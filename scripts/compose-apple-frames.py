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
# ---------------------------------------------------------------- layouts ---
# Two layouts, picked by canvas shape rather than by store.
#
#   side — caption in a column to the LEFT of the pane. For the very wide,
#          short phone canvases, where stacking caption over app would squeeze
#          both to nothing.
#   band — caption in a band ABOVE the pane. For the tablet canvases, which are
#          tall enough to carry one.
#
# Both galleries use both. Play frames used to ship as bare app captures, which
# left the two listings for one app looking like different products; they now
# carry the same captions as their Apple counterparts.
LAYOUTS = {
    "iphone":  dict(mode="side", w=2622, h=1206, col=1010),
    "pphone":  dict(mode="side", w=2640, h=1320, col=1020),
    "ipad":    dict(mode="band", w=2752, h=2064, band=480),
    "ptab7":   dict(mode="band", w=1920, h=1200, band=280),
    "ptab10":  dict(mode="band", w=2560, h=1600, band=370),
}

# Caption copy lives here once; a Play frame reuses the caption of the Apple
# frame showing the same thing, so the two listings say the same words.
CAP = {
    "decades":   ("DECADES TO WEEKS", "See your whole life,", "at a glance."),
    "chapters":  ("CHAPTERS", "The eras you lived,", "drawn to scale."),
    "future":    ("THE FUTURE HALF", "Half your timeline", "hasn't happened yet."),
    "onthisday": ("ON THIS DAY", "What today meant", "in every other year."),
    "add":       ("ADD A MILESTONE", "Some memories have a date.", "Others have a year."),
    "longview":  ("THE LONG VIEW", "Years at a time,", "all in one window."),
    "incontext": ("IN CONTEXT", "One moment,", "and everything around it."),
}
BULLETS = ["Works fully offline.", "No account, no analytics.",
           "Your life stays on your device."]


def shot(layout, out, pane, cap, bullets=None):
    eyebrow, l1, l2 = CAP[cap]
    return dict(layout=layout, out=out, pane=pane, bullets=bullets,
                eyebrow=eyebrow, l1=l1, l2=l2)


SHOTS = [
    # Apple iPhone. Shot 2 is drilled into one chapter, so the era IS the
    # frame: its name, dates, member count and its own milestones, with
    # nothing else on the axis competing.
    shot("iphone", "apple/iphone-dynamic-island/01-decades.png",       "iphone/01a", "decades"),
    shot("iphone", "apple/iphone-dynamic-island/02-chapters.png",      "iphone/02a", "chapters"),
    shot("iphone", "apple/iphone-dynamic-island/03-future.png",        "iphone/03a", "future"),
    shot("iphone", "apple/iphone-dynamic-island/04-on-this-day.png",   "iphone/04a", "onthisday"),
    # The privacy bullets sit under the caption in the left column, beside the
    # dialog rather than below it — there is no below on a 1206px canvas.
    shot("iphone", "apple/iphone-dynamic-island/05-add-milestone.png", "iphone/05a", "add", BULLETS),
    # Apple iPad.
    shot("ipad", "apple/ipad13/06-timeline.png",  "ipad/06a", "longview"),
    shot("ipad", "apple/ipad13/07-milestone.png", "ipad/07a", "incontext"),
    # Google Play, same captions as the Apple frame showing the same thing.
    shot("pphone", "play/phone/01-decades.png",       "play/phone/01a", "decades"),
    shot("pphone", "play/phone/02-chapters.png",      "play/phone/02a", "chapters"),
    shot("pphone", "play/phone/03-future.png",        "play/phone/03a", "future"),
    shot("pphone", "play/phone/04-on-this-day.png",   "play/phone/04a", "onthisday"),
    shot("pphone", "play/phone/05-add-milestone.png", "play/phone/05a", "add", BULLETS),
    shot("ptab7",  "play/tablet7/01-timeline.png",          "play/tablet7/01a", "longview"),
    shot("ptab7",  "play/tablet7/02-milestone-detail.png",  "play/tablet7/02a", "incontext"),
    shot("ptab10", "play/tablet10/01-timeline.png",         "play/tablet10/01a", "longview"),
    shot("ptab10", "play/tablet10/02-milestone-detail.png", "play/tablet10/02a", "incontext"),
]


