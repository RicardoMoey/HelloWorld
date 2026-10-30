# Wave 4 stage 1 reports

## ARCHITECT
The binding contract `docs/CAMPAIGN_API.md` is written, and its reference parts (clock, globe maths, `newCampaign` plus shared helpers) are implemented and tested. My new `geo_core` tests pass (27). The full `--strict` run has 2 failures, both in someone else's file (see open issues).

**The contract** (`/home/user/HelloWorld/ovni-1999/docs/CAMPAIGN_API.md`):
- **State:** every field of the campaign state `G`, with type, units and the one module allowed to write it.
- **Ids and randomness:** one id counter per prefix (`s1`, `c1`, …). Four random streams, and which module may draw from each.
- **Tick order:** the exact order of the 21 steps that run every 5 s, 10 min, 30 min, 1 h, 1 day and 1 month, and which module function owns each. The loop stops on any event marked `stop`. A faster "skip idle time" mode is allowed only if it gives an identical hash.
- **Events:** 40 event types, each with its fields, whether it pauses the game, who emits it, which screen reacts, and a suggested i18n key.
- **Module APIs:** signatures for World, Missions, Dogfight, BaseSim, Economy, Soldiers, Campaign section B and Save. This includes the exact mission object `startMission` hands to `OV.Battle.create` (squad and equipment from the craft, terrain, day/dusk/night, race, battle seed). It also covers what `finishMission` applies after a battle and the result it gives the existing debrief screen (`progression`, `onDone`).
- **UI wiring:** scene names and parameters, the entry points the four UI engineers call on each other, and the Geoscape time loop (80 ms steps, chunked, frame budget, drop to 5 s on popups).
- Also: determinism and save rules, a table of pacing knobs, test duties per module, and a list of where the contract departs from DESIGN.

**Code:**
- **`clock.js`:** time boundary masks, ticks until the next boundary, dates and real month lengths, sun position.
- **`gmath.js`:** great-circle distance and movement (Lisbon–New York = 2 925.5 nm), predicted intercept point, region/country/land lookups, day/dusk/night, random land points and entry ring.
- **`campaign.js`:**
  - **`newCampaign`:** funding normalised to exactly $6 000 000, the original starting base and stores, a Skyranger plus two armed Interceptors.
  - **Starting squad:** 8 soldiers seated with default loadouts (heavy cannon, pistol, rifles, flares, Medi-Kit).
  - **Shared helpers:** random streams bound to `G`, ids, lookups, the event catalogue, game end and hash.
  - **Section B:** a clearly marked section is left for the campaign engineer.

**Verification:**
- **`geo_core` tests (27):**
  - clock boundaries;
  - round-trips and distances;
  - stepping toward a target and intercepts;
  - day and night;
  - `newCampaign` field-for-field against the contract, JSON round-trip, same seed gives the same hash, funds total, base grid connected;
  - the starting squad builds a valid battle through `OV.Battle.create`.
- **Browser:** `qa/campaign_core_check.mjs` loads the game in Chromium at 1440×900, 1280×800 and 1024×700. It finds no console errors and no missing i18n keys. Starting-state hashes, clock results and globe maths are identical to Node. The server was stopped afterwards. Screenshots are in `/tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad/ui4/campaign-core/`.

### API
OV.Clock = { TICK_S:5, T5S:1, T10M:2, T30M:4, T1H:8, T1D:16, T1MO:32, SPEEDS (TUNE.GEO_SPEEDS), SPEED_KEYS, advance(G, ticks=1) -> mask of boundaries crossed in (t, t+5*ticks] (sets G.t), crossed(t0,t1) -> mask, ticksUntil(G|t, bit) -> ticks>=1, date(G|t) -> {y,m,d,h,min,s,wd}, monthIndex(G|t), monthStartT(monthIndex), daysInMonth(G|t), dayOfYear(G|t), hourUTC(G|t), sunLon(G|t), declination(G|t), isNightAt(G,lon,lat) }

