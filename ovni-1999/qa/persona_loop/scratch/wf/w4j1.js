export const meta = {
  name: 'ovni-w4-review-a',
  description: 'OVNI 1999 wave 4 adversarial review: rules fidelity/win path and bug hunt',
  phases: [{ title: 'Revisão', detail: 'adversarial lenses' }],
}
const SP = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
const SHARED = `
You are a senior engineer on "OVNI: Inimigo Desconhecido" (repo /home/user/HelloWorld/ovni-1999), a faithful browser reverse-engineering of UFO: Enemy Unknown (1994) — vanilla JS classic-script IIFEs on global OV, Canvas 2D + DOM overlay, zero deps, no build, pt-PT European UI, Mac-first (trackpad + keyboard; also mouse and iPad touch). User brief: «capricha na jogabilidade» — gameplay feel and polish are the top priority; the campaign must be fun in a 2–4 h arc (DESIGN §14).
State: waves 1–3 done (rules data js/data/*, full battlescape engine js/sim/battle/*, renderer, presenter, battle HUD, inventory/equip screen, menus/briefing/debrief/options in js/ui/screens.js, audio, sprites). Wave 4 stage 1 done: the BINDING campaign contract ovni-1999/docs/CAMPAIGN_API.md, js/sim/geo/clock.js, js/sim/geo/gmath.js, OV.Campaign.newCampaign + shared helpers in js/sim/campaign.js. Stage-1 engineer reports (read them): ${SP}/wave4_stage1_reports.md.
READ FIRST: ovni-1999/CONVENTIONS.md (binding); docs/CAMPAIGN_API.md IN FULL (binding; overrides DESIGN where they differ); DESIGN.md §3.1, §3.13–§3.19, §5.3, §6, §12–§14, §18, §19; docs/DATA_API.md; docs/rea/02-geoscape.md. Read the real code you integrate with fully.
DONE and usable (read their file headers and APIs): js/sim/geo/world.js (OV.World), missions.js (OV.Missions), base.js (OV.BaseSim), economy.js (OV.Economy), soldiers.js (OV.Soldiers), dogfight.js (OV.Dogfight), js/sim/campaign.js (OV.Campaign incl. section B), js/sim/save.js (OV.Save), js/ui/ufopaedia.js (OV.Ufopaedia.open(G|null, id)), js/gfx/globe_render.js (OV.GlobeRender), js/gfx/base_render.js (OV.BaseRender). Their engineers' full reports (summary, api, open_issues, deviations): ${SP}/wave4_stage2A.json (world, basesim), ${SP}/wave4_stage2B.json (campaign, ufopaedia), ${SP}/wave4_stage2C.json (globe, baseart) — READ the api + open_issues of the modules you use. ALL strategy UIs are now DONE too: js/ui/geo_ui.js (OV.GeoUI), base_ui.js (OV.BaseUI), campaign_ui.js (OV.CampaignUI), dogfight_ui.js (OV.DogfightUI); their reports: ${SP}/wave4_geo_campaign_ui.json (geoui, campui), ${SP}/wave4_baseui.json, ${SP}/wave4_dogfight.json. The campaign pacing pass, the audio pass, the full-campaign playtest and the globe performance pass are also DONE (reports in ${SP}/wave4_pacing.json and ${SP}/wave4_playtest.json when present). The headless campaign bot is tools/campaign_bot.js; run sweeps with node ovni-1999/tools/sim.js campaign --seeds N --diff 0|1|2 [--days D]. Hard rules:
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
const REVIEW = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: {
    file: { type: 'string' }, area: { type: 'string', enum: ['sim', 'ui', 'gfx', 'data', 'audio', 'qa'] }, severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, claim: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
    required: ['file', 'area', 'severity', 'claim', 'evidence', 'fix'] } } },
  required: ['findings'],
}
const LENSES = [
  { key: 'fidelidade', prompt: 'RULES FIDELITY & WIN PATH: compare the strategy layer (js/sim/geo/*, js/sim/campaign.js, js/data/geo|base|research|crafts|ufos.js) against DESIGN §3.13–§3.19, docs/CAMPAIGN_API.md (incl. §11 pacing changes) and docs/rea/02-geoscape.md (original UFO: Enemy Unknown / OpenXcom rules): funding formula, rating thresholds, detection, dogfight, research/manufacture arithmetic, mission schedule, retaliation, alien base discovery, score points, promotions, capacities, delivery times, interrogation chain, Cydonia path. Prove each discrepancy with a headless Node script. Also hunt win-path blockers and soft-locks (can every seed still be won by a human? can research dead-end? can the player lose all transports/soldiers with no recovery path? funds spiral?).' },
  { key: 'bugs', prompt: 'BUG HUNT across the campaign in the browser and headless: try to break flows — double-launching missions, intercepting with damaged/unarmed/refuelling craft, selling items in use or equipped, dismantling the only lift/hangar/quarters in use, sacking staff mid-research/production, saving during a dogfight or mid-battle and loading, loading old/corrupt/imported files, quota exceeded (stub localStorage), running time at max speed for 6 game months (memory, perf, event floods, popup spam), base lost, bankruptcy, game over and victory paths, returning to the menu and starting a new campaign (listener/scene/timer leaks: count scenes, listeners, rAF loops), switching tabs mid-dogfight, resizing mid-flow, abort a mission then relaunch. Report reproducible bugs with exact steps.' },
]
phase('Revisão')
const reviews = await parallel(LENSES.map((l) => () => agent(`${SHARED}\nYOU ARE AN ADVERSARIAL REVIEWER of the finished wave 4 (strategy layer + its integration with the battlescape). Read-only on project files; throwaway scripts in ${SP}/review4/${l.key}/. Lens: ${l.prompt}\nUse the real game served over http with Playwright, and headless Node scripts against the sim. Report only VERIFIED findings with reproduction steps/evidence and a concrete fix; tag each with its area (sim/ui/gfx/data/audio/qa). Deliberate, documented compressions in DESIGN/CAMPAIGN_API are NOT findings.`, { label: 'revisao-' + l.key, phase: 'Revisão', schema: REVIEW, effort: 'high' })))
return { reviews: reviews.map((r, i) => ({ lens: LENSES[i].key, findings: r ? r.findings : null })) }
