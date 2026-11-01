#!/usr/bin/env python3
"""Compose the App Store canvases from raw app-surface panes.

Called by scripts/screenshots.mjs:  compose-apple-frames.py <pane-dir> <out-dir>

House style, and the reason this is not one of the GLANCE screenshot kit's
framers: lifeGLANCE ships NO device chrome. No bezels, no status bars, no home
indicators, no donor grafts. The app surface bleeds to the left and right canvas
edges and the caption sits in a band above it. What IS taken from the kit (v2.1)
is the part that makes the GLANCE listings look like one family: the design
tokens, the Lora/DejaVu caption pattern, and the background treatment.

The kit's background loop is per-pixel Python, which costs ~40s on a 2752x2064
canvas. Vectorised here with numpy; the output is the same image.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "scripts" / "assets" / "fonts"

# ---------------------------------------------------------------- tokens ---
# Kit v2.1 DESIGN TOKENS, with lifeGLANCE violet in place of dayGLANCE orange.
VIOLET = (129, 112, 238)          # #8170EE
WARM_WHITE = (247, 245, 241)
BG_TOP, BG_BOT = (14, 15, 19), (5, 5, 7)

FONT_SERIF = str(FONTS / "Lora.ttf")
FONT_SERIF_IT = str(FONTS / "Lora-Italic.ttf")
# The kit expects the container's DejaVuSans-Bold for the eyebrow. Fall back to
# Lora in Bold so a machine without it still renders rather than dying.
_DEJAVU = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FONT_SANS_BOLD = str(_DEJAVU) if _DEJAVU.exists() else FONT_SERIF


def serif(size, inst="SemiBold", it=False):
    f = ImageFont.truetype(FONT_SERIF_IT if it else FONT_SERIF, size)
    try:
        f.set_variation_by_name(("SemiBold Italic" if it else inst) if inst else inst)
    except Exception:
        pass
    return f


def sans(size):
    f = ImageFont.truetype(FONT_SANS_BOLD, size)
    if FONT_SANS_BOLD == FONT_SERIF:
        try:
            f.set_variation_by_name("Bold")
        except Exception:
            pass
    return f


def tracked(draw, cx, y, text, font, fill, tr):
    """Letter-spaced, centred. The kit's eyebrow treatment."""
    widths = [draw.textlength(c, font=font) for c in text]
    total = sum(widths) + tr * (len(text) - 1)
    x = cx - total / 2
    for c, w in zip(text, widths):
        draw.text((x, y), c, font=font, fill=fill)
        x += w + tr


