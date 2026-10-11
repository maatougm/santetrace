# PDF.js static assets — provenance

Used by `src/components/doctor/review/SourceViewer.tsx` (clinician source-PDF viewer). Served as
public, same-origin static files. They contain no patient data. Private PDFs never pass through here:
the app fetches them from `/api/documents/:id/source` and gives PDF.js the bytes in memory.

| | |
|---|---|
| Package | `pdfjs-dist` (Mozilla PDF.js), npm |
| Version | **6.4.299** (matches `node_modules/pdfjs-dist/package.json` and `pdfjsVersion` in the worker header) |
| Licence | Apache-2.0 (`6.4.299/LICENSE`); bundled third-party licences are kept next to their files |
| Copied | 2026-10-10, byte-identical to the installed package (checked with `cmp` and `diff -rq`) |
| Total size | about 3.1 MB. Code, fonts and decoders only; no model weights |

## Files (`public/pdfjs/6.4.299/` ← `node_modules/pdfjs-dist/`)

| Copy | Source | Purpose |
|---|---|---|
| `pdf.worker.min.mjs` | `legacy/build/pdf.worker.min.mjs` | PDF.js worker. The legacy build polyfills ES2025+ built-ins for older embedded Chromium |
| `LICENSE` | `LICENSE` | PDF.js licence |
| `standard_fonts/*` | `standard_fonts/*` | Data for non-embedded base-14 fonts (Foxit and Liberation, licences included) |
| `wasm/jbig2.wasm`, `wasm/jbig2_nowasm_fallback.js` | `wasm/` | JBIG2 (scanned black-and-white) image decoder, plus a JS fallback loaded with `import()` |
| `wasm/openjpeg.wasm`, `wasm/openjpeg_nowasm_fallback.js` | `wasm/` | JPEG 2000 image decoder, plus a JS fallback |
| `wasm/qcms_bg.wasm` | `wasm/` | ICC colour management |
| `wasm/LICENSE_*` | `wasm/LICENSE_*` | Decoder licences |
| `iccs/*` | `iccs/*` | Default CMYK ICC profile and its licence |

**Deliberately not copied:**
- `wasm/quickjs-eval.js` and `wasm/quickjs-eval.wasm`: the PDF JavaScript engine. Document scripting
  stays disabled.
- `cmaps/`: only needed for non-embedded CJK fonts.
- `pdf.sandbox*`: the scripting sandbox.

## Versioning and caching

- **Versioned paths.** All asset URLs contain the version (`/pdfjs/6.4.299/...`), so an upgrade gets new
  URLs and never mixes a cached old worker with a new API.
- **Version guard.** `SourceViewer` checks at runtime that `pdfjs.version === "6.4.299"`. On a mismatch
  it shows `PDF_VIEWER_UNAVAILABLE` and does not load a stale worker.
- **Caching.** Next serves `public/` with its default cache headers; `.mjs` is served as
  `application/javascript`. The patient service worker does not cache `/pdfjs/**`.

## Upgrading pdfjs-dist

1. Copy the files above from the new `node_modules/pdfjs-dist/` into `public/pdfjs/<new version>/`.
   Again leave out `quickjs-eval.*`, `cmaps/` and `pdf.sandbox*`.
2. Set `PDFJS_VERSION` in `SourceViewer.tsx` to the new version.
3. Delete the old version folder.
4. Verify with `cmp` / `diff -rq` against `node_modules`.
