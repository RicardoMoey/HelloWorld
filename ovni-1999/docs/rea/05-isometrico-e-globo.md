# Web/Canvas implementation research: X-COM (UFO: Enemy Unknown) remake in the browser

Scope: rendering, UX and world-map data for a vanilla-JS Canvas 2D game that targets macOS Safari and Chrome. Every number below was either checked in the OpenXcom source and rulesets (fetched from raw.githubusercontent.com, which works through the proxy) or measured in this container. Anything I could not verify is listed under "uncertain". UFOpaedia could not be reached: `www.ufopaedia.org` does not resolve in this sandbox's network policy, so it would have to be allow-listed.

**Licence note.** OpenXcom is GPLv3. Use the facts, constants and formulas below, but do not copy its code. The snippets in this report are my own.

---

## PART A: Isometric turn-based rendering in Canvas 2D

### A1. Coordinate conventions (identical to X-COM/OpenXcom)
- Map axes:
  - +x goes to screen lower-right.
  - +y goes to screen lower-left.
  - +z goes up.
  - North is −y (screen up-right) and west is −x (screen up-left).
  - OpenXcom directions run 0=N(0,−1), 1=NE(+1,−1), 2=E(+1,0), 3=SE, 4=S, 5=SW, 6=W, 7=NW.
- OpenXcom `Camera::convertMapToScreen` (verified): `sx = x*(W/2) − y*(W/2)` and `sy = x*(W/4) + y*(W/4) − z*((H + W/4)/2)`, with sprite W=32 and H=40. So the original game uses a floor diamond of 32×16 px and a level height of 24 px.
- Voxels: one tile is 16×16×24 voxels (`convertVoxelToScreen` divides by 16, 16, 24). Use the same grid for projectile and LOF tracing.
- Recommended browser scale is 2× X-COM: `TW=64, TH=32, LH=48`. Keep LH = 0.75·TW so wall and height proportions stay faithful. Sprite boxes become 64×80 CSS px.

```js
const TW = 64, TH = 32, LH = 48;            // tile width, tile height, level height (CSS px at zoom 1)
// top vertex of floor diamond of tile (x,y,z), in screen CSS px
function tileToScreen(x, y, z, cam) {
  return { sx: ((x - y) * TW / 2) * cam.zoom - cam.x,
           sy: (((x + y) * TH / 2) - z * LH) * cam.zoom - cam.y };
}
// inverse at a given level z (continuous + integer tile)
function screenToTile(px, py, z, cam) {
  const wx = (px + cam.x) / cam.zoom, wy = (py + cam.y) / cam.zoom;
  const a = wx / (TW / 2), b = (wy + z * LH) / (TH / 2);
  const fx = (a + b) / 2, fy = (b - a) / 2;          // continuous tile coords
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}
// voxel (16x16x24 per tile) -> screen, for projectiles/explosions
function voxelToScreen(vx, vy, vz, cam) {
  const u = vx / 16, v = vy / 16, h = vz / 24;
  return { sx: ((u - v) * TW / 2) * cam.zoom - cam.x, sy: (((u + v) * TH / 2) - h * LH) * cam.zoom - cam.y };
}
```
Derivation of the inverse: a point (u,v) inside tile (x,y) projects to `px=(u−v)TW/2` and `py=(u+v)TH/2`. Therefore `u=(a+b)/2` and `v=(b−a)/2`.

- Diamond geometry relative to the top vertex (sx,sy):
  - right vertex: (sx+TW/2, sy+TH/2)
  - bottom vertex: (sx, sy+TH)
  - left vertex: (sx−TW/2, sy+TH/2)
  - floor centre: (sx, sy+TH/2)
- Walls (X-COM tiles have four parts: floor, west wall, north wall, object):
  - The north wall sits on the top-right edge, from (sx,sy) to (sx+TW/2, sy+TH/2).
  - The west wall sits on the top-left edge, from (sx−TW/2, sy+TH/2) to (sx,sy).
  - Both are back edges, so they are drawn after the floor and before the unit and object of the same tile.
  - A tile's front edges are the next tiles' west and north walls, so they are drawn later automatically.

### A2. Draw order (painter's algorithm)
OpenXcom `Map::drawTerrain` (verified):
- Loop order is `for z (0..endZ) { for x { for y { … } } }`, where `endZ = showAllLayers ? mapZ−1 : viewLevel`.
- Order within a tile: floor → west wall → north wall → object (unless it is a "big wall" front piece) → unit → smoke/fire → particles → path-preview arrows → front objects (bigWall ≥ 6) → TU numbers.
- Units that move between tiles are drawn from neighbouring tiles using backPos/frontPos offsets.

The x-then-y loop is valid because sprites no wider than one tile never overlap a tile that is drawn earlier. A diagonal loop is clearer and also safe:

```js
for (let z = 0; z <= viewZ; z++) {
  // pass 1: all floors of this level (flat, cannot occlude same-level walls/units)
  forEachTileDiag(z, t => drawFloor(t));
  // pass 2 (optional): smooth floor light map for this level (see A7)
  drawFloorLightmap(z);
  // pass 3: back-to-front by diagonal s = x+y
  for (let s = 0; s <= MW + MH - 2; s++)
    for (let x = Math.max(0, s - MH + 1); x <= Math.min(MW - 1, s); x++) {
      const y = s - x, t = tile(x, y, z); if (!t || offscreen(t)) continue;
      drawWallW(t); drawWallN(t); drawItemsOnFloor(t); drawUnitsAnchoredAt(t);
      drawObject(t); drawSmokeFire(t); drawSelectionCursorIfHere(t);
    }
}
drawProjectilesAndFX(); drawPathPreviewNumbers(); // on top, like OpenXcom's TU numbers
```

Rules:
- Every sprite must fit inside one level height. Split tall things (trees, UFO hulls) per level.
- Under that rule the level-outer order is correct: a level-z+1 floor only ever overlaps level-z sprites that are behind and below it.
- A moving unit is anchored to whichever tile of {from, to} has the larger x+y. When both are equal, use the destination.
- A 2×2 unit (cyberdisc, sectopod, tank) is anchored to the front-most cell of its footprint.
- Hit-testing units: record each drawn unit's screen rectangle in draw order and test in reverse order before tile picking, so a click on a soldier's head selects him.

### A3. Multi-level cut-away and picking
- X-COM rule: draw only z ≤ viewLevel and hide everything above.
- Selecting a unit sets viewLevel to the unit's z. OpenXcom's `getSelectorPosition` sets `pos.z = viewLevel`, so the cursor always lives on the view level.
- Polish options (not in the original):
  - Dim levels below the view level by about 12% per level, as a multiplicative dark overlay or by adding to the shade.
  - Optionally draw the walls of level viewLevel+1 as 10%-alpha outlines.
- "Drop-through" picking, which is friendlier than X-COM's:

```js
function pickTile(px, py, cam) {
  for (let z = viewZ; z >= 0; z--) {
    const t = screenToTile(px, py, z, cam);
    const tl = tileAt(t.x, t.y, z);
    if (tl && (tl.hasFloor || tl.unit || z === 0)) return { ...t, z };
  }
  return null;
}
```
To stay faithful, keep a setting that pins picking to viewZ, which flying units need.

### A4. Camera
- Model: `screen = world*zoom − cam`. Zoom around the cursor:
```js
function zoomAt(px, py, factor) {
  const z0 = cam.zoom, z1 = Math.min(3, Math.max(0.5, z0 * factor));
  cam.x = (px + cam.x) * z1 / z0 - px;  cam.y = (py + cam.y) * z1 / z0 - py;  cam.zoom = z1; requestRender();
}
```
- Discrete zoom steps:
  - Steps are [0.5, 0.75, 1, 1.5, 2].
  - During a pinch, draw the existing caches scaled (slightly soft).
  - On gesture end, snap to the nearest step and re-rasterise the vector sprite caches at `zoom*dpr`.
  - "Pixel-crisp" means rendering into a low-resolution buffer (for example 640×400 logical) and upscaling by an integer with `imageSmoothingEnabled=false` plus CSS `image-rendering: pixelated`. Offer it as a "retro" option; the default should be native-resolution vector art.
- Trackpad and mouse input:
```js
let gestureActive = false, gZoom0 = 1;
canvas.addEventListener('wheel', e => {
  e.preventDefault();                                   // also blocks two-finger swipe-back
  if (e.ctrlKey) { if (!gestureActive) zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.01)); return; } // pinch (Chrome/Firefox)
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  cam.x += e.deltaX * k; cam.y += e.deltaY * k; clampCamera(); requestRender();   // two-finger pan
}, { passive: false });
// Safari-only GestureEvent (pinch); guard against double zoom with ctrl-wheel
canvas.addEventListener('gesturestart',  e => { e.preventDefault(); gestureActive = true; gZoom0 = cam.zoom; });
canvas.addEventListener('gesturechange', e => { e.preventDefault(); zoomAt(e.clientX - rect.left, e.clientY - rect.top, (gZoom0 * e.scale) / cam.zoom); });
canvas.addEventListener('gestureend',    e => { e.preventDefault(); gestureActive = false; snapZoom(); });
```
- CSS required:
  - `html,body{overscroll-behavior:none}` and `canvas{touch-action:none}`.
  - The wheel `preventDefault` is mandatory. Otherwise a two-finger horizontal swipe triggers Back/Forward history navigation on Mac.
