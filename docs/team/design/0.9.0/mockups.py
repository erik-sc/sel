"""Generates the 0.9.0 design mockups (A1b, B1, B3) as SVG, light above dark.

Run: python3 -I docs/team/design/0.9.0/mockups.py docs/team/design/0.9.0
Values are copied from src/renderer/src/styles/tokens.css, ui/ui.css, editor/editor.css and
database/database.css on release/0.9.0. One file per state.
"""
import os
import sys
from html import escape

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

MONO = "IBM Plex Mono, SF Mono, Cascadia Code, Consolas, ui-monospace, monospace"
SERIF = "Newsreader, Iowan Old Style, Palatino Linotype, Georgia, serif"


def rgba(r, g, b, a):
    return ("#%02x%02x%02x" % (r, g, b), a)


LIGHT = {
    "name": "light",
    "bg": ("#faf8f4", 1), "pop": ("#fdfcfa", 1), "text": ("#24221d", 1),
    "text2": ("#615d54", 1), "text3": ("#6d685d", 1),
    "border": rgba(70, 58, 36, 0.11), "border_strong": rgba(70, 58, 36, 0.24),
    "accent": ("#3b4f7d", 1), "hover": rgba(84, 72, 48, 0.07),
    "menu_active": rgba(84, 72, 48, 0.12), "text_menu_active": ("#24221d", 1),
    "fill1": rgba(84, 72, 48, 0.16), "fill3": rgba(84, 72, 48, 0.09), "fill4": rgba(84, 72, 48, 0.05),
    "frame": ("#24221d", 1), "shadow": ("#24221d", 1), "focus": rgba(59, 79, 125, 0.7),
    "danger": ("#b0432f", 1), "selection": rgba(59, 79, 125, 0.2), "sunk": ("#ebe7de", 1),
    "c": {
        "gray": (("#63605a", 1), rgba(110, 104, 92, 0.14)),
        "brown": (("#7a5632", 1), rgba(128, 98, 70, 0.19)),
        "orange": (("#9b4f14", 1), rgba(206, 132, 50, 0.2)),
        "yellow": (("#75600c", 1), rgba(196, 163, 58, 0.22)),
        "green": (("#456a38", 1), rgba(98, 140, 80, 0.2)),
        "blue": (("#3f5f8a", 1), rgba(70, 112, 170, 0.18)),
        "purple": (("#6f528c", 1), rgba(128, 94, 168, 0.18)),
        "pink": (("#9a4268", 1), rgba(196, 100, 144, 0.18)),
        "red": (("#a3363a", 1), rgba(196, 72, 72, 0.17)),
    },
}

DARK = {
    "name": "dark",
    "bg": ("#1d1c1a", 1), "pop": ("#2b2927", 1), "text": ("#e8e3d9", 1),
    "text2": ("#a8a297", 1), "text3": ("#959188", 1),
    "border": rgba(232, 222, 200, 0.09), "border_strong": rgba(232, 222, 200, 0.2),
    "accent": ("#a3b1d9", 1), "hover": rgba(232, 222, 200, 0.06),
    "menu_active": rgba(232, 222, 200, 0.11), "text_menu_active": ("#e8e3d9", 1),
    "fill1": rgba(232, 222, 200, 0.18), "fill3": rgba(232, 222, 200, 0.1), "fill4": rgba(232, 222, 200, 0.05),
    "frame": ("#e8e3d9", 1), "shadow": ("#000000", 1), "focus": rgba(163, 177, 217, 0.7),
    "danger": ("#dc7a68", 1), "selection": rgba(163, 177, 217, 0.28), "sunk": ("#141311", 1),
    "c": {
        "gray": (("#b0aba0", 1), rgba(170, 164, 150, 0.16)),
        "brown": (("#c9a37e", 1), rgba(160, 130, 104, 0.24)),
        "orange": (("#d39a5e", 1), rgba(214, 142, 60, 0.2)),
        "yellow": (("#d1b660", 1), rgba(204, 174, 76, 0.18)),
        "green": (("#9bbb8a", 1), rgba(120, 160, 100, 0.2)),
        "blue": (("#93acce", 1), rgba(96, 138, 190, 0.22)),
        "purple": (("#b3a0cc", 1), rgba(146, 116, 184, 0.22)),
        "pink": (("#cf9aae", 1), rgba(200, 112, 148, 0.2)),
        "red": (("#e2827e", 1), rgba(210, 90, 90, 0.2)),
    },
}


def fill(c):
    col, a = c
    return f'fill="{col}"' + (f' fill-opacity="{a}"' if a != 1 else "")


def stroke(c, w):
    col, a = c
    return f'stroke="{col}" stroke-width="{w}"' + (f' stroke-opacity="{a}"' if a != 1 else "")


