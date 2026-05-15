#!/usr/bin/env python3
"""Generate the warren logo: a burrow-network mark + wordmark.

Concept: warren = a network of interconnected burrows. The mark is a
hexagonal cluster of nodes (ephemeral agent runs) connected by tunnel
edges, with a larger central control-plane node. One outer node and its
spoke render in amber (the ecosystem accent) to suggest an active run.

Outputs:
  branding/logo.png       horizontal mark + wordmark (~640x220)
  branding/logo@2x.png    same at 2x for retina
  branding/icon.png       square mark only (256x256), for avatars/favicons
"""

import math
from PIL import Image, ImageDraw, ImageFont

# --- Palette: match the warren UI (src/ui/src/index.css dark mode) ---
# Pure grayscale with a faint cool tint (hue 264). RGB approximations of the
# oklch values used by the UI theme.
BG = (24, 25, 28)              # --color-bg            oklch(14% 0.005 264)
FG = (242, 244, 248)           # --color-fg            oklch(96% 0.005 264)
PRIMARY = (208, 212, 220)      # --color-primary       oklch(85% 0.02 264)
MUTED_FG = (160, 162, 168)     # --color-muted-fg      oklch(67% 0.01 264)
BORDER = (62, 64, 70)          # --color-border        oklch(28% 0.01 264)

# Mark-specific roles (all grayscale):
EDGE = BORDER                  # outer-to-outer tunnel edges (dim)
NODE_INACTIVE = MUTED_FG       # idle outer nodes + their spokes
NODE_ACTIVE = FG               # active run: bright (no longer amber)
CENTER = PRIMARY               # control plane node
TEXT_PRIMARY = FG
TEXT_DIM = MUTED_FG

SCALE = 4  # render at 4x then downsample for crisp edges

# --- Horizontal layout (1x units) ---
IMG_W = 640
IMG_H = 220

MARK_CX = 110
MARK_CY = 110
HEX_RADIUS = 64                # center -> outer node distance
NODE_RADIUS = 8
CENTER_HALF = 14               # half-side of center rounded square
CENTER_RADIUS = 5              # corner radius of center square
LINE_WIDTH = 2

TEXT_X = 230
NAME = "warren"
TAGLINE = "self-hostable cloud control plane"
NAME_SIZE = 56
TAG_SIZE = 18
NAME_Y = 76
TAG_Y = 142

ACTIVE_OUTER = 1               # index of the amber node (0=top, going clockwise)


def load_font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def hex_positions(cx: float, cy: float, r: float):
    """6 nodes around (cx, cy), pointed-top hex."""
    angles_deg = [-90, -30, 30, 90, 150, 210]
    return [
        (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        for a in angles_deg
    ]


def draw_mark(draw: ImageDraw.ImageDraw, cx: float, cy: float, s: int):
    """Draw the burrow-network mark centered at (cx, cy). s = SCALE."""
    outer = hex_positions(cx, cy, HEX_RADIUS)
    lw = LINE_WIDTH * s

    # 1. tunnel ring: connect each outer node to its neighbors
    for i in range(6):
        x1, y1 = outer[i]
        x2, y2 = outer[(i + 1) % 6]
        draw.line(
            [x1 * s, y1 * s, x2 * s, y2 * s],
            fill=EDGE,
            width=lw,
        )

    # 2. spokes: center -> each outer node
    for i, (x, y) in enumerate(outer):
        color = NODE_ACTIVE if i == ACTIVE_OUTER else NODE_INACTIVE
        draw.line(
            [cx * s, cy * s, x * s, y * s],
            fill=color,
            width=lw,
        )

    # 3. outer nodes
    nr = NODE_RADIUS * s
    for i, (x, y) in enumerate(outer):
        color = NODE_ACTIVE if i == ACTIVE_OUTER else NODE_INACTIVE
        draw.ellipse(
            [x * s - nr, y * s - nr, x * s + nr, y * s + nr],
            fill=color,
        )

    # 4. center node (control plane) — solid rounded square in primary gray
    ch = CENTER_HALF * s
    cr = CENTER_RADIUS * s
    draw.rounded_rectangle(
        [cx * s - ch, cy * s - ch, cx * s + ch, cy * s + ch],
        radius=cr,
        fill=CENTER,
    )


def render_horizontal(out_path: str, w: int, h: int, s: int):
    sw, sh = w * s, h * s
    img = Image.new("RGB", (sw, sh), BG)
    draw = ImageDraw.Draw(img)

    draw_mark(draw, MARK_CX, MARK_CY, s)

    name_font = load_font("/System/Library/Fonts/HelveticaNeue.ttc", NAME_SIZE * s)
    tag_font = load_font("/System/Library/Fonts/SFNSMono.ttf", TAG_SIZE * s)

    draw.text((TEXT_X * s, NAME_Y * s), NAME, fill=TEXT_PRIMARY, font=name_font)
    draw.text((TEXT_X * s, TAG_Y * s), TAGLINE, fill=TEXT_DIM, font=tag_font)

    img = img.resize((w, h), Image.LANCZOS)
    img.save(out_path)
    print(f"Saved {out_path} ({w}x{h})")


def render_horizontal_2x(out_path: str, w: int, h: int, s: int):
    """Render at SCALE without downsampling — gives a 2x asset."""
    sw, sh = w * s, h * s
    img = Image.new("RGB", (sw, sh), BG)
    draw = ImageDraw.Draw(img)

    draw_mark(draw, MARK_CX, MARK_CY, s)

    name_font = load_font("/System/Library/Fonts/HelveticaNeue.ttc", NAME_SIZE * s)
    tag_font = load_font("/System/Library/Fonts/SFNSMono.ttf", TAG_SIZE * s)

    draw.text((TEXT_X * s, NAME_Y * s), NAME, fill=TEXT_PRIMARY, font=name_font)
    draw.text((TEXT_X * s, TAG_Y * s), TAGLINE, fill=TEXT_DIM, font=tag_font)

    # downsample from 4x to 2x for retina sharpness
    img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img.save(out_path)
    print(f"Saved {out_path} ({w * 2}x{h * 2})")


def render_icon(out_path: str, size: int, s: int):
    """Square icon — just the mark, centered."""
    sw = size * s
    img = Image.new("RGB", (sw, sw), BG)
    draw = ImageDraw.Draw(img)
    # center the mark inside the square
    draw_mark(draw, size / 2, size / 2, s)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out_path)
    print(f"Saved {out_path} ({size}x{size})")


if __name__ == "__main__":
    import os

    out_dir = os.path.dirname(os.path.abspath(__file__))

    render_horizontal(os.path.join(out_dir, "logo.png"), IMG_W, IMG_H, SCALE)
    render_horizontal_2x(os.path.join(out_dir, "logo@2x.png"), IMG_W, IMG_H, SCALE)
    render_icon(os.path.join(out_dir, "icon.png"), 256, SCALE)
