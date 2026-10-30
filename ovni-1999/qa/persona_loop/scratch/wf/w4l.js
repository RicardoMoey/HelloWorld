export const meta = {
  name: 'ovni-w4-fix-ui',
  description: 'OVNI 1999 wave 4: UI fixer — Cydonia launch, send-team, onboarding, dogfight start, month report, Mac UX and pt-PT fixes',
  phases: [{ title: 'Correção UI', detail: 'ui fixer' }],
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
const UIRULES = `
UI rules: X-COM 1994 mood modernised, consistent with the battlescape HUD and menus (css/base.css tokens, .btn/.panel/.modal components, OV.Dom helpers, the .scr panel styles of css/screens.css); legible at 1280×800; responsive to 1024×700 and iPad landscape; min 32 px targets on (hover:none); every button has a tooltip with its shortcut; keyboard per DESIGN §15.5; trackpad: two-finger scroll rotates/pans, pinch zooms, ctrl+click secondary; sounds via OV.audio (check OV.audio.names(): ui clicks, alerts, music moods); the UI never mutates G except through the OV.World / OV.BaseSim / OV.Campaign / OV.Economy / OV.Soldiers / OV.Dogfight / OV.Save APIs (if one you need is missing, add the minimal pure-UI fallback and put the exact sim patch in open_issues). Every sim reason/err code you can receive must map to a pt-PT text in YOUR i18n file. Run tools/test.js --strict --i18n and your QA with ?debug=1 so no ⟦missing⟧ key survives.`
phase('Correção UI')
const fix = await agent(`${SHARED}${UIRULES}
YOU ARE THE UI FIXER for wave 4. You may edit js/ui/**, css/**, js/i18n/**, js/gfx/**, qa/** and tools/tests/ UI tests (ui_*, geoui_*, base_ui_*, campaign_ui_*, dogfight_ui*). Another engineer is fixing pacing in js/sim/**, js/data/**, tools/sim.js, tools/campaign_bot.js and docs right now — never edit those; if a UI fix needs a sim change, put the exact patch in open_issues. Never run git; never edit index.html.
Inputs (read all):
1) ${SP}/wave4_findings_ui.json — 21 verified findings from 4 adversarial reviewers (critical: no UI path launches the Cydonia mission — add «Missão final: Cidónia» entry points in the GeoUI base/craft cards, BaseUI Naves tab and the researchDone popup when G.flags.cydoniaUnlocked, with a no-return confirm, disabled states with campaign.err.* reasons, and a QA step that reaches the Cydonia briefing through the UI).
2) ${SP}/wave4_ui_requirements.json — UI requirements from the sim fixer (sell-craft button via BaseSim.canSellCraft/sellCraft; scramble dogfights labelled «Defesa da base»; ufoDetected popup for an assault ship heading to the base; research hint texts updated for the retroactive interrogation rule; cancel-interrogation dialog says the alien returns; import dialog shows save.err.parse) and residual issues from the playtester (Geoscape craft card stale during a dogfight; toasts over the funding table).
Lead guidance for judgement calls:
- Dogfight start: open in «Normal» (or the last posture the player used), never «Distância», and show a one-time hint about postures and switching the Stingray off for small scouts.
- Onboarding without nagging: a compact «Próximos passos» checklist/hint in the Geoscape panel for the first month (start research, hire scientists, set a speed, wait for a UFO), an idle-staff reminder (toast + badge, not a blocking popup, at most once per game day), and auto-suggest a faster speed after launching a craft («a nave chega em 18 min — 3 acelera») — keep it subtle and dismissible, remembered in G.ui.
- Monthly report must be readable at 1280×800 (no toasts over it, totals visible).
- pt-PT AO90 everywhere («Intercetar»); add an i18n lint test that fails on /intercep/i, /detect/i, /\\bac[çc]ão/ in OV.STR values.
Re-verify each item, fix the root cause, add a regression check (QA script step or Node UI test), skip with a reason if not reproducible. Then rerun ALL qa/*.mjs (full_campaign.mjs at least once at 1440×900 and once with --touch), node tools/test.js --strict --i18n, and LOOK at the screenshots of every screen you changed. Report fixed/skipped per item.`, { label: 'corretor-ui', phase: 'Correção UI', schema: RESULT, effort: 'high' })
return { fix }
