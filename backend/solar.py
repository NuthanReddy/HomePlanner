"""Site-bound pvlib adapter with explicit IANA civil-clock resolution."""

from datetime import date, datetime, timedelta, timezone
import math
from time import monotonic
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import Field
from fastapi import HTTPException

import python_analysis
from .workspace import Site, StrictModel


class SolarInput(StrictModel):
    expected_version: int = Field(ge=0)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    local_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    occurrence: Literal["earlier", "later"] | None = None
    altitude_m: float | None = Field(default=None, ge=-500, le=9000)
    pressure_pa: float | None = Field(default=None, ge=1000, le=120000)
    temperature_c: float | None = Field(default=None, ge=-100, le=100)
    acknowledge_reference: bool = False
    sample_minutes: int = Field(default=15, ge=5, le=60)
    pole_height_m: float | None = Field(default=None, gt=0, le=1000)
    low_sun_cutoff_deg: float = Field(default=1, ge=0, le=10)


def resolve_clock(day, clock, zone_name, occurrence):
    try:
        wall = datetime.fromisoformat(f"{day}T{clock}")
        if not 1900 <= wall.year <= 2100:
            raise ValueError
    except ValueError:
        raise HTTPException(422, "Supply a real civil date (1900–2100) and local clock time.") from None
    zone = ZoneInfo(zone_name)
    candidates = sorted({
        wall.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
        for fold in (0, 1)
        if wall.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == wall
    })
    if not candidates:
        raise HTTPException(422, "This local clock time is skipped by a time-zone change. Choose another time.")
    if len(candidates) > 1 and occurrence is None:
        raise HTTPException(422, "This local time occurs twice. Select the earlier or later occurrence.")
    return candidates[-1] if occurrence == "later" else candidates[0]


def calculate_site_solar(site: Site, inputs: SolarInput):
    deadline = monotonic() + 20
    if site.latitude is None or site.longitude is None or site.time_zone is None:
        raise HTTPException(422, "Apply site latitude and longitude to resolve the time zone before calculating Solar.")
    instant = resolve_clock(inputs.date, inputs.local_time, site.time_zone, inputs.occurrence)
    result = python_analysis.calculate_solar({
        "latitude": site.latitude, "longitude": site.longitude, "timeZone": site.time_zone,
        "date": inputs.date, "instantUTC": instant.isoformat(),
        "altitudeM": inputs.altitude_m, "pressurePa": inputs.pressure_pa,
        "temperatureC": inputs.temperature_c, "acknowledgeReferenceAtmosphere": inputs.acknowledge_reference,
        "sampleMinutes": inputs.sample_minutes,
        "source": {"kind": "site", "label": f"Applied native Site at workspace version {inputs.expected_version}; not a surveyed-site verification"},
    })
    result["inputs"].update(localClock=inputs.local_time, occurrence=inputs.occurrence,
                            poleHeightM=inputs.pole_height_m, lowSunCutoffDeg=inputs.low_sun_cutoff_deg)
    result["output"]["charts"] = site_charts(site, inputs, result, deadline)
    result["assumptions"] += [
        "Seasonal paths retain HomeSun's equidistant sky projection, fixed reference dates and civil-clock series semantics; the ephemeris is pvlib SPA, not SunCalc.",
        "Reference daily paths use 5-minute UTC steps. Annual/hourly curves have one point per calendar date, not hourly weather or annual energy.",
        "Skipped civil times are unavailable; repeated annual times use the requested occurrence, or explicitly labelled earlier when no choice was supplied.",
        "SPA sunrise/sunset use its standard -0.8333 degree geometric solar-centre horizon; these event times do not use the supplied pressure/temperature.",
        "Pole shadows use apparent elevation and height/tan(elevation) on level unobstructed ground. Low-sun omissions are not zero shade.",
    ]
    return result


def pole_shadow(point, height, cutoff):
    elevation = point["apparentElevationDeg"]
    status = "unknown-height" if height is None else "night" if elevation <= 0 else "low-sun" if elevation < cutoff else "available"
    length = height / math.tan(math.radians(elevation)) if status == "available" and elevation < 90 else 0 if status == "available" else None
    if length is not None and not math.isfinite(length):
        raise python_analysis.AnalysisError("Pole shadow is not finite at this near-horizon elevation; use an explicit low-sun cutoff.", "calculation_failed", 422)
    return {"status": status, "lengthM": length,
            "bearingDeg": (point["azimuthDeg"] + 180) % 360 if status == "available" else None}


def check_budget(deadline):
    if monotonic() > deadline:
        raise HTTPException(503, "Solar calculation exceeded its 20-second cooperative budget; no result was attached.")


