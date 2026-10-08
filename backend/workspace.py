"""Native platform documents; independent of the incumbent schema-1 planner."""

import math
from functools import lru_cache
from datetime import datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update, delete
from fastapi import HTTPException
from timezonefinder import TimezoneFinder

from .models import Workspace, WorkspaceRevision
from .materials import Materials


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class Obstacle(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["cuboid", "tree"]
    name: str = Field(min_length=1, max_length=100)
    x: float = Field(ge=-10000, le=10000)
    y: float = Field(ge=-10000, le=10000)
    width_m: float = Field(gt=0, le=1000)
    depth_m: float = Field(gt=0, le=1000)
    height_m: float | None = Field(default=None, gt=0, le=500)
    base_m: float | None = Field(default=None, ge=-500, le=9000)
    transmission: float | None = Field(default=None, ge=0, le=1)


class Site(StrictModel):
    width: float | None = Field(default=None, gt=0, le=10000)
    depth: float | None = Field(default=None, gt=0, le=10000)
    units: Literal["m", "ft"] = "m"
    facing: Literal["N", "E", "S", "W", "NE", "SE", "SW", "NW"] = "N"
    roads: dict[str, float | None] = Field(default_factory=lambda: dict.fromkeys("NESW"))
    road_units: dict[str, Literal["m", "ft"]] = Field(default_factory=lambda: dict.fromkeys("NESW", "m"))
    category: Literal["A", "B"] = "B"
    use: Literal["res", "apt", "com"] = "res"
    height_m: float | None = Field(default=None, gt=0, le=55)
    floor_height_m: float | None = Field(default=None, gt=0, le=6)
    floors: int | None = Field(default=None, ge=1, le=100, strict=True)
    stilt: bool = False
    tdr: bool = False
    compounding: bool = False
    custom_setbacks: bool = False
    setback_front_m: float | None = Field(default=None, ge=0, le=1000)
    setback_rear_m: float | None = Field(default=None, ge=0, le=1000)
    setback_left_m: float | None = Field(default=None, ge=0, le=1000)
    setback_right_m: float | None = Field(default=None, ge=0, le=1000)
    split_edge: Literal["N", "E", "S", "W"] | None = None
    split_fraction: float | None = Field(default=None, ge=.15, le=.85)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    time_zone: str | None = "Asia/Kolkata"
    location_source: Literal["manual", "device", "unknown"] = "unknown"
    location_accuracy_m: float | None = Field(default=None, ge=0)
    weather_source: Literal["location", "manual"] = "location"
    obstacles: list[Obstacle] = Field(default_factory=list, max_length=200)

    @field_validator("roads")
    @classmethod
    def roads_valid(cls, value):
        if set(value) != set("NESW"):
            raise ValueError("Supply all four road entries; unknown widths are null.")
        for width in value.values():
            if width is not None and (not math.isfinite(width) or not 0 < width <= 200):
                raise ValueError("Road widths must be positive and at most 200 m.")
        return value

    @field_validator("road_units")
    @classmethod
    def road_units_valid(cls, value):
        if set(value) != set("NESW"):
            raise ValueError("Supply display units for all four road entries.")
        return value

    @field_validator("time_zone")
    @classmethod
    def zone_valid(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Select a valid IANA time zone.") from None
        return value

    @field_validator("obstacles")
    @classmethod
    def unique_obstacles(cls, value):
        if len({item.id for item in value}) != len(value):
            raise ValueError("Obstacle identities must be unique.")
        return value


class Costs(StrictModel):
    land_inr_m2: float | None = Field(default=None, ge=0, le=1e10)
    construction_inr_m2: float | None = Field(default=None, ge=0, le=1e9)
    stilt_inr_m2: float | None = Field(default=None, ge=0, le=1e9)
    land_sro_inr_m2: float | None = Field(default=None, ge=0, le=1e10)
    registration_percent: float | None = Field(default=None, ge=0, le=100)
    gst_percent: float | None = Field(default=None, ge=0, le=100)
    estimate_scope: Literal["partial", "legacy-schedule"] = "partial"
    flat_sro_inr_m2: float | None = Field(default=None, ge=0, le=1e10)
    lrs_mode: Literal["na", "paid", "due"] | None = None
    lrs_rebate: bool | None = None
    brs_mode: Literal["na", "paid", "dev", "unauth"] | None = None
    brs_violated_m2: float | None = Field(default=None, ge=0, le=1e8)
    stilt_rate_mode: Literal["explicit", "legacy-55-percent"] = "explicit"


class NativeDocument(StrictModel):
    schema_version: Literal[1] = 1
    site: Site = Field(default_factory=Site)
    costs: Costs = Field(default_factory=Costs)
    materials: Materials = Field(default_factory=Materials)


class WorkspaceCommand(StrictModel):
    expected_version: int = Field(ge=0, strict=True)
    action: Literal["site", "costs", "materials", "undo", "redo"]
    value: dict | None = None


@lru_cache(maxsize=1)
def timezone_boundaries():
    return TimezoneFinder(in_memory=True)


def location_time_zone(latitude, longitude):
    if latitude is None or longitude is None:
        return None
    zone = timezone_boundaries().timezone_at(lat=latitude, lng=longitude)
    if zone is None:
        raise HTTPException(422, "No time zone found for these coordinates. Review the location; nothing was saved.")
    return zone


def read_workspace(session, project_id):
    row = session.get(Workspace, project_id)
    return {
        "project_id": project_id, "version": row.version if row else 0,
        "document": NativeDocument.model_validate(row.document).model_dump() if row else NativeDocument().model_dump(),
        "can_undo": row is not None and row.cursor > 0,
        "can_redo": row is not None and row.cursor < row.head,
    }


def execute_workspace(session, project_id, command):
    row = session.get(Workspace, project_id)
    if row is None:
        if command.expected_version != 0:
            raise HTTPException(409, "Workspace changed elsewhere. Reload; your draft is retained.")
        row = Workspace(project_id=project_id, version=0, cursor=0, head=0,
                        document=NativeDocument().model_dump())
        session.add(row)
        session.add(WorkspaceRevision(project_id=project_id, sequence=0, document=row.document))
        session.flush()
    if row.version != command.expected_version:
        raise HTTPException(409, "Workspace changed elsewhere. Reload; your draft is retained.")
    document = NativeDocument.model_validate(row.document).model_dump()
    cursor, head = row.cursor, row.head
    if command.action in {"undo", "redo"}:
        if command.value is not None:
            raise HTTPException(422, "History commands do not accept a replacement document.")
        cursor += -1 if command.action == "undo" else 1
        if cursor < 0 or cursor > head:
            raise HTTPException(409, "No matching history entry is available.")
        document = session.scalar(select(WorkspaceRevision.document).where(
            WorkspaceRevision.project_id == project_id, WorkspaceRevision.sequence == cursor))
        if document is None:
            raise HTTPException(409, "Workspace history is unavailable.")
    else:
        model = {"site": Site, "costs": Costs, "materials": Materials}[command.action]
        if command.value is None:
            raise HTTPException(422, "A section command requires a value.")
        patch = {**document[command.action], **command.value}
        if command.action == "materials":
            for section in ("films", "glazing"):
                if isinstance(command.value.get(section), dict):
                    patch[section] = {**document["materials"][section], **command.value[section]}
        candidate = model.model_validate(patch).model_dump()
        if command.action == "site" and {"latitude", "longitude"} & command.value.keys():
            candidate["time_zone"] = location_time_zone(candidate["latitude"], candidate["longitude"])
            candidate = Site.model_validate(candidate).model_dump()
        document[command.action] = candidate
        if document == NativeDocument.model_validate(row.document).model_dump():
            session.rollback()
            return read_workspace(session, project_id)
        cursor += 1
        head = cursor
    result = session.execute(update(Workspace).where(
        Workspace.project_id == project_id, Workspace.version == command.expected_version,
    ).values(document=document, version=command.expected_version + 1, cursor=cursor, head=head))
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, "Workspace changed elsewhere. Reload; your draft is retained.")
    if command.action in {"site", "costs", "materials"}:
        session.execute(delete(WorkspaceRevision).where(
            WorkspaceRevision.project_id == project_id, WorkspaceRevision.sequence >= cursor))
        session.add(WorkspaceRevision(project_id=project_id, sequence=cursor, document=document))
    session.commit()
    session.expire_all()
    return read_workspace(session, project_id)


def time_zones():
    return sorted(available_timezones() - {"localtime", "Factory"})


def time_zone_labels(instant=None):
    instant = instant or datetime.now(timezone.utc)
    labels = {}
    for name in time_zones():
        seconds = instant.astimezone(ZoneInfo(name)).utcoffset().total_seconds()
        minutes = int(abs(seconds) // 60)
        labels[name] = f"{name} (UTC{'+' if seconds >= 0 else '-'}{minutes // 60}:{minutes % 60:02d})"
    return labels
