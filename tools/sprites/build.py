# Recorta las hojas de sprites generadas (tools/sprites/src/*.png) y arma el atlas
# de unidades de la Cacería:
#   apps/client/public/sprites/hunt-units.png
#   apps/client/src/hunt-sprites.gen.ts
#
# Las hojas vienen de un generador de imágenes: rejilla aproximada, neblina casi
# transparente, halos de color en el borde y filas de más. Aquí se detectan las
# filas por proyección, las columnas con los centros de la primera fila, se quita
# lo semitransparente, se tiran las manchas sueltas pequeñas, se reduce cada
# personaje con una escala única (para que no "respire" de tamaño) y se le pone
# un contorno oscuro de 1 px.
#
# Uso: python -I tools/sprites/build.py
import json
import os
import sys
from collections import deque

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'tools', 'sprites', 'src')
OUT_PNG = os.path.join(ROOT, 'apps', 'client', 'public', 'sprites', 'hunt-units.png')
OUT_TS = os.path.join(ROOT, 'apps', 'client', 'src', 'hunt-sprites.gen.ts')

DIRS = ['down', 'left', 'right', 'up']

# filas (índice de banda detectada) de cada hoja. act: dirección -> banda, o
# ('mirror', dir) para reflejar otra dirección, o ('walk', dir) para usar el
# caminar de esa dirección cuando la hoja no trae ese ataque.
SHEETS = {
    'elf': {'ref': 96, 'walk': [0, 1, 2, 3], 'act': {'down': 5, 'left': 6, 'right': 7, 'up': 8}, 'death': 9},
    'hunter': {'ref': 136, 'walk': [0, 1, 2, 3], 'act': {'down': 4, 'left': 5, 'right': 6, 'up': 8}, 'death': 9},
    'wolf': {'ref': 80, 'walk': [0, 1, 2, 3], 'act': {'down': 4, 'left': 5, 'right': 6, 'up': ('walk', 'up')}, 'death': 8},
    'angel': {'ref': 96, 'walk': [0, 1, 2, 3], 'act': {'down': 4, 'left': 5, 'right': ('mirror', 'left'), 'up': 7}, 'death': 8},
    # obreros: algo más bajitos que el colono; sus filas «derecha» de acción
    # salieron mirando a la izquierda, así que se reflejan
    'repairer': {'ref': 80, 'walk': [0, 1, 2, 3], 'act': {'down': 5, 'left': 6, 'right': ('mirror', 'left'), 'up': 8}, 'death': 9},
    'lumberjack': {'ref': 80, 'walk': [0, 1, 2, 3], 'act': {'down': 4, 'left': 5, 'right': ('mirror', 'left'), 'up': 7}, 'death': 8},
}

A_CUT = 150  # alfa mínima para considerar un píxel parte del dibujo


def bands_of(mask, W, H):
    px = mask.load()
    rows = [sum(1 for x in range(0, W, 2) if px[x, y]) for y in range(H)]
    out = []
    inb = False
    s = 0
    for y, v in enumerate(rows):
        if v > 1 and not inb:
            s, inb = y, True
        elif v <= 1 and inb:
            if y - s > 30:
                out.append((s, y))
            inb = False
    if inb and H - s > 30:
        out.append((s, H))
    return out


def col_centers(mask, W, band):
    px = mask.load()
    y0, y1 = band
    cols = [sum(1 for y in range(y0, y1, 2) if px[x, y]) for x in range(W)]
    segs = []
    inb = False
    s = 0
    for x, v in enumerate(cols):
        if v > 0 and not inb:
            s, inb = x, True
        elif v == 0 and inb:
            if x - s > 30:
                segs.append((s, x))
            inb = False
    if inb:
        segs.append((s, W))
    assert len(segs) == 5, f'la primera fila debería tener 5 figuras, tiene {len(segs)}'
    return [(a + b) / 2 for a, b in segs]


def components(img):
    """Componentes conexos (8-vecindad) de los píxeles opacos: lista de listas de (x, y)."""
    W, H = img.size
    a = img.split()[3].load()
    seen = bytearray(W * H)
    comps = []
    for y in range(H):
        for x in range(W):
            if a[x, y] == 0 or seen[y * W + x]:
                continue
            q = deque([(x, y)])
            seen[y * W + x] = 1
            comp = []
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx] and a[nx, ny]:
                            seen[ny * W + nx] = 1
                            q.append((nx, ny))
            comps.append(comp)
    return comps


def clean(crop):
    """Alfa dura y sin manchas sueltas pequeñas."""
    r, g, b, a = crop.split()
    a = a.point(lambda v: 255 if v >= A_CUT else 0)
    img = Image.merge('RGBA', (r, g, b, a))
    comps = components(img)
    if not comps:
        return img
    big = max(len(c) for c in comps)
    px = img.load()
    for c in comps:
        if len(c) < max(40, big * 0.03):
            for x, y in c:
                px[x, y] = (0, 0, 0, 0)
    return img


def outline(img):
    """Oscurece el borde exterior: contorno de 1 px nítido, tapa los halos de color."""
    W, H = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            edge = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= W or ny >= H or src[nx, ny][3] == 0:
                    edge = True
                    break
            if edge:
                dst[x, y] = (int(r * 0.25) + 8, int(g * 0.25) + 6, int(b * 0.25) + 10, 255)
    return out