- Telling a real mouse wheel from a trackpad (heuristic): treat the event as a mouse notch when `!e.ctrlKey && e.deltaX===0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY)>=100` (or `deltaMode===1`). Map a notch to view level ±1 or to zoom, and expose this as a setting.
- Arrow keys pan at about 600 CSS px/s with acceleration (held-key state polled in rAF).
- Edge scroll: OpenXcom uses `SCROLL_BORDER = 5 px`, `SCROLL_DIAGONAL_EDGE = 60 px` and `battleScrollSpeed = 8`. On a laptop browser, default edge scroll to OFF because the cursor leaves the window; provide it as an option.
- Drag-scroll: OpenXcom uses the middle button with tolerances of 300 ms and 10 px. On Mac, use Space+drag or a left-drag that starts on empty ground, with the same 10 px / 300 ms threshold to tell it apart from a click.
- Centre on unit: tween 250–300 ms with ease-out cubic.
- Clamp the camera to the map diamond's bounding box plus a margin of one screen half.

### A5. Retina / devicePixelRatio
```js
function fitCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);          // cap at 2 for fill-rate
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  spriteCache.clear(); requestRender();
}
new ResizeObserver(fitCanvas).observe(canvas);
// re-fit when moved between displays with a different DPR
(function watchDpr(){ matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  .addEventListener('change', () => { fitCanvas(); watchDpr(); }, { once: true }); })();
```
- Snap sprite blits to device pixels with `Math.round(x*dpr)/dpr` to avoid shimmering and diamond seams.
- Expand floor diamonds by about 0.5 device px when rasterising so anti-aliased edges do not leave hairline gaps.
- Put text, menus and tooltips in a DOM overlay (absolutely positioned HTML) rather than on the canvas. Text stays crisp at any DPR, pt-PT localisation is easier, and the map canvas only redraws the map.

### A6. Sprite caching of vector-drawn tiles
```js
const spriteCache = new Map();               // key -> canvas (with .shadow silhouette)
function sprite(key, w, h, draw) {           // w,h in CSS px at zoom 1
  const s = dpr * cam.zoom, k = key + '@' + s;
  let c = spriteCache.get(k); if (c) return c;
  c = document.createElement('canvas'); c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
  const g = c.getContext('2d'); g.scale(s, s); draw(g);
  const sh = document.createElement('canvas'); sh.width = c.width; sh.height = c.height;
  const sg = sh.getContext('2d'); sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, sh.width, sh.height);
  c.shadow = sh; spriteCache.set(k, c); return c;
}
const SHADE_ALPHA = Array.from({ length: 16 }, (_, s) => Math.min(0.85, s / 15 * 0.85));
function blitShaded(spr, dx, dy, shade) {           // shade 0..15 (OpenXcom scale), 16 = unseen
  if (shade >= 16) return;
  ctx.drawImage(spr, dx, dy);
  if (shade > 0) { ctx.globalAlpha = SHADE_ALPHA[shade]; ctx.drawImage(spr.shadow, dx, dy); ctx.globalAlpha = 1; }
}
```
- Cache key: `${part}|${type}|${variant}|${damageState}@${dpr*zoom}`.
- Variant: `hash(x,y,z) % nVariants` (deterministic, so tiles do not flicker between frames).
- Memory: a 64×80 sprite at scale 2 is 128×160×4 B = 80 KB, or 160 KB including its silhouette. 150 variants therefore come to about 24 MB, which is fine. Clear the cache on zoom or DPR change and rebuild lazily.
- Prefer `document.createElement('canvas')` over OffscreenCanvas for Safari compatibility.
- Avoid `ctx.filter` (Safari support is unreliable). The silhouette-overlay technique works everywhere.
- Rendering policy:
  - Render on demand: dirty flag plus `requestAnimationFrame`, no permanent 60 fps loop.
  - Ambient animation (fire, smoke) runs at about 8–10 fps only while visible. This is a big battery and fan win on MacBooks.
  - Cull per tile against the viewport.
  - A 50×50×4 map is about 10k tiles. The visible region is about 1–3k tiles × 2–4 drawImage calls, which is comfortably 60 fps on Apple Silicon.
  - Chunked static-layer caching (with re-drawing of the front occluders for each unit) is only worth it if profiling shows a need.

### A7. Lighting (OpenXcom model, verified in TileEngine.cpp and Tile.cpp)
- Three light layers per tile: 0 = ambient (sun), 1 = static (terrain sources, fires, items on the ground), 2 = dynamic (units).
- Tile `shade = max(0, 15 − max(layerLight))`. A shade of 16 is used for undiscovered tiles, which are drawn black.
- Sun: `power = 15 − globalShade`. When `globalShade ≤ 4`, tiles with a roof (blocking floors or objects above) get `power −= 2`.
- `addLight(center, power)`: every tile with |dx|,|dy| ≤ power on all z levels receives `power − round(sqrt(dx²+dy²))`, keeping the maximum per layer. There is no occlusion.
- Fire light = 15. Player units carry a personal light of 15 (toggled with L, on by default). Burning units = 15. Items such as flares use their item "power".
- Recompute lights after explosions (roofs can be destroyed) and when fires start.
- Rendering:
  - (a) Per-sprite shading with `blitShaded` (faithful).
  - (b) Optional smooth floor light map: a W×H canvas with one pixel per tile, where alpha = darkness. Draw it with an isometric affine transform and bilinear smoothing:
```js
ctx.save();
const s = dpr * cam.zoom;
ctx.setTransform(s*TW/2, s*TH/2, -s*TW/2, s*TH/2, -cam.x*dpr, (-cam.y - z*LH*cam.zoom)*dpr);
ctx.imageSmoothingEnabled = true;  ctx.drawImage(lightMap[z], 0, 0);  ctx.restore();
```
  (The map maps u→(u·TW/2, u·TH/2) and v→(−v·TW/2, v·TH/2), so pixel (x,y) covers exactly the diamond of tile (x,y). Pad the light map by one pixel.)
  - Night tint: draw the overlay or silhouette with rgb(5,10,30) instead of black for a moonlit feel.
  - Cosmetic flare and fire glow: a screen-space radial gradient with `globalCompositeOperation='lighter'` at low alpha.

### A8. Smoke and fire animation
- OpenXcom smoke frame = `floor(smoke/6 − 0.1)`, which gives three density buckets (about 1–6, 7–12, 13+). On top of that an animation cycle runs with a per-tile `animationOffset`. Fire uses separate frames. Smoke takes the tile's shade; fire is drawn unshaded at full brightness.
- Procedural version:
  - Per tile, 3–6 puffs at seeded positions from `hash(x,y,z)`.
  - Each puff is a cached radial-gradient sprite in three sizes, drifting up −8 px over 1.6 s and looping with phase = hash.
  - Alpha = 0.25 + 0.15·bucket. Puffs are drawn after the units of that tile.
  - Fire: three cached flame frames (teardrop paths with an orange→yellow gradient), cycled every 100 ms with a per-tile phase, plus an additive glow.

### A9. Turn-based action queue (simulation separated from presentation)
- The rules engine resolves an order immediately and deterministically (seeded RNG) and returns an event list. The presenter plays the list back with async/await.
- The same engine can then run headless for AI-vs-AI tests and QA.
```js
// events: {type:'turn',unit,dir} {type:'walk',unit,from,to,tu} {type:'shot',from,path:[voxels],impact,weapon}
//         {type:'explosion',center,radius} {type:'damage',unit,amount} {type:'death',unit} {type:'reveal',unit} {type:'door',tile}
class Presenter {
  queue = []; busy = false; speed = 1;              // speed: 1 normal, 8 when user holds Space / clicks
  push(...ev) { this.queue.push(...ev); if (!this.busy) this.run(); }
  async run() { this.busy = true; input.lock();
    while (this.queue.length) { const e = this.queue.shift();
      if (e.visibleToPlayer && !onScreen(e.pos)) await camera.panTo(e.pos, 300 / this.speed);
      await this[e.type]?.(e); }
    this.busy = false; input.unlock(); }
  tween(ms, fn) { return new Promise(res => { const t0 = performance.now(), d = ms / this.speed;
    const step = t => { const k = Math.min(1, (t - t0) / d); fn(k); requestRender(); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step); }); }
  walk(e)  { return this.tween(240, k => e.unit.drawPos = lerp3(e.from, e.to, k)); }      // ~OpenXcom 30 ms x 8 phases
  async shot(e) { const L = e.path.length;                                               // bullets ~30 tiles/s
    await this.tween(L * 1000 / (30 * 16), k => fx.projectile = e.path[Math.floor(k * (L - 1))]); fx.projectile = null; }
  async explosion(e) { shake(4, 300); await Promise.all(tilesInRadius(e).map(t =>
    sleep(t.dist * 40 / this.speed).then(() => this.tween(400, k => t.fxFrame = Math.floor(k * 8))))); }
}
```
- OpenXcom default timers (verified in Options.cpp):
  - `battleXcomSpeed = 30` and `battleAlienSpeed = 30` (ms per walk-animation step).
  - `battleFireSpeed = 6`.
  - `battleScrollSpeed = 8`.
  - `battleSmoothCamera = false`.
  - `battleNewPreviewPath = PATH_NONE` (the preview path is off by default).
