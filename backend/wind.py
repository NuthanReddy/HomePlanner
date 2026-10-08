"""Offline weather import and retained EnvironmentData record-count wind method."""

import csv
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, StrictInt

MAX_TEXT = 6 * 1024 * 1024
MAX_RECORDS = 200000
FIELDS = {
    "temperatureC": ("C", -100, 70, 99.9),
    "rhPct": ("%", 0, 100, 999),
    "pressurePa": ("Pa", 10000, 120000, 999999),
    "dniWm2": ("W/m2", 0, 1600, 9999),
    "dhiWm2": ("W/m2", 0, 1500, 9999),
    "ghiWm2": ("W/m2", 0, 2000, 9999),
    "windSpeedMps": ("m/s", 0, 150, 999),
    "windFromDeg": ("deg", 0, 360, 999),
}
UNITS = {key: rule[0] for key, rule in FIELDS.items()}
KINDS = {"unclassified", "historical", "reanalysis", "tmy", "forecast", "scenario"}
PROVIDER_FIELDS = dict(zip(FIELDS, (
    "temperature_2m", "relative_humidity_2m", "surface_pressure",
    "direct_normal_irradiance", "diffuse_radiation", "shortwave_radiation",
    "wind_speed_10m", "wind_direction_10m",
)))


class WeatherError(ValueError):
    pass


class WindInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    expected_version: StrictInt = Field(ge=0, le=2147483646)
    format: Literal["epw", "json"]
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    calm_threshold_mps: float = Field(default=0.5, ge=0, le=150, strict=True)
    months: list[StrictInt] = Field(default_factory=list, max_length=12)
    daytime: Literal["all", "day", "night"] = "all"
    day_start_hour: float = Field(default=6, ge=0, lt=24, strict=True)
    day_end_hour: float = Field(default=18, ge=0, le=24, strict=True)
    clock: Literal["source", "site"] = "source"


