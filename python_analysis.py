"""Local property calculations and a separate explicitly consented weather lookup."""

from __future__ import annotations

import importlib
import json
import math
import re
import threading
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from time import monotonic
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests


INSTALL_COMMAND = r".\.venv\Scripts\python.exe -m pip install -r requirements-analysis.txt"
LAUNCH_COMMAND = r".\.venv\Scripts\python.exe -B app.py"
MAX_PAYLOAD_BYTES = 8192
MAX_PATH_SAMPLES = 313
REFERENCE_ATMOSPHERE = {"altitudeM": 0.0, "pressurePa": 101325.0, "temperatureC": 15.0}
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_RESPONSE_BYTES = 32768
_PSYCHRO_LOCK = threading.Lock()


class AnalysisError(ValueError):
    def __init__(self, message: str, code="invalid_input", status=400, field=None):
        super().__init__(message)
        self.code, self.status, self.field = code, status, field

    def public(self):
        error = {"code": self.code, "message": str(self)}
        if self.field:
            error["field"] = self.field
        return {"status": "unavailable" if self.status == 503 else "error", "error": error}


def _object(value, allowed, name="input"):
    if not isinstance(value, dict):
        raise AnalysisError(f"Supply a JSON object for {name}.", field=name)
    if set(value) - set(allowed):
        raise AnalysisError(f"Unsupported {name} fields. Use the documented calculation inputs.", field=name)
    return value


def _number(value, name, low, high):
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise AnalysisError(f"Supply a finite number for {name}.", field=name)
    if not low <= value <= high:
        raise AnalysisError(f"{name} must be between {low:g} and {high:g}.", field=name)
    return float(value)


def _text(value, name, maximum=240):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise AnalysisError(f"Supply {name} as nonempty text (at most {maximum} characters).", field=name)
    return value


def _instant(value, name="instantUTC"):
    text = _text(value, name, 40)
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", text):
        raise AnalysisError(f"{name} needs an ISO timestamp with explicit UTC/offset and seconds.", field=name)
    try:
        result = datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        raise AnalysisError(f"{name} must be a real calendar instant.", field=name) from None
    if not 1900 <= result.year <= 2100:
        raise AnalysisError(f"{name} must be within 1900–2100.", field=name)
    return result


