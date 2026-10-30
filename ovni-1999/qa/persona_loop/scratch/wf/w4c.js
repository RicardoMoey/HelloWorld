export const meta = {
  name: 'ovni-w4-globe-baseart',
  description: 'OVNI 1999 wave 4 stage 2C: Geoscape globe renderer and Basescape facility art',
  phases: [{ title: 'Globo e base', detail: 'globe_render ‖ base_render' }],
}
const SP = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
const SHARED = `
You are a senior engineer on "OVNI: Inimigo Desconhecido" (repo /home/user/HelloWorld/ovni-1999), a faithful browser reverse-engineering of UFO: Enemy Unknown (1994) — vanilla JS classic-script IIFEs on global OV, Canvas 2D + DOM overlay, zero deps, no build, pt-PT European UI, Mac-first (trackpad + keyboard; also mouse and iPad touch). User brief: «capricha na jogabilidade» — gameplay feel and polish are the top priority; the campaign must be fun in a 2–4 h arc (DESIGN §14).
State: waves 1–3 done (rules data js/data/*, full battlescape engine js/sim/battle/*, renderer, presenter, battle HUD, inventory/equip screen, menus/briefing/debrief/options in js/ui/screens.js, audio, sprites). Wave 4 stage 1 done: the BINDING campaign contract ovni-1999/docs/CAMPAIGN_API.md, js/sim/geo/clock.js, js/sim/geo/gmath.js, OV.Campaign.newCampaign + shared helpers in js/sim/campaign.js. Stage-1 engineer reports (read them): ${SP}/wave4_stage1_reports.md.
READ FIRST: ovni-1999/CONVENTIONS.md (binding); docs/CAMPAIGN_API.md IN FULL (binding; overrides DESIGN where they differ); DESIGN.md §3.1, §3.13–§3.19, §5.3, §6, §12–§14, §18, §19; docs/DATA_API.md; docs/rea/02-geoscape.md. Read the real code you integrate with fully.
Five other engineers work IN PARALLEL in the same tree right now (world/missions, base/economy/soldiers/dogfight, campaign/save, Ufopaedia, globe renderer, base art). Hard rules:
- Create/modify ONLY the files you own (listed in your task); placeholders exist (Read then overwrite). Never edit index.html (load order fixed; ask in open_issues). Never run git (I commit).
- Layer rule R1: js/core, js/i18n, js/data, js/sim run in Node with no DOM, no Math.random/performance/rAF, no presentation globals; all randomness through the G.rng streams as the contract says. Integer arithmetic for rules. G is plain JSON.
- Player text only via OV.T keys; sim emits keys/ids, never prose.
- Node suite must stay green: node /home/user/HelloWorld/ovni-1999/tools/test.js --strict (other engineers' in-progress files may break it transiently — distinguish and report). Add tests in tools/tests/<area>_*.test.js (new files you create are yours).
- If you run a browser: python3 -m http.server on a RANDOM free port (not 8000/8001/8765), kill it when done; outputs outside the repo under ${SP}/ui4/.
- The container has 4 CPUs shared by 6 agents: avoid needlessly long CPU-heavy loops; keep sim tests fast (< 10 s per file).
- No TODOs/stubs. Comment sparingly in Portuguese.
Return the structured summary with the exact public API you expose.`
const RESULT = {
  type: 'object',
  properties: {
    files_written: { type: 'array', items: { type: 'string' } },
    tests: { type: 'object', properties: { passed: { type: 'number' }, failed: { type: 'number' } }, required: ['passed', 'failed'] },
    api: { type: 'string' }, summary: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['files_written', 'tests', 'api', 'summary', 'screenshots', 'deviations', 'open_issues'],
}
phase('Globo e base')
const [globe, baseart] = await parallel([
  () => agent(`${SHARED}
YOUR TASK — Geoscape globe renderer (owner of: js/gfx/globe_render.js, qa/globe_check.mjs, qa/globe_check.html (optional harness)).
Implement OV.GlobeRender per DESIGN §12 + docs/rea/05-isometrico-e-globo.md + the contract: draw(ctx, G, view) with view = {lon, lat, zoom index 0..5 (radii 0.45/0.60/0.90/1.40/2.25/3.60 × height), w, h, dpr, time, selection, hover, highlights, mode:'normal'|'placeBase'|'target'}, pick(view, px, py) → {lon,lat}|null, objectAt(G, view, px, py) → {kind:'ufo'|'site'|'base'|'craft'|'alienBase'|'city', id}|null, project(view, lon, lat) → {x,y,front}, animation helpers (rotateTo(view, lon, lat, ms), zoomTo). Make it gorgeous and readable — X-COM 1994 mood modernised: orthographic globe with the Natural Earth land from OV.Data.world (limb-collapse + antipode-parity evenodd fill, front-only strokes, densify ≤ 2°, precomputed unit vectors), ocean radial gradient lit toward the sun, limb darkening + atmosphere glow, day/night terminator from the real sun position at G.t (OV.Clock/OV.GMath sun helpers; soft twilight bands, city lights on the night side), faint graticule, funding country borders on hover/select, radar circles dashed (bases, crafts), base markers (blue squares, name at zoom ≥ 2), crafts (chevrons + great-circle path to destination), UFO blips (red, blinking; size by UFO size; landed/crashed variants), sites (terror red skull pulse, crash orange, landed yellow), alien bases (purple once discovered), cities at zoom ≥ 3, selection rings, «placeBase» mode with valid/invalid land highlight under the cursor. Performance: cache the static land layer per rotation/zoom to an offscreen canvas element, redraw the dynamic layer each frame; target ≥ 55 fps at 1440×900 @2×; no ctx.filter, no OffscreenCanvas (Safari). QA with a G from OV.Campaign.newCampaign plus fake ufos/sites/crafts injected in the harness; screenshots: day side over Europe, night over Asia, zoomed city level, placeBase mode, many objects; LOOK and iterate ≥ 4 rounds. Coordinate with nobody — the Geoscape UI engineer (next stage) will consume your API, so document it precisely in your api field.`, { label: 'globo', phase: 'Globo e base', schema: RESULT, effort: 'high' }),
  () => agent(`${SHARED}
YOUR TASK — Basescape art (owner of: js/gfx/base_render.js, qa/base_check.mjs).
Implement OV.BaseRender per DESIGN §13 + the contract: draw(ctx, base, view) with view = {x, y, cell size, hover cell, ghost {type,x,y,valid}, selection, time, dpr}, cellAt(view, px, py) → {x,y}|null, facilityIcon(type, size) → canvas (for lists), craftIcon(type, size). Procedural top-down cut-away art for EVERY facility in OV.Data.facilities (access lift, living quarters, laboratory, workshop, small/large radar, hyper-wave decoder, general stores, alien containment, hangar 2×2 with the parked craft drawn by type — Skyranger, Interceptor, Firestorm, Avenger, any other in OV.Data.crafts —, laser/plasma/fusion defences, grav shield, mind shield, psi lab), rock/earth background of the 6×6 grid, connecting corridors between adjacent facilities, construction state (scaffolding + days-left badge), dismantle highlight, ghost placement green/red, subtle animation (radar dishes rotating, lab screens flicker, containment glow), palette consistent with the battlescape tiles and css/base.css tokens. Cache per facility sprite. QA: the starting base (OV.Campaign.newCampaign), a full late-game base, construction states, ghost valid/invalid; LOOK and iterate ≥ 3 rounds.`, { label: 'arte-base', phase: 'Globo e base', schema: RESULT, effort: 'high' }),
])
return { globe, baseart }