def site_charts(site, inputs, result, deadline):
    """Batch bounded calendar series; never consume or synthesize house geometry."""
    library, pandas, _ = python_analysis._dependencies("pvlib")
    zone = ZoneInfo(site.time_zone)
    year = date.fromisoformat(inputs.date).year
    atmosphere = result["inputs"]
    timestamps, paths, clocks = [], [], []

    def append_time(instant):
        timestamps.append(instant)
        return len(timestamps) - 1

    reference_dates = [(date(year, month, 21), "june-solstice" if month == 6 else "december-solstice" if month == 12 else "monthly")
                       for month in range(1, 13)]
    reference_dates += [(date(year, 3, 20), "march-equinox"), (date(year, 9, 22), "september-equinox")]
    for day, kind in sorted(reference_dates):
        try:
            start = python_analysis._day_boundary(day, zone)
            end = python_analysis._day_boundary(day + timedelta(days=1), zone)
        except python_analysis.AnalysisError:
            paths.append({"date": day.isoformat(), "kind": kind, "durationHours": 0, "indices": [], "status": "unsupported civil date"})
            continue
        duration = (end - start).total_seconds() / 3600
        if not 20 <= duration <= 26:
            paths.append({"date": day.isoformat(), "kind": kind, "durationHours": duration, "indices": [], "status": "unsupported civil date"})
            continue
        times = [start]
        while times[-1] < end:
            times.append(min(times[-1] + timedelta(minutes=5), end))
        paths.append({"date": day.isoformat(), "kind": kind, "durationHours": duration,
                      "indices": [append_time(t) for t in times], "status": "available"})
    day_count = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    for clock in dict.fromkeys([inputs.local_time, *(f"{hour:02}:00" for hour in range(24))]):
        check_budget(deadline)
        rows = []
        for offset in range(day_count):
            day = date(year, 1, 1) + timedelta(days=offset)
            wall = datetime.fromisoformat(f"{day}T{clock}")
            candidates = sorted({
                wall.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
                for fold in (0, 1)
                if wall.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == wall
            })
            row = {"date": day.isoformat(), "status": "skipped local time", "index": None}
            if candidates:
                instant = candidates[-1] if inputs.occurrence == "later" else candidates[0]
                row.update(index=append_time(instant), status=f"{inputs.occurrence or 'earlier'} repeated time" if len(candidates) > 1 else "available")
            rows.append(row)
        clocks.append({"time": clock, "rows": rows})
    # Fixed limits cover leap years, 25-hour reference dates and a non-hour selected clock.
    if len(timestamps) > 14000:
        raise HTTPException(422, "Seasonal solar sample bound exceeded.")
    positions = library.solarposition.get_solarposition(
        time=pandas.DatetimeIndex(timestamps), latitude=site.latitude, longitude=site.longitude,
        altitude=atmosphere["altitudeM"], pressure=atmosphere["pressurePa"],
        temperature=atmosphere["temperatureC"], method="nrel_numpy", delta_t=None, atmos_refract=0.5667)
    check_budget(deadline)
    points = []
    for timestamp, (_, row) in zip(timestamps, positions.iterrows()):
        values = [float(row[key]) for key in ("azimuth", "elevation", "apparent_elevation")]
        if not all(math.isfinite(value) for value in values):
            raise python_analysis.AnalysisError("pvlib seasonal position unavailable.", "calculation_failed", 422)
        points.append({"instantUTC": python_analysis._utc(timestamp), "localTime": timestamp.astimezone(zone).isoformat(),
                       "azimuthDeg": values[0], "geometricElevationDeg": values[1], "apparentElevationDeg": values[2],
                       "aboveHorizon": values[2] > 0})
    for path in paths:
        path["samples"] = [points[i] for i in path.pop("indices")]
    for curve in clocks:
        for row in curve["rows"]:
            index = row.pop("index")
            row["position"] = points[index] if index is not None else None
    selected_curve = next(curve for curve in clocks if curve["time"] == inputs.local_time)
    daylight = [p for p in result["output"]["path"][:-1] if p["aboveHorizon"]]
    pole = {"heightM": inputs.pole_height_m, "lowSunCutoffDeg": inputs.low_sun_cutoff_deg,
            "selected": pole_shadow(result["output"]["selected"], inputs.pole_height_m, inputs.low_sun_cutoff_deg),
            "path": [pole_shadow(p, inputs.pole_height_m, inputs.low_sun_cutoff_deg) for p in result["output"]["path"]]}
    return {
        "schemaVersion": 1, "year": year, "sampleCount": len(timestamps), "referenceSampleMinutes": 5,
        "references": paths, "annual": selected_curve,
        "hourly": sorted((curve for curve in clocks if curve["time"].endswith(":00")), key=lambda curve: curve["time"]),
        "monthly": [{"date": day.isoformat(), "times": [
            {"time": clock, **next(row for row in next(curve for curve in clocks if curve["time"] == clock)["rows"] if row["date"] == day.isoformat())}
            for clock in ("09:00", "12:00", "15:00")]} for day, _ in reference_dates[:12]],
        "extrema": {"min": min(daylight, key=lambda p: p["apparentElevationDeg"]),
                    "max": max(daylight, key=lambda p: p["apparentElevationDeg"])} if daylight else None,
        "summary": event_summary(library, pandas, site, inputs, result, deadline), "pole": pole,
        "geometry": {"status": "legacy-only", "reason": "This Python astronomical response contains no house geometry. The separate house section uses the actual imported Design planner and incumbent sunlight kernel; no envelope or sample house is used. Weather irradiance remains unavailable here."},
    }


