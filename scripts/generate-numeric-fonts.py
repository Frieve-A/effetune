"""Generate EffeTune's original numeric fonts from the geometry below.

Run: python scripts/generate-numeric-fonts.py
Reproducible tool versions: fonttools[woff]==4.57.0, brotli==1.0.9.
These are optional asset-authoring tools, not application dependencies.
No existing font outlines, images, or third-party glyph data are used.
The source and generated fonts use the project's MIT license.
"""

from io import BytesIO
from math import hypot
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


ROOT = Path(__file__).resolve().parent.parent
UNITS_PER_EM = 1000
ADVANCE = 600
ASCENT = 800
DESCENT = -200
CAP_HEIGHT = 700
TIMESTAMP = 3850070400  # 2026-01-01 in OpenType's epoch, for stable output.

# Segments are top, upper right, lower right, bottom, lower left,
# upper left, and middle. All segments stay within a common digit cell.
SEGMENT_DIGITS = (
    "abcdef", "bc", "abdeg", "abcdg", "bcfg",
    "acdfg", "acdefg", "abc", "abcdefg", "abcdfg",
)

# Hand-authored 5-by-7 light patterns, with a diagonal in zero to distinguish it.
DOT_DIGITS = (
    ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    ("00110", "01000", "10000", "11110", "10001", "10001", "01110"),
    ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    ("01110", "10001", "10001", "01111", "00001", "00010", "01100"),
)


def polygon(pen, points):
    """Write one clockwise, closed contour."""
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def seven_segment_glyph(digit):
    pen = TTGlyphPen(None)
    for segment in SEGMENT_DIGITS[digit]:
        if segment in "adg":
            y = {"a": 665, "d": 35, "g": 350}[segment]
            polygon(pen, [(100, y), (135, y + 35), (465, y + 35),
                          (500, y), (465, y - 35), (135, y - 35)])
        else:
            x = 520 if segment in "bc" else 80
            bottom = 370 if segment in "bf" else 70
            top = bottom + 260
            polygon(pen, [(x, bottom), (x - 35, bottom + 35),
                          (x - 35, top - 35), (x, top),
                          (x + 35, top - 35), (x + 35, bottom + 35)])
    return pen.glyph()


def dot_matrix_glyph(digit):
    pen = TTGlyphPen(None)
    # Eight short quadratic arcs make round dots with integer coordinates.
    arcs = (
        ((15, 36), (25, 25)), ((36, 15), (36, 0)),
        ((36, -15), (25, -25)), ((15, -36), (0, -36)),
        ((-15, -36), (-25, -25)), ((-36, -15), (-36, 0)),
        ((-36, 15), (-25, 25)), ((-15, 36), (0, 36)),
    )
    patterns = DOT_DIGITS[digit] if digit is not None else ("11111",) * 7
    for row, pattern in enumerate(patterns):
        for column, enabled in enumerate(pattern):
            if enabled == "0":
                continue
            x, y = 100 + column * 100, 650 - row * 100
            pen.moveTo((x, y + 36))
            for control, end in arcs:
                pen.qCurveTo((x + control[0], y + control[1]),
                             (x + end[0], y + end[1]))
            pen.closePath()
    return pen.glyph()


# Original centerlines for a thin wire display. True means a closed loop.
WIRE_DIGITS = (
    ((((180, 30), (420, 30), (500, 110), (500, 590), (420, 670), (180, 670), (100, 590), (100, 110)), True),),
    ((((190, 550), (300, 670), (300, 30)), False), (((190, 30), (410, 30)), False)),
    ((((100, 560), (100, 590), (180, 670), (420, 670), (500, 590), (500, 500), (100, 30), (500, 30)), False),),
    ((((100, 670), (420, 670), (500, 590), (500, 450), (420, 350), (260, 350)), False),
     (((260, 350), (420, 350), (500, 250), (500, 110), (420, 30), (100, 30)), False)),
    ((((420, 30), (420, 670), (100, 240), (500, 240)), False),),
    ((((500, 670), (100, 670), (100, 370), (420, 370), (500, 290), (500, 110), (420, 30), (100, 30)), False),),
    ((((500, 670), (260, 670), (100, 510), (100, 110), (180, 30), (420, 30), (500, 110), (500, 290), (420, 370), (100, 370)), False),),
    ((((100, 670), (500, 670), (220, 30)), False),),
    ((((180, 350), (420, 350), (500, 430), (500, 590), (420, 670), (180, 670), (100, 590), (100, 430)), True),
     (((180, 30), (420, 30), (500, 110), (500, 270), (420, 350), (180, 350), (100, 270), (100, 110)), True)),
    ((((100, 30), (340, 30), (500, 190), (500, 590), (420, 670), (180, 670), (100, 590), (100, 410), (180, 330), (500, 330)), False),),
)


