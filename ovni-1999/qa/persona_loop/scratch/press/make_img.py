"""Gera as imagens do dossiê (JPEG 16:10) a partir das capturas do jogo."""
import os
import sys
from PIL import Image

S = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
P = S + '/press'
OUT = P + '/img'
os.makedirs(OUT, exist_ok=True)

R = P + '/raw/'
REN = P + '/render/'
INV = S + '/ui/inventory/'
RENDER_CROP = (60, 70, 2508, 1600)  # tira a linha de depuração do render_check

JOBS = [
    ('hero.jpg', R + '015_dia_aim.png', None, (1600, 1000)),
    ('t1-caminho.jpg', R + '028_noite_confirm_lock.png', (648, 216, 2376, 1296), (1600, 1000)),
    ('t2-apontar.jpg', R + '015_dia_aim.png', (475, 216, 2059, 1206), (1600, 1000)),
    ('t5-oculto.jpg', R + '013_dia_t5_hidden.png', None, (1600, 1000)),
    ('t6-relatorio.jpg', R + '017_dia_debrief.png', None, (1600, 1000)),
    ('inventario.jpg', INV + '04_inv_drag_reload.png', (353, 220, 2527, 1579), (1600, 1000)),
    ('kit-medico.jpg', INV + '13_med_panel.png', (353, 220, 2527, 1579), (1600, 1000)),
    ('ovni.jpg', REN + 'ufo_medium_scout_night.png', RENDER_CROP, (1600, 1000)),
    ('terreno-quinta.jpg', REN + 'farm_buildings.png', RENDER_CROP, (1200, 750)),
    ('terreno-urbano.jpg', REN + 'urban_terror_z1.png', RENDER_CROP, (1200, 750)),
    ('terreno-floresta.jpg', REN + 'forest.png', RENDER_CROP, (1200, 750)),
    ('terreno-deserto.jpg', REN + 'desert.png', RENDER_CROP, (1200, 750)),
    ('terreno-selva.jpg', REN + 'jungle.png', RENDER_CROP, (1200, 750)),
    ('terreno-montanha.jpg', REN + 'mountain.png', RENDER_CROP, (1200, 750)),
    ('terreno-polar.jpg', REN + 'polar.png', RENDER_CROP, (1200, 750)),
    ('terreno-base.jpg', REN + 'alienbase_z2.png', RENDER_CROP, (1200, 750)),
    ('terreno-marte.jpg', REN + 'mars_z1.png', RENDER_CROP, (1200, 750)),
]
# extras passados na linha de comandos: nome=origem[@x0,y0,x1,y1]
for a in sys.argv[1:]:
    name, src = a.split('=', 1)
    box = None
    if '@' in src:
        src, b = src.split('@')
        box = tuple(int(v) for v in b.split(','))
    JOBS.append((name, src, box, (1600, 1000)))

only = [a.split('=', 1)[0] for a in sys.argv[1:]]
for name, src, box, size in JOBS:
    if only and name not in only:
        continue
    im = Image.open(src).convert('RGB')
    if box:
        im = im.crop(box)
    im = im.resize(size, Image.LANCZOS)
    im.save(os.path.join(OUT, name), 'JPEG', quality=84, optimize=True, progressive=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')
