# Hojas de candidatos: para cada clave de icono, 6 sprites de cada uno de sus temas.
# Bajo cada sprite va su índice GLOBAL (fila del atlas), que es lo que se guarda en picks.json.
import json, sys, numpy as np
from PIL import Image, ImageDraw
SRC, OUTDIR, PER = sys.argv[1], sys.argv[2], 18
tok = np.load(SRC + '/tokens.npy', mmap_mode='r', allow_pickle=False)
pal = np.load(SRC + '/palette.npy', allow_pickle=False)
obj = json.load(open(SRC + '/objects.json', encoding='utf-8'))
idx = {}
for i, s in enumerate(obj): idx.setdefault(s, []).append(i)
cand = json.load(open(sys.argv[3], encoding='utf-8'))
keys = list(cand)
Z, C = 3, 12
cw, ch = 16*Z+8, 16*Z+14
for p in range(0, len(keys), PER):
    page = keys[p:p+PER]
    img = Image.new('RGBA', (130 + C*cw, len(page)*ch), (30,30,40,255))
    d = ImageDraw.Draw(img)
    for r, k in enumerate(page):
        y = r*ch
        ids = []
        for s in cand[k]: ids += idx.get(s, [])[:6]
        d.text((4, y+14), k, fill=(240,240,240,255))
        for c, i in enumerate(ids[:C]):
            px = np.asarray(tok[i]).reshape(16,16)
            rgba = np.dstack((pal[px], (px!=0).astype('uint8')*255)).astype('uint8')
            sp = Image.fromarray(rgba,'RGBA').resize((16*Z,16*Z), Image.NEAREST)
            img.alpha_composite(sp, (130 + c*cw, y))
            d.text((130 + c*cw, y+16*Z), str(i), fill=(200,200,120,255))
    img.save(f'{OUTDIR}/cand_{p//PER}.png')
print('pages', (len(keys)+PER-1)//PER)