- Projectile visuals:
  - Bullets: bright head plus a 6-point fading trail.
  - Lasers: instant beam, 150 ms fade.
  - Plasma: a glowing ball moving at about 18 tiles/s.
  - Draw projectiles on top of the map for simplicity, or at their current tile in the painter loop if they should be occluded.

### A10. Path preview, reachable area, hit-chance popup
- OpenXcom `Pathfinding::previewPath` (verified):
  - Each tile shows a direction arrow, and the TU marker shows the TUs remaining after reaching that tile.
  - Colour is **green** if TU ≥ 0, energy ≥ 0 and the reserved action is still affordable; **yellow** if the tile is reachable but the reserve is lost; **red** if TU or energy is insufficient.
  - With reserve = None, the colour test uses the **Auto shot** reserve.
  - A kneeling unit pays 8 TU to stand first.
  - Running (Ctrl+strafe option) costs TU×0.75 and energy×1.5. Energy use is TU/2 per step, and 0 for vertical moves.
- Movement costs from OpenXcom (verified):
  - Diagonal step = orthogonal cost × 1.5 (the floor's TU cost, typically 4, so 6 diagonal).
  - Fly or grav-lift vertical move = 8 TU.
  - Turning = 1 TU per 45°.
  - Kneel = 4 TU; stand = 8 TU.
- Implementation:
  - When a unit is selected, and after every action, run Dijkstra once over the whole map (≤ 10k nodes, under 5 ms).
  - Hover then reconstructs the path from parent pointers instantly.
  - Draw the reachable-area outline in two colours, like modern XCOM: "can still fire the reserved shot" in green, "reachable" in yellow.
- Hit-chance popup:
  - X-COM's action menu shows "Acc>xx% TUs>yy" for each mode (ActionMenuState).
  - `acc = firing × weaponModeAcc/100`, then ×1.15 kneeling, ×0.8 for a two-handed weapon with both hands full, then × a health-based modifier (BattleUnit::getFiringAccuracy).
  - This value ignores distance and cover. For polish, also show "Prob. de acerto ≈ NN%" from a Monte Carlo of about 200 traces using the engine's own deviation and LOF voxel trace (about 1–3 ms), cached per target, stance and mode.
  - Render the popup as a DOM tooltip next to the cursor: "Tiro rápido · 18 TU · Precisão 62% · Acerto ≈ 38%". If LOF is blocked, show a red ✕.

---

## PART B: UX for browser turn-based tactics (prioritised for "capricha na jogabilidade")

### B1. What each reference game does well
- **X-COM 1994 battlescape HUD.** Unit up/down, view level up/down, map (minimap), kneel/stand, inventory, centre on selected, next unit, "done" (next unit and deselect), options, end turn, abort mission, four reserve-TU buttons (None/Snap/Aimed/Auto), two hand slots that open the action menu, TU/energy/health/morale bars, and red numbered "spotted alien" boxes that centre the camera when clicked. During the alien turn it shows a "Hidden Movement" screen, and the camera shows alien moves only when X-COM units can see them. Click = move, right-click = turn to face, and right-click cancels targeting.
- **OpenXcom.**
  - Optional path preview (arrows and/or TU numbers, with a double-click to confirm).
  - Default keys (verified in Options.cpp): arrows scroll; PgUp/PgDn change level; Home centres; Tab next unit; LShift previous unit; `\` deselect; Q/E use left/right hand; I inventory; M map; Esc options; **Backspace end turn**; A abort; S stats; K kneel; R reload; L personal lighting; F1–F4 reserve None/Snap/Aimed/Auto; J reserve kneel; Delete zero TUs; 1–0 centre on enemy 1–10; F10 voxel view.
  - Geoscape keys: arrows rotate; +/- zoom; 1–6 time speed; I intercept; B bases; G graphs; U Ufopaedia; F funding; Tab detail; R radar.
- **Xenonauts.** Keeps the TU model but shows the path with TU cost and remaining TU at the cursor, red where TU runs out, reserve buttons with icons, accuracy shown over the target when hovering in fire mode, and right-click to cancel.
- **XCOM (2012/2).** Movement-range outlines in two colours, cover shields at the hovered destination, hit % with a modifier breakdown, Tab to cycle targets, an enemy-head icon bar, a cinematic camera pan to enemy actions, and an end-turn prompt when units still have actions.

### B2. Prioritised polish list (Mac laptop first)
**P0, must have for good play**
1. **Hover path preview.**
   - Path dots or arrows coloured green/yellow/red (OpenXcom rule above).
   - Remaining TU at the destination ("TU 23/54"), plus an energy warning.
   - Two-colour reachable-area outline.
   - Single click moves (faithful), with an option for "confirmar movimentos (duplo clique)".
2. **Mac trackpad.**
   - Two-finger scroll pans; pinch zooms (ctrl+wheel plus Safari `gesture*`).
   - Block swipe-back (`preventDefault` on wheel, `overscroll-behavior:none`).
   - Secondary action = right button OR `ctrlKey && button===0` OR two-finger click (`contextmenu`, always `preventDefault`). It turns the unit to face (1 TU/45°) or cancels targeting/menus.
   - Option+click as an alternative turn-to-face.
3. **Firing.**
   - Click a hand slot (or Q/E) to open a menu listing Auto/Snap/Aimed with **TU cost and Acc%**, greyed out if unaffordable.
   - Targeting cursor shows the hit estimate and LOF status.
   - Esc, right-click or ctrl-click cancels.
   - Optionally remember the last fire mode per soldier.
4. **Reserve TU.** Four toggle buttons. Keys F1–F4 plus Mac-friendly aliases (Shift+1..4), because F-keys are media keys by default on MacBooks. Moves that would break the reserve show a clear "TU reservadas para tiro" message with a buzz sound.
5. **Navigation keys.** Next/previous soldier = Tab/Shift+Tab; centre = C (and Home); level up/down = PgUp/PgDn plus `Shift+↑/↓` or `,`/`.` (Mac laptops lack PgUp/Home without fn); kneel = K; inventory = I; map = M; reload = R; end turn = Backspace (Mac "delete") **and** an on-screen button.
6. **End-turn confirmation.** Prompt when any conscious soldier can still move about 4+ tiles or fire a snap shot: "Ainda há soldados com TU. Terminar turno?" with a "não perguntar de novo" option.
7. **Enemy turn presentation.** A "Movimento Oculto" overlay; the camera auto-pans (250–300 ms ease) only to events visible to X-COM; reaction fire is shown the same way; input is locked during playback; holding Space or clicking fast-forwards (×8).
8. **Feedback sounds** (WebAudio-synthesised, no assets). Select blip, move confirm, footsteps per tile (quiet), door, per-weapon shot timbre, explosion (filtered noise burst), "alien spotted" sting (iconic), not-enough-TU buzz, turn start/end chimes, death. Master volume and mute. Resume the AudioContext on the first user gesture (Safari requirement).

**P1**
9. Unit list strip (left side): portrait or rank, name, TU bar (green), health (red, with stun overlay), morale; status icons (kneeling, no TU, bleeding, panicking). Click selects; double-click centres.
10. Spotted-alien indicators (red numbered boxes; keys 1–0) to centre on each visible alien.
11. Minimap (M or a corner inset): top-down, 3 px per tile, current level, fog, unit dots, and the camera diamond. Click to jump.
12. Simplified inventory: drag-and-drop grid, TU cost shown on hover and drop, ammo count, "recarregar" button. Loadout templates at the craft equipment screen.
13. Cover and LOF hints: when hovering a destination, highlight the walls and objects on each side; red line-of-fire ✕.
14. Auto-select the next soldier with TU left after a soldier spends all TU (option).

**P2**
15. Settings: animation speed (alien and X-COM separately, as in OpenXcom), edge scroll, path preview mode, retro pixel mode, screen shake, colour-blind palette for green/yellow/red (add shapes: ●/▲/✕).
16. Tooltips in pt-PT on every HUD button, with the shortcut shown.
17. Autosave every turn plus a `beforeunload` guard. Never bind Cmd+W/Q/R/1–9 (browser-reserved on Mac).
18. Battery: render on demand, ambient animation at 10 fps, pause when `document.hidden`.

---

## PART C: World-map data feasibility (tested in this container)

### C1. Download test results
New directories were created under the scratchpad. `worldmap/` already held `extracted/`, `npm-tgz/` and `out/` from an earlier agent; I left them untouched.

| URL | Result |
|---|---|
| https://unpkg.com/world-atlas@2.0.2/land-110m.json | **FAIL**: proxy 403 on CONNECT (unpkg.com policy-denied) |
| https://unpkg.com/world-atlas@2.0.2/countries-110m.json | **FAIL**: 403 |
| https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json | **FAIL**: 403 (cdn.jsdelivr.net policy-denied) |
| https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json | **FAIL**: 403 |
| https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz | **OK**: 200, 2,277,546 B, sha256 032e7765f2ce00edaeafec23ff22bc3b77e42987c257da944cc585b452c05b97 |
| https://raw.githubusercontent.com/... (topojson/world-atlas package.json, OpenXcom rulesets and source) | **OK**: 200 |

The npm registry is outside the proxy (it is in noProxy) and works, so the official data is obtainable as files committed into the repo.

Note for the game itself: the game must not load from unpkg or jsdelivr at runtime. Commit a pre-converted JSON instead, which is offline and has zero dependencies.

Tarball contents (world-atlas 2.0.2; Natural Earth 4.1.0; data public domain; packaging ISC © Mike Bostock):

| File | Bytes | gzip |
|---|---|---|
| land-110m.json | 55,207 | 21,014 |
| countries-110m.json | 107,761 | 39,028 |
| land-50m.json | 545,534 | 173,792 |
| countries-50m.json | 756,420 | 235,996 |
| land-10m.json | 3,086,715 | n/a |
| countries-10m.json | 3,661,071 | n/a |

Format (inspected):
- `{"type":"Topology","bbox":[-180,-85.609,180,83.645],"transform":{"scale":[0.0036000360003600037,0.0016925586033320111],"translate":[-180,-85.60903777459777]},"objects":{...},"arcs":[...]}`.
- Quantisation is 1e5: scale = 360/99999 for longitude and 169.25/99999 for latitude.
- land-110m: object `land` = one MultiPolygon, 130 arcs, 5,129 arc points; decodes to 125 polygons, 126 rings (1 hole), 5,123 points.
- countries-110m: objects `countries` (177 geometries; `id` = ISO 3166-1 numeric string; `properties.name`) and `land`; 595 arcs, 8,246 arc points; decodes to 285 polygons and 10,587 points.
- All 16 funding countries are present by name:

| Country | ISO numeric id |
|---|---|
| United States of America | 840 |
| Russia | 643 |
| United Kingdom | 826 |
| France | 250 |
| Germany | 276 |
| Italy | 380 |
| Spain | 724 |
| China | 156 |
| Japan | 392 |
| India | 356 |
| Brazil | 076 |
| Australia | 036 |
| Nigeria | 566 |
| South Africa | 710 |
| Egypt | 818 |
| Canada | 124 |

- Coordinates are spherical (degrees), and rings follow the d3 convention: exterior rings are clockwise in (lon east, lat north).
- **Antimeridian:** rings are NOT cut at ±180. They cross it with one-step jumps, for example Eurasia (-180,64.98)→(179.99,64.97), Fiji, and Wrangel.
- **Antarctica** is a single "polar ring" that runs around the coast from -180 to 178.28 and jumps back. It contains no pole points (minimum latitude -85.6).
- Both quirks are harmless on a 3D globe but must be handled on a flat map (C3).

Decoded outputs (my Node decoder, verified for closed rings, sane areas and visual renders):
- land110.json (2-decimal lon/lat): 76,238 B, 27,137 gz.
- land110_d1.json (1 decimal): 65,291 B, 20,047 gz.
- countries110.json: 160,282 B, 53,007 gz.
- Densifying to edges ≤ 2° gives 5,382 points (land) and 10,998 (countries).
- Recommendation: ship land at 1 decimal (about 20 KB gz) plus the 16 funding-country outlines (funding16.json, 8,005 B, 2,973 gz; 645 points).

### C2. TopoJSON arc decoding: exact algorithm (plain JS, Node script)
```js
// node topo2poly.mjs land-110m.json land 1 > land110.json
import { readFileSync } from 'node:fs';
const [,, file, objName, dec = '2'] = process.argv;
const topo = JSON.parse(readFileSync(file, 'utf8'));
// 1) decode each arc ONCE: delta-decoding + dequantisation
//    quantised arcs: first point absolute, every next point is a delta from the previous one
//    real = (cumulative_q) * scale + translate      (no transform => coordinates are already absolute)
const T = topo.transform;
const ARCS = topo.arcs.map(arc => { let x = 0, y = 0;
  return arc.map(([dx, dy]) => T
    ? (x += dx, y += dy, [x * T.scale[0] + T.translate[0], y * T.scale[1] + T.translate[1]])
    : [dx, dy]); });
// 2) a ring is a list of arc indices; negative index i means arc ~i (= -i-1) REVERSED;
//    consecutive arcs share an endpoint -> skip the first point of every arc after the first
function ring(idx) { const pts = [];
  for (const i of idx) { let a = ARCS[i < 0 ? ~i : i]; if (i < 0) a = a.slice().reverse();
    a.forEach((p, k) => { if (k === 0 && pts.length) return; pts.push(p); }); }
  return pts; }                                   // closed: last point == first point
// 3) geometry -> polygons ([outer, ...holes])
const geomToPolys = g => g.type === 'Polygon' ? [g.arcs.map(ring)]
  : g.type === 'MultiPolygon' ? g.arcs.map(p => p.map(ring)) : [];
const r = v => +v.toFixed(+dec);
const out = topo.objects[objName].geometries.map(g => ({ id: g.id, name: g.properties?.name,
  polys: geomToPolys(g).map(p => p.map(rg => rg.map(([x, y]) => [r(x), r(y)]))) }));
process.stdout.write(JSON.stringify(out));
```
(Shared arcs make borders consistent between neighbouring countries. Two refinements are worth knowing: OpenXcom-style "bigger" simplification should be done after decoding, and Visvalingam–Whyatt on cos(lat)-weighted triangle areas gives the best shapes for a small point count.)

### C3. Antimeridian and polar handling (tested; renders verified)
```js
// unwrap so consecutive longitudes differ by <180; a ring whose unwrapped net change is ±360 encircles a pole
function unwrapRing(r) { const o = [[r[0][0], r[0][1]]];
  for (let i = 1; i < r.length; i++) { let x = r[i][0]; const px = o[i-1][0];
    while (x - px > 180) x -= 360; while (x - px < -180) x += 360; o.push([x, r[i][1]]); } return o; }
function closeForPlanar(r) { const u = unwrapRing(r), net = u[u.length-1][0] - u[0][0];
  if (Math.abs(net) < 1) return u;                                  // ordinary ring
  const pole = u.reduce((a, p) => a + p[1], 0) / u.length < 0 ? -90 : 90;   // polar ring (Antarctica)
  const L = u[u.length-1], F = u[0]; return [...u, [L[0], pole], [F[0], pole], F]; }
// flat map: draw every polygon 3 times at lon offsets -360, 0, +360 and clip to the map rect
// point-in-polygon on these planar rings: test lon, lon-360, lon+360 (ray casting)
```

### C4. Fallback: 30 coarse land polygons (real data simplified with Visvalingam; 522 points, 6.1 KB)
- The rings are open (do not repeat the first point) and flat: [lon,lat,lon,lat,...].
- #2 (Antarctica) is a polar ring, so use `closeForPlanar` on a flat map. It needs no special case on the globe.
- Verified rendering: Mediterranean, Red Sea, Gulf, Hudson Bay and the British Isles are all recognisable.
```js
const COARSE_LAND = [
/*0 Afro-Eurasia*/[-178.7,66.1,170.3,59.9,163.5,59.9,156.8,51,155.4,55.4,163.7,61.1,142.2,59,135.1,54.7,141.4,53.1,134.9,43.4,127.5,39.8,126.5,34.4,124.3,39.9,117.5,38.7,122.1,29.8,115.9,22.8,108.5,21.7,105.7,19.1,109.2,11.7,105.1,9.9,100.1,13.4,99.1,10,103.4,4.8,103.5,1.2,98.1,8.3,97.2,16.9,91.4,22.8,87,21.5,80.3,15.9,77.5,8,72.6,21.4,66.4,25.4,54.7,26.5,48,30,51.8,24,59.8,22.3,57.8,19.1,43.5,12.6,42.6,16.8,35.1,28.1,32.7,28.7,39.3,15.9,44.1,10.4,51.1,12,46.6,2.9,40.3,-2.6,38.8,-6.5,40.8,-14.7,34.8,-19.8,35,-24.5,28.2,-32.8,19.6,-34.8,11.8,-18.1,13.6,-12,11.9,-5,8.8,-1.1,9.8,3.1,4.3,6.3,-7.5,4.3,-16.6,12.2,-17.1,21,-14.4,26.3,-5.9,35.8,9.5,37.4,11.1,33.3,19.1,30.3,20.9,32.7,34.3,31.2,36.1,35.8,27.6,36.7,26.2,39.5,41.4,42.6,30.8,46.6,28.8,41.1,15.4,40,8.9,44.4,3.1,43.1,-2.1,36.7,-8.9,36.9,-9.4,43,-1.9,43.4,-1.6,48.6,8.8,54,21.3,55.2,21.1,62.6,15.9,56.1,5,62,19.2,69.8,28.2,71.2,40.3,67.9,34.9,64.4,87.2,75.1,109.4,74.2,160.9,69.4,178.6,69.4],
/*1 Americas*/[-85.8,66.6,-93.2,62,-92.3,57.1,-82.3,55.1,-76.5,56.5,-78.1,62.3,-64.6,60.3,-55.7,52.1,-66.4,50.2,-64.5,46.2,-70.1,43.7,-75.7,35.5,-81.3,31.4,-81.2,25.2,-83.7,29.9,-94.7,29.5,-97.9,22.4,-94.4,18.1,-87.1,21.5,-88.9,15.9,-83.1,15,-81.4,8.8,-76.8,8.6,-71.4,11,-61.9,10.7,-57.1,6,-52.9,5.4,-48.6,-0.2,-35.2,-5.5,-35.1,-9,-38.9,-13.8,-42,-23,-46.5,-24.1,-48.9,-28.7,-56.8,-36.9,-67.6,-46.3,-65.6,-47.2,-71,-53.8,-74.9,-52.3,-75.6,-46.6,-71.4,-32.4,-70.4,-18.4,-76,-14.7,-81.4,-4.7,-80.1,0.8,-77.1,3.9,-80,7.5,-87.7,12.9,-94.7,16.2,-103.5,18.3,-106,22.8,-114.7,30.2,-109.4,23.4,-114.5,27.1,-117.3,33,-124.4,40.3,-123,49,-127.4,50.8,-134.1,58.1,-147.1,60.9,-157.7,57.6,-166.1,61.5,-160.8,64.8,-168.1,65.7,-156.6,71.4,-136.5,68.9,-128.1,70.5,-113.9,68.4],
/*2 Antarctica (polar ring)*/[-180,-84.7,-158.1,-85.4,-146.8,-79.9,-155.3,-79.1,-135.2,-74.3,-113.9,-73.7,-100.6,-75.3,-103.7,-72.6,-76.2,-74,-68.9,-73,-67.7,-67.3,-61.5,-71.1,-62,-74.4,-77.2,-76.7,-75.4,-80.3,-59.7,-82.4,-28.6,-80.3,-35.8,-78.3,-21.2,-75.9,-10.3,-71.3,-0.2,-71.6,9.5,-70,22.6,-70.7,40,-69.1,56.4,-66,62.4,-68,68.9,-67.9,68,-71.8,82.8,-67.2,99.7,-67.3,102.8,-65.6,106.2,-66.9,113.6,-65.9,120.9,-67.2,134.8,-66.2,145.5,-66.9,162.7,-70.7,171.2,-71.7,163.5,-77.1,159.8,-81,178.3,-84.5],
/*3 Australia*/[143.9,-14.6,145.4,-15,146.4,-19,148.9,-20.4,149.7,-22.3,152.9,-25.3,153.6,-28.1,152.9,-31.6,150,-37.4,146.3,-39,140.6,-38,139.6,-36.1,136,-34.9,134.3,-32.6,131.3,-31.5,126.1,-32.2,123.7,-33.9,119.9,-34,118,-35.1,115,-34.2,115.7,-31.6,114.2,-28.1,113.4,-24.4,114.1,-21.8,120.9,-19.7,123,-16.4,127.1,-13.8,128.4,-14.9,132.4,-11.1,137,-12.3,135.4,-14.7,140.2,-17.7,141.7,-15,142.5,-10.7],
/*4 Greenland*/[-20.9,82.7,-31.9,82.2,-12.2,81.3,-19.7,78.8,-19.4,74.3,-23.6,73.3,-21.8,70.7,-27.8,68.5,-39.8,65.5,-42.8,62.7,-43.4,60.1,-48.3,60.9,-51.6,63.6,-54,67.2,-54.7,72.6,-58.6,75.5,-68.5,76.1,-66.8,77.4,-73.2,78.4,-57.2,82.2,-35.1,83.7],
/*5 New Guinea*/[134.4,-2.8,138.3,-1.7,144.6,-3.9,148.7,-9.1,150.8,-10.3,147.9,-10.1,144.7,-7.6,142.6,-9.3,140.1,-8.3,137.6,-8.4,138.7,-7.3,137.9,-5.4,133.7,-3.5,130.5,-0.9,134,-0.8],
/*6 Borneo*/[119,0.9,117.8,0.8,116.6,-1.5,116.1,-4,114.9,-4.1,113.3,-3.1,112.1,-3.5,110.2,-2.9,109.1,-0.5,109.7,2,111.2,1.9,113,3.1,117.1,6.9,119.2,5.4,117.3,3.2],
/*7 Madagascar*/[50.1,-13.6,50.5,-15.2,49.4,-17.9,47.1,-24.9,45.4,-25.6,44,-25,43.3,-22.1,44.4,-20.1,44,-17.4,44.5,-16.2,46.3,-15.8,47.7,-14.6,48.8,-13.1,49.2,-12],
/*8 Baffin I.*/[-82.3,73.8,-68.8,70.5,-68.8,68.7,-61.9,66.9,-65.3,64.4,-66.2,61.9,-68.9,62.3,-77.9,65.3,-74,65.5,-72.6,67.3,-79,70.2,-88.7,70.4,-88.4,73.5],
/*9 Sumatra*/[105.8,-5.8,104.7,-5.9,102.6,-4.2,98.6,1.8,95.4,5,95.3,5.5,97.5,5.3,100.6,2.1,101.7,2.1,103.8,0.1,104.4,-1.1,104.9,-2.3,106.1,-3.1],
/*10 Honshu*/[140.8,35.8,135.8,33.5,135.1,34.6,131,33.9,131.3,31.4,129.4,33.3,132.6,35.4,135.7,35.5,139.4,38.2,140.3,41.2,141.9,39.2],
/*11 Great Britain*/[-2,57.7,-2.1,55.9,0.5,52.9,1.7,52.7,0.5,50.8,-5.8,50.2,-4.3,51.2,-4.6,53.5,-3.6,54.6,-6.1,56.8,-5,58.6],
/*12 Victoria I.*/[-108.4,73.1,-105.4,72.7,-104.5,71,-101,70,-102.4,68.8,-106,69.2,-113.3,68.5,-117.3,70,-112.4,70.4,-117.9,70.5,-117.9,72.7],
/*13 Ellesmere I.*/[-61.9,82.4,-71.2,79.8,-76.9,79.3,-75.4,78.5,-80.6,76.2,-89.5,76.5,-88,78.4,-85.1,79.3,-91.6,81.9,-85.5,82.7,-72.8,83.2],
/*14 Sulawesi*/[124.4,0.4,120.2,0.2,123.2,-4.7,121.7,-4.8,120.3,-2.9,120.4,-5.5,119.4,-5.4,118.8,-2.8,120,0.6,120.9,1.3],
/*15 NZ South I.*/[174.3,-41.8,172.7,-43.4,173.1,-43.9,171.5,-44.2,170.6,-45.9,169.3,-46.6,166.7,-46.2,167,-45.1,170.5,-43,172.8,-40.5],
/*16 Java*/[108.6,-6.8,110.8,-6.5,112.6,-7,113,-7.6,115.7,-8.4,114.6,-8.8,108.3,-7.8,105.4,-6.8,106,-5.9,107.3,-6],
/*17 Newfoundland*/[-56.8,49.8,-53.5,49.3,-52.6,47.5,-53.1,46.7,-54.2,46.8,-54.2,47.8,-59.3,47.6,-58.4,49.1,-56.7,51.3,-55.4,51.6],
/*18 NZ North I.*/[175.3,-37.2,177.4,-38,178.5,-37.7,177.2,-39.1,176,-41.3,173.8,-39.5,174.6,-38.8,174.3,-36.5,172.6,-34.5,174.3,-35.3],
/*19 Luzon*/[122.5,17.1,121.7,15.9,121.7,14.3,124,13.8,124.1,12.5,122.9,13.6,120.6,13.9,120.1,15,120.7,18.5],
/*20 Cuba*/[-78.4,22.5,-76.5,21.2,-74.2,20.3,-77.8,19.9,-77.1,20.4,-78.7,21.6,-81.8,22.2,-82.8,22.7,-82.3,23.2],
/*21 Iceland*/[-14.5,66.5,-13.6,65.1,-14.9,64.4,-18.7,63.5,-22.8,64,-21.8,64.4,-24.3,65.6,-22.1,66.4,-20.6,65.7],
/*22 Mindanao*/[126.5,7.2,125.8,7.3,125.4,5.6,124.2,6.2,123.6,7.8,122.1,6.9,122.3,8,123.8,8.2,126.2,9.3],
/*23 Hokkaido*/[145.5,43.3,144.1,43,143.2,42,141.6,42.7,141.1,41.6,140,41.6,140.3,43.3,141.4,43.4,142,45.5],
/*24 Tierra del Fuego*/[-67.8,-53.9,-65.1,-54.7,-67,-54.9,-68.1,-55.6,-71,-55,-74.7,-52.8,-71.1,-54.1,-70.3,-52.9,-68.6,-52.6],
/*25 Novaya Zemlya*/[57.5,70.7,53.7,70.8,51.6,71.5,55.6,75.1,61.2,76.3,68.2,76.9,68.2,76.2,58.5,74.3,55.4,72.4],
/*26 Sakhalin*/[144.6,49,143.2,49.3,142.6,47.9,143.5,46.8,142.1,46,141.9,48.9,142.2,51,141.7,53.3,142.6,53.8],
/*27 Hispaniola*/[-70.8,19.9,-69.2,19.3,-68.3,18.6,-69.9,18.4,-71.7,18,-73.4,18.2,-74.4,18.7,-72.3,18.7,-73.2,19.9],
/*28 Banks I.*/[-120.5,71.4,-123.1,70.9,-125.9,71.9,-123.9,73.7,-124.9,74.3,-121.5,74.5,-117.6,74.2,-115.5,73.5,-119.2,72.5],
/*29 Ireland*/[-6.8,52.3,-8.6,51.7,-10,51.8,-9.2,52.9,-9.7,53.9,-7.6,55.1,-6.7,55.2,-5.7,54.6,-6,53.1],
];
```

### C5. The 16 X-COM funding countries
Source: OpenXcom `xcom1/countries.rul` and `regions.rul`.
- OpenXcom stores longitude as 0..360 east and **latitude with NEGATIVE = NORTH**. The values below are converted to the normal convention (lon −180..180 east+, lat north+). Area rectangles are [lonW, lonE, latS, latN].
- Membership is rectangle-based (country and region area lists). Countries and regions are independent sets: a point can be in a country rectangle and in some region rectangle. Russia's area spans the Europe and Siberia regions.
- The "region" column is the X-COM region containing the capital; Russia's OXC label point falls in Siberia.

| Country (pt-PT) | Capital, lat/lon | X-COM region | OXC label (lat, lon) | fundingBase / fundingCap | OXC areas [lonW,lonE,latS,latN] |
|---|---|---|---|---|---|
| EUA | Washington 38.90, −77.04 | North America | 40, −100 | 600 / 10000 | [−125,−105,32,49] [−105,−82.5,29,49] [−100,−95,26,29] [−83,−80,25,32] [−82.5,−74,32,44] [−74,−67.5,40,45.5] |
| Rússia | Moscow 55.76, 37.62 | Europe (capital) / Siberia (label) | 60, 60 | 230 / 8000 | [30,50,45,70] [24,30,42,60] [50,75,40,77] [75,165,50,80] [165,170,59,70] |
| Reino Unido | London 51.51, −0.13 | Europe | 53.625, −2 | 240 / 7000 | [−8,2,50,60] |
| França | Paris 48.86, 2.35 | Europe | 46.5, 2.5 | 320 / 8000 | [−5,7,43,50] |
| Alemanha | Berlin 52.52, 13.40 (Bonn was the seat of government until 1999) | Europe | 50, 11.5 | 250 / 9000 | [6,15,47.5,55] |
| Itália | Rome 41.90, 12.50 | Europe | 43.875, 12.5 | 160 / 6000 | [7,15,43,46.5] [11,18,37,43] |
| Espanha | Madrid 40.42, −3.70 | Europe | 42.625, −2.5 | 140 / 5000 | [−7,3,36.5,43] [−9,−7,42.25,43] |
| China | Beijing 39.90, 116.40 | South East Asia | 35, 100 | 245 / 7000 | [75,98,30,50] [98,122,22,50] [122,133,40,54] |
| Japão | Tokyo 35.68, 139.69 | South East Asia | 38.25, 138 | 400 / 10000 | [130,143,30,40] [138,147,40,46] |
| Índia | New Delhi 28.61, 77.21 | Central Asia | 24, 80 | 150 / 5000 | [70,85,8,30] [74,79,30,35] [85,95,20,27] |
| Brasil | Brasília −15.79, −47.88 | South America | −5, −55 | 300 / 4000 | [−70,−58,−17,2.5] [−58,−50,−22,2.5] [−50,−35,−24,0] [−55,−47,−32,−22] |
| Austrália | Canberra −35.28, 149.13 | Australasia | −25, 135 | 280 / 5000 | [110,156,−40,−10] |
| Nigéria | Abuja 9.08, 7.40 | North Africa | 10, 7.5 | 180 / 2000 | [3,14,4,14] |
| África do Sul | Pretoria −25.75, 28.19 | Southern Africa | −30, 25 | 230 / 3000 | [15,25,−35,−26] [25,32.5,−35,−22] |
| Egito | Cairo 30.04, 31.24 | North Africa | 26, 29 | 230 / 2000 | [25,35,22,32] |
| Canadá | Ottawa 45.42, −75.70 | North America | 55, −100 | 230 / 4000 | [−141,−130,55,70] [−130,−55,40,75] |

The 15 X-COM regions, with OXC base cost and OXC regionWeight, converted to normal lon/lat:

| Region | Base cost | Weight | Rectangles [lonW, lonE, latS, latN] |
|---|---|---|---|
| North America | 800,000 | 18 | [−165,−55,55,70] [−130,−55,30,55] [−120,−60,10,30] |
| Arctic | 950,000 | 4 | all longitudes, 70..90 |
| Antarctica | 900,000 | 4 | all longitudes, −90..−60 |
| South America | 600,000 | 10 | [−90,−45,0,10] [−85,−30,−15,0] [−85,−35,−60,−15] |
| Europe | 1,000,000 | 16 | [−25,60,35,70] |
| North Africa | 650,000 | 12 | [−25,40,15,35] [−25,55,0,15] |
| Southern Africa | 550,000 | 8 | [5,55,−40,0] |
| Central Asia | 500,000 | 12 | [40,70,15,35] [60,90,35,50] [70,90,5,35] |
| South East Asia | 750,000 | 15 | [90,105,−10,50] [105,150,5,50] |
| Siberia | 800,000 | 10 | [60,180,50,70] |
| Australasia | 750,000 | 10 | [105,180,−60,5] |
| Pacific | 600,000 | 5 | lon 180→−165..−85 bands plus [150,180,5,50] |
| North Atlantic | 500,000 | — | [−55,−25,30,70] [−60,−25,10,30] [−45,−25,0,10]; missions handled by North America |
| South Atlantic | 500,000 | — | [−30,5,−15,0] [−35,5,−60,−15] [5,55,−60,−40]; missions handled by Antarctica |
| Indian Ocean | 500,000 | — | [55,70,−10,15] [70,90,−10,5] [55,105,−60,−10]; missions handled by Southern Africa |

Rectangle test with wrap:
```js
function inRect(lon, lat, [w, e, s, n]) { const inLon = w === e ? true : w < e ? (lon >= w && lon < e) : (lon >= w || lon < e);
  return inLon && lat >= s && lat < n; }
```

Recommendation: gameplay uses these rectangles (faithful to how funding and mission placement work). The visuals use the Natural Earth outlines (funding16.json) for hover highlight, with the label at the OXC label point.

---

## PART D: Globe rendering

### D1. Orthographic projection (OpenXcom `Globe::polarToCart` / `cartToPolar` use the same formulas)
- Forward:
  - `x = cx + R·cosφ·sin(λ−λ0)`
  - `y = cy − R·(cosφ0·sinφ − sinφ0·cosφ·cos(λ−λ0))`
  - visible iff `cos c = sinφ0·sinφ + cosφ0·cosφ·cos(λ−λ0) > 0` (back-face culling)
- Inverse: `ρ = hypot(x,y)/R` (miss if > 1), `c = asin ρ`; `φ = asin(cos c·sinφ0 + y·sin c·cosφ0/ρ)`; `λ = λ0 + atan2(x·sin c, ρ·cosφ0·cos c − y·sinφ0·sin c)`.
- Fast form: precompute unit vectors `v=[cosφcosλ, cosφsinλ, sinφ]` at load. Each frame, build the camera basis `e=[−sinλ0, cosλ0, 0]`, `n=[−sinφ0cosλ0, −sinφ0sinλ0, cosφ0]`, `c=[cosφ0cosλ0, cosφ0sinλ0, sinφ0]`. Then `x = cx + R·v·e`, `y = cy − R·v·n`, `z = v·c` (9 multiplies per point, no trig).
```js
const D2R = Math.PI / 180, wrap180 = l => ((l + 540) % 360) - 180;
function makeOrtho(lon0, lat0, R, cx, cy) {
  const l0 = lon0 * D2R, p0 = lat0 * D2R, sp0 = Math.sin(p0), cp0 = Math.cos(p0);
  return {
    fwd(lon, lat) { const l = lon * D2R, p = lat * D2R, cp = Math.cos(p), sp = Math.sin(p), dl = l - l0, cdl = Math.cos(dl);
      return { x: cx + R * cp * Math.sin(dl), y: cy - R * (cp0 * sp - sp0 * cp * cdl), z: sp0 * sp + cp0 * cp * cdl }; },
    inv(sx, sy) { const x = (sx - cx) / R, y = (cy - sy) / R, rho = Math.hypot(x, y);
      if (rho > 1) return null; if (rho < 1e-12) return { lon: lon0, lat: lat0 };
      const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
      return { lat: Math.asin(cc * sp0 + y * sc * cp0 / rho) / D2R,
               lon: wrap180((l0 + Math.atan2(x * sc, rho * cp0 * cc - y * sp0 * sc)) / D2R) }; } };
}
```

### D2. Filling land correctly on the sphere (tested; renders verified for Pacific, Europe, South Pole, Asia and South Atlantic views)
- The naive approach (project and fill) fails for polygons that cross the horizon.
- The "limb-collapse" trick (push back-side points onto the rim) works only when the polygon does not contain the **antipode of the view centre**; otherwise the fill inverts.
- Fix: count, per polygon, how many of its rings contain the antipode (planar PIP on the `closeForPlanar` rings). If the count is odd, add the full rim circle as an extra subpath and fill with `evenodd`.
- Densify edges to ≤ 2° once at load.
```js
function drawLand(ctx, polys, proj, R, cx, cy, lon0, lat0) {   // polys: [{rings:[{dense,planar}]}]
  const aLon = wrap180(lon0 + 180), aLat = -lat0;
  for (const poly of polys) {
    let anyVis = false, parity = 0; ctx.beginPath();
    for (const ring of poly.rings) {
      ring.dense.forEach(([lo, la], i) => { const p = proj.fwd(lo, la); let X = p.x, Y = p.y;
        if (p.z > 0) anyVis = true;
        else { const dx = X - cx, dy = Y - cy, d = Math.hypot(dx, dy) || 1; X = cx + dx * R / d; Y = cy + dy * R / d; }
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
      if (pipPlanar(ring.planar, aLon, aLat)) parity ^= 1;
    }
    if (!anyVis) continue;
    if (parity) { ctx.moveTo(cx + R, cy); ctx.arc(cx, cy, R, 0, 2 * Math.PI); }
    ctx.fill('evenodd');
  }
}
function pipPlanar(ring, lon, lat) { for (const L of [lon, lon - 360, lon + 360]) { let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && L < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins; }
  if (ins) return true; } return false; }
```
- Why this works: limb-collapse is continuous on the sphere minus the antipode, so the filled region is always the side of the ring that does not contain the antipode. Adding one full rim loop flips the parity.
- Coastlines, borders, graticule, radar and paths are drawn as strokes: draw only segments with both ends at `z>0`, and break the pen otherwise (or interpolate the crossing in 3D with `t = zA/(zA−zB)`).
- Culling: precompute each polygon's centroid vector and angular radius. Skip it if the angular distance to the view centre exceeds 90° plus that radius.
- Cost: about 5.4k points (land) or 11k (countries) per redraw is trivial. Redraw only on rotate, zoom or a time tick, and cache the globe in an offscreen canvas while static.

### D3. Great-circle paths, radar circles, day/night
```js
const vec = (lon, lat) => { const l = lon*D2R, p = lat*D2R; return [Math.cos(p)*Math.cos(l), Math.cos(p)*Math.sin(l), Math.sin(p)]; };
const toLL = v => ({ lon: Math.atan2(v[1], v[0]) / D2R, lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R });
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
function slerp(a, b, t) { const w = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))); if (w < 1e-9) return a.slice();
  const s = Math.sin(w), k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s;
  return [a[0]*k1 + b[0]*k2, a[1]*k1 + b[1]*k2, a[2]*k1 + b[2]*k2]; }