def rect(x, y, w, h, c, extra=""):
    return f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" {fill(c)} {extra}/>'


def line(x1, y1, x2, y2, c, w, extra=""):
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" {stroke(c, w)} {extra}/>'


def text(x, y, s, c, size, family=MONO, weight=400, extra=""):
    return (f'<text x="{x:.2f}" y="{y:.2f}" font-family="{family}" font-size="{size}" '
            f'font-weight="{weight}" {fill(c)} {extra}>{escape(s)}</text>')


def pointer(x, y, t):
    # a plain arrow cursor, drawn in the theme's ink with a paper outline
    p = f"M{x},{y} l0,16 l4,-4 l3,7 l2.5,-1 l-3,-7 l5.5,0 z"
    return f'<path d="{p}" {fill(t["text"])} {stroke(t["bg"], 1)}/>'


def grip(cx, cy, c):
    """The ⋮⋮ handle: two columns of three dots."""
    out = []
    for dx in (-3, 3):
        for dy in (-5, 0, 5):
            out.append(f'<circle cx="{cx + dx}" cy="{cy + dy}" r="1.3" {fill(c)}/>')
    return "".join(out)


def plus(cx, cy, c, s=6):
    return line(cx - s, cy, cx + s, cy, c, 1.5) + line(cx, cy - s, cx, cy + s, c, 1.5)


def frame_doc(scenes, w, h, title):
    """Light scene on top, dark under it; each with a small label."""
    label_h = 22
    total = (h + label_h) * len(scenes)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{total}" '
           f'viewBox="0 0 {w} {total}" role="img" aria-label="{escape(title)}">',
           f'<title>{escape(title)}</title>']
    y = 0
    for t, body in scenes:
        out.append(rect(0, y, w, label_h + h, t["bg"]))
        out.append(text(12, y + 15, f"{title} · {t['name']}", t["text3"], 11))
        out.append(line(0, y + label_h - 0.5, w, y + label_h - 0.5, t["border"], 1))
        out.append(f'<g transform="translate(0,{y + label_h})">{body}</g>')
        y += label_h + h
    out.append("</svg>")
    return "\n".join(out)


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(content + "\n")


# --------------------------------------------------------------------------------------------
# A1b — columns on a page
# --------------------------------------------------------------------------------------------

GAP = 52          # .blk-beside column-gap
RULE_OFF = 25     # hairline / side drop line centre: 25px right of a column's edge (slot between + and ⋮⋮)
LH = 29           # 17px * 1.7


def para(x, y, lines, t, size=17, c=None):
    c = c or t["text"]
    return "".join(text(x, y + 20 + i * LH, s, c, size, SERIF) for i, s in enumerate(lines))


def heading(x, y, s, t):
    return text(x, y + 22, s, t["text"], 20, SERIF, 500)


def bullets(x, y, items, t, c=None):
    c = c or t["text"]
    out = []
    for i, s in enumerate(items):
        by = y + i * (LH + 0)
        out.append(f'<circle cx="{x + 9}" cy="{by + 15}" r="2.4" {fill(c)}/>')
        out.append(text(x + 24, by + 20, s, c, 17, SERIF))
    return "".join(out)


def column_errands(x, y, t):
    return heading(x, y, "Errands", t) + bullets(x, y + 34, ["Post office", "Pharmacy", "Bakery"], t)


def column_plumber(x, y, t):
    return para(x, y, ["Call the plumber before", "Friday, and ask about", "the boiler too."], t)


def gutter(colx, rowy, t, hovered_handle=False):
    """+ and ⋮⋮ in the 52px left of a block, top 3px, each a 24px circle, 2px apart."""
    cy = rowy + 3 + 12
    out = []
    if hovered_handle:
        out.append(f'<circle cx="{colx - 14}" cy="{cy}" r="12" {fill(t["hover"])}/>')
    out.append(plus(colx - 40, cy, t["text3"]))
    out.append(grip(colx - 14, cy, t["text2"] if hovered_handle else t["text3"]))
    return out


def a1b_two(t, state):
    x0, w = 80, 560
    cw = (w - GAP) / 2
    c1, c2 = x0, x0 + cw + GAP
    top, bottom = 80, 200
    out = [para(x0, 30, ["Two things to sort out before the weekend."], t)]
    out.append(column_errands(c1, top, t))
    out.append(column_plumber(c2, top, t))
    out.append(para(x0, 216, ["Everything else can wait."], t))
    rule_x = c1 + cw + RULE_OFF
    if state in ("hover", "focus"):
        out.append(line(rule_x, top, rule_x, bottom, t["border"], 0.5))
    if state == "hover":
        out += gutter(c2, top, t)
        out.append(pointer(c2 + 120, top + 14, t))
    if state == "focus":
        cx = c2 + 7.6 * len("the boiler too.") + 2
        out.append(line(cx, top + 2 * LH + 4, cx, top + 2 * LH + 25, t["text"], 1.5))
    return "".join(out)


