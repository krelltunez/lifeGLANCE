# Vendored fonts

All vendored here so the asset scripts need no network and cannot silently fall
back to a substitute face. Every font below is licensed under the SIL Open Font
License, Version 1.1 — the licence text is in `OFL.txt`.

| File | Font | Copyright | Used by |
|---|---|---|---|
| `CourierPrime-Regular.ttf`, `CourierPrime-BoldItalic.ttf` | Courier Prime | Copyright 2015 The Courier Prime Project Authors (https://github.com/quoteunquoteapps/CourierPrime) | `scripts/feature-graphic.mjs` — the app's wordmark face |
| `Lora.ttf`, `Lora-Italic.ttf` | Lora (variable) | Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic) | `scripts/compose-apple-frames.py` — store-frame headlines |

`OFL.txt` carries the Courier Prime copyright line at the top; the licence body
below it governs both families.

The store-frame eyebrow uses **DejaVuSans-Bold** from the system
(`/usr/share/fonts/truetype/dejavu/`), matching the GLANCE screenshot kit. It is
not vendored; the compositor falls back to Lora Bold if it is missing, so a
machine without it still renders rather than failing.
