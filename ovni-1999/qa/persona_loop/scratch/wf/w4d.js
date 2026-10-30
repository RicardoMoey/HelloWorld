export const meta = {
  name: 'ovni-w4-dogfight-ui',
  description: 'OVNI 1999 wave 4: interception/dogfight overlay UI',
  phases: [{ title: 'Interceção', detail: 'dogfight_ui' }],
}
const SP = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
const SHARED = `
You are a senior engineer on "OVNI: Inimigo Desconhecido" (repo /home/user/HelloWorld/ovni-1999), a faithful browser reverse-engineering of UFO: Enemy Unknown (1994) — vanilla JS classic-script IIFEs on global OV, Canvas 2D + DOM overlay, zero deps, no build, pt-PT European UI, Mac-first (trackpad + keyboard; also mouse and iPad touch). User brief: «capricha na jogabilidade» — gameplay feel and polish are the top priority; the campaign must be fun in a 2–4 h arc (DESIGN §14).
State: waves 1–3 done (rules data js/data/*, full battlescape engine js/sim/battle/*, renderer, presenter, battle HUD, inventory/equip screen, menus/briefing/debrief/options in js/ui/screens.js, audio, sprites). Wave 4 stage 1 done: the BINDING campaign contract ovni-1999/docs/CAMPAIGN_API.md, js/sim/geo/clock.js, js/sim/geo/gmath.js, OV.Campaign.newCampaign + shared helpers in js/sim/campaign.js. Stage-1 engineer reports (read them): ${SP}/wave4_stage1_reports.md.
READ FIRST: ovni-1999/CONVENTIONS.md (binding); docs/CAMPAIGN_API.md IN FULL (binding; overrides DESIGN where they differ); DESIGN.md §3.1, §3.13–§3.19, §5.3, §6, §12–§14, §18, §19; docs/DATA_API.md; docs/rea/02-geoscape.md. Read the real code you integrate with fully.
Other engineers work IN PARALLEL in the same tree right now (campaign/save, Ufopaedia, globe renderer, base art). DONE and usable now: js/sim/geo/world.js (OV.World), missions.js (OV.Missions), base.js (OV.BaseSim), economy.js, soldiers.js, dogfight.js (OV.Dogfight) — read their headers/APIs; stage-2A reports are in ${SP}/wave4_stage2A.json (keys world, basesim: summary/api/open_issues). Hard rules:
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
const UIRULES = `
UI rules: X-COM 1994 mood modernised, consistent with the battlescape HUD and menus (css/base.css tokens, .btn/.panel/.modal components, OV.Dom helpers); legible at 1280×800; responsive to 1024×700 and iPad landscape; min 32 px targets on (hover:none); every button has a tooltip with its shortcut; trackpad/keyboard first; sounds via OV.audio (check OV.audio.names(); interception music mood if present); the UI never mutates G except through the OV.Dogfight / OV.World APIs.`
phase('Interceção')
const dog = await agent(`${SHARED}${UIRULES}
YOUR TASK — interception / dogfight overlay (owner of: js/ui/dogfight_ui.js, css/dogfight.css, js/i18n/pt-PT.dogfight.js, qa/dogfight_check.mjs).
Implement OV.DogfightUI.open(G, dogfightId) + its overlay scene exactly as docs/CAMPAIGN_API.md (UI wiring section) specifies (isScreen:false over the geoscape; the Geoscape screen engineer will call it on dogfightStart and is being written next — keep a clean, documented API: open, close, minimise/restore, active list, onEnd callback). Read js/sim/geo/dogfight.js fully: tick-based (Data.dogfight.tickMs per tick; approach is now 4 per tick, retreat 4, missiles 8 per tick; projectile pos = distance flown from the craft, arrives when pos ≥ dist; beams and UFO shots resolve in the same tick and leave no projectile; events df.move/df.fire/df.hit/df.miss/df.retreat/df.breakOff and the result events).
Design: the X-COM 1994 interception window modernised — a compact framed panel (not full screen) with a canvas: starfield/clouds parallax at altitude, the UFO silhouette (per UFO type, size by class) growing as distance closes, the interceptor's HUD reticle; a range bar with the current distance and markers for each weapon's range and the UFO weapon range; craft and UFO hull bars (UFO damage % as the original shows), weapon status per slot (name, ammo, reload progress, on/off toggle), mode buttons «Distância / Cauteloso / Normal / Agressivo / Desengatar» (keys 1–5, current mode highlighted), projectile animations (Stingray/Avalanche missiles with smoke trails, cannon tracers, laser/plasma beams, UFO plasma bolts), hit flashes, camera shake on hits, damage numbers, status text (a aproximar, em alcance, OVNI a fugir, sem munições…), outcome banners («OVNI despenhado», «OVNI destruído», «OVNI escapou», «Nave danificada», «Nave destruída») then auto-close after a short pause with a summary; minimise to keep watching the Geoscape (≤ 2 simultaneous dogfights shown as small chips), sounds (engines, missile launch, cannon, hits, explosions) and the interception music mood if OV.audio has one. Advance the sim with OV.Dogfight.tick at Data.dogfight.tickMs real time independent from the globe speed; pause while a modal is open. QA: build G with OV.Campaign.newCampaign, spawn a flying UFO and order an interceptor until contact via OV.World APIs (or create the dogfight directly via OV.Dogfight.create), open the overlay in a page with only the menu scene behind (the Geoscape scene is not written yet — feature-detect it), play each mode, screenshot approach/firing/hit/crash/escape/minimised at 1440×900 and 1024×700; LOOK and iterate ≥ 3 rounds.`, { label: 'intercecao-ui', phase: 'Interceção', schema: RESULT, effort: 'high' })
return { dog }
