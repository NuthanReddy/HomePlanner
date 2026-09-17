# PDF runtime provenance

- Runtime: **pdf-lib 1.17.1**, upstream <https://github.com/Hopding/pdf-lib>.
- Registry artifact: <https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz>.
- Acquired with `npm pack pdf-lib@1.17.1 --ignore-scripts`; no installation or lifecycle scripts.
- Committed file `pdf-lib-1.17.1.min.js` is the **unchanged** upstream
  `package/dist/pdf-lib.min.js` UMD bundle. It supplies both browser `PDFLib` and CommonJS.
- Package integrity:
  `sha512-V/mpyJAoTsN4cnP31vc0wfNA1+p20evqqnap0KLoRUN0Yk/p3wN52DOEsL4oBFcLdb76hlpKPtzJIgo67j/XLw==`
- Runtime SHA-256:
  `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f`
- License: MIT; original upstream text retained in `LICENSE.md`.
- Acquired/checked: 2026-09-16. API checked against Context7 `/hopding/pdf-lib`
  and the published 1.17.1 source. This is a pinned upstream distribution, not a
  claim of an independent security audit.

The UMD runtime bundles its dependencies; **no additional scripts are needed**.
The upstream manifest declares `@pdf-lib/standard-fonts ^1.0.0`,
`@pdf-lib/upng ^1.0.1`, `pako ^1.0.11`, and `tslib ^1.11.1`.
License copies in `licenses` were acquired from these explicitly named releases
using `npm pack --ignore-scripts` (these are license-source versions, not an
independent reconstruction of upstream's bundle lockfile):

| Package | License source version | License files |
| --- | --- | --- |
| `@pdf-lib/standard-fonts` | 1.0.0 | `standard-fonts-LICENSE.md` (MIT) |
| `@pdf-lib/upng` | 1.0.1 | `upng-LICENSE` (MIT) |
| `pako` | 1.0.11 | `pako-LICENSE` (MIT), `pako-zlib-NOTICE.txt` (zlib source notice) |
| `tslib` | 1.11.1 | `tslib-LICENSE.txt` (Apache-2.0), `tslib-CopyrightNotice.txt` |

Acquisition archives and unused package source were removed. No CDN, remote
font fetch, telemetry, package installation, or network request is involved in
an export. Updating this runtime requires reviewing upstream changes, replacing
the pinned bundle and applicable notices, updating this hash/version record,
and rerunning `node --test tests\planner-drawing-export.test.cjs`.
