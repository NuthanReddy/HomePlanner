"""Port of BuildingPhysics.assemblyProperties; no zone or energy simulation."""

import hashlib
import json
import math
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


class MaterialModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class MaterialLayer(MaterialModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(default="", max_length=200)
    source: str = Field(default="", max_length=2000)
    condition: str = Field(default="", max_length=1000)
    thicknessM: float | None = Field(default=None, gt=0)
    conductivityW_MK: float | None = Field(default=None, gt=0)
    densityKgM3: float | None = Field(default=None, gt=0)
    specificHeatJ_KgK: float | None = Field(default=None, gt=0)


class Films(MaterialModel):
    inside: float | None = Field(default=None, ge=0)
    outside: float | None = Field(default=None, ge=0)
    source: str = Field(default="", max_length=2000)


class Glazing(MaterialModel):
    uValueW_M2K: float | None = Field(default=None, gt=0)
    shgc: float | None = Field(default=None, ge=0, le=1)
    vlt: float | None = Field(default=None, ge=0, le=1)
    source: str = Field(default="", max_length=2000)


class Materials(MaterialModel):
    version: Literal[1] = 1
    layers: list[MaterialLayer] = Field(default_factory=list, max_length=100)
    films: Films = Field(default_factory=Films)
    comparisonThicknessM: float | None = Field(default=None, gt=0)
    glazing: Glazing = Field(default_factory=Glazing)

    @field_validator("layers")
    @classmethod
    def unique_layers(cls, value):
        if len({layer.id for layer in value}) != len(value):
            raise ValueError("Material layer identities must be unique.")
        return value


class MaterialsRequest(MaterialModel):
    expected_version: int = Field(ge=0, strict=True)


# Same sourced examples as EnvironmentUI.MATERIAL_PRESETS, never defaults.
PRESETS = [
    dict(id="dense-clay-brick", label="Dense face clay brick — EnergyPlus example",
         thicknessM=0.1014984, conductivityW_MK=1.245296, densityKgM3=2082.4, specificHeatJ_KgK=920.48,
         source="EnergyPlus 24.2 Material example A2 – 4 IN DENSE FACE BRICK. Example, not a local product specification.",
         condition="Source example; confirm applicability to the specified product and moisture/temperature conditions.",
         url="https://bigladdersoftware.com/epx/docs/24-2/input-output-reference/group-surface-construction-elements.html#material"),
    dict(id="aac-ens", label="AAC — ENS 2024 reference",
         thicknessM=0.2, conductivityW_MK=0.184, densityKgM3=642.0, specificHeatJ_KgK=1240.0,
         source="BEE Eco-Niwas Samhita 2024: c 1.24 kJ/(kg K) converted to 1240 J/(kg K). Thickness 0.20 m is an explicit example assumption.",
         condition="Reference example, not a product specification; review applicable moisture/temperature conditions.",
         url="https://beeindia.gov.in/WriteReadData/RTF1984/1772175926.pdf"),
    dict(id="lyon-rammed-earth", label="Lyon rammed earth — source-specific, properties required",
         thicknessM=0.3, conductivityW_MK=None, densityKgM3=None, specificHeatJ_KgK=None,
         source="Losini et al., Lyon rammed earth. Supply density/moisture-dependent properties from the applicable specimen. Thickness 0.30 m is an example assumption.",
         condition="Applicable specimen, moisture and density conditions required; generic mud is unspecified.",
         url="https://hal.science/hal-04301821"),
]

WARNINGS = [
    "Supplied surface films are fixed resistances, not a dynamic convection/radiation calculation.",
    "One-dimensional homogeneous layers only; no thermal bridges, moisture, cavities, contact resistance or dynamic time lag.",
    "Areal material heat capacity is not effective zone capacity. No indoor temperature, HVAC load, energy use, comfort or savings is predicted.",
]
UNITS = {"resistanceM2K_W": "m²·K/W", "uValueW_M2K": "W/(m²·K)",
         "arealHeatCapacityJ_M2K": "J/(m²·K)"}


def positive_result(value, name):
    if not math.isfinite(value) or value <= 0:
        raise HTTPException(422, f"{name} is outside finite positive numerical range.")
    return value


def assembly_properties(layers, films):
    """Same explicit-film equations and positive-coefficient domain as legacy."""
    resistances = [films.inside, films.outside]
    capacities = []
    for layer in layers:
        resistances.append(positive_result(layer.thicknessM / layer.conductivityW_MK, "Layer resistance"))
        capacities.append(positive_result(layer.densityKgM3 * layer.specificHeatJ_KgK * layer.thicknessM, "Layer heat capacity"))
    try:
        resistance = positive_result(math.fsum(resistances), "Assembly resistance")
        capacity = positive_result(math.fsum(capacities), "Assembly heat capacity")
    except OverflowError:
        raise HTTPException(422, "Assembly sum exceeds finite numerical range.") from None
    return {"resistanceM2K_W": resistance,
            "uValueW_M2K": positive_result(1 / resistance, "Assembly U-value"),
            "arealHeatCapacityJ_M2K": capacity}


def calculate_materials(materials):
    missing = []
    if not materials.layers:
        missing.append("Add at least one opaque layer.")
    for index, layer in enumerate(materials.layers):
        for key in ("thicknessM", "conductivityW_MK", "densityKgM3", "specificHeatJ_KgK"):
            if getattr(layer, key) is None:
                missing.append(f"Layer {index + 1}: {key} is unknown.")
        if not layer.label.strip() or not layer.source.strip():
            missing.append(f"Layer {index + 1}: record a label and source/condition or explicitly hypothetical basis.")
    film_missing = []
    for key in ("inside", "outside"):
        if getattr(materials.films, key) is None:
            film_missing.append(f"Supply {key} film resistance in m²·K/W; no coefficient is assumed.")
    if not materials.films.source.strip():
        film_missing.append("Record the film boundary/source or explicit hypothetical assumption.")
    missing += film_missing
    selected = {"status": "prerequisites", "messages": missing, "output": None}
    if not missing:
        selected = {"status": "computed", "messages": [], "output": assembly_properties(materials.layers, materials.films)}
    comparisons = []
    for preset in PRESETS:
        reasons = list(film_missing)
        if materials.comparisonThicknessM is None:
            reasons.append("Supply explicit equal comparison thickness in metres.")
        if any(preset[key] is None for key in ("conductivityW_MK", "densityKgM3", "specificHeatJ_KgK")):
            reasons.append("Specimen-specific properties remain unknown; no generic substitute.")
        layer = MaterialLayer.model_validate({key: value for key, value in preset.items() if key != "url"})
        layer.thicknessM = materials.comparisonThicknessM
        comparisons.append({"id": preset["id"], "label": preset["label"], "source": preset["source"],
                            "url": preset["url"], "status": "prerequisites" if reasons else "computed",
                            "messages": reasons, "thicknessM": materials.comparisonThicknessM,
                            "output": None if reasons else assembly_properties([layer], materials.films)})
    glazing = materials.glazing
    glazing_missing = [f"Whole-window {key} is unknown." for key in ("uValueW_M2K", "shgc", "vlt")
                       if getattr(glazing, key) is None]
    if not glazing.source.strip():
        glazing_missing.append("Supply glazing product/test source or explicit hypothetical basis.")
    inputs = materials.model_dump()
    return {"method": "BuildingPhysics.assemblyProperties explicit-film Python port v1",
            "input_fingerprint": hashlib.sha256(json.dumps(inputs, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            "inputs": inputs, "units": UNITS, "selected": selected, "comparisons": comparisons,
            "glazing": {"status": "prerequisites" if glazing_missing else "supplied",
                        "messages": glazing_missing, "inputs": glazing.model_dump()},
            "warnings": WARNINGS}
