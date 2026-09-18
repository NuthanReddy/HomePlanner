(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HomePlannerGuide = api;
    const start = () => { api.mount(); api.mountAll(); };
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  const guides = freeze({
    'overview/summary': {
      title: 'Choose your next task',
      task: 'Use readiness as a checklist for the task you want, not a demand to complete every analysis.',
      steps: [
        'Read Current project readiness to check which project and floor you are reviewing.',
        'Choose Continue design to work on rooms, or Review site and weather to check site inputs.',
        'Use Save now in the project bar; wait for Saved in this browser. Use Projects & backups → Export JSON for a separate backup.'
      ],
      required: 'For a first floor plan, start with measured plot dimensions or a site plan and a room list.',
      optional: 'Weather, structural sizes, pipe levels and study coefficients are not prerequisites for arranging rooms.',
      result: 'Readiness describes available inputs. Missing optional study data is not a broken floor plan or a failed design.',
      sources: ['docs/workspace-navigation.md', 'docs/local-persistence.md']
    },
    'site/plot': {
      title: 'Set the plot before planning rooms',
      task: 'Describe the land and compare the space left by the selected planning scenario.',
      steps: [
        'Enter your plot dimensions and units from a measured survey or site plan, then choose Plot facing for the road side.',
        'Review Roads, Site Category and Height band against the applicable source documents; do not choose a category just because it gives more space.',
        'Review the resulting buildable area and warnings before moving to Design → Layout.',
        'Use custom setbacks or TDR only for a deliberate, documented scenario; they do not grant permission.'
      ],
      required: 'Plot lengths, units, road information and a supported site category. Get legal classifications and applicable rules from the relevant authority or a qualified local professional.',
      optional: 'Leave optional TDR/custom-setback scenarios off if you have no basis for them. Weather and specialist analyses can wait.',
      result: 'The plot is the land boundary; the buildable plate is the area remaining after the scenario deductions. Feasibility is not planning approval.',
      sources: ['docs/plot-geometry.md', 'docs/regulatory-basis.md']
    },
    'site/context': {
      title: 'Record the real site and its surroundings',
      task: 'Keep measured site information separate from examples and analysis drafts.',
      steps: [
        'Enter coordinates and time zone from a reliable site reference. Choose Save site only after reviewing them; tick the verification statement only if you actually checked the location.',
        'Review building dimensions and Active storey floor-to-floor height (m); use Save building dimensions or Save storey height only for intentional project changes.',
        'Use New rectangle and Save obstacle for a known surrounding object, with measured dimensions and a source.',
        'If a weather-driven study is needed, choose an EPW or weather JSON file. Fetch ERA5 history is a separate, explicit online request.'
      ],
      required: 'Actual coordinates/time zone for site-based solar calculations; measured heights and obstacle dimensions for geometry you choose to model.',
      optional: 'Weather files and obstacles can be left unentered while planning rooms. Unentered surroundings remain unknown, not automatically clear. Detect current location is optional and identifies the device, not necessarily your site.',
      result: 'Saved inputs describe your stated site. Applying them does not independently verify a survey, weather record or building measurement.',
      sources: ['docs/environment-analysis.md', 'docs/sun-path.md']
    },
    'site/prohibited': {
      title: 'Look up property records deliberately',
      task: 'Search the available Telangana records without treating a search result as a title opinion.',
      steps: [
        'Choose Connect local lookup only when the local property service is available; ordinary room planning does not need that service.',
        'Choose the location and property search fields shown by the connected service, using identifiers from your property documents.',
        'Review the matching source report, its date and the exact search scope before interpreting a match or an empty result.'
      ],
      required: 'The local lookup backend and the correct property/location identifiers. Obtain identifiers from the deed and official records rather than guessing similar names.',
      optional: 'You can skip this entire lookup while working on a schematic. No connection is made merely by opening this section.',
      result: 'A match needs source review. No match, a failed connection or an unreadable report does not establish clear title or permission to build.',
      sources: ['README-prohibited-properties.md', 'docs/workspace-navigation.md']
    },
    'site/references': {
      title: 'Check the basis of a planning scenario',
      task: 'Use the listed regulatory sources to understand which rules the calculator represents.',
      steps: [
        'Read the regulatory source list and identify the document relevant to your plot, road and proposed use.',
        'Open a source link only when you want to consult it; external publications may require a connection.',
        'Compare the edition and amendments with current authority guidance, then return to Plot & feasibility to review your selected scenario.'
      ],
      required: 'Jurisdiction, building use and applicable publication/edition. A qualified local professional can resolve applicability and amendments.',
      optional: 'There are no study values to fill in on this reference page. Do not enable a scenario merely to remove a warning.',
      result: 'A source list explains implemented assumptions; it does not demonstrate that every current legal requirement has been assessed.',
      sources: ['docs/regulatory-basis.md']
    },
    'design/layout': {
      title: 'Arrange your rooms and openings',
      task: 'Work on the current floor; you do not have to complete engineering or environment forms first.',
      steps: [
        'Choose the active editable floor in the shared toolbar. Open Tools & rooms to choose rooms or components.',
        'Add only the room you need, then select an object and use Selection properties for numeric position or size changes.',
        'Use the plan controls for 2D / 3D inspection. Review placement issues & guidance for conflicts rather than assuming that a visible fit proves access.',
        'Use Undo for an unwanted edit. Save now keeps a browser copy; Projects & backups → Export JSON makes a separate backup.'
      ],
      required: 'A usable floor plate and room dimensions from measurements or a clearly labelled proposal. Openings need compatible wall hosts.',
      optional: 'Material properties, pressure inputs, light-study settings and service sizes can wait. Optional 3D is not required for editing.',
      result: 'This is an editable schematic. A lift or stair reservation removes usable space from its host room; it is not a fully designed lift or staircase. Whole-plan regeneration is a deliberate replacement action, not a routine save.',
      sources: ['docs/room-planner.md', 'docs/editor-workspace.md', 'docs/local-persistence.md']
    },
    'design/structure': {
      title: 'Record structural intent for review',
      task: 'Locate supplied members and review geometric coordination without sizing them for construction.',
      steps: [
        'Select New element or an existing current-floor record, then choose its kind.',
        'Supply the applicable point coordinates in active-floor metres. Enter sizes, material and source only when you have them.',
        'For an existing hosted element, leave its anchors intact unless you deliberately choose Replace anchors with entered point coordinates.',
        'Choose Save structural intent, then Refresh coordination & 2D preview to review the stated geometry.'
      ],
      required: 'The intended member kind and applicable anchors. Obtain construction sizes and specifications from the responsible structural engineer.',
      optional: 'Unknown sizes and materials may remain blank, so geometry may be unavailable. Grids require blank sizes/material; beams use depth, not a separate height.',
      result: 'Contacts and intersections are coordination findings, not proof of support, strength or a safe foundation. Engineering remains not assessed.',
      sources: ['docs/structure-workbench.md', 'docs/conceptual-structure.md']
    },
    'design/elevations': {
      title: 'Save an elevation or section view',
      task: 'Define how to look at existing physical geometry; a saved view does not add missing construction.',
      steps: [
        'Choose New view, enter a name and owner floor, and select an elevation or section.',
        'For an elevation choose the geographic viewer side; for a section enter its ordered A–B endpoints in the selected floor frame.',
        'Choose the saved scale and Save view. Create front/rear/left/right views adds four named elevation views explicitly.',
        'Use Report → Drawings to select the saved view and refresh its sheet. The adjacent facade editor is a separate physical-editing tool.'
      ],
      required: 'A current model, an intended view direction or section endpoints, and any physical heights needed by the drawing. Use measured or professionally supplied geometry.',
      optional: 'You need not create every view. Missing roofs, stair details or facade dimensions remain missing rather than being completed by the view.',
      result: 'Elevations look from the named compass side; sections cut only along the finite A–B line. They are reference drawings, not construction certification.',
      sources: ['docs/view-workbench.md', 'docs/elevations-sections.md']
    },
    'design/plumbing': {
      title: 'Connect explicit water and waste intent',
      task: 'Record fixtures and their connections without inventing pipe sizes or water pressure.',
      steps: [
        'Choose Fixtures and enter a located fixture; use Save fixture. A fixture symbol does not automatically create connection ports.',
        'Choose Nodes / explicit fixture ports to describe water/waste nodes, including the intended supply or outlet, then Save node / explicit port.',
        'Choose Directed routes, select the actual from/to nodes and any ordered waypoints, then Save directed route.',
        'Choose Refresh plumbing coordination & preview and review disconnected or unresolved records before preparing drawings.'
      ],
      required: 'Explicit endpoints, system and physical locations from a coordinated layout. Use a plumbing professional for specified sizes and connection details.',
      optional: 'Unknown dimensions, material and circuit metadata may remain blank where the form permits; missing facts remain visible. You may skip plumbing entirely for a room layout.',
      result: 'The network shows authored connections and supported lengths, not computed flow, supply pressure or hydraulic capacity. Use Drainage for geometric invert profiles.',
      sources: ['docs/plumbing-workbench.md', 'docs/plumbing-networks.md']
    },
    'design/drainage': {
      title: 'Review a supplied drainage route and levels',
      task: 'Keep sanitary waste, vents and stormwater distinct while recording their intended route.',
      steps: [
        'Under Author drainage intent, choose Nodes / explicit fixture ports and supply the intended system, role and location.',
        'Save node / explicit port with any known invert, ground or finished-floor levels, using the stated project datum.',
        'Choose Directed routes and its exact endpoints. Supply intermediate inverts where known, then Save directed route.',
        'Use View & print settings and Refresh drainage preview; inspect the profile and missing-level findings before using a sheet.'
      ],
      required: 'Explicit connections and locations. A complete gravity profile also needs every endpoint and intermediate invert; obtain these and slope intent from survey/engineering evidence.',
      optional: 'Unknown inverts, nominal diameters, discharge evidence and slope intent may remain blank. Do not insert a typical slope merely to obtain a result.',
      result: 'A geometric fall compares supplied pipe-inside-bottom levels. It is not flow capacity, safe cover, permitted discharge or a verified sewer connection; vent routes do not acquire gravity results.',
      sources: ['docs/drainage-workbench.md', 'docs/drainage-coordination.md']
    },
    'design/electrical': {
      title: 'Place a device-intent point',
      task: 'Describe where a device is wanted, with its real host and height reference.',
      steps: [
        'Choose New point, name its purpose, select its type and the room served.',
        'Select a real wall and face, then enter its along-wall offset; eligible light points can use the supported surface host instead.',
        'Enter height above finished floor and its datum, plus known device dimensions and context.',
        'Choose Add point or Save point, and review the placement findings. Preview only — do not add points yet leaves suggestions unapplied.'
      ],
      required: 'A compatible host and intended location. Obtain mounting/envelope dimensions from product drawings and the coordinated design, not a generic mounting-height guess.',
      optional: 'Unknown heights or device dimensions remain blank where permitted and keep the review incomplete. You need no electrical points to arrange rooms.',
      result: 'A symbol records spatial intent, not a circuit, wiring design or electrical safety assessment. Wet-area and high-load intent still need qualified electrical review.',
      sources: ['docs/electrical-planning.md']
    },
    'design/review': {
      title: 'Work through placement findings',
      task: 'Use issues and guidance to decide what to inspect next, without automatically rearranging your plan.',
      steps: [
        'Read the placement issues and guidance for the current layout; distinguish a missing measurement from a detected geometric conflict.',
        'Return to Layout and select the named room or component; use Selection properties for a deliberate change.',
        'Review the finding again after the edit. Use shared Undo, or Undo last fix where offered by a checklist, to reverse an unwanted change.'
      ],
      required: 'The current layout and the dimensions relevant to the reported conflict. Measure actual clearances when checking use or access.',
      optional: 'You can defer optional preferences. Do not invent a clearance or accept a suggested fix solely to clear the list.',
      result: 'These are planning and placement checks. A connected room graph or schematic door sweep does not certify clear passage, accessibility or legal compliance.',
      sources: ['docs/design-guidance.md', 'docs/circulation-and-components.md', 'docs/workspace-navigation.md']
    },
    'environment/sun': {
      title: 'Explore sun position and shading',
      task: 'Use a deliberate site and local time, then choose whether you need a whole-house study.',
      steps: [
        'Enter actual coordinates, time zone, date and time, or choose Use project defaults and review what was copied.',
        'Inspect the sun path and pole-shadow controls. Resolve any repeated local-clock-time choice rather than using your computer time zone.',
        'For whole-house exposure, review the side obstruction states and supplied heights/gaps before running that study.',
        'Use for this project explicitly applies the exploratory site/time inputs; leave it alone if you only intended a comparison.'
      ],
      required: 'Site/time-zone evidence and the chosen date/time. Neighbor geometry and physical storey data are needed for the shading scope you choose.',
      optional: 'Weather is not needed for astronomical paths. Pole shadows and whole-house exposure are separate optional tasks; unentered neighbors remain unknown.',
      result: 'Sun position and astronomical daylight are not measured sunshine. Neighbor-blocked sun hours are not energy, lux or guaranteed indoor cooling.',
      sources: ['docs/sun-path.md', 'docs/workspace-navigation.md']
    },
    'environment/solar': {
      title: 'Compare geometric solar exposure',
      task: 'Start with geometry only; add radiation inputs only for a question that needs them.',
      steps: [
        'Review the location and surroundings in Site, then select the solar date, time and Floors scope.',
        'Choose Radiation inputs → Geometry only unless you have deliberate hypothetical or matched weather irradiance inputs.',
        'Choose Calculate sun & exposure. If using imported records, Use record midpoint as solar time aligns the chosen record.',
        'Use Compare monthly 09 / 12 / 15 for a limited snapshot comparison and read its assumptions.'
      ],
      required: 'Site/time information and modeled geometry. Radiation results additionally need the stated radiation components with correct units and source.',
      optional: 'Radiation inputs and weather can be omitted in Geometry only mode. Do not fill them with zero to suppress missing-data messages.',
      result: 'Sunlit fractions describe geometric exposure; incident radiation is not absorbed heat or illuminance. Monthly snapshots are not annual energy, and separate floor calculations do not establish all-storey mutual shading.',
      sources: ['docs/environment-analysis.md', 'docs/building-physics.md']
    },
    'environment/airflow': {
      title: 'Build a deliberate airflow scenario',
      task: 'The plan supplies geometry, not the physical forcing needed to solve airflow.',
      steps: [
        'Choose Use whole house to select all discovered rooms and known adjacent openings across registered floors. Review volume estimates from net usable area × supplied wall height; manual overrides are retained.',
        'Review scenario inputs and Project wind reference. Saved weather shows speed, FROM direction, time and source without fetching; it does not supply pressure forcing.',
        'Supply air density, Cd, signed pressure and operating free areas for enabled links. Use geometric opening areas (estimate) optionally proposes upper bounds, not verified aerodynamic areas, and preserves supplied overrides.',
        'Choose Run scenario and inspect missing-input or convergence findings before reading arrows or tables. Whole-house selection never physically opens a door or window.'
      ],
      required: 'Review plan-volume estimates or supply clear-volume overrides. Enabled connections still need documented density, operating free areas, Cd and signed pressure from applicable technical evidence or a qualified ventilation specialist.',
      optional: 'Manual room selection and geometric opening-area proposals are optional. Saved weather is only a reference; it cannot replace missing forcing, Cd or density. Leave the study unrun if these are unavailable; floor planning does not require it.',
      result: 'Arrows show solved opening flow direction. A velocity field, when available, is a reduced depth-averaged estimate, not measured occupant airspeed or validated CFD. Failure or unknown is not zero flow.',
      sources: ['docs/airflow-workbench.md', 'docs/airflow-field.md']
    },
    'environment/cfd': {
      title: 'Prepare a coupled thermal and airflow case',
      task: 'Use one current room and explicit physical inputs. A prepared OpenFOAM case is not a simulation result.',
      steps: [
        'Choose a room on the active floor and review its actual inner wall faces, opening states and geometry findings.',
        'Supply solid and air properties, initial and boundary temperatures, absolute reference pressure and any inlet/outlet conditions. Record their sources; blank does not mean zero.',
        'Review the empty-room and laminar-model assumptions, then choose Prepare case. Download OpenFOAM case works without virtualization or an installed engine.',
        'Save inputs to project separately for JSON and Undo. Check local engine and Run OpenFOAM require the explicitly configured matching local runtime; Cancel run stops only that job.'
      ],
      required: 'A supported rectangular enclosure, complete supplied physical boundaries and properties, and explicit acknowledgements. On Windows, execution additionally needs WSL2 and OpenCFD OpenFOAM v2606; preparation does not.',
      optional: 'CFD is not needed for floor planning. Unknown physical inputs may remain saved as null. Adjacent rooms, turbulence, radiation, HVAC, moisture and furniture are outside the first profile.',
      result: 'The generated profile has not yet passed real-engine or numerical verification. Only completed, matching solver samples can produce a field plot; no placeholder output appears while the engine is unavailable.',
      sources: ['docs/coupled-cfd.md', 'docs/airflow-workbench.md']
    },
    'environment/light': {
      title: 'See sky access across the whole house',
      task: 'Calculate from your current house geometry; this does not calculate lux.',
      steps: [
        'Choose Analyze whole house. It includes every discovered room on every registered floor, with sampling at floor level (0 m) and explicitly ideal-clear apertures.',
        'Read the supplied-model sky-access map and use Display floor & saved studies to inspect another floor. Re-run after changing the house.',
        'Only for a custom height or time-based sunlight question, open Study inputs and Prepare inventory; select rooms and enter the intended workplane heights.',
        'For time-based sunlight, enter site/time inputs or Use project site, review copied values, and Prepare sun intervals. Review optics and the numerical cutoff, then Run custom study.'
      ],
      required: 'For Analyze whole house: your current modeled rooms and geometry. Floor-level sampling is a stated measurement plane, not an inferred ceiling height. Existing modeled obstacles and roofs are retained.',
      optional: 'No room selection, date, time, location or near-horizon cutoff is needed for whole-house sky access. Custom workplanes and time-based sunlight are optional; use measured heights and sourced product VLT only when that custom question needs them.',
      result: 'Sky access is a dimensionless fraction from the supplied model, not lux or electric-light coverage. Unknown real neighbors and roofs remain unknown, not declared clear; they limit real-site interpretation without hiding the available modeled fractions.',
      sources: ['docs/light-workbench.md', 'docs/light-visualizer.md']
    },
    'environment/models': {
      title: 'Use expert reduced models only with stated inputs',
      task: 'These optional pressure and thermal experiments are not required project setup.',
      steps: [
        'Choose the pressure or thermal experiment you actually need; read its acknowledgement and input guidance first.',
        'Use Prepare from current openings for pressure or Prepare room input template for thermal; these are reviewable drafts, not verified physical values.',
        'Review the matching current rooms and supply the requested sourced physical inputs in the contract editor; keep unknown values missing rather than guessing.',
        'Choose Solve stated pressure network or Simulate stated RC scenario only when its input checks are satisfied, then read the diagnostics and limitations.'
      ],
      required: 'Pressure experiments need density, Cd and signed forcing plus reviewed areas/volumes. Thermal experiments need heat capacity, conductance, initial/outdoor temperatures, gains and interval durations from a defensible scenario.',
      optional: 'Skip either model if you cannot supply its inputs. Saving an unevaluated draft is not running it; material choices alone do not complete a thermal experiment.',
      result: 'These are reduced pressure-network or hypothetical sensible-temperature calculations, not validated CFD, measured indoor temperature, comfort, humidity or mold predictions.',
      sources: ['docs/environment-analysis.md', 'docs/building-physics.md']
    },
    'compare/plot': {
      title: 'Compare plot size and shape scenarios',
      task: 'Compare the existing plot alternatives while keeping the actual edited room plan distinct.',
      steps: [
        'Review the current dimensions, units, road-facing side and rule scenario in Site → Plot & feasibility.',
        'Read the scaling and shape comparison tables against that base case; distinguish a changed size from a changed aspect ratio.',
        'Review remaining buildable space and warnings, then return to Site only if you intentionally want to change the underlying inputs.'
      ],
      required: 'A meaningful base plot and consistent road/rule assumptions from the site evidence.',
      optional: 'No pressure, weather or material inputs are needed for this comparison. You do not have to apply a compared shape.',
      result: 'These are rectangular feasibility alternatives, not a survey, approval or automatic rearrangement of your manually edited rooms.',
      sources: ['docs/plot-geometry.md', 'docs/workspace-navigation.md']
    },
    'compare/envelope': {
      title: 'Compare stated wall, roof and glazing properties',
      task: 'Use sourced construction properties without treating them as a prediction of indoor temperature.',
      steps: [
        'Use Add layer and enter each layer’s thickness and physical properties with a source.',
        'Replace layers with example is an explicit example choice, not a recommendation for your building.',
        'Choose Evaluate stated assemblies and review the U/R/capacity results and assumptions.',
        'Enter independently sourced glazing values and choose Save glazing inputs when you want them in the project.'
      ],
      required: 'Layer thickness, conductivity, density and specific heat from applicable product or technical evidence. Glazing needs its own product/test source.',
      optional: 'Glazing can wait if you are only comparing opaque layers. Do not replace missing properties with guessed values to obtain a result.',
      result: 'U describes heat transfer, R resistance and capacity heat storage. These do not establish indoor degrees, energy savings or comfort; VLT and SHGC describe different window properties.',
      sources: ['docs/environment-analysis.md', 'docs/building-physics.md']
    },
    'report/drawings': {
      title: 'Prepare a scaled reference drawing',
      task: 'Export shared drawing sheets rather than a screenshot of the editor.',
      steps: [
        'Choose the drawing discipline and open View & print settings for the intended floor or saved view.',
        'Choose paper, orientation, scale, units and layers, then Refresh preview.',
        'Read the page selector, continuation pages and assumptions. If geometry overflows, deliberately change paper/orientation or an allowed scale rather than shrinking the print.',
        'Prepare the required PDF, SVG or PNG and save the listed files. Print at 100% / Actual size and verify the scale bar.'
      ],
      required: 'Current model geometry and a supported sheet/view selection. Elevations, structural and services sheets need their corresponding authored intent.',
      optional: 'You can export a floor plan without running environmental studies or completing structural/services models. Select only the discipline you need.',
      result: 'These are fixed-scale reference sheets, not certified construction documents. Screen Fit to width does not change drawing scale; PDF font limits may require SVG/PNG instead.',
      sources: ['docs/drawing-report.md', 'docs/drawing-export-formats.md']
    },
    'report/package': {
      title: 'Assemble a coordinated document set',
      task: 'Review one captured project revision and the evidence actually available for it.',
      steps: [
        'Review the package settings for the intended content, then choose Refresh preview.',
        'Use Preview controls to inspect pages and open Findings & missing evidence for unresolved items.',
        'Choose Prepare PDF, Prepare SVG or Prepare PNG; Prepare manifest provides the index/provenance files without drawings.',
        'Download each listed file, including the manifest and available attachments. After edits, refresh and prepare again.'
      ],
      required: 'A current project and an explicit package scope. Resolve drawing prerequisites for the sheets you select.',
      optional: 'Unavailable light/airflow evidence can remain unavailable. Creating a package does not run those studies or fill engineering inputs.',
      result: 'The manifest records what was captured and included. Missing evidence and reference sheets do not become professional certification; a browser download request is not proof a file was saved.',
      sources: ['docs/package-workbench.md', 'docs/coordinated-package.md']
    },
    'report/schedules': {
      title: 'Read the current room schedule',
      task: 'Check room quantities and areas against the model you are editing.',
      steps: [
        'Choose the active editable floor in the shared toolbar.',
        'Read Room schedule and compare its rooms and dimensions with Design → Layout.',
        'For a correction, change the actual room in Layout rather than treating this derived table as a separate editable plan.'
      ],
      required: 'Rooms on the selected floor. Use measured dimensions for an existing building or label proposal dimensions clearly.',
      optional: 'No weather, optical properties or engineering calculations are needed to read room quantities.',
      result: 'Usable/net area respects service reservations. A room’s enclosing rectangle is not necessarily its remaining usable floor, and schedule quantities are not a certified survey.',
      sources: ['docs/room-planner.md', 'docs/workspace-navigation.md']
    },
    'report/electrical': {
      title: 'Review the point schedule',
      task: 'Check active-floor device intent and identify incomplete placements.',
      steps: [
        'Choose the active editable floor in the shared toolbar.',
        'Read Point schedule and select a named point where offered to inspect that exact record.',
        'Use Design → Electrical to correct the point’s host, dimensions or context, then return to the schedule.'
      ],
      required: 'Saved electrical points on the selected floor. Product and coordinated-layout evidence is needed to resolve unknown device dimensions.',
      optional: 'An empty point schedule is valid if you have not planned electrical intent. Missing physical inputs should remain visible, not guessed.',
      result: 'The table counts intended points and records placement review. It is not a circuit schedule, load calculation or electrical safety certificate.',
      sources: ['docs/electrical-planning.md', 'docs/workspace-navigation.md']
    },
    'report/exports': {
      title: 'Back up the project and export existing evidence',
      task: 'Keep a recoverable project file separate from analysis outputs and browser storage.',
      steps: [
        'Use Export JSON for the full project, then verify the downloaded file exists.',
        'Use the analytical export controls for the available results you intend to share; review their source scenario and freshness first.',
        'Follow Sun Path CSV exports and whole-house exposure for those specific outputs, rather than assuming every result is in one table.',
        'Use Save now for a browser copy as well. Import JSON in Projects & backups validates a file before any project replacement.'
      ],
      required: 'A current project for backup; a matching evaluated result for any numerical export. Apply workbench drafts explicitly if you want their accepted inputs included in the project.',
      optional: 'You can export the project with unknown fields and without running an analysis. Session-only drafts/results are not automatically a durable project backup.',
      result: 'Project JSON is the editable backup format. Analytical files are scoped evidence, not a project replacement; neither a generated link nor a browser save guarantees a separate downloaded backup.',
      sources: ['docs/local-persistence.md', 'docs/environment-analysis.md', 'docs/workspace-navigation.md']
    }
  });

  const introduction = freeze({
    title: 'Start here: a floor plan does not need every study input',
    paragraphs: [
      'Start with your site dimensions, arrange rooms, and save a backup. Structure, electrical, plumbing and environmental workspaces are optional next tasks, not a form you must finish before using the planner.',
      'Use measured dimensions or a clearly labelled proposal. Leave unavailable evidence unknown: blank is not zero and is not automatically an application error. An optional analysis can be blocked while your room layout remains usable.',
      'Homeowner and Expert change presentation, not the project or the truth of its inputs. Expert mode does not supply missing measurements or certify results. Open How to use this section under any workspace heading for the same guidance.',
      'Opening this guide does not change your project, active floor, selection or input drafts. It does not run studies, save, detect location or contact a service. Links to planner sections on this separate page open the application; keep your original editing tab for pending work.'
    ],
    steps: [
      { route: 'site/plot', text: 'Set measured site dimensions and review the planning scenario.' },
      { route: 'design/layout', text: 'Arrange rooms on the intended active floor; use numeric Selection properties as well as the plan.' },
      { route: 'report/exports', text: 'Choose Save now and verify Saved in this browser, then Export JSON for a separate backup.' },
      { route: 'environment/light', text: 'If useful, Analyze whole house maps sky access from the current geometry; custom studies remain optional.' },
      { route: 'report/drawings', text: 'Refresh a drawing preview, review its assumptions, and prepare the reference sheets you need.' }
    ]
  });

  const glossary = freeze([
    ['Unknown / blank', 'A value or piece of evidence has not been supplied or resolved. Do not replace it with zero just to clear a warning.'],
    ['Not run / not evaluated', 'No calculation has been performed for these inputs. Preparing an inventory or saving a draft is not a numerical result.'],
    ['Blocked / failed', 'Blocked means prerequisites prevent the requested calculation. Failed means an attempted action did not finish successfully. Read the stated reason; neither means a zero result.'],
    ['Zero / night', 'Zero is a known numerical value. Night can mean zero direct sunlight, but it does not fill unknown sky or context values.'],
    ['Stale', 'An earlier result no longer matches the relevant current inputs. Review and explicitly rerun or refresh; an old picture is not current evidence.'],
    ['Workplane / height above floor', 'The horizontal sampling plane used by the light study, such as the plane you intend to examine. Enter its height in metres above that floor; it is not a ceiling height or a recommendation.'],
    ['Window optics / VLT / SHGC', 'Optics states how the study treats an opening. Ideal-clear is an explicit idealization. VLT is the transmitted visible-light fraction; SHGC concerns solar heat gain. They are not interchangeable. Use the relevant product/test evidence.'],
    ['Near-horizon cutoff', 'A numerical low-sun exclusion threshold, not a physical shading device or a recommended design value. Custom time-based light studies require a stated angle greater than 0° and less than 90°; whole-house sky access does not need it. Excluded near-horizon intervals are not silently counted as known shade.'],
    ['Cd / discharge coefficient', 'A dimensionless airflow coefficient describing an opening’s flow behavior. It needs an applicable technical source or qualified review; it is not supplied by the window’s visual transparency.'],
    ['Pressure boundary / signed forcing', 'A declared driving pressure for an airflow connection, in pascals, with direction defined by its from/to endpoints. Compass direction or a weather wind rose alone does not establish this input.'],
    ['Clear volume', 'The stated usable air volume in cubic metres. It can be derived from appropriate measured geometry, but a room label or drawn area does not make a verified volume automatically available.'],
    ['Invert / project datum', 'An invert is the pipe’s inside-bottom level. The project datum is the common reference for levels. Invert, ground level, finished floor and a route’s drawn axis are different inputs; one does not silently supply another.'],
    ['Scenario', 'A named set of stated assumptions or study inputs for a particular question. An example scenario is not evidence that those values apply to your building.'],
    ['Revision / snapshot', 'A revision identifies a state of project edits. A snapshot is a captured copy of the inputs used for a view, export or study. Matching relevant inputs matters as well as the revision number.'],
    ['Plot / floor plate / net area', 'The plot is the site boundary; the floor plate is the buildable area. A room’s net usable area excludes reserved service space, including the reservation’s wall footprint.'],
    ['Engineering not assessed', 'The application has recorded intent or compared supported geometry, not verified structural adequacy, wiring, hydraulic capacity, professional accessibility or legal approval.']
  ]);

  function routeKey(route) {
    return typeof route === 'string' ? route : route ? `${route.destination}/${route.section}` : '';
  }

  function getGuide(route) {
    const key = routeKey(route);
    return Object.prototype.hasOwnProperty.call(guides, key) ? guides[key] : null;
  }

  const anchorFor = route => `guide-${routeKey(route).replace('/', '-')}`;
  function plannerURL(route) {
    if (!getGuide(route)) return null;
    const [destination, section] = routeKey(route).split('/');
    return `index.html?workspace=${destination}&section=${section}`;
  }

  function element(doc, tag, text, className) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderGuide(doc, guide, headingTag) {
    const content = element(doc, 'div', '', 'hp-guide-content');
    content.append(element(doc, headingTag, guide.title), element(doc, 'p', guide.task));
    const steps = element(doc, 'ol');
    guide.steps.forEach(step => steps.append(element(doc, 'li', step)));
    const facts = element(doc, 'dl');
    for (const [label, text] of [
      ['What you need', guide.required], ['Can leave blank / skip', guide.optional], ['What the result means', guide.result]
    ]) facts.append(element(doc, 'dt', label), element(doc, 'dd', text));
    content.append(steps, facts);
    return content;
  }

  function mount(document = root.document, workspace = root.HomePlannerWorkspace) {
    const host = document?.getElementById('workspaceGuide');
    if (!host || !workspace?.getRoute) return null;
    if (host.homePlannerGuide) return host.homePlannerGuide;
    const disclosure = element(document, 'details', '', 'hp-guide-disclosure');
    const summary = element(document, 'summary', 'How to use this section');
    const body = element(document, 'div');
    disclosure.append(summary, body);
    host.append(disclosure);
    let currentKey = null, disposed = false;
    function sync() {
      if (disposed) return;
      const route = workspace.getRoute(), key = routeKey(route);
      if (key === currentKey) return;
      const guide = getGuide(route);
      currentKey = key;
      disclosure.open = false;
      if (!guide) {
        body.replaceChildren(element(document, 'p', 'No section guide is available for this route.'));
        return;
      }
      const link = element(document, 'a', 'Full user guide');
      link.href = `user-guide.html#${anchorFor(key)}`;
      link.target = '_blank';
      link.rel = 'noopener';
      const footer = element(document, 'p', '', 'hp-guide-footer');
      footer.append(link, document.createTextNode(' — start here, all sections and plain-English terms (opens a new tab).'));
      body.replaceChildren(renderGuide(document, guide, 'h3'), footer);
    }
    const controller = {
      sync,
      dispose() {
        if (disposed) return;
        disposed = true;
        document.removeEventListener('homeplanner:workspace-change', sync);
        disclosure.remove();
        delete host.homePlannerGuide;
      }
    };
    host.homePlannerGuide = controller;
    document.addEventListener('homeplanner:workspace-change', sync);
    sync();
    return controller;
  }

  function mountAll(document = root.document) {
    const host = document?.getElementById('homePlannerUserGuide');
    if (!host) return null;
    if (host.homePlannerFullGuide) return host.homePlannerFullGuide;
    const content = element(document, 'div');
    const start = element(document, 'section');
    start.id = 'start';
    start.append(element(document, 'h2', introduction.title));
    introduction.paragraphs.forEach(text => start.append(element(document, 'p', text)));
    const journey = element(document, 'ol');
    introduction.steps.forEach(step => {
      const item = element(document, 'li');
      const link = element(document, 'a', step.text);
      link.href = `#${anchorFor(step.route)}`;
      item.append(link); journey.append(item);
    });
    start.append(journey);
    const nav = element(document, 'nav', '', 'hp-guide-toc');
    nav.setAttribute('aria-label', 'User guide contents');
    nav.append(element(document, 'h2', 'Find your section'));
    const list = element(document, 'ul');
    for (const [route, guide] of Object.entries(guides)) {
      const item = element(document, 'li'), link = element(document, 'a', guide.title);
      link.href = `#${anchorFor(route)}`;
      item.append(link); list.append(item);
    }
    const glossaryItem = element(document, 'li'), glossaryLink = element(document, 'a', 'Plain-English glossary');
    glossaryLink.href = '#glossary'; glossaryItem.append(glossaryLink); list.append(glossaryItem);
    nav.append(list); content.append(start, nav);
    for (const [route, guide] of Object.entries(guides)) {
      const section = element(document, 'section', '', 'hp-guide-section');
      section.id = anchorFor(route);
      section.append(renderGuide(document, guide, 'h2'));
      const footer = element(document, 'p', '', 'hp-guide-footer');
      const open = element(document, 'a', 'Open this section in the planner');
      open.href = plannerURL(route);
      const top = element(document, 'a', 'Back to contents');
      top.href = '#guide-contents';
      footer.append(open, document.createTextNode(' · '), top); section.append(footer); content.append(section);
    }
    nav.id = 'guide-contents';
    const terms = element(document, 'section', '', 'hp-guide-section'); terms.id = 'glossary';
    terms.append(element(document, 'h2', 'Plain-English glossary'));
    const definitions = element(document, 'dl');
    glossary.forEach(([term, text]) => definitions.append(element(document, 'dt', term), element(document, 'dd', text)));
    terms.append(definitions); content.append(terms); host.append(content);
    let disposed = false;
    const controller = { dispose() {
      if (disposed) return;
      disposed = true;
      content.remove();
      delete host.homePlannerFullGuide;
    } };
    host.homePlannerFullGuide = controller;
    return controller;
  }

  return Object.freeze({ guides, introduction, glossary, getGuide, anchorFor, plannerURL, mount, mountAll });
});