def a1b_beside(t):
    """Dragging a paragraph to the right of a lone heading: vertical line 25px right of it."""
    x0, w = 80, 560
    top, bottom = 80, 200
    out = [para(x0, 30, ["Two things to sort out before the weekend."], t)]
    out.append(column_errands(x0, top, t))
    out.append(para(x0, 216, ["Call the plumber."], t))
    lx = x0 + w + RULE_OFF
    out.append(rect(lx - 1.5, top, 3, bottom - top, t["accent"]))
    # drag image: the block itself, translucent, its top-left at the pointer
    px, py = 580, 172
    out.append(f'<g opacity="0.5">{para(px + 14, py + 4, ["Call the plumber."], t)}</g>')
    out.append(pointer(px, py, t))
    return "".join(out)


def a1b_three_between(t):
    """A row of 3 at --database-width; dragging into the gap between column 1 and 2."""
    x0, w = 80, 880
    n = 3
    cw = (w - GAP * (n - 1)) / n
    xs = [x0 + i * (cw + GAP) for i in range(n)]
    top, bottom = 80, 200
    out = [para(x0, 30, ["Two things to sort out before the weekend."], t)]
    out.append(column_errands(xs[0], top, t))
    out.append(column_plumber(xs[1], top, t))
    out.append(heading(xs[2], top, "Ideas", t) + bullets(xs[2], top + 34, ["Paint the hall"], t))
    # gap 1: the drop line replaces the hairline; gap 2: the hairline shows while a drag is over the row
    g1 = xs[0] + cw + RULE_OFF
    g2 = xs[1] + cw + RULE_OFF
    out.append(line(g2, top, g2, bottom, t["border"], 0.5))
    out.append(rect(g1 - 1.5, top, 3, bottom - top, t["accent"]))
    px, py = xs[1] + 30, 178
    out.append(f'<g opacity="0.5">{text(px + 14, py + 30, "Lemons", t["text"], 17, SERIF)}</g>')
    out.append(pointer(px, py, t))
    out.append(para(x0, 216, ["Everything else can wait."], t))
    return "".join(out)


def a1b_full(t):
    """A full row (4): the side zones do not exist; the pointer falls back to before/after."""
    x0, w = 80, 880
    n = 4
    cw = (w - GAP * (n - 1)) / n
    xs = [x0 + i * (cw + GAP) for i in range(n)]
    top = 80
    heads = [("Read", "Two chapters"), ("Write", "The letter"), ("Walk", "By the river"), ("Rest", "Early night")]
    out = [para(x0, 30, ["The week, loosely."], t)]
    for (h, b), x in zip(heads, xs):
        out.append(heading(x, top, h, t) + bullets(x, top + 34, [b], t))
    bottom = top + 34 + LH + 6
    for i in range(n - 1):
        gx = xs[i] + cw + RULE_OFF
        out.append(line(gx, top, gx, bottom, t["border"], 0.5))
    # 'after' line under column 4 only (drop-after on that column's .blk: bottom -3px, its width)
    out.append(rect(xs[3], bottom, cw, 3, t["accent"]))
    px, py = xs[3] + cw - 40, top + 46
    out.append(f'<g opacity="0.5">{text(px + 14, py + 34, "Lemons", t["text"], 17, SERIF)}</g>')
    out.append(pointer(px, py, t))
    out.append(para(x0, bottom + 24, ["Everything else can wait."], t))
    return "".join(out)