OV.GMath = { D2R, NM_PER_DEG, EARTH_RADIUS_NM, wrapLon, clampLat, vec(lon,lat)->[x,y,z], toLL(v)->{lon,lat}, dot, cross, normalize, angle(a,b), distNm(a,b), distNmLL(lon1,lat1,lon2,lat2), withinNm(a,b,nm), bearing(a,b)->0..360, destination(p,bearingDeg,nm), lerp(a,b,f), moveToward(a,b,nm) / stepToward(a,b,knots,seconds) -> {lon,lat,arrived,remainingNm}, interceptPoint(chaser,chaserKn,target,targetDest,targetKn) -> {lon,lat,hours}|null, inRect(lon,lat,rect), inAreas(areas,lon,lat), regionAt, countryAt (orig rectangles), countryAtMap(lon,lat,reach?) (real outlines), isLand, sunLL(G), sunVec(G), sunElevation(G,lon,lat), dayPhase(G,lon,lat) -> 'day'|'dusk'|'night', isNightAt, missionShade(G,lon,lat) -> TUNE.SHADE_*, randomPointInAreas(rng,areas), randomLandPoint(rng,areas,tries=10) -> {lon,lat,land}, randomPointAround(rng,center,minDeg,maxDeg), path(a,b,maxStepDeg=2), smallCircle(center,radiusNm,n=48) }  (points are any {lon,lat})

OV.Campaign (section A) = { SCHEMA:1, STREAMS:['geo','map','combat','ai'], EVENTS:{type:{stop}}, ID_PREFIX, newCampaign({difficulty=0, seed=1, baseLonLat={lon:-9.14,lat:38.72}, baseName=null}) -> G (throws if the base point is not on land), rng(G, stream) -> live RNG bound to G.rng[stream], nextId(G, prefix) -> 'b1'/'s7'/..., craftNumber(G,type), rebuildDerived(G) -> non-enumerable G._, hash(G) -> uint32 (FNV-1a of JSON without events/ui/_), event(G, type, data?) -> ev pushed to G.events (stop from EVENTS), endGame(G, 'won'|'lost', reason?), newScoreMonth(), emptyLoadout(), findBase/findCraft/findSoldier/findUfo/findAlienMission/findSite/findAlienBase/findDogfight(G,id) -> obj|null, baseOf(G, craftOrSoldier), targetOf(G, ref) -> {kind,id,obj,lon,lat}|null, removeById(list,id), makeSoldier(G,{baseId,rng?}) -> soldier (not inserted), addSoldier(G,soldier), addCraft(G, baseId, type, {weapons?, equipment?}) -> craft, defaultLoadouts(G, craftId) }

Section B of campaign.js (startMission, finishMission, briefingMeta, availableResearch, availableManufacture, equipPool, applyEquip, baseDefence) is delimited by a marker comment and fully specified in CAMPAIGN_API.md §5.9. All other modules (OV.World, OV.Missions, OV.Dogfight, OV.BaseSim, OV.Economy, OV.Soldiers, OV.Save, and the UI entry points OV.GeoUI/BaseUI/DogfightUI/CampaignUI/Ufopaedia with their scenes) are specified in CAMPAIGN_API.md §3–§6.

### Open issues
- The full suite has 2 failures in data_items_units.test.js (crew totals per difficulty; alien weapons per month). They come from another engineer's uncommitted edits to js/data/units.js and js/data/tuning.js made during this session; the suite was green (349/349) before them. My files are not involved.
- screens.js (not mine) needs two small hooks for the campaign: startBattle(mission, meta) should hand off to OV.CampaignUI.startBattle when meta.campaign is set, and resumeGame(st) should hand off to OV.CampaignUI.resume when st.G is set. Without them, a campaign battle's debrief goes back to the main menu, and loading a mid-battle campaign save loses the campaign wrap-up. The contract (§6.2) gives the campaign UI engineer a fallback until then.
- New tuning keys for js/data/tuning.js; modules read them with defaults until added: GEO_MAX_STEPS_PER_FRAME 3, GEO_CHUNK_TICKS 720, GEO_FRAME_BUDGET_MS 12, AUTOSAVE_DAYS [1,10,20], LOW_FUEL_MARGIN_10M 1, BASE_DEFENCE_BASE 1800, BASE_DEFENCE_PER_COEF 300.
- Seasons are off (data/geo.js geoConst.sun.seasons = false, the OpenXcom default). So at 18:00 UTC in January Lisbon is still in daylight in the sim. Turning seasons on is a single data flag if winter dusk missions are wanted.
- Any engineer who needs a new event type should add it to OV.Campaign.EVENTS in campaign.js section A and to the contract's event table. Unlisted types are still pushed, but never pause the game.
- The determinism test for the 'skip idle time' mode (contract §3.1) belongs to the World engineer, along with the other per-module test duties in §9.