def wire_glyph(digit):
    pen = TTGlyphPen(None)
    for points, closed in WIRE_DIGITS[digit]:
        normals = []
        for index in range(len(points) if closed else len(points) - 1):
            start, end = points[index], points[(index + 1) % len(points)]
            dx, dy = end[0] - start[0], end[1] - start[1]
            length = hypot(dx, dy)
            normals.append((-dy / length, dx / length))
        sides = []
        for direction in (-1, 1):
            side = []
            for index, (x, y) in enumerate(points):
                before = normals[index - 1 if closed or index else 0]
                after = normals[index % len(normals)] if closed else normals[min(index, len(normals) - 1)]
                divisor = 1 + before[0] * after[0] + before[1] * after[1]
                dx, dy = 16 * (before[0] + after[0]) / divisor, 16 * (before[1] + after[1]) / divisor
                # Limit acute joins so a wire end cannot exceed the cap height.
                limit = max(1, hypot(dx, dy) / 28)
                side.append((round(x + direction * dx / limit), round(y + direction * dy / limit)))
            sides.append(side)
        # The closed centerlines run counterclockwise; right is outside.
        if closed:
            polygon(pen, list(reversed(sides[0])))
            polygon(pen, sides[1])
        else:
            polygon(pen, sides[0] + list(reversed(sides[1])))
    return pen.glyph()


def build_font(family, glyph_factory, full_glyph=None):
    glyph_order = [".notdef"] + [f"digit{digit}" for digit in range(10)]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    glyphs.update({f"digit{digit}": glyph_factory(digit) for digit in range(10)})
    character_map = {ord(str(digit)): f"digit{digit}" for digit in range(10)}
    if full_glyph is not None:
        glyph_order.append("fullDisplay")
        glyphs["fullDisplay"] = full_glyph
        character_map[0xE000] = "fullDisplay"
    builder = FontBuilder(UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({
        name: (ADVANCE, getattr(glyph, "xMin", 0)) for name, glyph in glyphs.items()
    })
    builder.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT, lineGap=0)
    builder.setupNameTable({
        "copyright": "Copyright (c) 2025-2026, Yoshiyuki Kobayashi",
        "familyName": family,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"EffeTune: {family}: 1.000",
        "fullName": f"{family} Regular",
        "psName": family.replace(" ", "") + "-Regular",
        "version": "Version 1.000",
        "description": "Original geometric numeric font for EffeTune.",
        "licenseDescription": (ROOT / "LICENSE").read_text(encoding="utf-8"),
        "sampleText": "0123456789",
    })
    builder.setupOS2(
        version=4, sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
        usWinAscent=ASCENT, usWinDescent=-DESCENT, sCapHeight=CAP_HEIGHT,
        sxHeight=CAP_HEIGHT, fsSelection=0xC0, fsType=0,
    )
    builder.setupPost(isFixedPitch=1)
    font = builder.font
    font.recalcTimestamp = False
    font["head"].created = font["head"].modified = TIMESTAMP
    font.flavor = "woff2"
    output = BytesIO()
    font.save(output)
    return output.getvalue()


def main():
    directory = ROOT / "css" / "fonts"
    directory.mkdir(parents=True, exist_ok=True)
    for slug, family, glyph_factory, full_glyph in (
        ("seven-segment", "EffeTune Seven Segment", seven_segment_glyph, seven_segment_glyph(8)),
        ("dot-matrix", "EffeTune Dot Matrix", dot_matrix_glyph, dot_matrix_glyph(None)),
        ("wire-digits", "EffeTune Wire Digits", wire_glyph, None),
    ):
        path = directory / f"effetune-{slug}.woff2"
        data = build_font(family, glyph_factory, full_glyph)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)
        print(f"{path.relative_to(ROOT)}: {len(data)} bytes")


if __name__ == "__main__":
    main()