def a1b_zones():
    """Where the pointer has to be: one block, its zones (diagram, light only)."""
    t = LIGHT
    x, y, w, h = 120, 40, 480, 120
    q = min(w / 4, 96)
    out = [rect(0, 0, 720, 230, t["bg"])]
    out.append(rect(x, y, w, h, t["fill4"], f'{stroke(t["border_strong"], 1)}'))
    out.append(rect(x, y, q, h, t["c"]["blue"][1]))
    out.append(rect(x + w - q, y, q, h, t["c"]["blue"][1]))
    out.append(line(x + q, y + h / 2, x + w - q, y + h / 2, t["border_strong"], 1, 'stroke-dasharray="3 3"'))
    out.append(text(x + q / 2, y + h / 2 + 4, "left", t["c"]["blue"][0], 12, extra='text-anchor="middle"'))
    out.append(text(x + w - q / 2, y + h / 2 + 4, "right", t["c"]["blue"][0], 12, extra='text-anchor="middle"'))
    out.append(text(x + w / 2, y + h / 4 + 4, "before", t["text2"], 12, extra='text-anchor="middle"'))
    out.append(text(x + w / 2, y + 3 * h / 4 + 4, "after / inside", t["text2"], 12, extra='text-anchor="middle"'))
    out.append(text(x, y - 10, "outer quarter, at most 96 px", t["text3"], 11))
    out.append(text(x + w, y - 10, "outer quarter, at most 96 px", t["text3"], 11, extra='text-anchor="end"'))
    # where the lines land
    out.append(rect(x - RULE_OFF - 1.5, y, 3, h, t["accent"]))
    out.append(rect(x + w + RULE_OFF - 1.5, y, 3, h, t["accent"]))
    out.append(text(x - RULE_OFF, y + h + 22, "line 25 px outside the edge, as tall as the block with its children",
                    t["text3"], 11))
    out.append(text(x - RULE_OFF, y + h + 40, "row full (4) or block cannot share a row: no side zones, before/after only",
                    t["text3"], 11))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="230" viewBox="0 0 720 230" role="img" '
            f'aria-label="A1b drop zones"><title>A1b drop zones</title>{"".join(out)}</svg>')


def a1b():
    two_w, two_h = 720, 260
    for state, title in [("rest", "A1b · row of 2 at rest"), ("hover", "A1b · row hovered"),
                         ("focus", "A1b · caret in a column")]:
        write(f"a1b-{state}.svg", frame_doc([(T, a1b_two(T, state)) for T in (LIGHT, DARK)], two_w, two_h, title))
    write("a1b-drag-beside.svg", frame_doc([(T, a1b_beside(T)) for T in (LIGHT, DARK)], two_w, two_h,
                                           "A1b · drag to the right of a lone block"))
    write("a1b-drag-between.svg", frame_doc([(T, a1b_three_between(T)) for T in (LIGHT, DARK)], 1040, two_h,
                                            "A1b · drag between two columns of a row of 3"))
    write("a1b-row-full.svg", frame_doc([(T, a1b_full(T)) for T in (LIGHT, DARK)], 1040, 220,
                                        "A1b · row full: falls back to after"))
    write("a1b-zones.svg", a1b_zones())


# --------------------------------------------------------------------------------------------
# Shared menu pieces
# --------------------------------------------------------------------------------------------

POP_W = 240        # proposed: .db-prop-menu (add and edit) fixed at 240px, as .db-prop-menu-name:only-child
ITEM_H = 28        # .ui-menu-item min-height: calc(--control-height - 2px)
ROW_H = 32         # --row-height


def icon(kind, cx, cy, c):
    s = stroke(c, 1.3) + ' fill="none" stroke-linecap="round" stroke-linejoin="round"'
    if kind == "text":
        return "".join(f'<line x1="{cx - 5}" y1="{cy + d}" x2="{cx + (5 if d < 4 else 1)}" y2="{cy + d}" {s}/>'
                       for d in (-4, 0, 4))
    if kind == "number":
        return text(cx, cy + 4.5, "#", c, 13, extra='text-anchor="middle"')
    if kind == "select":
        return f'<circle cx="{cx}" cy="{cy}" r="5.5" {s}/><path d="M{cx - 2.5},{cy - 1} l2.5,2.5 l2.5,-2.5" {s}/>'
    if kind == "multi":
        return "".join(f'<circle cx="{cx - 4}" cy="{cy + d}" r="0.9" {fill(c)}/>'
                       f'<line x1="{cx - 1}" y1="{cy + d}" x2="{cx + 5}" y2="{cy + d}" {s}/>' for d in (-4, 0, 4))
    if kind == "date":
        return (f'<rect x="{cx - 5.5}" y="{cy - 4.5}" width="11" height="10" {s}/>'
                f'<line x1="{cx - 5.5}" y1="{cy - 1.5}" x2="{cx + 5.5}" y2="{cy - 1.5}" {s}/>')
    if kind == "checkbox":
        return (f'<rect x="{cx - 5}" y="{cy - 5}" width="10" height="10" {s}/>'
                f'<path d="M{cx - 2.5},{cy} l2,2 l3.5,-4" {s}/>')
    if kind == "url":
        return (f'<path d="M{cx - 1},{cy + 1} l3,-3" {s}/><path d="M{cx - 4},{cy} l-1,1 a2.5,2.5 0 0 0 3.5,3.5 l1,-1" {s}/>'
                f'<path d="M{cx + 4},{cy} l1,-1 a2.5,2.5 0 0 0 -3.5,-3.5 l-1,1" {s}/>')
    if kind == "clock":
        return f'<circle cx="{cx}" cy="{cy}" r="5.5" {s}/><path d="M{cx},{cy - 3} l0,3 l2,1.5" {s}/>'
    if kind == "relation":
        return f'<path d="M{cx - 4},{cy + 4} l8,-8 M{cx - 2},{cy - 4} l6,0 l0,6" {s}/>'
    if kind == "rollup":
        return f'<path d="M{cx + 4},{cy - 5} l-8,0 l4,5 l-4,5 l8,0" {s}/>'
    if kind == "formula":
        return text(cx, cy + 4, "fx", c, 11, extra='text-anchor="middle" font-style="italic"')
    if kind == "sort":
        return (f'<path d="M{cx - 3},{cy + 5} l0,-10 l-2.5,2.5 M{cx - 3},{cy - 5} l2.5,2.5" {s}/>'
                f'<path d="M{cx + 3},{cy - 5} l0,10 l-2.5,-2.5 M{cx + 3},{cy + 5} l2.5,-2.5" {s}/>')
    if kind == "filter":
        return f'<path d="M{cx - 5},{cy - 4} l10,0 M{cx - 3},{cy} l6,0 M{cx - 1},{cy + 4} l2,0" {s}/>'
    if kind == "trash":
        return (f'<path d="M{cx - 5},{cy - 3} l10,0 M{cx - 2},{cy - 3} l0,-2 l4,0 l0,2 '
                f'M{cx - 4},{cy - 3} l1,8.5 l6,0 l1,-8.5" {s}/>')
    if kind == "back":
        return f'<path d="M{cx + 1.5},{cy - 3.5} l-3.5,3.5 l3.5,3.5" {s}/>'
    if kind == "check":
        return f'<path d="M{cx - 4},{cy} l3,3 l5,-6" {s}/>'
    return ""