def main():
    chars = {}
    tiles = []  # (char, Image)
    for name, spec in SHEETS.items():
        im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
        W, H = im.size
        mask = im.split()[3].point(lambda v: 255 if v >= A_CUT else 0)
        bands = bands_of(mask, W, H)
        centers = col_centers(mask, W, bands[0])
        sp = (centers[-1] - centers[0]) / 4
        print(f'{name}: {len(bands)} filas, separación {sp:.0f}px')

        def grab(band_i, col):
            y0, y1 = bands[band_i]
            cx = centers[col]
            box = (int(cx - sp / 2), max(0, y0 - 6), int(cx + sp / 2), min(H, y1 + 6))
            return clean(im.crop(box))

        raw = {}  # (anim, dir, i) -> Image  (cajas del mismo ancho, centradas en la columna)
        for d, bi in zip(DIRS, spec['walk']):
            for c in range(4):
                raw[('walk', d, c)] = grab(bi, c)
            raw[('idle', d, 0)] = grab(bi, 4)
        for d in DIRS:
            src = spec['act'][d]
            if isinstance(src, int):
                for c in range(4):
                    raw[('act', d, c)] = grab(src, c)
        for d in DIRS:
            src = spec['act'][d]
            if isinstance(src, tuple):
                kind, od = src
                for c in range(4):
                    base = raw[('act', od, c)] if kind == 'mirror' else raw[('walk', od, c)]
                    raw[('act', d, c)] = base.transpose(Image.FLIP_LEFT_RIGHT) if kind == 'mirror' else base
        for c in range(4):
            raw[('death', 'down', c)] = grab(spec['death'], c)

        # escala única: la altura del reposo de frente pasa a medir `ref` px
        ib = raw[('idle', 'down', 0)].getbbox()
        scale = spec['ref'] / (ib[3] - ib[1])
        # caja común: ancho de columna y el alto que haga falta, pies abajo
        frames = {}
        for key, img in raw.items():
            bb = img.getbbox()
            if not bb:
                bb = (0, 0, 1, 1)
            # recorte vertical al contenido; horizontal se mantiene la columna
            sub = img.crop((0, bb[1], img.width, bb[3]))
            w = max(1, round(sub.width * scale))
            h = max(1, round(sub.height * scale))
            small = sub.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
            r, g, b, a = small.split()
            small = Image.merge('RGBA', (r, g, b, a.point(lambda v: 255 if v >= 128 else 0)))
            frames[key] = outline(small)
        fw = max(f.width for f in frames.values())
        fh = max(f.height for f in frames.values()) + 2
        cells = {}
        for key, f in frames.items():
            cell = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
            cell.alpha_composite(f, ((fw - f.width) // 2, fh - 1 - f.height))
            cells[key] = cell
        # recortar los lados vacíos comunes a todas las celdas (sin mover el centro)
        lo = min(c.getbbox()[0] for c in cells.values() if c.getbbox())
        hi = max(c.getbbox()[2] for c in cells.values() if c.getbbox())
        m = min(lo, fw - hi)
        if m > 1:
            cells = {k: c.crop((m - 1, 0, fw - m + 1, fh)) for k, c in cells.items()}
            fw = fw - 2 * (m - 1)
        chars[name] = {'w': fw, 'h': fh, 'ref': spec['ref'], 'cells': cells}

    # empaquetado: una fila de atlas por personaje
    order = []
    for name, ch in chars.items():
        keys = list(ch['cells'].keys())
        order.append((name, keys))
    atlas_w = 0
    atlas_h = 0
    per_row = 12
    layout = {}
    y = 0
    for name, keys in order:
        ch = chars[name]
        rows = (len(keys) + per_row - 1) // per_row
        layout[name] = (y, keys)
        atlas_w = max(atlas_w, per_row * ch['w'])
        y += rows * ch['h']
    atlas_h = y
    atlas = Image.new('RGBA', (atlas_w, atlas_h), (0, 0, 0, 0))
    meta = {}
    for name, (y0, keys) in layout.items():
        ch = chars[name]
        frames = []
        anims = {'walk': {d: [] for d in DIRS}, 'idle': {}, 'act': {d: [] for d in DIRS}, 'death': []}
        for i, key in enumerate(keys):
            x = (i % per_row) * ch['w']
            yy = y0 + (i // per_row) * ch['h']
            atlas.alpha_composite(ch['cells'][key], (x, yy))
            frames.append([x, yy])
            anim, d, _c = key
            if anim == 'idle':
                anims['idle'][d] = i
            elif anim == 'death':
                anims['death'].append(i)
            else:
                anims[anim][d].append(i)
        meta[name] = {'w': ch['w'], 'h': ch['h'], 'ref': ch['ref'], 'frames': frames, 'anims': anims}
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    atlas.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(OUT_PNG, optimize=True)
    with open(OUT_TS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Generado por tools/sprites/build.py — no editar a mano.\n')
        f.write('export interface UnitSheet {\n  w: number;\n  h: number;\n  ref: number;\n  frames: [number, number][];\n')
        f.write("  anims: { walk: Record<Dir, number[]>; idle: Record<Dir, number>; act: Record<Dir, number[]>; death: number[] };\n}\n")
        f.write("export type Dir = 'down' | 'left' | 'right' | 'up';\n")
        f.write('export const UNIT_SHEETS: Record<string, UnitSheet> = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
    print(f'atlas {atlas_w}x{atlas_h} -> {OUT_PNG} ({os.path.getsize(OUT_PNG) // 1024} KB)')


if __name__ == '__main__':
    sys.exit(main())
