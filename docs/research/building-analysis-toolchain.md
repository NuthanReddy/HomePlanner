# Building analysis toolchain: OpenStudio, EnergyPlus and Ladybug Tools

## Source and scope

Organized from the supplied conversation:
[Open-source alternative to this? | Shared Copilot Chat](https://copilot.cloud.microsoft/chat/share/eyJzaGFyZUlkIjoiMGRkMjVjNzktMGU1OS00NWFhLWFjYzctNGVhY2Y5ZGE4MzlhIiwiY29udmVyc2F0aW9uSWQiOiI3NmVjOWJiZC0zODc3LTRiZWUtODJiOC0wYWE1YzI1MmUzMmYifQ%3D%3D).

This is an external-tool research and learning guide, not a description of
implemented HomePlanner integrations. The shared page has not been independently
reviewed; the supplied text is the basis of these notes. Current installers,
supported versions, licensing and analysis workflows need confirmation against
each tool's documentation.

The core simulation tools include open-source software, but the proposed
Rhino/Grasshopper workflow is **not an entirely open-source or free stack**.
Rhino is commercial; evaluation and educational licenses have their own terms.
Optional plugins and hosted services can have separate licensing restrictions.

## Recommended option: OpenStudio + EnergyPlus + Ladybug Tools

### Step 1: Install a compatible EnergyPlus release

Download: <https://energyplus.net/downloads>

EnergyPlus is the simulation engine: the calculation backend for building
energy and thermal models.

Record the installed version. Before choosing the latest release, check which
EnergyPlus version the selected OpenStudio and Honeybee releases support.
An independently installed newest version is not necessarily compatible.
Follow the selected toolchain's instructions for bundled or managed engines.

### Step 2: Install the OpenStudio Application

Starting point: <https://www.openstudio.net/downloads>

Install the **OpenStudio Application**, distinguishing it from the OpenStudio
SDK. Confirm the current Application distribution and its compatible engines.

The OpenStudio ecosystem supports:

- Building geometry workflows.
- Energy model setup.
- HVAC templates and system configuration.
- Simulation results review.
- Integration with EnergyPlus.

Geometry editing and results visualization depend on the Application version
and companion tools; do not assume every editor is included in one installer.
Open a sample model and run it to confirm the Application can find and use its
supported EnergyPlus installation.

### Step 3: Install Rhino and open Grasshopper

Download: <https://www.rhino3d.com>

For the visual workflow described here, Ladybug Tools runs inside Rhino and
Grasshopper. The supplied conversation suggests Rhino 8, an evaluation license,
or an educational license where eligible. Check current plugin compatibility
and license terms before installing.

Open Rhino and launch Grasshopper using the `Grasshopper` command.
This requirement applies to the proposed visual workflow, not every possible
use of the underlying Ladybug Tools libraries.

### Step 4: Install Ladybug Tools

Starting point: <https://www.ladybug.tools>

Follow the current installation instructions for the supported installer or
package manager. The supplied conversation refers to a Ladybug Tools Manager;
the exact distribution and installation steps require confirmation.

Relevant components are:

- **Ladybug:** climate, sun path and environmental studies.
- **Honeybee:** building energy, daylight and related simulation workflows.
- **Dragonfly:** optional district or urban-scale workflows.
- **Pollination plugins:** optional workflow integrations; check their terms.

Confirm the required OpenStudio, EnergyPlus and Radiance versions and paths.
Do not assume automatic detection of arbitrary existing installations.

### Step 5: Verify the workflow

Create a small test building before modeling a complete house:

1. Open Rhino and draw a closed box measuring 10 m x 10 m x 3 m.
2. Open Grasshopper and create a Honeybee Room from the geometry.
3. Assign constructions, a program/use type, schedules and appropriate loads.
4. Supply an appropriate EPW weather file and simulation settings.
5. Configure an HVAC system or ideal-air-loads model for the study.
6. Connect the supported Honeybee energy simulation components and run.
7. Review errors, warnings and outputs for annual energy, heating and cooling.

Component names vary by release. Successful output confirms the toolchain runs,
not that the model accurately represents a real building. Ideal-air-loads
results describe thermal demand, not actual equipment electricity consumption.

## Typical DesignBuilder-equivalent workflow

These are functional alternatives, not guarantees of feature parity or
superiority over a particular DesignBuilder edition.

| DesignBuilder task | Candidate tool or workflow |
| --- | --- |
| Building model | OpenStudio ecosystem or Honeybee |
| Energy simulation | EnergyPlus |
| HVAC analysis | EnergyPlus / OpenStudio, including supported Honeybee workflows |
| Thermal comfort | Ladybug + Honeybee with suitable model outputs |
| Daylighting | Radiance via Honeybee |
| Solar studies | Ladybug |
| Parametric optimization | Grasshopper + Galapagos; Rhino licensing applies |
| LEED analysis | Honeybee-supported analysis and reporting workflows; not certification |
| Net-zero studies | Ladybug / Honeybee with explicit energy and generation assumptions |

## Learning path: one week

| Days | Focus | Practice |
| --- | --- | --- |
| 1-2 | EnergyPlus basics | Learn zones, constructions, schedules and EPW weather files. |
| 3-4 | OpenStudio | Create a simple office model, add HVAC and run an annual simulation. |
| 5-6 | Ladybug Tools | Explore solar radiation, daylight and thermal comfort. |
| 7 | Comparative modeling | Build a home or office-floor model and compare glazing options. |

This is an introductory learning plan, not a substitute for simulation training
or calibrated professional analysis.

## Starting with a home energy study

The OpenStudio Application can be skipped initially when using Honeybee's
visual workflow. OpenStudio engine/SDK dependencies may still be required.

```text
Rhino + Grasshopper
    |
    +-- Ladybug: climate and solar studies
    |
    +-- Honeybee -> OpenStudio / EnergyPlus: building energy studies
```

This provides a visual route for exploring electricity savings, solar sizing,
HVAC choices and insulation. A useful first model still needs geometry,
constructions, occupancy, operating schedules and local weather.

## Analysis coverage

| Analysis | EnergyPlus / OpenStudio | Ladybug Tools and companion tools | Important boundary |
| --- | --- | --- | --- |
| Sun path | Not primarily a visual sun-path tool | Ladybug sun paths and solar geometry | Distinguish visualization from energy calculations. |
| Solar radiation | EnergyPlus models solar gains and shading | Ladybug radiation and solar-access studies | Results depend on weather and obstruction geometry. |
| Daylight | EnergyPlus has daylighting calculations and controls | Honeybee uses Radiance workflows | Available metrics depend on the recipe and inputs. |
| Glare | Not the primary workflow for detailed glare studies | Honeybee / Radiance workflows | Requires suitable views and simulation settings. |
| Natural ventilation | Ventilation models and AirflowNetwork | Honeybee interfaces to supported energy workflows | Detailed airflow features may need additional setup. |
| Room airflow patterns | Airflow networks are not room-scale CFD | Additional CFD software | Do not interpret ACH as an air-velocity map. |
| Thermal comfort | Temperature and comfort-related outputs | Ladybug / Honeybee comfort workflows | Choose the correct comfort model and assumptions. |
| Energy consumption | Core capability | Honeybee configures and runs the engine | End-use accuracy depends on the model. |
| HVAC sizing | Sizing calculations with suitable models and design conditions | Honeybee exposes supported workflows | Professional review is needed for equipment selection. |
| Mold risk | Indirect temperature/moisture indicators | Partial screening using relevant outputs | Not a general direct mold-growth prediction. |
| Moisture transport | Specialized capabilities require careful setup | Not the main visual workflow | Detailed envelope studies need dedicated methods. |

### 1. Sun path and solar analysis

Ladybug can support:

- Annual and seasonal sun paths.
- Sunrise and sunset studies.
- Shadows and solar access.
- Solar radiation comparisons.

Example questions for a Hyderabad house:

- Does a west-facing bedroom receive strong afternoon solar exposure?
- How much sunlight reaches the terrace in May?
- Which roof areas are promising for solar panels?

Sun exposure alone does not establish overheating or photovoltaic yield.
Those require additional thermal or PV-system assumptions.

### 2. Ventilation analysis

#### Basic natural ventilation

EnergyPlus-based workflows can explore air changes per hour (ACH), window
opening schedules and night cooling. Cross- and stack-ventilation studies need
appropriate airflow models, openings, pressure assumptions and controls.
Not every advanced EnergyPlus feature is exposed directly by Honeybee.

Possible questions include whether opening strategies improve ventilation,
whether exhaust fans are needed and how window sizes affect performance.
These are model-based comparisons, not proof of healthy indoor air quality.

#### Advanced CFD

For room airflow patterns, candidate tools mentioned in the supplied text are:

- OpenFOAM.
- SimScale Community, subject to current service and project-visibility terms.
- Butterfly for Grasshopper, subject to current maintenance and compatibility.

With suitable geometry, meshing and boundary conditions, CFD can investigate
air velocity, poorly ventilated zones, thermal plumes and AC supply-air
distribution. The supplied claim that these are more detailed than
DesignBuilder CFD is not established here; suitability depends on the solver,
setup and comparison task.

### 3. Lighting analysis

Honeybee uses Radiance-based workflows for detailed daylight analysis.
The supplied text also mentions Daysim; whether it is required or supported
depends on the selected workflow and software generation.

Potential metrics include:

- Daylight factor.
- Spatial daylight autonomy (sDA).
- Annual sunlight exposure (ASE).
- Useful daylight illuminance (UDI).
- Illuminance in lux.
- Inputs to LEED daylight-credit assessments.

Example questions:

- Does a workspace receive enough daylight?
- When might artificial lighting be needed?
- Which window location or glazing option performs better?

Electric-lighting design requires appropriate luminaire and control inputs;
daylight results alone do not provide a complete artificial-lighting design.
Credit-related outputs do not establish LEED compliance or certification.

### 4. Mold and moisture analysis

This is a weaker fit for the proposed general-purpose workflow.

EnergyPlus can provide surface temperatures and zone humidity outputs.
With appropriate moisture assumptions and post-processing, these can support
dew-point and condensation-risk screening. Zone relative humidity is not the
same as relative humidity at a cold surface.

The supplied conversation suggests prolonged surface RH above 80% as a
warning sign. Treat that as a **screening heuristic**, not a universal threshold
or a mold-growth prediction. Material, temperature, exposure duration, leaks
and drying conditions all matter.

For detailed studies, investigate dedicated hygrothermal tools:

| Tool | Study areas | Qualification |
| --- | --- | --- |
| WUFI | Vapor diffusion, moisture transport, condensation and drying | Commercial software; mold assessment depends on the selected module or post-processing workflow. |
| DELPHIN | Coupled heat/moisture transport and drying behavior | Check current licensing and the supported mold-risk assessment method. |

Neither a temperature result nor a condensation flag proves the presence or
absence of mold. Serious moisture problems need material-specific modeling
and on-site investigation.

## Suggested Hyderabad-house workflow

```text
Rhino + Grasshopper: building geometry
    |
    +-- Ladybug
    |       +-- Sun path and shadows
    |       +-- Solar radiation and climate studies
    |
    +-- Honeybee
            +-- OpenStudio / EnergyPlus
            |       +-- Energy use and thermal demand
            |       +-- Thermal comfort
            |       +-- Supported ventilation studies
            |
            +-- Radiance
                    +-- Daylight
                    +-- Glare

Detailed room airflow -> separate CFD workflow
Detailed envelope moisture / mold risk -> dedicated hygrothermal workflow
```

Useful comparison studies include:

- Window orientation, placement and shading.
- Terrace insulation and its effect on modeled AC demand.
- Cross-ventilation strategies under explicit wind and opening assumptions.
- Daylight availability in each room.
- Roof solar potential, followed by a dedicated PV-yield calculation.
- Summer overheating and thermal comfort.
- Cooling-load and HVAC-sizing scenarios.

Use representative Hyderabad weather, realistic neighboring obstructions,
actual wall/roof assemblies and occupancy schedules. Compare model predictions
with bills or measurements where possible.

## Relationship to HomePlanner

These tools are candidates for external analysis, not installed dependencies
or implemented simulation backends in HomePlanner. No automatic export,
integration, CFD, Radiance simulation or mold-growth model is implied by this
guide.

See [Environment analysis](../environment-analysis.md),
[Building physics](../building-physics.md) and
[Validation and limitations](../validation-and-limitations.md) for the
application's actual behavior and boundaries.