def popover(x, y, w, h, t, body):
    sh = t["shadow"]
    return (rect(x + 3, y + 3, w, h, sh)
            + rect(x, y, w, h, t["pop"], f'{stroke(t["frame"], 1)}')
            + f'<g transform="translate({x},{y})">{body}</g>')


def ui_input(x, y, w, t, value="", placeholder="", focused=False, selected=False, caret=False):
    out = [rect(x, y, w, 30, t["fill3"])]
    if focused:
        out.append(rect(x - 1.5, y - 1.5, w + 3, 33, ("#000000", 0), f'fill="none" {stroke(t["focus"], 3)}'))
    if value:
        if selected:
            out.append(rect(x + 10, y + 7, 7.8 * len(value), 16, t["selection"]))
        out.append(text(x + 10, y + 19.5, value, t["text"], 13))
        if caret:
            cx = x + 10 + 7.8 * len(value) + 1
            out.append(line(cx, y + 7, cx, y + 23, t["text"], 1.2))
    else:
        if caret:
            out.append(line(x + 10, y + 7, x + 10, y + 23, t["text"], 1.2))
        out.append(text(x + 10 + (2 if caret else 0), y + 19.5, placeholder, t["text2"], 13))
    return "".join(out)


def menu_header(y, s, t, x=15):
    """.ui-menu-header: padding 6px 10px 3px, --text-xs, medium, 0.08em, uppercase. Returns (svg, height)."""
    return text(x, y + 6 + 10, s.upper(), t["text3"], 11, weight=500, extra='letter-spacing="0.88"'), 23


def menu_item(y, label, t, ic=None, active=False, danger=False, chevron=False, hint=None, w=POP_W):
    out = []
    c = t["danger"] if danger else t["text"]
    if active:
        out.append(rect(5, y, w - 10, ITEM_H, t["menu_active"]))
        out.append(text(7, y + 18.5, ">", t["accent"] if not danger else t["danger"], 13))
    lx = 15
    if ic:
        out.append(icon(ic, 15 + 9, y + 14, t["danger"] if danger else t["text2"]))
        lx = 15 + 18 + 8
    out.append(text(lx, y + 18.5, label, c, 13))
    if chevron:
        out.append(f'<path d="M{w - 19},{y + 10.5} l3.5,3.5 l-3.5,3.5" {stroke(t["text2"], 1.3)} fill="none"/>')
    if hint:
        out.append(text(w - 15, y + 18, hint, t["text2"], 12, extra='text-anchor="end"'))
    return "".join(out)


def separator(y, t, w=POP_W):
    """.ui-menu-separator: margin 5px 10px, hairline dashed --border-strong. Height 10 + hairline."""
    return line(15, y + 5, w - 15, y + 5, t["border_strong"], 0.5, 'stroke-dasharray="3 2"'), 10