def compose_side(sh, lay, pane):
    """Caption column left, one app pane filling everything right of it."""
    W, H, col = lay["w"], lay["h"], lay["col"]
    pane_w = W - col
    if pane.size != (pane_w, H):
        pane = pane.resize((pane_w, H), Image.LANCZOS)

    # Type scales with the column so the two phone canvases match optically.
    u = col / 1010
    cx = col // 2
    eb_size, head_size = round(38 * u), round(104 * u)
    lh = int(head_size * 1.14)
    cap_h = eb_size + round(60 * u) + 2 * lh

    if sh["bullets"]:
        bul_gap, bul_size = round(92 * u), round(46 * u)
        bul_h = bul_gap * (len(sh["bullets"]) - 1) + bul_size
        eb_y = (H - (cap_h + round(110 * u) + bul_h)) // 2
    else:
        eb_y = (H - cap_h) // 2

    canvas = build_bg(W, H, glow_y=(eb_y + cap_h * 0.5) / H, glow_x=cx / W)
    draw_caption(canvas, sh["eyebrow"], sh["l1"], sh["l2"],
                 eb_y=eb_y, eb_size=eb_size, eb_track=round(11 * u),
                 head_y=eb_y + round(80 * u), head_size=head_size,
                 head_pad=round(130 * u), cx=cx, column=col)
    if sh["bullets"]:
        top = eb_y + cap_h + round(110 * u)
        draw_bullets(canvas, sh["bullets"], top, top + bul_h,
                     size=bul_size, gap=bul_gap, cx=cx)
    canvas.paste(pane, (col, 0))
    return canvas


def compose_band(sh, lay, pane):
    """Caption band above, pane bleeding to the other three edges."""
    W, H, band = lay["w"], lay["h"], lay["band"]
    want = H - band
    if pane.width != W:
        pane = pane.resize((W, round(pane.height * W / pane.width)), Image.LANCZOS)
    if pane.height > want:          # crop rather than letterbox
        pane = pane.crop((0, 0, W, want))

    u = band / 480                  # geometry was tuned on the iPad band
    canvas = build_bg(W, H, glow_y=0.10)
    draw_caption(canvas, sh["eyebrow"], sh["l1"], sh["l2"],
                 eb_y=round(70 * u), eb_size=round(44 * u), eb_track=round(15 * u),
                 head_y=round(132 * u), head_size=round(150 * u),
                 head_pad=round(560 * u), line_ratio=1.12)
    canvas.paste(pane, (0, H - pane.height))
    return canvas


def main():
    pane_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    # Mirrors ONLY in screenshots.mjs: rebuild just these shots and leave every
    # other committed frame exactly as it is.
    only = [x.strip() for x in os.environ.get("ONLY", "").split(",") if x.strip()]
    made = []
    for sh in SHOTS:
        if only and not any(sh["pane"].startswith(o) for o in only):
            continue
        lay = LAYOUTS[sh["layout"]]
        pane = Image.open(pane_dir / f"{sh['pane']}.png").convert("RGB")
        canvas = (compose_side if lay["mode"] == "side" else compose_band)(sh, lay, pane)
        dest = out_dir / sh["out"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(dest)
        made.append((sh["out"], canvas.size))
        print(f"  ✓ {sh['out']}  {canvas.size[0]} x {canvas.size[1]}")

    # Captions live beside the frames so the listing copy and the images cannot
    # drift apart. Written whole even on a partial run.
    (out_dir / "captions.json").write_text(json.dumps(
        [{f: sh[f] for f in ("out", "eyebrow", "l1", "l2")} for sh in SHOTS], indent=2) + "\n")
    return made


if __name__ == "__main__":
    main()
