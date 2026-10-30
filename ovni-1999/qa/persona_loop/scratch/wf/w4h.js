export const meta = {
  name: 'ovni-w4-audio',
  description: 'OVNI 1999 wave 4: strategy-layer audio (interception/base/Mars moods, Geoscape alerts, dogfight engine)',
  phases: [{ title: 'Som', detail: 'audio.js' }],
}
const SP = '/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad'
const SHARED = `
You are a senior engineer on "OVNI: Inimigo Desconhecido" (repo /home/user/HelloWorld/ovni-1999), a faithful browser reverse-engineering of UFO: Enemy Unknown (1994) — vanilla JS classic-script IIFEs on global OV, Canvas 2D + DOM overlay, zero deps, no build, pt-PT European UI, Mac-first (trackpad + keyboard; also mouse and iPad touch). User brief: «capricha na jogabilidade» — gameplay feel and polish are the top priority; the campaign must be fun in a 2–4 h arc (DESIGN §14).
State: waves 1–3 done (rules data js/data/*, full battlescape engine js/sim/battle/*, renderer, presenter, battle HUD, inventory/equip screen, menus/briefing/debrief/options in js/ui/screens.js, audio, sprites). Wave 4 stage 1 done: the BINDING campaign contract ovni-1999/docs/CAMPAIGN_API.md, js/sim/geo/clock.js, js/sim/geo/gmath.js, OV.Campaign.newCampaign + shared helpers in js/sim/campaign.js. Stage-1 engineer reports (read them): ${SP}/wave4_stage1_reports.md.
READ FIRST: ovni-1999/CONVENTIONS.md (binding); docs/CAMPAIGN_API.md IN FULL (binding; overrides DESIGN where they differ); DESIGN.md §3.1, §3.13–§3.19, §5.3, §6, §12–§14, §18, §19; docs/DATA_API.md; docs/rea/02-geoscape.md. Read the real code you integrate with fully.
DONE and usable (read their file headers and APIs): js/sim/geo/world.js (OV.World), missions.js (OV.Missions), base.js (OV.BaseSim), economy.js (OV.Economy), soldiers.js (OV.Soldiers), dogfight.js (OV.Dogfight), js/sim/campaign.js (OV.Campaign incl. section B), js/sim/save.js (OV.Save), js/ui/ufopaedia.js (OV.Ufopaedia.open(G|null, id)), js/gfx/globe_render.js (OV.GlobeRender), js/gfx/base_render.js (OV.BaseRender). Their engineers' full reports (summary, api, open_issues, deviations): ${SP}/wave4_stage2A.json (world, basesim), ${SP}/wave4_stage2B.json (campaign, ufopaedia), ${SP}/wave4_stage2C.json (globe, baseart) — READ the api + open_issues of the modules you use. Other UI engineers work IN PARALLEL right now on: the Geoscape screen (geo_ui.js), the Basescape screens (base_ui.js), the campaign flow screens (campaign_ui.js) and the interception overlay (dogfight_ui.js; OV.DogfightUI — feature-detect, its engineer documents open/close in its file header). Hard rules:
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
phase('Som')
const audio = await agent(`${SHARED}
YOUR TASK — strategy-layer audio (owner of: js/audio/audio.js, qa/audio_check.mjs). Read js/audio/audio.js fully first (Web Audio synthesis; SFX table, MOODS with MOOD_LIST, STINGERS, names()/moods()/stingers(); crossfaded moods; everything synthesized, zero samples; DESIGN §17). The UIs feature-detect names: unknown names are silent today.
1) Add music moods, in the same synthesized style and quality bar as the existing ones (listenable for 10+ minutes, not fatiguing, mixed under SFX): 'interception' (tense, fast pulse, for the dogfight overlay), 'base' (calm, industrious, subterranean hum + soft arpeggios), 'research' (optional variant or reuse), 'alien_base' (eerie organic, for alien base assaults), 'cydonia' (Mars finale: ominous, epic), plus 'victory' and 'defeat' end-of-campaign moods if the stingers are not enough. Wire them into MOOD_LIST.
2) Add SFX the strategy UIs need, at minimum: dogfight_engine (jet rumble ~1.5 s, loopable feel), craft_takeoff, craft_landing, terror_siren (city siren, used with terror sites), ufo_lost, base_build (construction), facility_done, research_done (rewarding chime), production_done, funds_in (month report income), council_bad, interrogation, autosave (subtle), plus anything else the strategy UI code requests: grep js/ui/*.js for every OV.audio.play/music/stinger/speak name (and any helper like sfx('…')) and make sure EVERY requested name exists (the Geoscape and campaign UI engineers are still writing js/ui/geo_ui.js and js/ui/campaign_ui.js right now — grep them again at the end and cover new names).
3) Keep CPU low (no long node chains per note), respect volumes/mute settings, no clicks/pops (ramps), all try/catch-silent as the module already does. Extend qa/audio_check.mjs to render each new mood and SFX offline (OfflineAudioContext) and assert non-silent, no NaN, peak < 0.98, sensible RMS; plus a list of every name requested by js/ui that is missing (must be empty).
Run node tools/test.js --strict (must stay green apart from other engineers' in-progress failures, which you report) and the audio QA.`, { label: 'som', phase: 'Som', schema: RESULT, effort: 'high' })
return { audio }