def table_strip(x, y, w, t, cols, plus_active=False, active_th=None):
    """A slice of a table: header row (--table-row-height 36) and two body rows."""
    out = [rect(x, y, w, 36 * 3, t["fill4"])]
    out.append(rect(x, y, w, 36, t["fill4"]))
    for i in range(1, 4):
        out.append(line(x, y + 36 * i, x + w, y + 36 * i, t["border"], 0.5))
    cx = x
    for name, ic, cw, vals in cols:
        if active_th == name:
            out.append(rect(cx, y, cw, 36, t["hover"]))
        out.append(icon(ic, cx + 17, y + 18, t["text2"]))
        out.append(text(cx + 30, y + 22, name, t["text2"], 12, weight=500))
        for r, v in enumerate(vals):
            if isinstance(v, tuple):
                tx, col = v
                tw = 18 + 7.2 * len(tx)
                out.append(rect(cx + 10, y + 36 * (r + 1) + 7, tw, 22, t["c"][col][1]))
                out.append(text(cx + 19, y + 36 * (r + 1) + 22, tx, t["c"][col][0], 12, weight=500))
            else:
                out.append(text(cx + 10, y + 36 * (r + 1) + 23, v, t["text"], 13))
        cx += cw
    if plus_active:
        out.append(rect(cx, y, 36, 36, t["hover"]))
    out.append(plus(cx + 18, y + 18, t["text2"], 5))
    return "".join(out), cx


# --------------------------------------------------------------------------------------------
# B1 — add a property with its name
# --------------------------------------------------------------------------------------------

TYPES_EN = [("Text", "text"), ("Number", "number"), ("Select", "select"), ("Multi-select", "multi"),
            ("Date", "date"), ("Checkbox", "checkbox"), ("URL", "url"), ("Created time", "clock"),
            ("Last edited time", "clock"), ("Relation", "relation"), ("Rollup", "rollup"), ("Formula", "formula")]
TYPES_PT = [("Texto", "text"), ("Número", "number"), ("Seleção única", "select"), ("Seleção múltipla", "multi"),
            ("Data", "date"), ("Caixa de seleção", "checkbox"), ("URL", "url"), ("Criado em", "clock"),
            ("Última edição", "clock"), ("Relação", "relation"), ("Agregação", "rollup"), ("Fórmula", "formula")]

TABLE_COLS = [("Name", "text", 190, ["Groceries", "Rent"]),
              ("Status", "select", 150, [("To do", "gray"), ("Done", "green")])]


def b1_menu(t, value, placeholder, hint, header, types, focused, active=None):
    out = []
    out.append(ui_input(8, 8, POP_W - 16, t, value, placeholder, focused=focused, caret=focused))
    y = 8 + 30
    if hint:
        out.append(text(18, y + 2 + 11, hint, t["text3"], 11))
        y += 2 + 14
    y += 4  # .db-prop-menu-name padding-bottom
    y += 5  # .ui-menu padding
    hsvg, hh = menu_header(y, header, t)
    out.append(hsvg)
    y += hh
    for i, (label, ic) in enumerate(types):
        out.append(menu_item(y, label, t, ic, active=(i == active)))
        y += ITEM_H
    y += 5
    return "".join(out), y


def b1_scene(t, state):
    lang_pt = state == "pt"
    out = []
    strip, plus_x = table_strip(24, 20, 340 + 36 + 120, t, TABLE_COLS, plus_active=True)
    out.append(strip)
    if state == "empty":
        body, h = b1_menu(t, "", "Property name", None, "Type", TYPES_EN, True)
    elif state == "typed":
        body, h = b1_menu(t, "Budget", "", "Enter adds a text property", "Type", TYPES_EN, True)
    elif state == "active":
        body, h = b1_menu(t, "Budget", "", "Enter adds a text property", "Type", TYPES_EN, False, active=1)
    else:
        body, h = b1_menu(t, "Orçamento", "", "Enter cria como texto", "Tipo", TYPES_PT, True)
    px = plus_x + 36 - POP_W
    out.append(popover(px, 20 + 36 + 4, POP_W, h, t, body))
    if state == "active":
        out.append(pointer(px + 150, 20 + 36 + 4 + 8 + 30 + 16 + 9 + 23 + ITEM_H + 12, t))
    return "".join(out)


def b1_added(t):
    cols = TABLE_COLS + [("Budget", "text", 150, ["", ""])]
    out = []
    strip, plus_x = table_strip(24, 20, 340 + 150 + 36, t, cols)
    out.append(strip)
    # the new column's first cell is the grid's active cell: .db-td.is-focused, inset 2px --focus-ring
    out.append(rect(24 + 340 + 1, 20 + 36 + 1, 148, 34, ("#000000", 0),
                    f'fill="none" {stroke(t["focus"], 2)}'))
    out.append(text(24, 20 + 36 * 3 + 24, "Announced: “Added Budget” / “Propriedade Budget adicionada”",
                    t["text3"], 11))
    return "".join(out)


