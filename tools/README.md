# tools/

Development helpers. **None of these are needed to run the plugin** — they were
used while building it, and they are kept because they document where the
geometry in `client.js` comes from.

| File | What it does | How to run |
| --- | --- | --- |
| `measure-head.cjs` | Prints her hair silhouette row by row from `assets/expression_happy.png`. The pot's size and resting row are derived from these numbers. | `<DSH Desktop.exe> tools/measure-head.cjs` |
| `measure-pot.cjs` | Decodes `assets/iron_bowl.webp` (Electron's image codec) to PNG and prints the pot's visible bounds — the padding that later flattened the pot. | same pattern as above |
| `check_quad.ps1` | Verifies that all four expression sheets share one tablet-panel position, so the readout cannot drift between faces. | `powershell -File tools/check_quad.ps1` |
| `make_flash.ps1` | Regenerates `assets/flash.png` (the flat red hurt layer, RGB 255,48,34, alpha kept) from the sprite. Run this if you replace the sprite. | `powershell -File tools/make_flash.ps1` |
| `make_expressions.ps1` | Older generator for the expression sheets; superseded by the sheets that ship now. Kept for reference. | — |
| `preview_expressions.ps1` | Builds `tools/expressions-preview.png`, a side-by-side sheet used to eyeball all four faces. | `powershell -File tools/preview_expressions.ps1` |
| `fit_panel.ps1` | Scratch tool for fitting the tablet panel; not part of the workflow any more. | — |

The scripts are Windows/PowerShell oriented and were only ever run there. The two
`.cjs` files need `require('electron')`, which is why they are launched with the
DSH Desktop executable in Node mode rather than plain `node`.