def finite(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def number(value):
    try:
        return float(value) if isinstance(value, str) and value.strip() else value
    except ValueError:
        return None


def warn(warnings, text):
    if text not in warnings:
        warnings.append(text)


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        return None
    try:
        if value[-1] != "Z" and (int(value[-5:-3]) > 14 or int(value[-2:]) > 59):
            return None
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if abs(result.utcoffset().total_seconds()) > 14 * 3600:
            return None
        return result.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def iso(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def converted(value, field, unit, duration):
    unit = re.sub(r"\s", "", unit).replace("²", "2").replace("°", "") if isinstance(unit, str) else ""
    if unit == UNITS[field] or (field == "temperatureC" and unit == "celsius"):
        return value
    if field == "temperatureC" and unit == "K":
        return value - 273.15
    if field == "pressurePa" and unit == "hPa":
        return value * 100
    if field in {"dniWm2", "dhiWm2", "ghiWm2"} and unit == "Wh/m2":
        return value * 3600 / duration
    if field == "windSpeedMps":
        return value * {"ms": 1, "km/h": 1 / 3.6, "kn": 1852 / 3600,
                        "knots": 1852 / 3600, "mph": 1609.344 / 3600}.get(unit, math.nan)
    if field == "windFromDeg" and unit in {"degrees", ""}:
        # Only the degree symbol itself is the supported empty normalized unit.
        return value if unit == "degrees" else math.nan
    return math.nan


def values(row, units, duration, warnings, strings=False):
    result, missing = {}, []
    prior = row.get("missing", [])
    for key, (_, low, high, sentinel) in FIELDS.items():
        raw = number(row.get(key)) if strings else row.get(key)
        value = None
        if finite(raw) and raw != sentinel and key not in prior:
            value = raw if key == "windFromDeg" and units.get(key) == "°" else converted(raw, key, units.get(key), duration)
        if not finite(value) or not low <= value <= high:
            result[key] = None
            missing.append(key)
            if raw is not None and raw != sentinel and key not in prior:
                warn(warnings, f"{key}: invalid values or unsupported units became null (accepted range {low}–{high} {UNITS[key]}).")
        else:
            result[key] = 0 if key == "windFromDeg" and value == 360 else value
    result["missing"] = missing
    return result


def coordinate(value, label, limit, warnings):
    if finite(value) and abs(value) <= limit:
        return value
    warn(warnings, f"{label} is missing or invalid; these data do not establish the building site.")
    return None


def kind(value, warnings):
    if not isinstance(value, str) or value not in KINDS or value == "unclassified":
        warn(warnings, "Weather classification is unconfirmed. Retain source evidence before labelling historical, reanalysis, TMY, forecast or scenario.")
    return value if isinstance(value, str) and value in KINDS else "unclassified"


def finish(dataset, records, warnings):
    if len(records) > MAX_RECORDS:
        raise WeatherError(f"At most {MAX_RECORDS} weather records are supported.")
    seen, unique = set(), []
    duplicates = out_of_order = 0
    previous = None
    for row in records:
        time = instant(row["timestamp"])
        if time in seen:
            duplicates += 1
            continue
        if previous and time < previous:
            out_of_order += 1
        seen.add(time)
        previous = time
        unique.append(row)
    if not unique:
        raise WeatherError("No valid weather intervals were found. Check timestamps, dates, durations and file structure.")
    if duplicates:
        warn(warnings, f"{duplicates} duplicate timestamp(s) discarded; the first interval was retained.")
    if out_of_order:
        warn(warnings, f"{out_of_order} out-of-order timestamp(s); source order and source years retained.")
    ordered = sorted(unique, key=lambda row: row["timestamp"])
    gaps = overlaps = 0
    for index, row in enumerate(ordered):
        if index:
            delta = (instant(row["timestamp"]) - timedelta(seconds=row["durationSeconds"]) -
                     instant(ordered[index - 1]["timestamp"])).total_seconds()
            gaps += delta > .001
            overlaps += delta < -.001
    if gaps:
        warn(warnings, f"{gaps} coverage gap(s); missing hours are not interpolated or replaced with zeros.")
    if overlaps:
        warn(warnings, f"{overlaps} overlapping interval(s); totals are not a continuous history.")
    for key in FIELDS:
        count = sum(row[key] is None for row in unique)
        if count:
            warn(warnings, f"{count} of {len(unique)} records missing {key}.")
    if dataset["kind"] == "tmy":
        warn(warnings, "TMY is a synthetic typical year, not observed chronological history. Original source years are preserved.")
    start = instant(ordered[0]["timestamp"]) - timedelta(seconds=ordered[0]["durationSeconds"])
    end = instant(ordered[-1]["timestamp"])
    if (end - start).total_seconds() < 8760 * 3600:
        warn(warnings, "Coverage is shorter than a full year; a partial record is not an annual climate normal.")
    warn(warnings, "Even full-year coverage alone does not establish an annual climate normal.")
    return {**dataset, "records": unique, "units": UNITS, "warnings": warnings,
            "timestampMeaning": "Interval end in UTC. Radiation is a mean over the preceding durationSeconds; other variable sampling follows source metadata.",
            "coverage": {"startUTC": iso(start), "endUTC": iso(end), "recordCount": len(unique),
                         "intervalHours": sum(row["durationSeconds"] for row in unique) / 3600,
                         "gaps": gaps, "overlaps": overlaps, "duplicates": duplicates,
                         "chronological": out_of_order == 0 and dataset["kind"] != "tmy"}}


def parse_epw(text):
    lines = [line for line in text.lstrip("\ufeff").splitlines() if line.strip()]
    if len(lines) < 9:
        raise WeatherError("An EPW file needs eight header lines followed by weather rows.")
    if len(lines) - 8 > MAX_RECORDS:
        raise WeatherError("EPW exceeds the supported record budget.")
    try:
        headers = [next(csv.reader([line], strict=True)) for line in lines[:8]]
    except csv.Error:
        raise WeatherError("Malformed EPW header CSV.") from None
    expected = ["LOCATION", "DESIGN CONDITIONS", "TYPICAL/EXTREME PERIODS", "GROUND TEMPERATURES",
                "HOLIDAYS/DAYLIGHT SAVINGS", "COMMENTS 1", "COMMENTS 2", "DATA PERIODS"]
    for index, name in enumerate(expected):
        if not headers[index] or headers[index][0].strip().upper() != name:
            raise WeatherError(f"EPW header {index + 1} must be {name}.")
    location, periods = headers[0], headers[7]
    if len(location) < 10 or len(periods) < 3:
        raise WeatherError("EPW LOCATION or DATA PERIODS metadata is incomplete.")
    offset, per_hour, period_count = number(location[8]), number(periods[2]), number(periods[1])
    if not finite(offset) or not -12 <= offset <= 14:
        raise WeatherError("EPW LOCATION needs a local-standard UTC offset between −12 and +14 hours.")
    if not finite(per_hour) or not float(per_hour).is_integer() or not 1 <= per_hour <= 60 or 60 % per_hour:
        raise WeatherError("EPW records per hour must divide 60.")
    if not finite(period_count) or not float(period_count).is_integer() or period_count < 1:
        raise WeatherError("EPW DATA PERIODS has an invalid period count.")
    warnings, records = [], []
    if period_count != 1:
        warn(warnings, "EPW declares multiple periods; review reported gaps and source metadata.")
    if len(periods) < 3 + period_count * 4:
        warn(warnings, "EPW DATA PERIODS metadata is incomplete.")
    for index in range(min(int(period_count), max(0, math.ceil((len(periods) - 3) / 4)))):
        for position in (5 + index * 4, 6 + index * 4):
            label = periods[position] if position < len(periods) else ""
            match = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", label)
            try:
                if not match:
                    raise ValueError()
                datetime(int(match[3] or 2000), int(match[1]), int(match[2]))
            except ValueError:
                warn(warnings, "EPW DATA PERIODS has an invalid/missing calendar boundary; actual row timestamps retained.")
    duration = 3600 / per_hour
    units = {**UNITS, **dict.fromkeys(("dniWm2", "dhiWm2", "ghiWm2"), "Wh/m2")}
    bad = 0
    for line in lines[8:]:
        try:
            row = next(csv.reader([line], strict=True))
            if len(row) < 35:
                raise ValueError()
            raw = [number(value) for value in row[:5]]
            if not all(finite(value) and float(value).is_integer() for value in raw):
                raise ValueError()
            year, month, day, hour, minute = map(int, raw)
            if not 1 <= hour <= 24 or not 1 <= minute <= 60 or minute % (60 / per_hour):
                raise ValueError()
            end = datetime(year, month, day, tzinfo=timezone.utc) + timedelta(
                hours=hour - 1 - offset, minutes=minute)
            data = dict(zip(FIELDS, (row[6], row[8], row[9], row[14], row[15], row[13], row[21], row[20])))
            records.append({"timestamp": iso(end), "durationSeconds": duration,
                            **values(data, units, duration, warnings, strings=True),
                            "sourceTime": dict(zip(("year", "month", "day", "hour", "minute"), (year, month, day, hour, minute)))})
        except (ValueError, OverflowError, csv.Error):
            bad += 1
    if bad:
        warn(warnings, f"{bad} malformed EPW row(s) skipped: require 35 fields, real dates, hours 1–24 and aligned interval-end minutes.")
    evidence = " ".join([location[4], *headers[5], *headers[6]])
    classification = "tmy" if re.search(r"\b(?:TMY[A-Za-z0-9]*|IWEC2?|typical\s+meteorological)\b", evidence, re.I) else kind(None, warnings)
    source = {"label": " · ".join(value for value in (location[1], location[3], location[4]) if value),
              "format": "EPW", "city": location[1], "country": location[3], "dataSource": location[4],
              "stationId": location[5], "elevationM": number(location[9]) if finite(number(location[9])) else None,
              "headers": {row[0]: row[1:] for row in headers}, "recordsPerHour": per_hour,
              "timeBasis": "Local standard time; fixed UTC offset, no DST",
              "radiationOriginalUnit": "Wh/m2", "radiationConversion": "Wh/m2 × 3600 / durationSeconds → W/m2",
              "observationTiming": "EPW end-of-interval fields; radiation integrated over the preceding interval",
              "windReferenceHeightM": None,
              "license": "Supplied by file owner; EPW format does not establish redistribution rights."}
    warn(warnings, "EPW uses local standard time, not the site IANA daylight-saving clock. Radiation Wh/m2 was divided by interval hours.")
    return finish({"kind": classification, "source": source,
                   "latitude": coordinate(number(location[6]), "Latitude", 90, warnings),
                   "longitude": coordinate(number(location[7]), "Longitude", 180, warnings),
                   "timeZoneOffsetHours": offset}, records, warnings)


def parse_json(text):
    try:
        data = json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, RecursionError):
        raise WeatherError("Weather JSON is invalid; nonfinite JSON values are not supported.") from None
    if isinstance(data, dict) and isinstance(data.get("hourly"), dict):
        return from_open_meteo(data)
    warnings = []
    if isinstance(data, list):
        data = {"records": data}
        warn(warnings, "Bare record array: source, classification and location metadata were not supplied.")
    if not isinstance(data, dict) or not isinstance(data.get("records"), list):
        raise WeatherError("Weather JSON needs a records array or an Open-Meteo hourly response.")
    if len(data["records"]) > MAX_RECORDS:
        raise WeatherError("Weather JSON exceeds the supported record budget.")
    if "units" in data and not isinstance(data["units"], dict):
        raise WeatherError("Weather units must be an object keyed by normalized field name.")
    units = {**UNITS, **data.get("units", {})}
    if "units" not in data:
        warn(warnings, "No units object: canonical names imply C, %, Pa, W/m2, m/s and degrees FROM true north.")
    for message in data.get("warnings", []) if isinstance(data.get("warnings"), list) else []:
        if isinstance(message, str):
            warn(warnings, message)
    records, bad = [], 0
    for row in data["records"]:
        end = instant(row.get("timestamp")) if isinstance(row, dict) else None
        duration = row.get("durationSeconds") if isinstance(row, dict) else None
        if not end or not finite(duration) or not 0 < duration <= 86400 or not isinstance(row.get("missing", []), list):
            bad += 1
            continue
        normalized = {"timestamp": iso(end), "durationSeconds": duration, **values(row, units, duration, warnings),
                      **({"sourceTime": row["sourceTime"]} if isinstance(row.get("sourceTime"), dict) else {})}
        if "requestedOverlapSeconds" in row:
            overlap = row["requestedOverlapSeconds"]
            if finite(overlap) and 0 < overlap <= duration:
                normalized["requestedOverlapSeconds"] = overlap
            else:
                warn(warnings, "Invalid requestedOverlapSeconds metadata discarded; original intervals unchanged.")
        records.append(normalized)
    if bad:
        warn(warnings, f"{bad} malformed JSON record(s) skipped: timestamps require real dates and an explicit UTC/offset suffix; durationSeconds must be > 0 and ≤ 86400.")
    source = data.get("source")
    source = {"label": source} if isinstance(source, str) else source if isinstance(source, dict) else {"label": "Local weather JSON", "format": "Normalized weather JSON"}
    dataset = {"kind": kind(data.get("kind"), warnings), "source": source,
               "latitude": coordinate(data.get("latitude"), "Latitude", 90, warnings),
               "longitude": coordinate(data.get("longitude"), "Longitude", 180, warnings)}
    if "timeZoneOffsetHours" in data:
        offset = data["timeZoneOffsetHours"]
        if not finite(offset) or not -12 <= offset <= 14:
            raise WeatherError("timeZoneOffsetHours must be finite and between −12 and +14.")
        dataset["timeZoneOffsetHours"] = offset
    return finish(dataset, records, warnings)


def from_open_meteo(data):
    if data.get("error"):
        raise WeatherError("The supplied Open-Meteo response reports a provider error.")
    hourly = data["hourly"]
    if not isinstance(hourly.get("time"), list):
        raise WeatherError("Open-Meteo response needs hourly.time as an array.")
    if len(hourly["time"]) > MAX_RECORDS:
        raise WeatherError("Open-Meteo response exceeds the supported record budget.")
    provided = data.get("hourly_units", {})
    provided = provided if isinstance(provided, dict) else {}
    warnings, records = [], []
    for field, provider in PROVIDER_FIELDS.items():
        if not isinstance(hourly.get(provider), list):
            warn(warnings, f"Open-Meteo {provider} is missing or not an array; {field} is null.")
        elif len(hourly[provider]) != len(hourly["time"]):
            warn(warnings, f"Open-Meteo {provider} length differs from time; absent elements stay null, excess elements ignored.")
        if not isinstance(provided.get(provider), str):
            warn(warnings, f"Open-Meteo unit for {provider} is missing; values cannot safely be interpreted.")
    units = {field: provided.get(provider) for field, provider in PROVIDER_FIELDS.items()}
    zone = data.get("timezone")
    utc = isinstance(zone, str) and zone in {"UTC", "GMT", "Etc/UTC", "Etc/GMT"} and data.get("utc_offset_seconds", 0) == 0
    bad = 0
    for index, time in enumerate(hourly["time"]):
        end = None
        try:
            if finite(time) and provided.get("time", "unixtime") == "unixtime":
                end = datetime.fromtimestamp(time, timezone.utc)
            elif isinstance(time, str):
                end = instant(time) or (instant(time + "Z") if utc else None)
        except (ValueError, OverflowError, OSError):
            pass
        if not end:
            bad += 1
            continue
        row = {}
        for field, provider in PROVIDER_FIELDS.items():
            array = hourly.get(provider)
            row[field] = array[index] if isinstance(array, list) and index < len(array) and isinstance(units[field], str) else None
        records.append({"timestamp": iso(end), "durationSeconds": 3600, **values(row, units, 3600, warnings)})
    if bad:
        warn(warnings, f"{bad} invalid or ambiguous Open-Meteo timestamps skipped; local clocks are not shifted by a guessed offset.")
    warn(warnings, "Gridded/model weather is not measured at the house. Wind at 10 m is not window-height or occupant airspeed.")
    warn(warnings, "Radiation is a preceding-hour mean; other variables are instantaneous model fields. No interpolation performed.")
    return finish({"kind": kind(data.get("kind"), warnings),
                   "source": {"label": "Open-Meteo hourly weather", "format": "Open-Meteo hourly", "provider": "Open-Meteo",
                              "model": data.get("model", "Not identified; retain original request"),
                              "originalUnits": provided, "windReferenceHeightM": 10,
                              "returnedTimeZone": data.get("timezone"), "returnedUTCOffsetSeconds": data.get("utc_offset_seconds"),
                              "radiationTiming": "Mean W/m2 over preceding hour ending at timestamp",
                              "otherVariableTiming": "Instantaneous model values at timestamp",
                              "attribution": "Open-Meteo.com and indicated upstream weather datasets",
                              "license": "CC BY 4.0 weather attribution; API service terms are separate."},
                   "latitude": coordinate(data.get("latitude"), "Latitude", 90, warnings),
                   "longitude": coordinate(data.get("longitude"), "Longitude", 180, warnings),
                   "timeZoneOffsetHours": 0}, records, warnings)


def wind_rose(records, inputs, clock):
    if any(month < 1 or month > 12 for month in inputs.months):
        raise WeatherError("Wind-rose months must be month numbers 1–12.")
    if inputs.day_start_hour == inputs.day_end_hour:
        raise WeatherError("Choose a nonempty daytime clock window.")
    bins = [{"directionDeg": index * 22.5, "count": 0, "meanSpeedMps": None} for index in range(16)]
    sums = [0.0] * 16
    calm = missing = total = excluded = 0
    speed_values = []
    selected = []
    for row in records:
        local = instant(row["timestamp"]).astimezone(clock)
        hour = local.hour + local.minute / 60
        day = (inputs.day_start_hour <= hour < inputs.day_end_hour if inputs.day_start_hour < inputs.day_end_hour
               else hour >= inputs.day_start_hour or hour < inputs.day_end_hour)
        if (inputs.months and local.month not in inputs.months) or (inputs.daytime == "day" and not day) or (inputs.daytime == "night" and day):
            excluded += 1
            continue
        total += 1
        selected.append(row)
        speed, direction = row["windSpeedMps"], row["windFromDeg"]
        if speed is None:
            missing += 1
            continue
        speed_values.append(speed)
        if speed == 0 or speed < inputs.calm_threshold_mps:
            calm += 1
            continue
        if direction is None:
            missing += 1
            continue
        index = int(((direction % 360) + 11.25) // 22.5) % 16
        bins[index]["count"] += 1
        sums[index] += speed
    for index, entry in enumerate(bins):
        if entry["count"]:
            entry["meanSpeedMps"] = sums[index] / entry["count"]
    return ({"bins": bins, "calmCount": calm, "missingCount": missing, "total": total,
            "excludedCount": excluded, "unknownTimeCount": 0, "calmThresholdMps": inputs.calm_threshold_mps,
            "directionConvention": "Meteorological FROM, clockwise from true north",
            "frequencyBasis": "Record count, not duration-weighted; do not mix interval lengths as hourly frequencies",
            "timeBasis": str(clock),
            "daytimeDefinition": {"mode": inputs.daytime, "startHour": inputs.day_start_hour, "endHour": inputs.day_end_hour,
                                  "meaning": "Clock-hour filter, not astronomical daylight"},
            "speedStatistics": {"validSpeedCount": len(speed_values),
                                "meanSpeedMps": sum(speed_values) / len(speed_values) if speed_values else None,
                                "maxSpeedMps": max(speed_values) if speed_values else None,
                                "basis": "Unweighted valid speed records, including calm and records with missing direction"}},
            selected)


def calculate_wind(site, inputs):
    if len(inputs.text.encode("utf-8")) > MAX_TEXT:
        raise WeatherError("Weather text exceeds the 6 MiB UTF-8 budget.")
    try:
        dataset = parse_epw(inputs.text) if inputs.format == "epw" else parse_json(inputs.text)
    except (OverflowError, RecursionError):
        raise WeatherError("Weather data exceeds supported date or nesting bounds.") from None
    if inputs.clock == "site":
        if not site.time_zone:
            raise WeatherError("Apply a Site IANA time zone before choosing the Site filter clock.")
        clock = ZoneInfo(site.time_zone)
    else:
        offset = dataset.get("timeZoneOffsetHours")
        if offset is None:
            raise WeatherError("Source has no declared fixed UTC offset. Choose the applied Site clock, or supply timeZoneOffsetHours in JSON.")
        clock = timezone(timedelta(hours=offset))
    rose, selected = wind_rose(dataset["records"], inputs, clock)
    durations = {row["durationSeconds"] for row in selected}
    if len(durations) > 1:
        warn(dataset["warnings"], "Selected intervals have mixed lengths; rose percentages describe records, not elapsed hours.")
    status = "empty-filter" if rose["total"] == 0 else "missing-wind" if rose["missingCount"] == rose["total"] else "ok"
    return {"status": status, "kind": "weather-wind-rose",
            "method": {"name": "HomePlanner retained EnvironmentData method",
                       "version": "python-weather-v1",
                       "implementation": "Python standard library csv/json/datetime/zoneinfo; 16-sector arithmetic port, not Ladybug/CFD",
                       "reference": "environment-data.js parseEPW / parseWeatherJSON / fromOpenMeteo / windRose"},
            "inputFingerprint": hashlib.sha256(json.dumps(
                {**inputs.model_dump(exclude={"expected_version", "text"}), "textSHA256": hashlib.sha256(inputs.text.encode()).hexdigest(),
                 "siteTimeZone": site.time_zone if inputs.clock == "site" else None},
                sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "weather": {key: value for key, value in dataset.items() if key != "records"},
            "rose": rose, "preview": selected[:100], "previewCount": min(100, len(selected)),
            "selectedRecordCount": len(selected),
            "limitations": [
                "Imported intervals only; no automatic weather fetch, window proposal, facade pressure, room airflow or ventilation performance.",
                "Wind directions are FROM true north; weather coordinates do not change the building site.",
                "Calm includes zero speed even when threshold is zero. Missing direction is not missing wind for calm records.",
                "Session-only inputs/results; retain original files. A current sample is not annual climate.",
                "Clock filters use interval-end timestamps, not astronomical daylight or duration-overlap weighting.",
            ]}
