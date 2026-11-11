# Genera el atlas de iconos pixel de la UI a partir del Pixel Art Atlas (CC0).
#
# Uso: python -I tools/pixel-atlas/build.py <carpeta-del-pack>
#
# Lee picks.json (clave de icono -> fila del pack) y escribe:
#   apps/client/public/icons/px-atlas.png   rejilla de sprites 16x16 nativos
#   apps/client/src/px-icons.gen.ts         clave -> celda (columna, fila)
# El pack (720 MB) NO entra en el repo: solo la rejilla curada (pocos KB).
import json, sys, numpy as np
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = Path(sys.argv[1])
tok = np.load(SRC / 'tokens.npy', mmap_mode='r', allow_pickle=False)
pal = np.load(SRC / 'palette.npy', allow_pickle=False)
picks = json.loads((HERE / 'picks.json').read_text(encoding='utf-8'))
COLS = 16
keys = list(picks)
rows = (len(keys) + COLS - 1) // COLS
atlas = Image.new('RGBA', (COLS * 16, rows * 16), (0, 0, 0, 0))
cells = {}
for n, k in enumerate(keys):
    px = np.asarray(tok[picks[k]]).reshape(16, 16)
    rgba = np.dstack((pal[px], (px != 0).astype('uint8') * 255)).astype('uint8')
    c, r = n % COLS, n // COLS
    atlas.paste(Image.fromarray(rgba, 'RGBA'), (c * 16, r * 16))
    cells[k] = [c, r]
atlas.save(ROOT / 'apps/client/public/icons/px-atlas.png', optimize=True)
lines = [
    '// GENERADO por tools/pixel-atlas/build.py — no editar a mano.',
    '// Celda [columna, fila] de cada icono en /icons/px-atlas.png (sprites 16x16).',
    f'export const PX_COLS = {COLS};',
    f'export const PX_ROWS = {rows};',
    'export const PX_CELLS: Record<string, readonly [number, number]> = {',
]
lines += [f"  '{k}': [{c}, {r}]," for k, (c, r) in cells.items()]
lines += ['};', '']
(ROOT / 'apps/client/src/px-icons.gen.ts').write_text('\n'.join(lines), encoding='utf-8')
print(len(keys), 'iconos ->', COLS, 'x', rows)
