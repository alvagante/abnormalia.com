---
name: jimp-bundle-bug
description: Jimp bundling breaks content-image and content-infographic in swamp — Node.js can't require() data: URIs that deno inlines for Jimp codecs
metadata:
  type: project
---

## Bug

`@alvagante/content-image@2026.06.23.1` and `@alvagante/content-infographic@2026.06.23.1` both fail to load after `swamp extension pull --force`.

The failure is silent at bundle time (deno bundles successfully, file is written), but swamp's catalog write fails and any subsequent load crashes Node.js:

```
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a file URL object,
file URL string, or absolute path string.
Received 'data:application/javascript;base64,[truncated]'... 2235959 more characters
```

**Why:** Jimp embeds its image codec data as `require('data:application/javascript;base64,...')` calls. Deno inlines these literally into the bundle. Node.js's CommonJS `require()` does not support `data:` URIs as module identifiers — it expects a file path.

**Introduced in:** git commit `f9007d5` ("Extensions shared data") in `swamp-extensions`. Both extensions gained `import Jimp from "npm:jimp@0.22.12"` in the same commit that added the shared file refactor.

**Affected files:**
- `extensions/content-image/extensions/models/content_image.ts` — `f9007d5` added Jimp
- `extensions/content-infographic/extensions/models/content_infographic.ts` — `f9007d5` added Jimp

## Workaround (applied 2026-06-23)

Reverted both extension source files to pre-Jimp versions:
- `content-image`: restored from commit `4cab882` ("New extensions")
- `content-infographic`: restored from commit `92c7fb7` ("Swamp update")

Rebuilt bundles manually with `deno bundle`, placed them in `.swamp/bundles/`, and patched the swamp SQLite catalog (`.swamp/_extension_catalog.db`) to reference them with `state='Indexed'`.

The pre-Jimp bundles are ~557KB (vs ~1.6MB with Jimp). These are working but pinned to old functionality (no Jimp image compositing).

## Fix options (for swamp-extensions session)

1. **Replace Jimp with a Node-compatible compositing approach** — `sharp` or `canvas` would bundle/load differently, but check if they also produce data: URIs via deno bundle.
2. **Dynamic import Jimp at runtime** — avoid static bundling of Jimp by using a lazy `await import()` inside the method body with a try/catch. Deno might not inline dynamic imports.
3. **Separate the Jimp logic into a subprocess** — shell out to a small deno script that does the compositing; the main bundle stays clean.
4. **Check if newer Jimp (0.23+) changed codec loading** — the data: URI behavior might be Jimp's codec registration system; a newer version might use a different pattern.

**Why:** Preserving image compositing (logo watermarking, overlays) added in `f9007d5` while making the bundle loadable in Node.js.
