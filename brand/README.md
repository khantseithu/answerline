# Answerline brand

Signal “a” is the approved identity: a lowercase a cut by a continuous voice line. These SVGs trace the selected Image Gen artwork; their lettering is outlined and needs no installed fonts.

| Asset | Use |
| --- | --- |
| `mark-black` / `mark-white` | Standalone symbol, avatars, compact navigation |
| `logo-black` / `logo-white` | Horizontal symbol and wordmark for headers and docs |
| `wordmark-black` / `wordmark-white` | Name alone where the symbol already appears |
| `logo-stacked-black` / `logo-stacked-white` | Square placements and cover artwork |
| `app-icon` | Teal app tile; favicon and home-screen icon |

Each asset is available as SVG and PNG. SVG is preferred on the web and for resizing. PNGs have transparent backgrounds except the app tile. Black variants go on light surfaces; white variants go on dark surfaces. Keep the voice line transparent and preserve the artwork’s aspect ratio. Allow at least one quarter of the symbol’s width as clear space around a placement. Check the mark at its actual display size; use the app tile for browser tabs.

The brand neutrals are `#111111` and `#ffffff`; the product accent is `#007563`. In the product, the mark can inherit a semantic foreground or call-state color.

Open `index.html` for the asset gallery. `reference/signal-a-original.png` preserves the selected concept. The website renders the same traced paths through `apps/web/src/components/brand/logo-paths.ts`. `docs/assets/` contains the README copies.
