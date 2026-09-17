# Architecture: verified primary sources

Checked **17 Sep 2026**. Only public documentation URLs were requested; no repository or user data was sent. These are workflow references, not evidence that HomePlanner implements another product's capabilities. The summaries below are original paraphrases, not copied designs or source code.

## Sweet Home 3D users guide
- URL: https://www.sweethome3d.com/users-guide/
- Checked: 17 Sep 2026; official guide identifies its tutorial as version 7.5.
- Establishes: a coherent workflow sets units and wall dimensions, draws rooms/walls/openings, reviews linked 2D/3D views, uses Undo/Redo and deliberately saves work. Imported reference images need a known-length scale and origin.
- Does not establish: HomePlanner's reservation rules, data schema, topology, arbitrary wall editing, actual clearances, structural safety or local planning approval. Product features are inspiration for review steps, not permission to port designs/source or infer implemented capabilities.

## LibreCAD: Setting up a Drawing
- URL: https://docs.librecad.org/en/latest/guides/dwg-setup.html
- Checked: 17 Sep 2026; the manual labels itself latest/pre-release and work in progress.
- Establishes: model objects are drawn at full size; units, page size, dimension presentation and output scale are separate choices. Named templates can retain explicit setup for new drawings.
- Does not establish: a HomePlanner starter/template API, permission to overwrite a saved project, physical wall/room semantics, surveyed accuracy or interoperability. Its print-fitting workflow does not override HomePlanner's fixed-scale, explicit-overflow policy.
