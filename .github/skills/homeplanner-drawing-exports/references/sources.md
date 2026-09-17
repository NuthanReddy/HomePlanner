# Drawing exports: verified primary sources

Checked **17 Sep 2026**. Only public standards/documentation were fetched; no repository/user data was transmitted. The Adobe-hosted PDF was inspected in memory, not copied into the repository. These are format references, not a claim of full conformance, CAD/BIM capability or engineering approval.

## W3C: SVG 1.1, Coordinate Systems, Transformations and Units
- URL: https://www.w3.org/TR/SVG11/coords.html
- Checked: 17 Sep 2026.
- Establishes: viewport dimensions, user coordinates, physical length units and `viewBox`/transform mappings are distinct. An exported document can express physical dimensions while its viewport presentation is scaled.
- Does not establish: that a particular drawing has correct architectural scale, embedded fonts, printer calibration, room topology or CAD/BIM semantics. Validate the actual SVG and preserve HomePlanner's paper-mm contract.

## Adobe-hosted ISO 32000-1:2008 (PDF 1.7)
- URL: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
- Checked: 17 Sep 2026; official Adobe copy retrieved successfully and §8.3.2.3 inspected.
- Establishes: PDF default user space is device-independent; absent/unsupported `UserUnit`, its unit is 1/72 inch. Page coordinates normally have positive y upward, and page rotation/cropping affect presentation.
- Does not establish: that an arbitrary PDF is vector rather than raster, that fonts cover Unicode, that printing preserves actual size, or that the pinned exporter implements all PDF features. This historical PDF 1.7 reference is not a claim of PDF 2.0, PDF/A or accessible-PDF certification.

## W3C: PNG Specification, Third Edition
- URL: https://www.w3.org/TR/png-3/
- Checked: 17 Sep 2026; specification title/abstract and decoder error-handling requirements verified.
- Establishes: PNG is a lossless raster-image format with defined signatures/chunks and error handling; successful image extraction depends on supported critical data, not just a `.png` name.
- Does not establish: vector paths, editable CAD entities, semantic BIM, guaranteed print-DPI metadata or an uncapped export resolution. Pixel dimensions, decode success, browser resources and any physical-print claim need their own validation.
