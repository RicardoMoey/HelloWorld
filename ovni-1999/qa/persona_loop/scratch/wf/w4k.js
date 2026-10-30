export const meta = {
  name: 'ovni-w4-fix-sim',
  description: 'OVNI 1999 wave 4: fix verified sim/data review findings (win path, terror, retaliation, crafts, economy, save)',
  phases: [{ title: 'Correção', detail: 'sim/data fixer' }],
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
phase('Correção')
const fix = await agent(`${SHARED}
YOU ARE THE SIM/DATA FIXER for wave 4. You may edit js/sim/**, js/data/**, tools/** (tests, sim.js, campaign_bot.js), docs/CAMPAIGN_API.md. Never touch js/ui, css, js/gfx, js/i18n, js/audio, qa (UI engineers are working there right now) — when a fix needs UI (e.g. a new event the Geoscape must show, or the Cydonia launch button), implement the sim side, add the event to OV.Campaign.EVENTS and the contract, and write the exact UI requirement into open_issues (the UI fixer runs next). Never run git; never edit index.html.
Re-verify each finding below with its evidence scripts (under ${SP}/review4/), then fix the root cause with a test (tools/tests/*.test.js), or skip with a clear reason. Guidance from the lead for the judgement calls:
- Interrogation trap: implement the retroactive flag rule (record interrogated ranks; grant leader/commander flags when alien_origins / martian_solution completes if such a rank was interrogated earlier), document it as an 'ours' rule; also make cancelResearch on an interrogation return the alien to containment if the topic consumed it on start.
- Terror site after a lost/aborted battle: remove it (no expiry penalty on top of the battle score), as OpenXcom does; update the pinned test.
- Retaliation: add the warning window — a stop:true event when the aliens locate the base (e.g. 'baseSpotted' {baseId, missionId}), let interceptors engage the assault ship when it is attacking their own base (no speed requirement at the base, like the original's base defences firing), make base defences shoot first, and size the starting garrison/defence math so an alert player who keeps soldiers home survives on Veterano; never an instant game over without a popup. Measure with the campaign bot.
- Selling crafts: add BaseSim.sellCraft (orig: sell price, not while out/with cargo/soldiers aboard) so rent can stop.
- Economy pact ordering, rearm spam, dismantle checks, Save.fromJSON deep validation (reject or repair malformed G before it reaches the main loop): fix.
- Contract/value mismatches: make docs and data agree with what is shipped.
After fixing: node tools/test.js --strict green; node tools/sim.js battle --ufo all --seeds 3 --det exit 0; node tools/sim.js campaign --seeds 6 --diff 0,1 --days 240 --det (report the before/after table: victories, council defeats, base losses, median victory day). Report fixed/skipped per finding and the UI requirements for the UI fixer.
FINDINGS: read the JSON array in ${SP}/wave4_findings_sim.json (10 verified findings with file, severity, claim, evidence, fix).`, { label: 'corretor-sim', phase: 'Correção', schema: RESULT, effort: 'high' })
return { fix }