// constant-speed movement: speed in knots (nm/h); 1 nm = 1 arc-minute
function step(a, b, knots, dtHours) { const ang = knots * dtHours / 60 * D2R, d = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  return d <= ang ? b.slice() : slerp(a, b, ang / d); }
const distNm = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / D2R * 60;
// small circle (radar) of angular radius rho around (lat, lon), N points; same formula as OpenXcom drawGlobeCircle
function smallCircle(lat, lon, rhoDeg, N = 48) { const p = lat*D2R, l = lon*D2R, r = rhoDeg*D2R, pts = [];
  for (let i = 0; i <= N; i++) { const az = i / N * 2 * Math.PI;
    const p1 = Math.asin(Math.sin(p)*Math.cos(r) + Math.cos(p)*Math.sin(r)*Math.cos(az));
    const l1 = l + Math.atan2(Math.sin(az)*Math.sin(r)*Math.cos(p), Math.cos(r) - Math.sin(p)*Math.sin(p1));
    pts.push([wrap180(l1 / D2R), p1 / D2R]); } return pts; }
```
- OpenXcom draws paths by stepping the 3D chord and renormalising. The number of steps is `|b−a|²·15 + 1`, and segments are drawn only when both ends are visible.
- Radar ranges come from OpenXcom `facilities.rul`, expressed in nm, where degrees = nm/60:

| Facility | Range | Angular radius | Detection chance |
|---|---|---|---|
| Small radar | 1695 nm | 28.25° | 10% |
| Large radar | 2577 nm | 42.95° | 20% |
| Hyper-wave decoder | 2759 nm | 45.98° | 100% |

  Draw radar as a 48-segment dashed stroke. An optional translucent fill uses the D2 fill with the parity rule "antipode inside circle iff angular distance(centre, antipode) < ρ".
- Day/night:
  - Subsolar point lon = (12 − UTC hours)·15°.
  - lat = declination δ ≈ −23.44°·cos(2π(N+10)/365). OpenXcom's default `globeSeasons=false` means δ = 0.
  - Night is the small circle of radius 90° around the antisolar point. Fill it with rgba(0,0,40,0.55) using the D2 method.
  - Add twilight rings at 84° and 96° with alpha 0.2 each.
  - Add ocean shading with a radial gradient whose centre is offset toward the light, plus limb darkening.
- OpenXcom globe zoom:
  - Six levels; radius = {0.45, 0.60, 0.90, 1.40, 2.25, 3.60} × globe-area height.
  - DOGFIGHT_ZOOM = 3 (auto zoom-in when an interception starts).
  - Smooth zoom step = (r[3]−r[0])/10 per tick.
  - Rotate timer 10 ms with ROTATE_LONGITUDE 0.10 / ROTATE_LATITUDE 0.06, scaled by (110−geoScrollSpeed)/100/(zoom+1); geoScrollSpeed defaults to 20.

### D4. Flat equirectangular alternative
- Projection: `x = (wrap180(λ−λc)+180)/360·W`, `y = (90−φ)/180·H`. Draw each polygon at offsets −360/0/+360 after `closeForPlanar`; this is tested and renders correctly, including Chukotka and Antarctica.
- Pros: the whole world is visible, picking is trivial, nothing is hidden on a back side.
- Cons: the Arctic, Antarctica and Siberia are hugely stretched; radar circles become distorted ovals; great circles curve; it looks much less like X-COM.

### D5. Recommendation: orthographic globe
It is the iconic X-COM geoscape, it has no polar distortion, and radar circles and flight paths read correctly. It is also excellent on a trackpad:
- Two-finger scroll rotates: Δλ = −dx/R rad, Δφ = +dy/R rad, with φ0 clamped to ±89°.
- Pinch zooms smoothly through the six OpenXcom levels.
- Arrow keys rotate; +/- zoom.
- Click selects; secondary click or double-click centres the globe on that point (X-COM: right-click centres).

Supplementary pieces:
- Keep a small flat overview inset showing all blips, or an "M" toggle to a full flat map, for situational awareness only.
- Use the D2 parity fill for land, night and radar fills, and stroke-only clipping for lines.
- Cache the globe bitmap when static.
- Time ticks of 5 s, 1 min or 5 min of game time move the terminator by 0.02°, 0.25° and 1.25° respectively, so redraw at most a few times per second.

---

## Files produced (all under the scratchpad)
- Downloads, in new directories:
  - `scratchpad/worldmap/dl-curltest/` (npm tarball and GitHub package.json)
  - `scratchpad/worldmap/dl-extract/package/` (world-atlas JSONs)
  - `scratchpad/worldmap/dl-oxc/` (countries.rul, regions.rul)
  - `scratchpad/worldmap/dl-oxcsrc/` (OpenXcom sources and rulesets, read only for facts)
- Outputs:
  - `scratchpad/worldmap/dl-out/land110.json`
  - `scratchpad/worldmap/dl-out/land110_d1.json`
  - `scratchpad/worldmap/dl-out/countries110.json`
  - `scratchpad/worldmap/dl-out/coarse30b.json`
  - `scratchpad/worldmap/dl-out/coarse30b.js`
  - `scratchpad/worldmap/dl-out/funding16.json`
  - Verification renders: `scratchpad/worldmap/dl-out/globe_test.png`, `scratchpad/worldmap/dl-out/flat_test.png`, `scratchpad/worldmap/dl-out/flat_coarse_b.png`
- Scripts (Node; each takes the data path as an argument):
  - `scratchpad/scripts-c/topo2poly.mjs` (decoder)
  - `scratchpad/scripts-c/coarse.mjs` (Visvalingam simplifier)
  - `scratchpad/scripts-c/funding.mjs`
  - `scratchpad/scripts-c/globe_raster.mjs` (validates the D2 algorithm)
  - `scratchpad/scripts-c/flat_raster.mjs`
  - `scratchpad/scripts-c/regions.mjs`
  - `scratchpad/scripts-c/stats.mjs`

Sources for the web search on Safari pinch handling:
- [DEV: Pinch me, I'm zooming](https://dev.to/danburzo/pinch-me-i-m-zooming-gestures-in-the-dom-a0e)
- [antvis X6 Safari pinch issue](https://lightrun.com/answers/antvis-x6-mousewheel-settings-not-working-in-safari-browser-when-pinch-zoom-is-performed-on-touchpad)
- [Drupal ctrl-wheel pinch issue](https://www.drupal.org/project/experience_builder/issues/3475749)
- [tldraw useGestureEvents](https://unpkg.com/@tldraw/editor@5.0.1/src/lib/hooks/useGestureEvents.ts)

## KEY NUMBERS
X-COM iso tile: floor diamond 32x16 px, level height 24 px, sprite 32x40 (OpenXcom Camera.cpp: sx=(x-y)*16, sy=(x+y)*8 - z*24) (verified)
Voxel grid per tile: 16x16x24 (Camera::convertVoxelToScreen) (verified)
Recommended browser scale: TW=64, TH=32, LH=48 (2x X-COM) (design choice)
screenToTile: a=wx/(TW/2), b=(wy+z*LH)/(TH/2), x=floor((a+b)/2), y=floor((b-a)/2) (derived, verified algebraically)
Lighting: shade=max(0,15-max(layer lights)); sun power=15-globalShade (-2 under roof when globalShade<=4); addLight falloff power-round(dist2D), all z, no occlusion; fire 15, player personal light 15 (verified TileEngine.cpp/Tile.cpp)
Path preview colours: green=reachable+reserve kept, yellow=reachable but reserve lost, red=insufficient TU/energy; reserve None evaluated as Auto shot; kneeling adds 8 TU to stand (verified Pathfinding.cpp)
TU: diagonal x1.5, kneel 4, stand 8, turn 1 per 45 deg, fly vertical 8; running x0.75 TU, x1.5 energy; energy use = TU/2 (verified OpenXcom)
Fire-menu accuracy = firing*modeAcc/100, x1.15 kneeling, x0.8 two-handed with both hands full, x health modifier (verified BattleUnit.cpp)
OpenXcom defaults: battleXcomSpeed=30, battleAlienSpeed=30, battleFireSpeed=6, battleScrollSpeed=8, SCROLL_BORDER=5px, SCROLL_DIAGONAL_EDGE=60px, drag tolerance 300ms/10px, path preview off (verified)
OpenXcom keys: Tab next, LShift prev, PgUp/PgDn level, Home center, K kneel, Backspace end turn, F1-F4 reserve, 1-0 center enemy, I inv, M map, R reload, L light (verified Options.cpp)
unpkg.com and cdn.jsdelivr.net: 403 (proxy policy) (verified)
registry.npmjs.org world-atlas-2.0.2.tgz: 200, 2,277,546 B (verified)
land-110m.json 55,207 B (21,014 gz); countries-110m.json 107,761 B (39,028 gz); land-50m 545,534; countries-50m 756,420 (verified)
TopoJSON quantisation 1e5: scale lon 0.0036000360003600037, translate [-180,-85.609] (verified)
land-110m decodes to 125 polygons / 126 rings / 5,123 pts; countries-110m to 177 features / 285 polygons / 10,587 pts (verified)
Decoded land 1-decimal JSON: 65,291 B / 20,047 gz; funding16 outlines 8,005 B / 2,973 gz; coarse 30 polygons 522 pts / 6.1 KB (verified)
OpenXcom globe zoom radii = {0.45,0.60,0.90,1.40,2.25,3.60} x globe height; DOGFIGHT_ZOOM=3 (verified Globe.cpp)
Radar ranges (OpenXcom facilities.rul): small 1695 nm (28.25 deg, 10%), large 2577 nm (42.95 deg, 20%), hyperwave 2759 nm (45.98 deg, 100%) (verified ruleset)
Nautical(): 1 nm = 1 arcminute => deg = nm/60 (verified fmath.h)
Orthographic: x=R cos(phi) sin(lam-lam0), y=R(cos(phi0) sin(phi) - sin(phi0) cos(phi) cos(lam-lam0)), visible iff cos c = sin(phi0) sin(phi) + cos(phi0) cos(phi) cos(lam-lam0) > 0 (verified, same as OpenXcom)
Globe fill fix: limb-collapse + evenodd + extra rim circle when antipode is inside an odd number of rings (tested on 5 views)
Funding countries fundingBase/cap (OpenXcom): USA 600/10000, Russia 230/8000, UK 240/7000, France 320/8000, Germany 250/9000, Italy 160/6000, Spain 140/5000, China 245/7000, Japan 400/10000, India 150/5000, Brazil 300/4000, Australia 280/5000, Nigeria 180/2000, South Africa 230/3000, Egypt 230/2000, Canada 230/4000 (verified ruleset values; units uncertain)

## UNCERTAIN
UFOpaedia was unreachable (www.ufopaedia.org fails DNS resolution in this sandbox's network policy), so nothing was cross-checked there; all game facts come from OpenXcom source and rulesets.
Whether OpenXcom fundingBase is in thousands of dollars and how initial funding is randomised (believed to be RNG(base, 2*base)*1000), not verified.
Region 'cost' in regions.rul is assumed to be the base construction cost per region; not cross-checked against the original game.
In-game displayed radar ranges (UFOpaedia figures such as 300/450 nm) versus ruleset detection ranges (1695/2577/2759 nm): only the ruleset values were verified.
Safari behaviour for trackpad pinch: GestureEvent (gesturestart/gesturechange with e.scale) is Safari-only; whether current Safari also emits ctrl+wheel for pinch is unconfirmed. Handle both and guard against double zoom, then test on the target macOS.
On Mac, whether ctrl+click mousedown reports button 0 with ctrlKey or button 2 differs by browser; treat both, plus contextmenu, as the secondary action.
Heuristic for telling mouse-wheel notches from trackpad scroll (integer deltaY >= 100, deltaX == 0, or deltaMode 1) is not reliable on every device.
Whether wheel preventDefault plus overscroll-behavior fully suppresses two-finger swipe-back navigation in Safari (very likely in Chrome).
ctx.filter support in Safari: avoided, so not critical.
OpenXcom walk animation: 8 phases x 30 ms per tile (~240 ms) is inferred from calculateWalkingOffset (endphase 8 or 16); the exact diagonal/vertical phase counts were not verified.
OpenXcom globe rotation speed: the constants were verified, but the effective deg/s depends on the engine frame rate.
Original X-COM 1994 HUD button list (e.g. whether a 'show all layers' button exists) and inventory TU costs per slot move were recalled, not verified.
Typical X-COM battlescape map sizes (40x40 to 60x60, 4 levels) were recalled, not verified.
Modern XCOM end-turn confirmation prompt and Xenonauts UI details (hit % over target, TU at cursor) are from memory, not verified.
Germany's capital in the 1999 game timeline: Berlin was the official capital from 1990, while Bonn remained the seat of government until 1999; choose either for display.
Day/night declination formula (-23.44 deg * cos(2pi(N+10)/365)) is the standard approximation; OpenXcom's own seasonal formula (-0.261*sin(2pi*CurDay)) is different and is disabled by default.