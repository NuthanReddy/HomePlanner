"""Opaque, lossless schema-1 snapshots; geometry semantics remain model-owned."""
import json

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import update

from .models import DesignSnapshot, DesignRevision


class DesignSave(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_version: int = Field(ge=0, le=2147483646)
    document: dict

    @field_validator("document")
    @classmethod
    def envelope(cls, value):
        if type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
            raise ValueError("Only an explicit schema-1 Design snapshot can be saved.")
        if not isinstance(value.get("id"), str) or not value["id"]:
            raise ValueError("Design identity is required.")
        if type(value.get("revision")) is not int or value["revision"] < 0:
            raise ValueError("Design revision must be a nonnegative integer.")
        for key in ("site", "building", "environment", "legacy"):
            if not isinstance(value.get(key), dict):
                raise ValueError(f"Design {key} must be an object.")
        floors = value.get("floors")
        if not isinstance(floors, list) or not floors:
            raise ValueError("Design must retain its modeled floors.")
        ids = [floor.get("id") if isinstance(floor, dict) else None for floor in floors]
        if any(not isinstance(key, str) or not key for key in ids) or len(set(ids)) != len(ids):
            raise ValueError("Design floor identities must be nonempty and unique.")
        if value.get("activeFloorId") not in ids:
            raise ValueError("Design active floor must exist.")
        try:
            encoded = json.dumps(value, allow_nan=False)
        except (ValueError, TypeError, RecursionError):
            raise ValueError("Design must contain finite JSON data.") from None
        if len(encoded.encode("utf-8")) > 8 * 1024 * 1024:
            raise ValueError("Design snapshot exceeds the 8 MiB storage limit.")
        return value


def read_design(session, project_id):
    row = session.get(DesignSnapshot, project_id)
    return {"project_id": project_id, "version": row.version if row else 0,
            "document": row.document if row else None}


def save_design(session, project_id, value):
    row = session.get(DesignSnapshot, project_id)
    if (row.version if row else 0) != value.expected_version:
        raise HTTPException(409, "Saved Design changed elsewhere. Keep your working copy and review the server version.")
    if row and row.document == value.document:
        return read_design(session, project_id)
    version = value.expected_version + 1
    if row is None:
        session.add(DesignSnapshot(project_id=project_id, version=version, document=value.document))
    else:
        result = session.execute(update(DesignSnapshot).where(
            DesignSnapshot.project_id == project_id, DesignSnapshot.version == value.expected_version
        ).values(version=version, document=value.document))
        if result.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "Saved Design changed elsewhere. Your working copy is retained.")
    session.add(DesignRevision(project_id=project_id, version=version, document=value.document))
    session.commit()
    session.expire_all()
    return read_design(session, project_id)