def build_bg(w, h, glow_y=0.16, glow_x=0.5):
    """Vertical gradient with a brand radial glow screened over it (kit build_bg)."""
    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    base = (np.array(BG_TOP, np.float32) * (1 - t) + np.array(BG_BOT, np.float32) * t)
    base = np.repeat(base[:, None, :], w, axis=1)

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    gx, gy, gr = w * glow_x, h * glow_y, w * 0.62
    f = np.clip(1.0 - np.hypot(xs - gx, ys - gy) / gr, 0.0, None) ** 2
    glow = f[:, :, None] * np.array(VIOLET, np.float32)

    base_img = Image.fromarray(base.clip(0, 255).astype("uint8"))
    glow_img = Image.fromarray(glow.clip(0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(60))
    return Image.blend(base_img, ImageChops.screen(base_img, glow_img), 0.55)


def draw_caption(canvas, eyebrow, l1, l2, *, eb_y, eb_size, eb_track,
                 head_y, head_size, head_pad, line_ratio=1.14, cx=None, column=None):
    """Kit caption pattern: tracked all-caps eyebrow in the brand colour, then
    two Lora lines — warm white above, brand-colour italic below. Shrinks the
    headline to fit rather than wrapping, exactly as the kit framers do."""
    d = ImageDraw.Draw(canvas)
    if cx is None:
        cx = canvas.width // 2
    tracked(d, cx, eb_y, eyebrow, sans(eb_size), VIOLET, eb_track)

    size = head_size
    target = (column or canvas.width) - head_pad
    longest = max(d.textlength(l1, font=serif(size)), d.textlength(l2, font=serif(size, it=True)))
    if longest > target:
        size = int(size * target / longest)
    f1, f2 = serif(size), serif(size, it=True)
    lh = int(size * line_ratio)
    d.text((cx - d.textlength(l1, font=f1) / 2, head_y), l1, font=f1, fill=WARM_WHITE)
    d.text((cx - d.textlength(l2, font=f2) / 2, head_y + lh), l2, font=f2, fill=VIOLET)
    return head_y + lh + int(size * 1.25)   # ink bottom, roughly


def draw_bullets(canvas, bullets, top, bottom, size=56, gap=130, cx=None):
    """Kit widget-frame bullet pattern: Lora italic, text alternating warm white
    and brand colour, each dot the INVERSE of its line's text colour, dots
    centred on the line's real ink box. The block auto-centres in [top, bottom]."""
    d = ImageDraw.Draw(canvas)
    f = serif(size, it=True)
    block_h = gap * (len(bullets) - 1) + size
    y = top + (bottom - top - block_h) // 2
    if cx is None:
        cx = canvas.width // 2
    for i, text in enumerate(bullets):
        fg = WARM_WHITE if i % 2 == 0 else VIOLET
        dot = VIOLET if i % 2 == 0 else WARM_WHITE
        tw = d.textlength(text, font=f)
        dot_r, dot_gap = max(5, size // 11), size // 2
        x = cx - (tw + dot_r * 2 + dot_gap) / 2
        ly = y + i * gap
        box = d.textbbox((x + dot_r * 2 + dot_gap, ly), text, font=f)
        dcy = (box[1] + box[3]) / 2          # real ink centre, not a font fraction
        d.ellipse([x, dcy - dot_r, x + dot_r * 2, dcy + dot_r], fill=dot)
        d.text((x + dot_r * 2 + dot_gap, ly), text, font=f, fill=fg)


def fit_width(path, width, crop=None):
    """Load a pane and scale it to the canvas width. Full bleed: no bezel, no
    mask, no shadow — the app surface runs to both edges.

    `crop` is (x0, x1, y0, y1) as fractions of the capture. Cropping to a
    region narrower than the capture and then fitting to the canvas width
    magnifies it — the only way to make a 16px chapter band the subject of a
    frame rather than a strip under the cards."""
    im = Image.open(path).convert("RGB")
    if crop:
        x0, x1, y0, y1 = crop
        im = im.crop((round(x0 * im.width), round(y0 * im.height),
                      round(x1 * im.width), round(y1 * im.height)))
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    return im


# ----------------------------------------------------------------- shots ---
# App Store Connect retired the 6.9" slot. The iPhone galleries are now
# "iPhone with Dynamic Island (medium display)", which takes 1179 x 2556 or
# 1206 x 2622, and "iPhone Duo". 1206 x 2622 is the larger of the two and its
# aspect is within 0.06% of the old 1320 x 2868, so the composition carries over
# unchanged — PHONE_K rescales the geometry and the type is re-rendered at the
# new size rather than downsampled. Tablet slots are unchanged.
# App Store Connect accepts landscape in the iPhone slots as well as portrait
# (2556x1179, 1179x2556, 2622x1206, 1206x2622). Landscape is the right choice
# here and removes the problem the portrait frames kept running into: the app
# is landscape-locked, so one pane fills a landscape canvas the way shots 6 and
# 7 already do — no stacking, no half-height panes, no collisions from either.
IPHONE_W, IPHONE_H = 2622, 1206
# 2622 x 1206 is very wide and short, so the caption sits in a column to the
# LEFT of the pane rather than above it; stacked, both would be squeezed to
# nothing. The pane bleeds to the top, right and bottom edges.
CAPTION_COL = 1010
PHONE_K = 1206 / 1320              # geometry below was tuned against the old canvas
IPAD_W, IPAD_H = 2752, 2064
IPAD_BAND = 480        # caption band; the pane fills the rest, bleeding to three edges
PANE_GAP = round(36 * PHONE_K)


def k(v):
    """Scale a length tuned against the 1320-wide canvas to the current one."""
    return round(v * PHONE_K)

SHOTS = [
    dict(kind="iphone", out="iphone-dynamic-island/01-decades.png", panes=["iphone/01a"],
         eyebrow="DECADES TO WEEKS", l1="See your whole life,", l2="at a glance."),
    # Cropped to the ribbon band plus the cards either side of it. Uncropped,
    # the ribbons are a thin line with a third of the pane empty beneath them
    # and the cards dominating a frame whose caption is about chapters.
    dict(kind="iphone", out="iphone-dynamic-island/02-chapters.png", panes=["iphone/02a"],
         band=80,
         eyebrow="CHAPTERS", l1="The eras you lived,", l2="drawn to scale."),
    dict(kind="iphone", out="iphone-dynamic-island/03-future.png", panes=["iphone/03a"],
         eyebrow="THE FUTURE HALF", l1="Half your timeline", l2="hasn't happened yet."),
    dict(kind="iphone", out="iphone-dynamic-island/04-on-this-day.png", panes=["iphone/04a"],
         eyebrow="ON THIS DAY", l1="What today meant", l2="in every other year."),
    # The privacy bullets sit under the caption in the left column, beside the
    # dialog rather than below it — there is no room below on a 1206px canvas.
    dict(kind="iphone", out="iphone-dynamic-island/05-add-milestone.png", panes=["iphone/05a"],
         eyebrow="ADD A MILESTONE", l1="Some memories have a date.", l2="Others have a year.",
         bullets=["Works fully offline.", "No account, no analytics.",
                  "Your life stays on your device."]),
    dict(kind="ipad", out="ipad13/06-timeline.png", panes=["ipad/06a"],
         eyebrow="THE LONG VIEW", l1="Years at a time,", l2="all in one window."),
    dict(kind="ipad", out="ipad13/07-milestone.png", panes=["ipad/07a"],
         eyebrow="IN CONTEXT", l1="One moment,", l2="and everything around it."),
]


def band_crop(pane, fade, head=0.07, foot=0.86, pad=26):
    """Crop a pane to the rows that actually carry content, and feather the two
    cut edges.

    The boundaries are measured, not fixed fractions. Fixed fractions sliced
    cards in half at the fade, which reads as damage rather than as a crop, and
    they go stale the moment the lane assignment shifts. `head` and `foot`
    exclude the app's own header and footer bars, which otherwise set the
    extent to the whole pane; between them the first and last rows carrying ink
    bound the band, so every card is whole and the fades land on empty space.

    Full width is kept deliberately and the sides are not faded: every other
    frame in the set is a full-width pane, and feathering the sides would make
    this one read as a different treatment rather than the same app window
    cropped.
    """
    import numpy as np
    a = np.asarray(pane.convert("L")).astype(float)
    lo, hi = round(head * pane.height), round(foot * pane.height)
    rows = (a[lo:hi] > 55).mean(axis=1)
    ink = np.where(rows > 0.004)[0]
    if len(ink) == 0:
        return pane, Image.new("L", pane.size, 255)
    y0 = max(0, lo + ink[0] - pad)
    y1 = min(pane.height, lo + ink[-1] + pad)

    band = pane.crop((0, y0, pane.width, y1))
    mask = Image.new("L", band.size, 255)
    px = mask.load()
    span = min(fade, band.height // 2)
    for y in range(span):
        v = round(255 * y / span)
        for x in range(band.width):
            px[x, y] = v
            px[x, band.height - 1 - y] = v
    return band, mask


def compose_iphone(shot, pane_dir, out_path):
    """Landscape phone canvas: caption column left, one app pane right."""
    pane_w = IPHONE_W - CAPTION_COL
    pane = Image.open(pane_dir / f"{shot['panes'][0]}.png").convert("RGB")
    if pane.size != (pane_w, IPHONE_H):
        pane = pane.resize((pane_w, IPHONE_H), Image.LANCZOS)

    cx = CAPTION_COL // 2
    eb_size, head_size = 38, 104
    lh = int(head_size * 1.14)
    cap_h = eb_size + 60 + 2 * lh

    bullets = shot.get("bullets")
    if bullets:
        bul_gap, bul_size = 92, 46
        bul_h = bul_gap * (len(bullets) - 1) + bul_size
        total = cap_h + 110 + bul_h
        eb_y = (IPHONE_H - total) // 2
    else:
        eb_y = (IPHONE_H - cap_h) // 2

    canvas = build_bg(IPHONE_W, IPHONE_H,
                      glow_y=(eb_y + cap_h * 0.5) / IPHONE_H,
                      glow_x=cx / IPHONE_W)
    draw_caption(canvas, shot["eyebrow"], shot["l1"], shot["l2"],
                 eb_y=eb_y, eb_size=eb_size, eb_track=11,
                 head_y=eb_y + 80, head_size=head_size, head_pad=130,
                 cx=cx, column=CAPTION_COL)
    if bullets:
        top = eb_y + cap_h + 110
        draw_bullets(canvas, bullets, top, top + bul_h,
                     size=bul_size, gap=bul_gap, cx=cx)
    if shot.get("band"):
        band, mask = band_crop(pane, shot["band"])
        canvas.paste(band, (CAPTION_COL, (IPHONE_H - band.height) // 2), mask)
    else:
        canvas.paste(pane, (CAPTION_COL, 0))
    canvas.save(out_path)
    return canvas.size


def _compose_iphone_portrait(shot, pane_dir, out_path):
    crops = shot.get("crops") or [None] * len(shot["panes"])
    panes = [fit_width(pane_dir / f"{p}.png", IPHONE_W, c)
             for p, c in zip(shot["panes"], crops)]
    block_h = sum(p.height for p in panes) + PANE_GAP * (len(panes) - 1)

    if shot.get("full"):
        # One pane, bleeding to the bottom edge. A compact-layout pane tops out
        # near 900px tall, so the caption centres in whatever is left above it
        # rather than sitting pinned to the top — otherwise the frame is a
        # caption and a screenshot with a thousand pixels of nothing between
        # them. The glow follows the caption, so the light stays behind the type.
        pane = panes[0]
        pane_top = IPHONE_H - pane.height
        cap_block = k(420)
        eb_y = max(k(150), (pane_top - cap_block) // 2)
        canvas = build_bg(IPHONE_W, IPHONE_H,
                          glow_y=(eb_y + cap_block * 0.45) / IPHONE_H)
        draw_caption(canvas, shot["eyebrow"], shot["l1"], shot["l2"],
                     eb_y=eb_y, eb_size=k(34), eb_track=k(10),
                     head_y=eb_y + k(86), head_size=k(132), head_pad=k(210))
        canvas.paste(pane, (0, pane_top))
        canvas.save(out_path)
        return canvas.size

    canvas = build_bg(IPHONE_W, IPHONE_H)
    draw_caption(canvas, shot["eyebrow"], shot["l1"], shot["l2"],
                 eb_y=k(150), eb_size=k(34), eb_track=k(10),
                 head_y=k(236), head_size=k(132), head_pad=k(210))

    if shot.get("bullets"):
        # One pane plus the privacy block: seat the pane just under the caption
        # and give the bullets the whole remaining column to centre in.
        top = k(760)
    else:
        # Two panes: centre the stack in the space below the caption, so the
        # bottom margin reads as deliberate rather than left over.
        top = k(620) + (IPHONE_H - k(620) - block_h) // 2
    y = top
    for p in panes:
        canvas.paste(p, (0, y))
        y += p.height + PANE_GAP

    if shot.get("bullets"):
        draw_bullets(canvas, shot["bullets"], top + block_h, IPHONE_H - k(60),
                     size=k(56), gap=k(130))

    canvas.save(out_path)
    return canvas.size


def compose_ipad(shot, pane_dir, out_path):
    canvas = build_bg(IPAD_W, IPAD_H, glow_y=0.10)
    draw_caption(canvas, shot["eyebrow"], shot["l1"], shot["l2"],
                 eb_y=70, eb_size=44, eb_track=15,
                 head_y=132, head_size=150, head_pad=560, line_ratio=1.12)

    pane = fit_width(pane_dir / f"{shot['panes'][0]}.png", IPAD_W)
    # Bleed to the bottom edge; if the capture aspect drifts, crop rather than
    # letterbox, so no band of background ever shows beside the app.
    want = IPAD_H - IPAD_BAND
    if pane.height > want:
        pane = pane.crop((0, 0, IPAD_W, want))
    canvas.paste(pane, (0, IPAD_H - pane.height))
    canvas.save(out_path)
    return canvas.size


def main():
    pane_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    # Mirrors ONLY in screenshots.mjs: rebuild just these shots and leave every
    # other committed frame exactly as it is.
    only = [x.strip() for x in os.environ.get("ONLY", "").split(",") if x.strip()]
    made = []
    for shot in SHOTS:
        if only and not any(p.startswith(o) for o in only for p in shot["panes"]):
            continue
        dest = out_dir / "apple" / shot["out"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        size = (compose_iphone if shot["kind"] == "iphone" else compose_ipad)(shot, pane_dir, dest)
        made.append((dest.relative_to(out_dir), size))
        print(f"  ✓ apple/{shot['out']}  {size[0]} x {size[1]}")
    (out_dir / "apple" / "captions.json").write_text(json.dumps(
        [{f: sh[f] for f in ("out", "eyebrow", "l1", "l2")} for sh in SHOTS], indent=2) + "\n")
    return made


if __name__ == "__main__":
    main()
