/* Matemática isométrica 2:1 com níveis. cam = {x, y, zoom}: posição do mundo (px a zoom 1) no canto sup. esq. */
(function (OV) {
  'use strict';

  const TW = 64, TH = 32, LH = 48, HW = TW / 2, HH = TH / 2;

  // canto superior do losango do tile (x,y,z) em px de ecrã (CSS)
  function tileToScreen(x, y, z, cam) {
    const wx = (x - y) * HW, wy = (x + y) * HH - z * LH;
    return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
  }
  // centro do losango (onde assentam unidades e objetos)
  function tileCenter(x, y, z, cam) {
    const p = tileToScreen(x, y, z, cam);
    p.y += HH * cam.zoom;
    return p;
  }
  // ponto de ecrã → tile no nível z (floats; usar Math.floor)
  function screenToTileF(px, py, z, cam) {
    const wx = px / cam.zoom + cam.x;
    const wy = py / cam.zoom + cam.y + z * LH;
    return { x: (wy / HH + wx / HW) / 2, y: (wy / HH - wx / HW) / 2 };
  }
  function screenToTile(px, py, z, cam) {
    const f = screenToTileF(px, py, z, cam);
    return { x: Math.floor(f.x), y: Math.floor(f.y), z };
  }
  // voxel (16×16×24 por tile) → ecrã; vx/vy/vz em voxels absolutos
  function voxelToScreen(vx, vy, vz, cam) {
    const tx = vx / 16, ty = vy / 16, tz = vz / 24;
    const wx = (tx - ty) * HW, wy = (tx + ty) * HH - tz * LH;
    return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
  }
  // zoom mantendo fixo o ponto de ecrã (px, py)
  function zoomAt(cam, px, py, newZoom) {
    const wx = px / cam.zoom + cam.x, wy = py / cam.zoom + cam.y;
    cam.zoom = newZoom;
    cam.x = wx - px / newZoom;
    cam.y = wy - py / newZoom;
  }
  // limites do mapa em px de mundo (para prender a câmara)
  function mapBounds(w, h, d) {
    return { x0: -h * HW - TW, x1: w * HW + TW, y0: -(d - 1) * LH - TH * 2, y1: (w + h) * HH + TH * 2 };
  }
  // centra a câmara no tile
  function centerOn(cam, x, y, z, viewW, viewH) {
    const wx = (x - y) * HW, wy = (x + y) * HH - z * LH + HH;
    cam.x = wx - viewW / 2 / cam.zoom;
    cam.y = wy - viewH / 2 / cam.zoom;
  }

  OV.Iso = { TW, TH, LH, HW, HH, tileToScreen, tileCenter, screenToTile, screenToTileF, voxelToScreen, zoomAt, mapBounds, centerOn };
})(globalThis.OV || (globalThis.OV = {}));