def _utc(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _source(value):
    if value is None:
        return {"kind": "manual", "label": "Supplied scenario inputs; not verified measurements"}
    _object(value, {"kind", "label", "weatherId", "recordTimestamp", "durationSeconds", "timeBasis"}, "source")
    result = {}
    for key, item in value.items():
        if key == "durationSeconds":
            result[key] = _number(item, key, 1, 86400)
        elif key == "recordTimestamp":
            _instant(item, key)
            result[key] = item
        else:
            result[key] = _text(item, key)
    if result.get("kind") not in {"manual", "weather-record", "site"}:
        raise AnalysisError("source.kind must be manual, weather-record or site.", field="source")
    return result


@lru_cache(maxsize=2)
def _dependencies(engine):
    try:
        if engine == "psychrolib":
            library = importlib.import_module("psychrolib")
            with _PSYCHRO_LOCK:
                library.SetUnitSystem(library.SI)
            return library, version("psychrolib")
        library = importlib.import_module("pvlib")
        pandas = importlib.import_module("pandas")
        # Check the same IANA provider used below; never guess a timezone offset.
        ZoneInfo("UTC")
        return library, pandas, version("pvlib")
    except Exception:
        raise AnalysisError(
            f"Local {engine} calculation is unavailable. Run {INSTALL_COMMAND}, then restart the local service.",
            "dependency_unavailable", 503,
        ) from None


def capabilities():
    features = {}
    for key, engine in (("airDensity", "psychrolib"), ("solarPosition", "pvlib")):
        try:
            dependencies = _dependencies(engine)
            features[key] = {"available": True, "engine": engine, "version": dependencies[-1]}
        except AnalysisError as exc:
            features[key] = {"available": False, "engine": engine, "error": exc.public()["error"]}
    available = sum(item["available"] for item in features.values())
    return {
        "status": "ready" if available == 2 else "partial" if available else "unavailable",
        "features": features,
        "limits": {"payloadBytes": MAX_PAYLOAD_BYTES, "solarPathSamples": MAX_PATH_SAMPLES,
                   "sampleMinutes": [5, 60], "years": [1900, 2100]},
        "installCommand": INSTALL_COMMAND, "launchCommand": LAUNCH_COMMAND,
    }


def calculate_density(data):
    _object(data, {"temperatureC", "rhPct", "pressurePa", "source"})
    temperature = _number(data.get("temperatureC"), "temperatureC", -100, 200)
    rh = _number(data.get("rhPct"), "rhPct", 0, 100)
    pressure = _number(data.get("pressurePa"), "pressurePa", 1000, 120000)
    source = _source(data.get("source"))
    library, library_version = _dependencies("psychrolib")
    with _PSYCHRO_LOCK:
        library.SetUnitSystem(library.SI)
        vapor = float(library.GetVapPresFromRelHum(temperature, rh / 100))
        if not math.isfinite(vapor) or vapor >= pressure:
            raise AnalysisError(
                "Total absolute pressure must exceed water-vapour partial pressure at this temperature/RH.",
                field="pressurePa",
            )
        humidity_ratio = float(library.GetHumRatioFromRelHum(temperature, rh / 100, pressure))
        density = float(library.GetMoistAirDensity(temperature, humidity_ratio, pressure))
        minimum = float(library.MIN_HUM_RATIO)
    if not all(math.isfinite(value) and value > 0 for value in (humidity_ratio, density)):
        raise AnalysisError("PsychroLib did not return a finite positive density.", "calculation_failed", 422)
    return {
        "status": "ok", "kind": "air-density",
        "inputs": {"temperatureC": temperature, "rhPct": rh, "pressurePa": pressure, "source": source},
        "output": {"densityKgM3": density, "humidityRatioKgKgDryAir": humidity_ratio,
                   "vapourPressurePa": vapor, "humidityRatioFloorApplied": humidity_ratio <= minimum},
        "units": {"densityKgM3": "kg/m³", "humidityRatioKgKgDryAir": "kg water/kg dry air",
                  "temperatureC": "°C", "rhPct": "%", "pressurePa": "Pa (absolute)"},
        "engine": {"name": "PsychroLib", "version": library_version,
                   "method": "SI GetHumRatioFromRelHum → GetMoistAirDensity",
                   "sourceURL": "https://psychrometrics.github.io/psychrolib/api_docs.html"},
        "assumptions": [
            "Moist-air property estimate for the supplied weather/scenario, not measured indoor air density.",
            "Absolute station/surface pressure, not sea-level-reduced pressure; no latitude-based density.",
            f"PsychroLib floors humidity ratio at {minimum:g} kg/kg dry air, including exactly 0% RH.",
            "One constant scenario density; no indoor moisture transport, temperature or comfort prediction.",
        ],
    }


def _now_utc():
    return datetime.now(timezone.utc)


def _weather_failure(message, code="weather_invalid_response", status=502):
    return AnalysisError(message + " Previous weather and airflow inputs were not replaced.", code, status)


def _read_current_weather(latitude, longitude):
    params = {
        "latitude": latitude, "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,surface_pressure",
        "temperature_unit": "celsius", "timeformat": "unixtime", "timezone": "GMT", "forecast_days": 1,
    }
    deadline = monotonic() + 10
    try:
        with requests.Session() as session:
            # Do not forward ambient netrc credentials, proxy settings or browser cookies.
            session.trust_env = False
            with session.get(OPEN_METEO_URL, params=params, timeout=(3.05, 6), stream=True,
                             allow_redirects=False, headers={"Accept": "application/json", "Accept-Encoding": "identity"}) as response:
                if response.status_code == 429:
                    raise _weather_failure("Open-Meteo's request limit was reached. Try again later.", "weather_rate_limited", 429)
                if response.status_code != 200:
                    raise _weather_failure("Open-Meteo is unavailable or redirected the request. Try again later.", "weather_unavailable")
                if response.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                    raise _weather_failure("Open-Meteo did not return JSON weather data.")
                if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise _weather_failure("Open-Meteo returned an unsupported compressed response.")
                body = bytearray()
                # Small uncompressed responses: check the elapsed budget even if
                # a provider drips bytes too slowly to fill a large read buffer.
                for chunk in response.iter_content(chunk_size=1):
                    if monotonic() > deadline:
                        raise requests.Timeout
                    body.extend(chunk)
                    if len(body) > WEATHER_RESPONSE_BYTES:
                        raise _weather_failure("Open-Meteo's response exceeded the small current-weather limit.")
                return json.loads(body)
    except requests.Timeout:
        raise _weather_failure("Open-Meteo timed out. Try again later.", "weather_timeout", 504) from None
    except requests.RequestException:
        raise _weather_failure("Open-Meteo could not be reached. Check connectivity and try again.", "weather_unavailable") from None
    except AnalysisError:
        raise
    except (ValueError, RecursionError):
        raise _weather_failure("Open-Meteo returned invalid JSON weather data.") from None


def calculate_current_weather_density(data):
    """Only this endpoint performs a fixed-provider network lookup; no file/cache writes."""
    _object(data, {"latitude", "longitude", "acknowledgeOpenMeteo"})
    latitude = _number(data.get("latitude"), "latitude", -90, 90)
    longitude = _number(data.get("longitude"), "longitude", -180, 180)
    if data.get("acknowledgeOpenMeteo") is not True:
        raise AnalysisError("Explicitly acknowledge sending the saved site coordinates to Open-Meteo.",
                            "external_lookup_not_acknowledged")
    # Do not disclose coordinates if the local calculation dependency is unavailable.
    _dependencies("psychrolib")
    raw = _read_current_weather(latitude, longitude)
    try:
        if not isinstance(raw, dict) or raw.get("error"):
            raise ValueError
        current, units = raw.get("current"), raw.get("current_units")
        expected = {"time": "unixtime", "interval": "seconds", "temperature_2m": "°C",
                    "relative_humidity_2m": "%", "surface_pressure": "hPa"}
        if not isinstance(current, dict) or not isinstance(units, dict) or any(units.get(key) != unit for key, unit in expected.items()):
            raise ValueError
        if raw.get("utc_offset_seconds") != 0:
            raise ValueError
        epoch = _number(current.get("time"), "current.time", -2208988800, 4133980799)
        interval = _number(current.get("interval"), "current.interval", 1, 3600)
        if epoch != int(epoch) or interval != int(interval):
            raise ValueError
        timestamp = datetime.fromtimestamp(epoch, timezone.utc)
        now = _now_utc()
        if not -3600 <= (now - timestamp).total_seconds() <= 10800:
            raise _weather_failure("Open-Meteo's returned timestamp is not current. Try again later.", "weather_stale")
        temperature = _number(current.get("temperature_2m"), "temperature_2m", -100, 200)
        rh = _number(current.get("relative_humidity_2m"), "relative_humidity_2m", 0, 100)
        # Never substitute pressure_msl or a standard-atmosphere density.
        pressure = _number(current.get("surface_pressure"), "surface_pressure", 10, 1200) * 100

        def optional(name, low, high):
            return None if raw.get(name) is None else _number(raw[name], name, low, high)

        grid_latitude = optional("latitude", -90, 90)
        grid_longitude = optional("longitude", -180, 180)
        elevation = optional("elevation", -500, 9000)
    except AnalysisError as exc:
        if exc.code == "weather_stale":
            raise
        raise _weather_failure("Open-Meteo did not supply complete, valid temperature, RH, surface-pressure or timestamp evidence.") from None
    except (ValueError, TypeError, OverflowError, OSError):
        raise _weather_failure("Open-Meteo returned missing values, unsupported units or invalid current-weather metadata.") from None
    label = "Open-Meteo current model sample"
    time_basis = "Modelled instant in UTC; intervalSeconds is the provider update interval, not an interval-end historical record."
    record = {"timestamp": _utc(timestamp), "intervalSeconds": int(interval),
              "temperatureC": temperature, "rhPct": rh, "pressurePa": pressure, "missing": []}
    weather = {
        "id": f"open-meteo-current:{latitude},{longitude}:{int(epoch)}",
        "kind": "current-model", "requestedSite": {"latitude": latitude, "longitude": longitude},
        "latitude": grid_latitude, "longitude": grid_longitude, "fetchedAtUTC": _utc(now),
        "timestampMeaning": time_basis, "records": [record],
        "units": {"temperatureC": "C", "rhPct": "%", "pressurePa": "Pa"},
        "source": {
            "label": label, "provider": "Open-Meteo", "format": "Open-Meteo current",
            "elevationM": elevation, "temperatureReferenceHeightM": 2,
            "model": "Provider best-match weather models; exact model/run not returned",
            "pressureMeaning": "Modelled surface pressure; not sea-level-reduced pressure_msl",
            "attribution": "Open-Meteo.com and its upstream weather providers",
            "license": "Weather data: CC BY 4.0. Free API: non-commercial use, subject to quotas and provider terms.",
            "documentation": "https://open-meteo.com/en/docs",
            "termsURL": "https://open-meteo.com/en/terms",
        },
    }
    source = {"kind": "weather-record", "label": label, "weatherId": weather["id"],
              "recordTimestamp": record["timestamp"], "timeBasis": time_basis}
    try:
        result = calculate_density({"temperatureC": temperature, "rhPct": rh, "pressurePa": pressure, "source": source})
    except AnalysisError as exc:
        if exc.status == 503:
            raise
        raise _weather_failure("Open-Meteo supplied an unsupported moist-air state for the local density calculation.") from None
    result["weather"] = weather
    result["assumptions"] += [
        "Explicit user-requested Open-Meteo current model sample, not measured on site or historical weather.",
        "Only the saved site coordinates and fixed weather parameters were sent to Open-Meteo; no project geometry or imported files.",
        "The fetched sample is session-only and must not replace an imported EPW/JSON dataset.",
        f"Requested site {latitude:g}, {longitude:g}; returned grid {grid_latitude}, {grid_longitude}; model elevation {elevation} m above sea level.",
    ]
    return result


def _day_boundary(day, zone):
    wall = datetime.combine(day, time.min)
    # A midnight clock jump can start a real civil day after 00:00. Resolve the
    # first valid wall minute, rather than accepting a nonexistent zone attachment.
    for minute in range(181):
        candidate = wall + timedelta(minutes=minute)
        instants = []
        for fold in (0, 1):
            instant = candidate.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
            if instant.astimezone(zone).replace(tzinfo=None) == candidate:
                instants.append(instant)
        if instants:
            return min(instants)
    raise AnalysisError("This civil-day boundary is skipped or unsupported; choose another date.", field="date")


def calculate_solar(data):
    _object(data, {"latitude", "longitude", "timeZone", "date", "instantUTC", "altitudeM",
                   "pressurePa", "temperatureC", "acknowledgeReferenceAtmosphere", "sampleMinutes", "source"})
    latitude = _number(data.get("latitude"), "latitude", -90, 90)
    longitude = _number(data.get("longitude"), "longitude", -180, 180)
    zone_name = _text(data.get("timeZone"), "timeZone", 100)
    day_text = _text(data.get("date"), "date", 10)
    try:
        if not re.fullmatch(r"\d{4}-\d\d-\d\d", day_text):
            raise ValueError
        day = date.fromisoformat(day_text)
        if not 1900 <= day.year <= 2100:
            raise ValueError
    except ValueError:
        raise AnalysisError("Choose a real civil date within 1900–2100.", field="date") from None
    instant = _instant(data.get("instantUTC"))
    sample_minutes = _number(data.get("sampleMinutes", 15), "sampleMinutes", 5, 60)
    if sample_minutes != int(sample_minutes):
        raise AnalysisError("sampleMinutes must be a whole number.", field="sampleMinutes")
    acknowledged = data.get("acknowledgeReferenceAtmosphere", False)
    if not isinstance(acknowledged, bool):
        raise AnalysisError("Reference-atmosphere acknowledgement must be a boolean.", field="acknowledgeReferenceAtmosphere")
    assumptions, atmosphere, reference_fields = [], {}, []
    for key, bounds in (("altitudeM", (-500, 9000)), ("pressurePa", (1000, 120000)), ("temperatureC", (-100, 100))):
        value = data.get(key)
        if value is None:
            if not acknowledged:
                raise AnalysisError(
                    "Supply altitude, absolute pressure and temperature, or explicitly acknowledge the displayed reference values.",
                    "reference_acknowledgement_required", field=key,
                )
            value = REFERENCE_ATMOSPHERE[key]
            reference_fields.append(key)
        atmosphere[key] = _number(value, key, *bounds)
    source = _source(data.get("source"))
    library, pandas, library_version = _dependencies("pvlib")
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise AnalysisError("Choose an available IANA time zone, e.g. Asia/Kolkata.", field="timeZone") from None
    start, end = _day_boundary(day, zone), _day_boundary(day + timedelta(days=1), zone)
    duration_seconds = (end - start).total_seconds()
    if not 20 * 3600 <= duration_seconds <= 26 * 3600:
        raise AnalysisError("This civil day is outside the supported 20–26 hour range.", field="date")
    if not start <= instant < end or instant.astimezone(zone).date() != day:
        raise AnalysisError("The selected instant must be on the selected civil date in its IANA zone.", field="instantUTC")
    step = timedelta(minutes=sample_minutes)
    times = [start]
    while times[-1] < end:
        times.append(min(times[-1] + step, end))
    if len(times) > MAX_PATH_SAMPLES:
        raise AnalysisError("Too many solar samples; choose a larger interval.", field="sampleMinutes")
    index = pandas.DatetimeIndex([instant, *times])
    positions = library.solarposition.get_solarposition(
        time=index, latitude=latitude, longitude=longitude,
        altitude=atmosphere["altitudeM"], pressure=atmosphere["pressurePa"],
        temperature=atmosphere["temperatureC"], method="nrel_numpy",
        delta_t=None, atmos_refract=0.5667,
    )

    def position(row, timestamp):
        values = {key: float(row[column]) for key, column in (
            ("azimuthDeg", "azimuth"), ("geometricElevationDeg", "elevation"),
            ("apparentElevationDeg", "apparent_elevation"),
        )}
        if not all(math.isfinite(value) for value in values.values()):
            raise AnalysisError("pvlib returned an unavailable solar position.", "calculation_failed", 422)
        if not (0 <= values["azimuthDeg"] <= 360
                and -90 <= values["geometricElevationDeg"] <= 90
                and -90 <= values["apparentElevationDeg"] <= 90):
            raise AnalysisError("pvlib returned an out-of-range solar position.", "calculation_failed", 422)
        return {"instantUTC": _utc(timestamp), "localTime": timestamp.astimezone(zone).isoformat(),
                **values, "aboveHorizon": values["apparentElevationDeg"] > 0}

    selected = position(positions.iloc[0], instant)
    path = [position(positions.iloc[i + 1], timestamp) for i, timestamp in enumerate(times)]
    for key in reference_fields:
        assumptions.append(f"Explicitly acknowledged reference {key} = {atmosphere[key]:g}; not a measured site/weather value.")
    assumptions += [
        "Altitude is metres above sea level, not the building's local base elevation.",
        "Supplied/reference pressure and temperature are held constant along this day's path, not a daily weather series.",
        "NREL SPA via nrel_numpy; delta_t=None uses pvlib's year/month polynomial estimate (TT–UT1).",
        "Refraction threshold atmos_refract = 0.5667°; apparent elevation uses the supplied/reference pressure and temperature.",
        "Azimuth is degrees clockwise from true north (N=0°, E=90°). Geometric elevation excludes atmospheric refraction.",
        "No terrain, building shadows, irradiance, energy, PV yield or indoor-comfort calculation.",
    ]
    return {
        "status": "ok", "kind": "solar-position",
        "inputs": {"latitude": latitude, "longitude": longitude, "timeZone": zone_name, "date": day_text,
                   "instantUTC": _utc(instant), **atmosphere, "referenceFields": reference_fields, "source": source},
        "output": {"selected": selected, "path": path, "day": {
            "startUTC": _utc(start), "endUTC": _utc(end), "durationHours": duration_seconds / 3600,
            "sampleMinutes": sample_minutes, "sampleCount": len(path),
            "sampling": "UTC-stepped samples including the next-day boundary; final interval clipped if necessary",
        }},
        "units": {"angles": "degrees", "altitudeM": "m above sea level", "pressurePa": "Pa (absolute)",
                  "temperatureC": "°C", "timestamps": "UTC instants and IANA local time with offset"},
        "engine": {"name": "pvlib", "version": library_version, "method": "solarposition.get_solarposition / nrel_numpy",
                   "sourceURL": "https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html",
                   "pandasVersion": version("pandas"), "tzdataVersion": _tzdata_version(),
                   "timeZoneProvider": "Python zoneinfo: system IANA database if configured, otherwise the installed tzdata package"},
        "assumptions": assumptions,
    }


def _tzdata_version():
    try:
        return version("tzdata")
    except PackageNotFoundError:
        return "system IANA database (version unavailable)"