def b1():
    h = 530
    for state, title in [("empty", "B1 · just opened"), ("typed", "B1 · name typed"),
                         ("active", "B1 · a type active (arrows or pointer)"), ("pt", "B1 · pt-BR")]:
        write(f"b1-{state}.svg", frame_doc([(T, b1_scene(T, state)) for T in (LIGHT, DARK)], 560, h, title))
    write("b1-added.svg", frame_doc([(T, b1_added(T)) for T in (LIGHT, DARK)], 560, 160,
                                    "B1 · after Enter: new column, first cell active"))


# --------------------------------------------------------------------------------------------
# B3 — options in the column menu
# --------------------------------------------------------------------------------------------

EN = {"options": "Options", "add": "Add an option", "type": "Type: Select", "asc": "Sort ascending",
      "desc": "Sort descending", "filter": "Filter", "hide": "Hide in view", "delete": "Delete property"}
PT = {"options": "Opções", "add": "Adicionar uma opção", "type": "Tipo: Seleção única", "asc": "Ordenar crescente",
      "desc": "Ordenar decrescente", "filter": "Filtrar", "hide": "Ocultar na visualização",
      "delete": "Excluir propriedade"}

OPTS = [("High", "red"), ("Medium", "yellow"), ("Low", "gray")]
LONG = [("Inbox", "gray"), ("Waiting on someone else's answer", "orange"), ("Next", "blue"),
        ("This week", "green"), ("Someday", "purple"), ("Blocked", "red"), ("Delegated", "brown"),
        ("Reference", "pink"), ("Done", "green")]


def tag(x, y, name, color, t, maxw=None):
    fg, bg = t["c"][color]
    tw = 18 + 7.2 * len(name)
    label = name
    if maxw and tw > maxw:
        n = int((maxw - 18 - 7.2) / 7.2)
        label = name[:n] + "…"
        tw = 18 + 7.2 * len(label)
    return rect(x, y, tw, 22, bg) + text(x + 9, y + 15, label, fg, 12, weight=500)


def option_row(y, name, color, t, state=None):
    """32px row (--row-height); '>' marker slot at left like a menu item; ⋮⋮ at the right on hover/focus."""
    out = []
    if state == "hover":
        out.append(rect(5, y, POP_W - 10, ROW_H, t["hover"]))
    if state in ("focus", "drag-src"):
        out.append(rect(5, y, POP_W - 10, ROW_H, t["menu_active"]))
        out.append(text(7, y + 20.5, ">", t["accent"], 13))
    out.append(tag(15, y + 5, name, color, t, maxw=POP_W - 15 - 36))
    if state in ("hover", "focus", "drag-src"):
        out.append(grip(POP_W - 5 - 10 - 8, y + 16, t["text3"]))
    return "".join(out)


def b3_menu(t, copy, opts, row_states=None, name_focused=True, long=False, drop_after=None, ghost=None):
    row_states = row_states or {}
    out = [ui_input(8, 8, POP_W - 16, t, "Priority" if not long else "Stage", focused=name_focused,
                    selected=name_focused)]
    y = 8 + 30 + 4
    hsvg, hh = menu_header(y, copy["options"], t)
    out.append(hsvg)
    y += hh
    visible = opts
    list_top = y
    if long:
        rows_shown = 6.5
        list_h = ROW_H * rows_shown
        clip = f'<clipPath id="lc{t["name"]}"><rect x="0" y="{list_top}" width="{POP_W}" height="{list_h}"/></clipPath>'
        rows = "".join(option_row(list_top + i * ROW_H, n, c, t, row_states.get(i)) for i, (n, c) in enumerate(visible))
        out.append(f'<defs>{clip}</defs><g clip-path="url(#lc{t["name"]})">{rows}</g>')
        # thin overlay-like scrollbar thumb
        out.append(rect(POP_W - 6, list_top + 2, 3, list_h * rows_shown / len(visible) - 4, t["fill1"]))
        y = list_top + list_h
    else:
        for i, (n, c) in enumerate(visible):
            out.append(option_row(y, n, c, t, row_states.get(i)))
            y += ROW_H
    if drop_after is not None:
        ly = list_top + ROW_H * (drop_after + 1)
        out.append(rect(5, ly - 1, POP_W - 10, 2, t["accent"]))
    y += 4
    out.append(ui_input(8, y, POP_W - 16, t, "", copy["add"]))
    y += 30 + 4
    s, sh = separator(y, t)
    out.append(s)
    y += sh
    out.append(menu_item(y, copy["type"], t, "select", chevron=True))
    y += ITEM_H
    s, sh = separator(y, t)
    out.append(s)
    y += sh
    for key, ic in (("asc", "sort"), ("desc", "sort"), ("filter", "filter"), ("hide", None)):
        out.append(menu_item(y, copy[key], t, ic))
        y += ITEM_H
    s, sh = separator(y, t)
    out.append(s)
    y += sh
    out.append(menu_item(y, copy["delete"], t, "trash", danger=True))
    y += ITEM_H + 5
    if ghost:
        gx, gy, (n, c) = ghost
        out.append(pointer(gx, gy, t))
        out.append(f'<g opacity="0.5">{tag(gx + 14, gy + 10, n, c, t)}</g>')
    return "".join(out), y


