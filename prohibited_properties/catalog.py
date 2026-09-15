from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from telangana_prohibited_properties import FORM_TYPES, PROPERTY_TYPES, Location


CATEGORIES = {
    **{
        code: {"label": label, "kind": "pdf", "formtype": code}
        for code, label in FORM_TYPES.items()
    },
    "court": {
        "label": "Court cases & Others",
        "kind": "html",
        "formtype": None,
    },
    "waqf": {
        "label": "22A(1)(c) - Waqf",
        "kind": "unavailable",
        "formtype": None,
    },
    "endowment": {
        "label": "22A(1)(c) - Endowment",
        "kind": "unavailable",
        "formtype": None,
    },
}
ALL_CATEGORIES = ("1", "2", "5", "6", "court", "waqf", "endowment")


class InputError(ValueError):
    pass


class CatalogError(RuntimeError):
    pass


def parameter(values: Mapping[str, Any], name: str, required: bool = True) -> str:
    value = values.get(name, "")
    if not isinstance(value, str) or len(value) > 100:
        raise InputError(f"{name} must be a string of at most 100 characters.")
    value = value.strip()
    if required and not value:
        raise InputError(f"{name} is required.")
    return value


@dataclass(frozen=True)
class Selection:
    location: Location
    property_type: str
    category: str
    force_refresh: bool = False

    @property
    def categories(self) -> tuple[str, ...]:
        return ALL_CATEGORIES if self.category == "all" else (self.category,)

    def public(self) -> dict[str, Any]:
        return {
            "location": asdict(self.location),
            "prohib_type": self.property_type,
            "property_type_label": PROPERTY_TYPES[self.property_type],
            "category": self.category,
        }

    @property
    def key(self) -> tuple[str, ...]:
        loc = self.location
        return (
            loc.district_code,
            loc.mandal_code,
            loc.village_code,
            loc.sro_code,
            self.property_type,
            self.category,
            str(self.force_refresh),
        )


class Catalog:
    """Index the exported hierarchy without depending on the live dropdown."""

    def __init__(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self.districts = self._index(data["districts"], "district_code", "district_name")
            self.mandals: dict[str, dict[str, str]] = {}
            self.villages: dict[tuple[str, str], dict[str, str]] = {}
            self.sros: dict[tuple[str, str, str], dict[str, str]] = {}
            self.locations: dict[tuple[str, str, str, str], Location] = {}
            for row in data["mandals"]:
                dist = row["district_code"]
                if dist not in self.districts:
                    raise ValueError("Mandal has an unknown district.")
                self._add(self.mandals.setdefault(dist, {}), row["mandal_code"], row["mandal_name"])
            for row in data["locations"]:
                loc = Location(**row)
                if loc.mandal_code not in self.mandals.get(loc.district_code, {}):
                    raise ValueError("Village has an unknown district/mandal.")
                pair = (loc.district_code, loc.mandal_code)
                triple = (*pair, loc.village_code)
                self._add(self.villages.setdefault(pair, {}), loc.village_code, loc.village_name)
                sros = self.sros.setdefault(triple, {})
                if loc.sro_code:
                    self._add(sros, loc.sro_code, loc.sro_name)
                key = (*triple, loc.sro_code)
                if key in self.locations and self.locations[key] != loc:
                    raise ValueError("Conflicting location values.")
                self.locations[key] = loc
            if not self.districts or not self.locations:
                raise ValueError("The location export is empty.")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CatalogError(
                "The location export is missing or invalid. Run "
                "'py telangana_prohibited_properties.py metadata' in HomePlanner, "
                "then restart the Flask server."
            ) from exc

    @staticmethod
    def _add(target: dict[str, str], code: str, name: str) -> None:
        if (
            not isinstance(code, str)
            or not code
            or not isinstance(name, str)
            or not name.strip()
        ):
            raise ValueError("Lookup codes and names must be nonempty strings.")
        if code in target and target[code] != name:
            raise ValueError("Conflicting lookup names.")
        target[code] = name

    @classmethod
    def _index(cls, rows: list[dict[str, str]], code_key: str, name_key: str) -> dict[str, str]:
        result: dict[str, str] = {}
        for row in rows:
            cls._add(result, row[code_key], row[name_key])
        return result

    @staticmethod
    def options(values: dict[str, str]) -> list[dict[str, str]]:
        return [
            {"code": code, "name": name}
            for code, name in sorted(values.items(), key=lambda item: item[1])
        ]

    def district(self, values: Mapping[str, Any]) -> str:
        code = parameter(values, "dist_code")
        if code not in self.districts:
            raise InputError("Choose a district from the available options.")
        return code

    def mandal(self, values: Mapping[str, Any]) -> tuple[str, str]:
        dist = self.district(values)
        code = parameter(values, "mand_code")
        if code not in self.mandals.get(dist, {}):
            raise InputError("The mandal does not belong to the selected district.")
        return dist, code

    def village(self, values: Mapping[str, Any]) -> tuple[str, str, str]:
        dist, mand = self.mandal(values)
        code = parameter(values, "vill_code")
        if code not in self.villages.get((dist, mand), {}):
            raise InputError("The village/division does not belong to this district and mandal.")
        return dist, mand, code

    def select(self, values: Mapping[str, Any]) -> Selection:
        triple = self.village(values)
        sro = parameter(values, "sro_code", required=False)
        choices = self.sros.get(triple, {})
        if choices and sro not in choices:
            raise InputError("Choose an SRO office for this division.")
        if not choices and sro:
            raise InputError("An SRO code is not applicable to this village.")
        key = (*triple, sro)
        if key not in self.locations:
            raise InputError("This location combination is not present in the lookup export.")
        property_type = parameter(values, "prohib_type")
        if property_type not in PROPERTY_TYPES:
            raise InputError("prohib_type must be AGRI or NONAGRI.")
        category = parameter(values, "category")
        if category not in {*CATEGORIES, "all"}:
            raise InputError("Choose a supported report category; Court cases is 'court', not formtype 7.")
        force = values.get("force_refresh", False)
        if not isinstance(force, bool):
            raise InputError("force_refresh must be a JSON boolean.")
        return Selection(self.locations[key], property_type, category, force)

    def public(self) -> dict[str, Any]:
        return {
            "districts": self.options(self.districts),
            "property_types": self.options(PROPERTY_TYPES),
            "categories": [{"code": code, **CATEGORIES[code]} for code in ALL_CATEGORIES],
            "counts": {
                "districts": len(self.districts),
                "mandals": sum(len(values) for values in self.mandals.values()),
                "villages": sum(len(values) for values in self.villages.values()),
                "location_combinations": len(self.locations),
            },
        }