def event_summary(library, pandas, site, inputs, result, deadline):
    from scipy.optimize import brentq

    zone = ZoneInfo(site.time_zone)
    noon = resolve_clock(inputs.date, "12:00", site.time_zone, "earlier")
    candidates = library.solarposition.sun_rise_set_transit_spa(
        pandas.DatetimeIndex([noon + timedelta(days=offset) for offset in (-1, 0, 1)]),
        latitude=site.latitude, longitude=site.longitude, delta_t=None)
    cycle = min((row for _, row in candidates.iterrows()), key=lambda row: abs((row["transit"].to_pydatetime(warn=False) - noon).total_seconds()))
    events = {name: None if pandas.isna(cycle[key]) else cycle[key].to_pydatetime(warn=False).astimezone(zone).isoformat()
              for name, key in (("sunrise", "sunrise"), ("solarNoon", "transit"), ("sunset", "sunset"))}
    sunrise, sunset = events["sunrise"], events["sunset"]
    status, hours = "incomplete", None
    if sunrise and sunset:
        hours = (datetime.fromisoformat(sunset).astimezone(timezone.utc) - datetime.fromisoformat(sunrise).astimezone(timezone.utc)).total_seconds() / 3600
        status = "sunrise-sunset"
    elif sunrise is None and sunset is None:
        elevations = [point["geometricElevationDeg"] for point in result["output"]["path"]]
        if min(elevations) > -0.8333:
            status = "polar-day"
        elif max(elevations) < -0.8333:
            status, hours = "polar-night", 0
    transit = cycle["transit"].to_pydatetime(warn=False)
    times = [transit + timedelta(minutes=5 * step) for step in range(-216, 217)]
    atmosphere = result["inputs"]

    def elevation_at(instants):
        check_budget(deadline)
        return library.solarposition.get_solarposition(
            pandas.DatetimeIndex(instants), latitude=site.latitude, longitude=site.longitude,
            altitude=atmosphere["altitudeM"], pressure=atmosphere["pressurePa"],
            temperature=atmosphere["temperatureC"], method="nrel_numpy", delta_t=None)["elevation"]

    elevations = list(elevation_at(times))
    phases = []
    for name, morning, evening, threshold in (
        ("Civil twilight", "dawn", "dusk", -6), ("Nautical twilight", "nauticalDawn", "nauticalDusk", -12),
        ("Astronomical twilight", "nightEnd", "night", -18), ("Golden hour", "goldenHourEnd", "goldenHour", 6),
    ):
        rising, falling = [], []
        for index in range(len(times) - 1):
            a, b = elevations[index] - threshold, elevations[index + 1] - threshold
            if (a < 0 <= b) or (a >= 0 > b):
                start = times[index]
                try:
                    root = brentq(lambda seconds: float(elevation_at([start + timedelta(seconds=seconds)]).iloc[0]) - threshold,
                                  0, 300, xtol=0.1, maxiter=20)
                except (ValueError, RuntimeError):
                    raise python_analysis.AnalysisError("SPA phase crossing solver did not converge within its bound.", "calculation_failed", 422) from None
                (rising if b > a else falling).append(start + timedelta(seconds=root))
        rise = max((t for t in rising if t <= transit), default=None)
        setting = min((t for t in falling if t >= transit), default=None)
        events[morning] = rise.astimezone(zone).isoformat() if rise else None
        events[evening] = setting.astimezone(zone).isoformat() if setting else None
        phases.append({"name": name, "thresholdDeg": threshold, "morning": events[morning], "evening": events[evening]})
    check_budget(deadline)
    return {"events": events, "daylight": {"status": status, "durationHours": hours},
            "method": "pvlib sun_rise_set_transit_spa; solar cycle nearest resolved local noon; elapsed UTC sunrise-to-sunset, not civil-day length or blocked sun.",
            "phases": phases,
            "phaseMethod": "SPA geometric solar-centre crossings at retained HomeSun -6/-12/-18/+6 degree thresholds, bracketed every 5 minutes within ±18 hours of transit and solved to 0.1 UTC second with scipy brentq. No crossing remains null; golden boundaries are not guaranteed one-hour light."}