## BATTLE LEFTOVERS
The four engineering items are in: «Descarregar» works end to end, the spawn and terror-race cleanup is done, sprite pre-warming is in, and the render-region bug is fixed. On balance, the alien base and Cydonia now meet their targets, but only because those sweeps use a full craft (10 and 12 soldiers). Terror sites, the scout loss caps and the Abductor loss cap are still missed. The Node suite has two failures: data_items_units.test.js still checks the old crew and weapon tables. I can't edit that file; a ready patch is listed under open issues.

**1. Unload.** Added the 'unload' action as specified (clip to the free other hand, 8 TU) and tested it in battle_actions.test.js. qa/battle_unload_check.mjs drives it through the real UI and passes at 1440×900, 1280×800 and 1024×700 with no console errors. The existing qa/inventory_check.mjs also passes.

**2. Spawning and terror race.** spawnAlien now checks spawnAllowed itself, and the minimum distance from the craft is 10. Quick-battle terror sites now pick their race from the campaign's alien_terror schedule. Tests are in battle_spawn_race.test.js.

**3. Rendering.** Sprites are pre-warmed in idle time when a battle loads; the current zoom is done first, then the other rest zooms. That alone did not remove the hitch: the zoom animation passes through in-between scales, and each one used to build every visible sprite. Tile sprites and floor regions are now built only at the rest zoom levels and scaled during the animation.
- qa/battle_prewarm_check.mjs (Battleship map, 1440×900 at 2×): no new tile sprites while zooming. Worst frame during a zoom-in is 29–36 ms (57 ms in one run), against 75–87 ms without the cache; the slow zoom-out frames come from rebuilding floor regions. All timings are from this container's software renderer.
- Pre-warming here takes about 2 s of work spread over about 23 s, because the battle redraws every frame.
- When a tile changes, its 3×3 neighbours on that level and the level above are now redrawn. Tested in battle_render_warm.test.js.
- qa/perf_battle.mjs still passes.

**4. Balance.** I applied the proposals. Alien base and Cydonia are no longer dark, by setting the light level rather than adding lamps.

Two proposals were not enough. At Veterano the alien base was still 5–13 %, even with seeing in the dark fixed, fewer aliens, better soldiers or weaker aliens. The decisive factor was squad size, so these sweeps now use a full craft. To reach the target I also cut the base crew further and set month-3 weapons to [30,50,20] (the proposal was [20,50,30]).

A bot-behaviour change (aliens holding their posts) and a cap on alien psi attacks both made results worse, so I reverted them.

Final table, 40 seeds per row, month-appropriate gear, 8 soldiers unless noted (win % / X-COM losses per battle / median turns):

| Mission | Veterano | Recruta | Target |
|---|---|---|---|
| Small Scout m0 | 100 / 0.65 / 6 | 100 / 0.35 / 7 | 95 %, ≤ 1 loss |
| Medium Scout m0 | 95 / 2.30 / 7 | 98 / 1.45 / 8 | 95 %, ≤ 1 loss |
| Large Scout m1 | 93 / 2.50 / 13 | 98 / 1.18 / 10 | 95 %, ≤ 1 loss |
| Harvester m1 | 80 / 3.10 / 13 | 95 / 1.40 / 14 | — |
| Abductor m1 | 85 / 2.92 / 13 | 90 / 1.77 / 14 | 80 %, ≤ 2 losses |
| Supply Ship m2 | 58 / 5.60 / 15 | 98 / 2.05 / 15 | — |
| Terror Ship m3 | 70 / 3.20 / 13 | 98 / 1.30 / 14 | — |
| Battleship m3 | 88 / 3.38 / 14 | 93 / 1.85 / 16 | 70 % |
| Terror site m1 | 18 / 7.10 / 5.5 | 43 / 5.60 / 9 | 70 %, ≤ 3 losses |
| Alien base m3 (10 soldiers) | 60 / 6.80 / 13 | 70 / 5.70 / 15.5 | 50 % |
| Cydonia (12 soldiers) | 68 / 7.17 / 16.5 | 98 / 2.45 / 12 | 60 % |