def b3_edit(t):
    """OptionEditPane in the property menu's popover: Back, name, Delete option, Colour."""
    out = []
    # head: .db-option-edit-head padding 2px 2px 6px, gap 4px; inside a 6px-padded body
    out.append(icon("back", 20, 23, t["text2"]))
    out.append(ui_input(8 + 24 + 4, 8, POP_W - 16 - 28, t, "Medium", focused=True, selected=True))
    y = 8 + 30 + 6
    out.append(icon("trash", 8 + 8 + 7, y + 15, t["text"]))
    out.append(text(8 + 8 + 14 + 8, y + 19.5, "Delete option", t["text"], 13))
    y += 30
    out.append(text(16, y + 8 + 12, "Colour", t["text2"], 12, weight=500))
    y += 8 + 16 + 4
    for color in ("gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"):
        fg, bg = t["c"][color]
        out.append(f'<circle cx="{8 + 8 + 8}" cy="{y + 15}" r="8" {fill(bg)} {stroke(t["border_strong"], 0.5)}/>')
        out.append(text(8 + 8 + 16 + 8, y + 19.5, color.capitalize(), t["text"], 13))
        if color == "yellow":
            out.append(icon("check", POP_W - 24, y + 15, t["text"]))
        y += 30
    return "".join(out), y + 8


def b3_scene(t, state):
    out = []
    pname = "Stage" if state == "long" else "Priority"
    vals = [("Inbox", "gray"), ("Next", "blue")] if state == "long" else [("High", "red"), ("Low", "gray")]
    cols = [("Task", "text", 180, ["Water the plants", "Taxes"]), (pname, "select", 150, vals)]
    strip, _ = table_strip(24, 20, 330 + 36, t, cols, active_th=pname)
    out.append(strip)
    copy = PT if state == "pt" else EN
    if state == "default" or state == "pt":
        body, h = b3_menu(t, copy, OPTS)
    elif state == "hover":
        body, h = b3_menu(t, copy, OPTS, {1: "hover"})
    elif state == "keyboard":
        body, h = b3_menu(t, copy, [OPTS[0], OPTS[2], OPTS[1]], {1: "focus"}, name_focused=False)
    elif state == "drag":
        body, h = b3_menu(t, copy, OPTS, {2: "hover"}, name_focused=False, drop_after=0,
                          ghost=(150, 8 + 30 + 4 + 23 + ROW_H + 2, ("Low", "gray")))
    elif state == "empty":
        body, h = b3_menu(t, copy, [])
    elif state == "long":
        body, h = b3_menu(t, copy, LONG, {1: "hover"}, long=True)
    elif state == "edit":
        body, h = b3_edit(t)
    px = 24 + 180
    out.append(popover(px, 20 + 36 + 4, POP_W, h, t, body))
    if state == "hover":
        out.append(pointer(px + 110, 20 + 36 + 4 + 8 + 30 + 4 + 23 + ROW_H + 14, t))
    if state == "long":
        out.append(pointer(px + 140, 20 + 36 + 4 + 8 + 30 + 4 + 23 + ROW_H + 14, t))
    if state == "keyboard":
        out.append(text(px + POP_W + 16, 20 + 36 + 4 + 8 + 30 + 4 + 23 + ROW_H + 20, "Alt+↑ moved Low up:",
                        t["text3"], 11))
        out.append(text(px + POP_W + 16, 20 + 36 + 4 + 8 + 30 + 4 + 23 + ROW_H + 36, "“Low, position 2 of 3”",
                        t["text3"], 11))
    return "".join(out)


def b3():
    for state, title, h in [("default", "B3 · Options in the column menu", 470),
                            ("hover", "B3 · pointer on an option", 470),
                            ("keyboard", "B3 · list focused, after Alt+Up", 470),
                            ("drag", "B3 · dragging an option", 470),
                            ("empty", "B3 · no options yet", 380),
                            ("long", "B3 · nine options, one long name", 610),
                            ("edit", "B3 · an option opened (Back)", 470),
                            ("pt", "B3 · pt-BR", 470)]:
        w = 640 if state == "keyboard" else 520
        write(f"b3-{state}.svg", frame_doc([(T, b3_scene(T, state)) for T in (LIGHT, DARK)], w, h, title))


a1b()
b1()
b3()
print("ok")