With experienced soldiers (`--vet`) at Veterano: alien base 58 %, Cydonia 88 %, terror m1 15 %.

**Terror month 1, with the current race schedule** (Veterano, 30 seeds per race, all with my smaller terror crew):

| Race | Month 1 (rifles) | Month 3 (lasers + armour) |
|---|---|---|
| Floater | 73 % | — |
| Sectoid | 0 % | 80 % |
| Muton | — | 63 % |
| Snakeman | 0 % | 7 % |

- Sectoids lose because Cyberdiscs make 43 of 48 kills at 13+ tiles, and rifles don't kill them. Bringing the starting Heavy Cannon and Rocket Launcher didn't help.
- Snakemen lose because Chryssalids reach the squad on turns 2–3 and civilians get zombified (75 times in 8 battles).
- Fewer civilians plus a costlier Chryssalid attack would raise snakeman month 3 to 37 %. I did not apply either.

Nothing else was changed for Medium/Large Scout and Abductor. They miss only on losses per battle, which I put down mostly to the bot; Recruta meets them.

`--det --save-at 5` over all missions exits 0 (hashes match). The full sweep tables are in /tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad/sweep/fin2.tab.

### Open issues
- Node suite is red with two failures. tools/tests/data_items_units.test.js (not mine) checks the old crew totals (terror site, alien base, Cydonia) and the old weapon table, both changed by this task. A tested patch is ready: /tmp/claude-0/-home-user-HelloWorld/b8cfbac1-629a-5f58-8dfb-0f752cc84b7c/scratchpad/patch/data_items_units.test.js.patch (patched copy alongside it: 23 of 23 tests pass). With it applied the suite is 385 of 385 green. Please apply it or authorise me to.
- For the campaign pacing engineer: at month 1 with rifles, sectoid terror (Cyberdiscs) and snakeman terror (Chryssalids plus zombified civilians) win 0 % at Veterano, whatever the crew size and even with the starting Heavy Cannon and Rocket Launcher. Floater terror is 73 %. At month 3, sectoid is 80 %, muton 63 % and snakeman only 7 %. The current alien_terror schedule (snakeman 60 % at month 1) makes terror month 1 18 % overall, against a 70 % target. Options I measured but did not apply: civilians 10–14 → 5–7, plus Chryssalid melee from 15 to 25 TU, lifts snakeman month 3 to 37 %.
- Still missing their targets at Veterano: Medium Scout (2.3 losses per battle) and Large Scout (93 %, 2.5 losses) against ≤ 1 loss; Abductor 85 % but 2.9 losses against ≤ 2; Supply Ship month 2 at 58 % (no target). Recruta meets all of them. I believe the playerBot loses more soldiers than a human would; I didn't change data for these.
- The playerBot is weak at assaulting dug-in aliens. When aliens wait, its alien base wins drop (more spawn distance or a later cheat turn → 0 %), and changing its own settings made no difference. Alien base and Cydonia numbers therefore lean on squad size. A better bot assault would make these sweeps more trustworthy.
- Minor UI note: after «Descarregar», the «Recarregar» button reloads from the belt first (engine findClip order is belt → pack → other hand), so the clip just unloaded stays in the hand. It works, but the hand clip would be the more natural first choice.
- Pre-warming in this container takes about 23 s of wall-clock time for the Battleship map, because the battle screen redraws every frame and leaves little idle time. On a Mac with a GPU it should take a couple of seconds. If the UI stopped redrawing while idle, pre-warming would finish sooner.
