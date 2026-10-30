# CAMPAIGN_API.md — binding contract for the strategy layer

Status: **binding**, stage 1 (architect). Every strategy engineer (sim and UI) implements against this file.
Precedence: `CONVENTIONS.md` > **this file** > `DESIGN.md` (where this file and DESIGN differ, this file wins).
References: DESIGN §3.1, §3.12–§3.19, §5.3, §6, §12–§15, §18–§19; `docs/DATA_API.md`; `docs/rea/02-geoscape.md`.
Implemented by the architect (reference code, tested in `tools/tests/geo_core.test.js`): `js/sim/geo/clock.js`,
`js/sim/geo/gmath.js`, `js/sim/campaign.js` section A. Everything else in this file is a specification.

Conventions used below:
- **Writer** = the only module allowed to change a field. Other modules read it, or call the writer's function.
- `t` = game seconds (integer, multiple of 5). `nm` = nautical miles (1 nm = 1 arc-minute). `kn` = knots (nm/h).
- Money is an integer number of US$. Scores are integers. Counts are integers. Positions (`lon`, `lat`) and craft
  speeds are the only floats in `G`.
- "Event" means an object pushed with `OV.Campaign.event(G, type, data)` (§3).
- An id is a string from `OV.Campaign.nextId(G, prefix)` (§1.3). Objects never hold references to other objects.

---

## 0. Who owns what

| Area | Sim file (global) | UI files | i18n file |
|---|---|---|---|
| Architect | `js/sim/geo/clock.js` (`OV.Clock`), `js/sim/geo/gmath.js` (`OV.GMath`), `js/sim/campaign.js` section A (`OV.Campaign` helpers + `newCampaign`), this document | — | — |
| World loop and orders | `js/sim/geo/world.js` (`OV.World`) | — | — |
| Alien strategy | `js/sim/geo/missions.js` (`OV.Missions`) | — | — |
| Interception | `js/sim/geo/dogfight.js` (`OV.Dogfight`) | `js/ui/dogfight_ui.js`, `css/dogfight.css` | `js/i18n/pt-PT.dogfight.js` |
| Bases | `js/sim/geo/base.js` (`OV.BaseSim`) | `js/ui/base_ui.js`, `js/gfx/base_render.js`, `css/basescape.css` | `js/i18n/pt-PT.base.js` (append) |
| Economy and score | `js/sim/geo/economy.js` (`OV.Economy`) | (monthly report: campaign UI) | — |
| Soldiers | `js/sim/geo/soldiers.js` (`OV.Soldiers`) | (soldier screens: base UI) | — |
| Campaign glue | `js/sim/campaign.js` section B (`OV.Campaign.startMission`, …) | `js/ui/campaign_ui.js`, `css/campaign.css` | `js/i18n/pt-PT.campaign.js` |
| Save/load | `js/sim/save.js` (`OV.Save`) | (dialogs: campaign UI) | — |
| Geoscape | — | `js/ui/geo_ui.js`, `js/gfx/globe_render.js`, `css/geo.css` | `js/i18n/pt-PT.geoui.js` |
| Ufopaedia | — | `js/ui/ufopaedia.js`, `css/ufopaedia.css` | `js/i18n/pt-PT.ufopaedia.js` |

Load order (fixed in `index.html`): `clock → gmath → soldiers → economy → base → missions → dogfight → world →
campaign → save`, then gfx, ui. A module may call any other strategy module **at call time** (all are loaded
by then). Never call another module at load time, and feature-detect a module only where this contract says so.

New gameplay constants: read them with `tune('KEY', default)` (the pattern in `battle.js`) and list them in §8. The
owner of `js/data/tuning.js` adds them to `OV.TUNE`. Until then, the default applies.

---

## 1. Campaign state `G`

`G` is plain JSON. `JSON.parse(JSON.stringify(G))` must deep-equal `G`, ignoring `G.events`. There is no `undefined`
(use `null`), no `NaN` or `Infinity`, no typed arrays, no `Map` or `Set`, no class instances, no functions. Derived
caches live in the non-enumerable `G._` (§7).

### 1.1 Top level (exactly these keys; tested)

| Key | Type | Writer | Meaning |
|---|---|---|---|
| `game` | `'ovni-1999'` | newCampaign | save identity |
| `schema` | int (1) | newCampaign, Save migrations | state schema version |
| `seed` | uint32 | newCampaign | campaign seed |
| `difficulty` | 0 \| 1 \| 2 | newCampaign | «Recruta», «Veterano», «Super-humano». `coef = 2·difficulty` (0/2/4) wherever DESIGN uses OpenXcom's coefficient. |
| `t` | int s | Clock.advance (only via World.step) | seconds since 1999-01-01 12:00 UTC |
| `month` | int | World (month handler) | calendar months elapsed since Jan 1999 (`= Clock.monthIndex(G)` after the month handler) |
| `plannedMonth` | int | Missions.planMonth | last month whose alien script ran; −1 = none yet (§3.1 step 0) |
| `rng` | `{geo, map, combat, ai}` uint32 | via `Campaign.rng(G, s)` only | RNG stream states (§1.4) |
| `ids` | `{seq:{prefix:int}, craftNum:{type:int}}` | `Campaign.nextId`, `craftNumber` | id counters (§1.3) |
| `funds` | int $ | Economy, BaseSim | cash; may go negative |
| `history` | array | Economy.monthEnd | one entry per finished month (§1.5) |
| `reports` | array (≤ 12) | Economy.monthEnd | last 12 monthly reports, newest last (§5.7) |
| `council` | `{badMonths, debtMonths, lastRating}` | Economy.monthEnd | defeat counters |
| `score` | object | Economy | §1.6 |
| `countries` | array | Economy (funding), Missions (pact) | §1.7, `OV.Data.countries` key order |
| `bases` | array | BaseSim (+ Campaign for creation) | §1.8, creation order |
| `soldiers` | `{id: soldier}` | Soldiers, BaseSim (assignments), Campaign | §1.9 |
| `dead` | array | Soldiers.kill | memorial «Memorial», oldest first |
| `crafts` | `{id: craft}` | World (flight), BaseSim (maintenance, purchase), Dogfight (damage, ammo), Campaign | §1.10 |
| `ufos` | array | Missions (lifecycle), World (movement, detection), Dogfight (damage) | §1.11 |
| `alienMissions` | array | Missions | §1.12 |
| `sites` | array | Missions | terror sites (§1.13) |
| `alienBases` | array | Missions (discovered: World/Missions/Economy as listed) | §1.14 |
| `dogfights` | array | Dogfight | active interceptions (§1.15); empty when saving |
| `alien` | object | Missions | private alien-strategy memory (§1.12) |
| `researched` | `[topicId]` | BaseSim (research completion) | completed topics, in completion order |
| `ufopaedia` | `[articleId]` | BaseSim (research), Campaign | unlocked articles beyond the always-open ones (§5.11) |
| `seen` | `{ufoTypes:[], races:[]}` | World (detection with hyper-wave), Campaign.finishMission | used for free Ufopaedia articles |
| `flags` | object | BaseSim (research), Campaign.endGame | §1.16 |
| `stats` | object | various (§1.17) | lifetime counters for the end screens |
| `activeMission` | `null \| {siteRef, craftId, startedT}` | Campaign.startMission / finishMission | a battle is running; World.step refuses to run |
| `ui` | object | **UI only** | camera, speed, last tab; sim never reads it; excluded from `hash` |
| `debug` | `null \| {revealUfos, instantResearch, instantBuild, instantProduction}` | debug panel (`?debug=1`) | cheat flags honoured by World/BaseSim |
| `events` | array | everyone via `Campaign.event` | transient queue; **never saved**, excluded from `hash` |

### 1.2 Time
- Start `t = 0` = 1 Jan 1999 12:00 UTC, a Friday. Real month lengths and leap years (via `OV.U.dateOf`).
- One tick = 5 s. Boundaries are aligned to UTC clock time: every 10 min, every 30 min, every hour on the hour, the
  day at 00:00 UTC, and the month at 00:00 UTC on the 1st. The first day boundary is at `t = 43 200`.
- Only `World.step` advances `G.t`, through `Clock.advance`.

### 1.3 Ids
`nextId(G, prefix)` returns `prefix + n`, where `n` is a separate counter for each prefix starting at 1. Prefixes:
`b` base, `s` soldier, `c` craft, `u` UFO, `m` alien mission, `t` terror site, `a` alien base, `d` dogfight,
`p` production order, `dl` delivery, `tr` transfer. Ids are never reused.
`craftNumber(G, type)` gives the display number. The UI shows a craft as `craft.name` if the player renamed it,
otherwise `T('craft.instance', {type: T(def.nameKey), n: craft.num})`.

### 1.4 RNG streams
`G.rng` holds four uint32 states. A module gets a live generator with `OV.Campaign.rng(G, stream)`. It has the
`OV.RNG` interface (`int(a,b)`, `pct(p)`, `pick`, `weighted`, `shuffle`, `next()` float, `u32()`), and every draw
writes back to `G.rng[stream]`. Never copy the state elsewhere. The UI never draws from these streams; it uses its
own `OV.RNG.create(...)`.

| Stream | Used by (and only by) |
|---|---|
| `geo` | World (detection rolls, patrol discovery), Missions (waypoint points, landing points, site and crash timers, alien-base discovery and supply rolls), Economy (funding changes), BaseSim (research cost randomisation), Soldiers (recruit generation), newCampaign |
| `ai` | Missions strategic choices only: region, mission type, race, terror city, retaliation rolls, infiltration pact country |
| `map` | `Campaign.startMission`: one `u32()` per battle, used as `mission.seed`; `Campaign.reseedMap` mixes a retry salt into it (§5.9) |
| `combat` | Dogfight (all rolls), `Campaign.finishMission` (stat growth via `OV.Morale.postMission`, wound days), `Campaign.baseDefence` |

Draws happen in the fixed handler order of §3.1. Within a handler, iterate arrays in index order and object maps in
insertion order. Then the same seed and the same orders always produce the same `hash(G)`.

### 1.5 Funds and history
- `funds` starts at `TUNE.FUNDING_TOTAL` (6 000 000), the sum of the initial country funding.
- Purchases, hiring, construction and production costs are subtracted at once. Spending is refused if `funds` is
  below the cost (`reason:'funds'`). Only the monthly upkeep can push `funds` below 0.
- `history[k] = {month, funds, income, upkeep, xcom, alien, research, rating}`, one entry per month end.

### 1.6 Score
```js
score = {
  month: { xcom:{total, regions:{regionId:int}, countries:{countryId:int}},
           alien:{total, regions:{…}, countries:{…}}, research:int },   // current month; reset at month end
  all:   { xcom:int, alien:int, research:int } }                         // lifetime totals
```
Only `Economy.addScore` writes `score`. The region of a point comes from `GMath.regionAt` (the original
rectangles; oceans included). The country comes from `GMath.countryAt`, which is null at sea or in non-funding
countries. `total` is the sum of every point added (= Σ regions).

### 1.7 Countries
`countries[i] = {id, funding:int $ (multiple of 1000), history:[funding at each month end, ≤ 12], pact:bool,
mood:'pleased'|'unhappy'|'same' (last month-end change), lastDelta:int $}`. A country with a pact has funding 0
forever. There are 17 funding countries: the 16 orig ones plus Portugal (ours, §11.6), in `OV.Data.countries` key
order (Portugal last).

### 1.8 Bases
```js
base = { id, name: string|null /* null ⇒ T('base.defaultName') */, lon, lat,
  region /* regionAt */, country /* countryAt (rect) or null */,
  grid: [{type, x, y, daysLeft}],          // top-left cell; daysLeft 0 = built; hangar 2×2 covers x..x+1, y..y+1
  scientists:int, engineers:int,           // totals present at the base (assigned + free)
  soldiers:[soldierId], crafts:[craftId],  // roster / hangar order
  stores:{itemId:int>0},                   // no zero entries
  aliens:{unitType:int>0},                 // live aliens in containment
  research:[{topic, cost, spent, scientists}],                     // cost/spent in scientist-days
  production:[{id, item, engineers, qty, done, spent, paid, stalled}],
  deliveries:[{id, kind, itemId, n, etaT}],
  transfers:[{id, fromBaseId, kind, itemId, n, etaT}],             // P1 (multi-base); always [] in the MVP
  spotted:bool,                            // aliens know where it is (Missions)
  rentDue:int }                            // $ of prorated rent of crafts sold this month (BaseSim.sellCraft, §11.7)
```
- `research[i]`: `topic` is a topic id (including synthesised `interrogate_<unit>`). `cost` is fixed at start as
  `max(1, floor(topic.cost × RNG(80..120)/100))` (geo; `Data.researchRules.costRandPct`). Each day
  `spent += scientists`. The topic is done when `spent ≥ cost`.
- `production[i]`: `item` is a `Data.manufacture` id. `qty` is the order size (0 = «contínuo»). `done` counts units
  finished. `spent` is engineer-hours on the current unit. `paid` is true once the current unit's money and
  materials were taken. `stalled` is `null | 'funds' | 'materials' | 'hangar' | 'space' | 'storage'` (`storage`: the
  next unit would not fit in the stores, counting the materials it consumes; §11.7).
- `deliveries[i].kind`: `'item' | 'craft' | 'soldier' | 'scientist' | 'engineer'`. `itemId` holds the item id or the
  craft type, or null for personnel. `etaT` is the absolute arrival time.
- Free scientists = `scientists − Σ research.scientists`. Free engineers = `engineers − Σ production.engineers`.
- Derived values are never stored: capacities, radars, defences and hyper-wave (`BaseSim.capacities`, §5.6).

### 1.9 Soldiers and the memorial
```js
soldier = { id, name /* generated proper name, not translated */, nat /* soldierGen nationality id */, female,
  rank /* 0..5 = Data.ranks.soldier */, stats:{tu,sta,hp,brav,react,fire,thr,str,melee,psiStr,psiSkill},
  initial:{…same keys, at hire}, missions, kills, woundDays /* 0 = fit */, armour /* Data.armours id */,
  baseId, craftId /* null if not assigned */, loadout:{R, L, belt:[], pack:[]} /* template of item ids */,
  portraitSeed, hiredT, psi:{training:false} /* P2 */ }
dead[k] = { id, name, nat, female, rank, portraitSeed, missions, kills, armour, diedT, cause, where }
          // cause 'kia'|'mia'|'craft'|'base'; where = {kind, lon, lat}|null
```
- Recruit generation (`Soldiers.generate`, identical to the reference `Campaign.makeSoldier`) draws from `geo` in this
  order: `Data.pickNationality` (1), female `pct(soldierGen.femalePct)` (1), `Data.soldierName` (2, plus 2
  per re-roll: a name already worn by a living soldier in `G.soldiers` is re-drawn up to 8 times, then gets the suffix
  « II», « III»…; §11.10), `Data.rollSoldierStats` (11), `portraitSeed = int(0, 0x7fffffff)` (1). The recruit gets armour
  `soldierGen.armour`, an empty loadout, `rank 0` and `initial = clone(stats)`.
- A soldier with `woundDays > 0` cannot have a `craftId`. Making a soldier wounded also removes them from the craft.
- Seats: a craft holds at most `Data.crafts[type].seatsUI` soldiers (Skyranger 10, Avenger 12).
- Armour: a suit other than `coveralls` takes one item `armours[a].storeItem` out of `base.stores`. Changing it puts
  the old suit back into stores (BaseSim).

### 1.10 Crafts
```js
craft = { id, type, num, name:string|null, baseId,
  status: 'ready'|'out'|'patrol'|'returning'|'repair'|'rearm'|'refuel',
  lon, lat, dest: null | {kind:'ufo'|'site'|'alienBase'|'base', id} | {kind:'point', lon, lat},
  patrol:bool,          // true while holding at a point (half speed burn)
  speed:number kn,      // current speed: 0 at base, max while out/returning, max·patrolSpeedPct/100 on patrol
  fuel:int, hp:int,     // hp = remaining damage capacity (max Data.crafts[type].hp)
  weapons:[{type, ammo}|null],   // length = def.weapons; ammo null for beams (ammoMax null)
  soldiers:[soldierId],          // seat order
  equipment:{itemId:int},        // everything aboard for the ground team, ⊇ Σ templates of its soldiers
  dogfightId:string|null, lowFuel:bool, missionT:int|null /* t of launch */,
  acquiredT:int|null /* t the craft joined the base (addCraft); null in old saves ⇒ month start; §11.7 rent */ }
```
- Status meanings: `ready` = in the hangar and launchable. `out` = flying to `dest`, including chasing a UFO.
  `patrol` = holding at a point or waiting over a site. `returning` = flying home. `repair` / `rearm` / `refuel` =
  in the hangar, being serviced in that order (`Craft::checkup` order, orig), then `ready`.
- A craft in a dogfight keeps status `out` and has `dogfightId` set.
- **Equipment invariant:** `craft.equipment ⊇ Σ loadout templates of craft.soldiers` (as a multiset). The difference
  is loose cargo. Only `Campaign.applyEquip`, `Campaign.finishMission` and BaseSim cargo moves change
  `equipment`.

### 1.11 UFOs
```js
ufo = { id, type, missionId, race, region,      // region = mission region
  traj, wp /* index of the trajectory point being flown to */, lon, lat, dest:{lon,lat}|null,
  alt /* 0..4 = Data.altitudes */, speed /* current kn = def.speed × pct/100 */,
  status: 'flying'|'landed'|'crashed',
  dmg:int /* damage taken; crash when dmg > hp/2, destroyed when dmg ≥ hp (Data.ufoRules) */,
  detected:bool, hyper:bool /* identified by a hyper-wave decoder */,
  groundLeftS:int /* landed: seconds left on the ground */, crashLeftS:int /* crashed: seconds before the site vanishes */,
  lastSeen:{lon, lat, t}|null, objective:bool /* this UFO completes the mission objective */,
  targetBaseId:string|null /* retaliation assault run */, siteCity:string|null /* terror objective city */,
  siege:null|{baseId, shots:[{type, hit, dmg}]} /* assault run at the base: defences already fired (§5.9) */,
  garrison?:{crew:[{type, rank, tier, outside}], leftovers:{itemId:n}, crashed:bool, visits:int}
            /* only after a battle here without a win (§11.10): the aliens still on site and the items left on the ground */ }
```
- Crash and landed sites are UFO records with status `crashed` or `landed`. They are not in `G.sites`.
- A `crashed` UFO never moves. A `landed` UFO lifts off when `groundLeftS ≤ 0`.
- `garrison` (optional; absent on a site never fought) is written by `finishMission` after a battle that was not a win
  and read by `startMission` (§5.9). A UFO that lifts off and crashes again keeps it (`crashed` says whether the
  survivors already went through a crash).
- A destroyed UFO, or one that left Earth, is removed from `G.ufos`, and its id is removed from its mission's
  `liveUfos`.

### 1.12 Alien missions and alien memory
```js
alienMission = { id, type /* Data.alienMissions id */, region, race, wave /* next wave index */,
  ufoCounter /* UFOs already spawned in the current wave */, countdownS /* seconds to next spawn */,
  liveUfos:[ufoId], cityId:string|null /* terror */, targetBaseId:string|null /* retaliation: X-COM base found */,
  alienBaseId:string|null /* supply/base */, startedT, script:string|null /* script id that created it */ }
G.alien = { tables:{regionId:{missionType:weight}} /* remaining regional mission tables */,
            cities:[cityId] /* terror cities hit recently */, retaliations:[{month, region}] }
```
Missions owns `G.alien`. Its content may grow (plain JSON only) if this table documents every new key.

### 1.13 Terror sites
`site = {id, kind:'terror', missionId, deployment:'dep_terror_site', cityId, lon, lat, race, region, country,
leftS}`. A terror site is always visible. Each 30-min check does `leftS −= 1800`. At ≤ 0 the site expires (§3.2) for
`Missions.expiredPoints(G)` alien points: −500 in months 0–1, −1 000 from month 2 (ours, §11.6).
Ours: a craft flying to the site does **not** stop the timer (the orig "cheeky exploit" is removed).
A terror site is removed after **any** battle there (win, loss or abort; OpenXcom): the battle score already holds the
civilian losses, so there is no `terrorSiteExpired` on top. Ours (§11.8): a lost or aborted terror battle costs at least
`Missions.expiredPoints(G)` in civilians: `finishMission` passes it to the debrief as `terrorFloor`, which adds the line
`OV.Battle.TERROR_ABANDONED_KEY` with the shortfall (`−(floor − civilians killed by aliens × value)`, only when positive).

### 1.14 Alien bases
`alienBase = {id, lon, lat, race, region, country, missionId, discovered:bool, foundT:int|null, supplyT:int|null,
garrison?}` (`garrison` as in §1.11, after an assault that was not a win; a Supply Ship landing there deletes it: the base
is back to full strength).
Writers: Missions creates, supplies, reveals by agents or supply sighting, and removes after a won assault. World
reveals by patrol (§3.1, 10-min step).

### 1.15 Dogfights
```js
dogfight = { id, craftId, ufoId, dist /* 0..800 abstract units */, mode /* Data.dogfight.modeOrder */,
  weapons:[{slot, enabled, reload /* ticks */}], ufoReload, escapeT /* ticks to UFO break-off */,
  projectiles:[{from:'craft'|'ufo', slot, weapon, pos, hit:bool, dmg:int}], ticks, over:bool,
  outcome: null|'crashed'|'destroyed'|'escaped'|'disengaged'|'craftDestroyed'|'craftRetreated' }
```
At most `TUNE.MAX_DOGFIGHTS` (2) at once. A dogfight lives only while it runs. `Dogfight.finish` removes it, and a
save is refused while any exists (§7).

### 1.16 Flags
`flags = {interrogated, navigatorInterrogated, leaderInterrogated, commanderInterrogated, martianSolution,
cydoniaUnlocked /* = Data.researchFlags, set by research */, won, lost, lostReason}`.
`lostReason` is `'council' | 'debt' | 'baseLost' | 'cydonia'`. Only `Campaign.endGame` writes `won`, `lost` and
`lostReason`.
Ours (retroactive interrogation, `Data.researchEffects`): an interrogation still gives `leaderInterrogated` /
`commanderInterrogated` only when `alien_origins` / `martian_solution` is already researched (orig sequence), **and**
when `alien_origins` / `martian_solution` completes, the flag is also granted if a leader/commander (resp. commander) was
interrogated earlier (read from the `interrogate_<unit>` topics in `G.researched`; no new state). A commander questioned
"too early" is no longer a dead end to Cydonia.

### 1.17 Stats (lifetime counters; writer in parentheses)
`ufosDetected` (World), `ufosShotDown` and `ufosDestroyed` (Missions.onUfoDown), `missionsWon`, `missionsLost`,
`missionsAborted`, `aliensKilled`, `aliensCaptured` and `civiliansSaved` (Campaign.finishMission), `soldiersLost`
(Soldiers.kill), `terrorIgnored` (Missions), `craftsLost` (World.loseCraft).

---

## 2. Clock (`OV.Clock`, implemented)

```
TICK_S = 5 ; bits T5S=1, T10M=2, T30M=4, T1H=8, T1D=16, T1MO=32
SPEEDS = TUNE.GEO_SPEEDS = [1, 12, 60, 360, 720, 17280]   // ticks per 80 ms step: 5 s, 1 min, 5 min, 30 min, 1 h, 1 day
SPEED_KEYS = ['5s','1m','5m','30m','1h','1d']
advance(G, ticks=1) → mask of boundaries crossed in (t, t+5·ticks]; sets G.t. Only World.step calls it.
crossed(t0, t1) → mask ; ticksUntil(G|t, bit) → ticks (≥1) until the next boundary of that kind
date(G|t) → {y, m:0..11, d:1..31, h, min, s, wd:0=Sunday} ; monthIndex(G|t) ; monthStartT(monthIndex)
daysInMonth(G|t) ; dayOfYear(G|t) ; hourUTC(G|t) → 0..24 float
sunLon(G|t) → subsolar longitude = (12 − hourUTC)·15° ; declination(G|t) → 0 (geoConst.sun.seasons false)
isNightAt(G, lon, lat) → GMath.isNightAt
```
`T1MO` is always reported together with `T1D` (the month changes at a day boundary).

---

## 3. World loop: `OV.World.step(G, ticks)`

### 3.1 Order of handlers per tick (binding)
`step(G, ticks) → {ticks:int done, stopped:bool, reason:null|'event'|'dogfight'|'battle'|'ended'}`

Before the loop:
- **0a.** If `G.flags.won || G.flags.lost`, return `{ticks:0, stopped:true, reason:'ended'}`.
- **0b.** If `G.activeMission`, return `reason:'battle'`. If `G.dogfights.length`, return `reason:'dogfight'`.
- **0c.** If `G.plannedMonth < G.month`, call `Missions.planMonth(G)` (this catches up a campaign created before
  OV.Missions existed).

Then for each tick, `mask = Clock.advance(G, 1)` and run the steps below in this order:

| # | When | Function (owner) | What |
|---|---|---|---|
| 1 | 5 s | `World.moveCrafts(G)` | crafts `out`, `patrol`, `returning` move (§3.3); arrivals, contacts and dogfight requests |
| 2 | 5 s | `World.moveUfos(G)` | flying UFOs move toward `dest`. On arrival: `Missions.onUfoWaypoint(G, ufo)`. Landed UFOs: `groundLeftS −= 5`; at ≤ 0: `Missions.onUfoLiftOff(G, ufo)` |
| 3 | 5 s | `World.contacts(G)` | craft–UFO contacts that came from UFO movement (UFO reached a chasing craft); assault runs reaching an X-COM base: `baseAttack`, `Campaign.baseVolley` (defences fire first), armed non-transport crafts `ready` in that base's hangar scramble into dogfights (≤ `MAX_DOGFIGHTS`; World stops), and on the first tick with no dogfight left `Campaign.baseDefence(G, baseId, ufoId)` (§5.9) |
| 4 | 10 min | `World.burnFuel(G)` | fuel use, low-fuel auto return (§3.3) |
| 5 | 10 min | `World.patrolDiscovery(G)` | each patrolling craft (`patrol:true`) within 1 696 nm of an undiscovered alien base: `geo.pct(50 − 50·d/1696)` ⇒ discovered (`alienBaseFound`, how `'patrol'`) |
| 6 | 10 min | `Missions.scan10m(G)` | retaliation UFOs search for X-COM bases (REA §3.2 chance; sets `base.spotted`, `mission.targetBaseId`); ours: `countdownS ≥ TUNE.RETALIATION_WARNING_MIN·60` and `baseSpotted` (stop) |
| 7 | 30 min | `BaseSim.halfHourly(G)` | refuel crafts in status `refuel` (+`def.refuel`; Elerium craft consume `refuelItem`) |
| 8 | 30 min | `World.detect(G)` | radar detection and loss (§3.4) |
| 9 | 30 min | `Economy.ufoActivity30m(G)` | alien score: +1 per flying UFO, +2 per landed UFO, at the UFO's point (`Data.scoring.ufoActivity`) |
| 10 | 30 min | `Missions.think30m(G)` | wave countdowns (−1800 s each), UFO spawns, terror-site and crash-site timers (−1800 s each, expiry events) |
| 11 | 1 h | `BaseSim.hourly(G)` | production; repair (+`CRAFT_REPAIR_HP_H`) and rearm (`rearmPerHour`, using ammo from stores); deliveries and transfers whose `etaT ≤ t` |
| 12 | 1 day | `BaseSim.daily(G)` | construction (`daysLeft −1` → `facilityDone`), research (`spent += scientists` → `researchDone`) |
| 13 | 1 day | `Soldiers.daily(G)` | `woundDays −1` → `soldierRecovered` |
| 14 | 1 day | `Economy.daily(G)` | +`scoring.alienBasePerDay` (5) alien points per alien base (discovered or not) at its point |
| 15 | 1 day | `Missions.daily(G)` | alien-base supply rolls (6 %/day per base → `alien_supply` mission) |
| 16 | 1 day | `World.autosave(G)` | on day 1, 10 and 20 (`TUNE.AUTOSAVE_DAYS`) push `autosaveDue` |
| 17 | month | `Missions.monthEnd(G)` | agents reveal one undiscovered alien base (`alienBaseRevealMonthlyPct` 50 %, `alienBaseFound` how `'agents'`); infiltration pacts (`country.pact = true`, +150 alien points to that country, `pactSigned`) |
| 18 | month | `Economy.monthEnd(G)` → `report` | funding, upkeep, rating, council (§5.7); World pushes `monthEnd {report}` |
| 19 | month | World | `G.month = Clock.monthIndex(G)` |
| 20 | month | `Missions.planMonth(G)` | the new month's mission script (`Data.scriptsForMonth`); sets `G.plannedMonth = G.month` |
| 21 | month | `Economy.checkDefeat(G)` → reason \| null | if a reason is returned: `Campaign.endGame(G, 'lost', reason)` |

After the handlers of a tick: if any event with `stop:true` was pushed during this tick, or `G.flags` ended the game,
or a dogfight was created, step returns `{stopped:true, reason:'event'}` and leaves the rest of the tick budget
unused. Otherwise the loop continues until `ticks` are done.

**Idle coalescing (optional, for the 1-day speed).** If no craft is `out`, `patrol` or `returning`, and no UFO is
`flying`, World may advance several ticks in one `Clock.advance(G, k)` call. `k` must not exceed the smallest of:
`Clock.ticksUntil(G, T10M)`, the ticks until the earliest `landed` `groundLeftS` expiry, and the remaining budget.
The result must be **identical** to stepping 5 s at a time. World ships a test proving this:
`hash` after `step(G1, N)` equals `hash` after N× `step(G2, 1)`, from the same state over one game week.

### 3.2 Expiry and removal rules
- Terror site expires: `Economy.addScore(G,'alien', Missions.expiredPoints(G), site)` (`scoring.terrorSiteExpiredByMonth[month]`
  while the month has an entry — 500 in months 0–1 — else `scoring.terrorSiteExpired` 1 000), `stats.terrorIgnored++`, the
  site is removed, and `terrorSiteExpired {siteId, cityId, points}` is pushed. Crafts whose dest was the site get
  `targetLost`.
- Crash site expires: the UFO is removed and `crashSiteExpired {ufoId}` is pushed (non-stop). Crafts get `targetLost`.
- Landed UFO lifts off while a craft is flying to it: the craft's target becomes the flying UFO (it chases).
- UFO leaves Earth (last waypoint reached): removed; `ufoGone {ufoId}` if it was detected; crafts get `targetLost`.

### 3.3 Craft flight (World)
- **Aim point each tick.** For a flying UFO target, aim at
  `GMath.interceptPoint(craft, maxSpeed, ufo, ufo.dest, ufo.speed)`, falling back to the UFO position. Any other
  target: its position. `craft.speed` is set as in §1.10. Movement is
  `GMath.stepToward(craft, aim, craft.speed, 5)`.
- **Contact with a flying UFO.** This happens on the tick where the craft reaches the UFO's current position (its
  remaining distance ≤ its 5-s move), or the UFO reaches the craft (step 3).
  - Craft with at least one weapon that has ammo or is a beam, `ufo.speed ≤ def.speed`
    (`craftRules.engageRequiresSpeed`), and fewer than `MAX_DOGFIGHTS` running: `Dogfight.create` and
    `dogfightStart`. Ours: the speed rule does not apply to the assault Battleship of a retaliation against the craft's
    own base (`ufo.targetBaseId === craft.baseId`; it comes to the craft), and `canOrder` gives no `tooSlow` for it.
  - Otherwise, or for unarmed transports: shadow the UFO (`craft.lon/lat = ufo.lon/lat`) and keep chasing.
- **Arrival at a landed or crashed UFO, a terror site or an alien base.** Status becomes `patrol` (it waits there) and
  `craftArrived {craftId, target, prompt}` is pushed. `prompt` is `'mission'` if the craft is a transport with ≥ 1
  soldier, otherwise `'none'`.
- **Arrival at a point.** `patrol:true`, status `patrol`, `craftArrived {prompt:'patrol'}`.
- **Arrival at its base.** `speed 0`, position = base, status from checkup (repair → rearm → refuel → ready),
  `craftReturned`. Soldiers stay assigned and `equipment` stays aboard.
- **Lost target.** A target UFO that is no longer detected, a removed target, or an expired site: dest becomes
  `{kind:'point'}` at `ufo.lastSeen` or the last position, `patrol:true`, and `targetLost {craftId, target}` is pushed.
- **Fuel, every 10 min,** for crafts `out`, `patrol` and `returning`:
  `fuel −= Data.craftFuelPer10Min(type, craft.speed)`, floored at 0. Then, for a craft not already returning, compute
  `need = ceil(distNm(craft, base) / def.speed × 6 + TUNE.LOW_FUEL_MARGIN_10M) × craftFuelPer10Min(type, def.speed)`.
  If `fuel ≤ need`: `lowFuel = true`, recall (status `returning`), and push `craftLowFuel`. A craft at fuel 0 still
  flies home (it is never lost to fuel).
- `World.loseCraft(G, craftId, reason)` removes the craft from `G.crafts` and its base. Soldiers aboard die through
  `Soldiers.kill(…, 'craft')`. It adds `Economy.addScore(G,'xcom', −def.score, craft)`, does `stats.craftsLost++`,
  closes its dogfight, and pushes `craftLost {craftId, type, reason, soldiers:[ids]}`.

### 3.4 Detection (World, every 30 min, `geo` stream)
For every UFO with status `flying` or `landed` (crashed UFOs keep their flag):
1. Inside the range of any completed hyper-wave decoder: `detected = hyper = true`.
2. Else, if already `detected`: it stays detected while inside any radar circle. Those are completed base radar
   facilities, each with its own `radarRange`, and the craft radar of airborne crafts (672 nm). Otherwise:
   `detected = false`, and `ufoLost {ufoId}` is pushed.
3. Else (undetected): it is detected at once if inside an airborne craft's radar. Otherwise, for each base,
   `chance = floor(Σ radarChance of completed radars whose range covers the UFO × (100 + visibility) / 100)` and
   `geo.int(0,99) < chance` detects. Visibility = `Data.ufos[type].visibility` (size) + altitude modifier: landed
   −30 (it replaces the size modifier), very low −20, low −10, high 0, very high −10 (REA §3.1).
4. On a new detection: `stats.ufosDetected++`, `lastSeen` updated, `ufoDetected {ufoId, hyper}` pushed. While
   detected, `lastSeen = {lon, lat, t}` each check. `G.debug.revealUfos` forces step 1 semantics without `hyper`.
5. Ours: the assault Battleship of a retaliation is created detected by `Missions.spawnUfo` (`ufoDetected`; the base was
   warned by `baseSpotted`) and is never lost by step 2.

---

## 4. Events (`G.events`)

Shape: `{t:type, at:G.t, stop:bool, ...fields}`. Push them only with `OV.Campaign.event(G, type, data)`, which
takes `stop` from `OV.Campaign.EVENTS` (data may override `stop`). The UI drains the queue with
`G.events.splice(0)` after each `World.step` (GeoUI), or after the call that produced the events (DogfightUI,
BaseUI, CampaignUI).

**stop:true** means World.step stops after the current tick. The Geoscape drops to the 5-s speed, shows the popup,
and stays paused while the popup is open (only the top scene thinks). **stop:false** means a toast, or nothing.

| type | stop | fields | emitted by | UI reaction (owner) | suggested i18n key |
|---|---|---|---|---|---|
| `ufoDetected` | ✔ | `ufoId, hyper` | World | popup: size, altitude, heading, speed (type, race and mission only if `hyper`); «Interceptar» / «Centrar» (GeoUI) | `ev.ufoDetected` |
| `ufoLost` | ✔ | `ufoId` | World | popup (GeoUI) | `ev.ufoLost` |
| `ufoLanded` | ✔ (only if detected) | `ufoId` | Missions | popup with «Enviar equipa» (GeoUI) | `ev.ufoLanded` |
| `ufoLiftOff` | – | `ufoId` | Missions | toast | `ev.ufoLiftOff` |
| `ufoCrashed` | ✔ | `ufoId, craftId, lon, lat` | Missions.onUfoDown | popup «OVNI abatido» + «Enviar equipa» (GeoUI; DogfightUI closes) | `ev.ufoCrashed` |
| `ufoDestroyed` | ✔ | `ufoId, craftId, type, score` | Missions.onUfoDown | popup (also when it crashed into the sea) | `ev.ufoDestroyed` |
| `ufoEscaped` | ✔ | `ufoId, craftId` | Dogfight | popup «O OVNI fugiu» | `ev.ufoEscaped` |
| `ufoGone` | – | `ufoId` | Missions | toast | `ev.ufoGone` |
| `craftArrived` | ✔ | `craftId, target:{kind,id\|lon,lat}, prompt:'mission'\|'patrol'\|'none'` | World | `mission` → «Iniciar missão?» → `CampaignUI.launchMission`; `patrol` → «Patrulhar / Regressar» (GeoUI) | `ev.craftArrived.*` |
| `craftLowFuel` | ✔ | `craftId` | World | popup | `ev.craftLowFuel` |
| `craftReturned` | – | `craftId, baseId` | World | toast | `ev.craftReturned` |
| `craftReady` | – | `craftId` | BaseSim | toast | `ev.craftReady` |
| `craftRearmShort` | – | `craftId, itemId, what:'ammo'\|'fuel'` | BaseSim | toast «Sem munições/combustível em armazém» — once per service cycle, when the other weapons finished rearming (orig: notify once, stop rearming that weapon) | `ev.craftRearmShort` |
| `craftLost` | ✔ | `craftId, type, reason:'dogfight'\|'mission'\|'base', soldiers` | World.loseCraft | popup | `ev.craftLost` |
| `targetLost` | ✔ | `craftId, target` | World | popup «Alvo perdido» with «Patrulhar / Regressar» | `ev.targetLost` |
| `interceptOrderInvalid` | – | `craftId, reason` | World (an order became invalid by itself) | toast | `ev.orderInvalid.<reason>` |
| `dogfightStart` | ✔ | `dogfightId, craftId, ufoId, scramble?:true` | World | `DogfightUI.open(G, dogfightId)`; `scramble` = a craft that took off from a base under attack | `df.start` |
| `dogfightEnd` | – | `dogfightId, craftId, ufoId, outcome` | Dogfight.finish | DogfightUI closes that panel | `df.end.<outcome>` |
| `researchDone` | ✔ | `baseId, topic, article, unlocked:[topicId], manufacture:[manufactureId], flags:[flag]` | BaseSim | popup «Investigação concluída» → «Ver Ufopédia» (`Ufopaedia.open`) and «Novo projeto» (`BaseUI.open(G, baseId, 'research')`) (GeoUI) | `ev.researchDone` |
| `productionDone` | ✔ | `baseId, item, qty` | BaseSim | popup → «Ir para a base» | `ev.productionDone` |
| `productionStalled` | ✔ (first time per order) | `baseId, item, reason` | BaseSim | popup | `ev.productionStalled.<reason>` |
| `facilityDone` | ✔ | `baseId, type, x, y` | BaseSim | popup | `ev.facilityDone` |
| `deliveryArrived` | ✔ | `baseId, kind, itemId, n` | BaseSim | popup «Chegaram encomendas» | `ev.deliveryArrived.<kind>` |
| `transferArrived` | – | `baseId, kind, itemId, n` | BaseSim (P1) | toast | `ev.transferArrived` |
| `soldierRecovered` | – | `soldierId, baseId` | Soldiers | toast | `ev.soldierRecovered` |
| `terrorSite` | ✔ | `siteId, cityId, lon, lat, race` | Missions | red popup with siren, «Enviar equipa» | `ev.terrorSite` |
| `terrorSiteExpired` | ✔ | `siteId, cityId, points` | Missions | popup (−`points`: 500 in months 0–1, 1 000 after; the UI shows `points`, and `Missions.expiredPoints(G)` gives the current stake for the `terrorSite` popup) | `ev.terrorSiteExpired` |
| `crashSiteExpired` | – | `ufoId` | Missions | toast | `ev.crashSiteExpired` |
| `landedUfoGone` | – | `ufoId` | Missions | toast (a landed UFO we targeted lifted off and was lost) | `ev.landedUfoGone` |
| `alienBaseFound` | ✔ | `alienBaseId, how:'patrol'\|'agents'\|'supply'` | World / Missions | popup + centre the globe | `ev.alienBaseFound` |
| `alienBaseBuilt` | – | `alienBaseId` | Missions | nothing (hidden); debug toast | — |
| `retaliation` | – | `missionId, region` | Missions | nothing (hidden) unless `G.debug` | — |
| `baseSpotted` | ✔ | `baseId, missionId, etaS` | Missions.scan10m | red popup «Os alienígenas localizaram a base — ataque iminente» with the earliest attack time (`etaS` seconds from now, ≥ 24 h) and advice: bring the squad home, keep soldiers and interceptors at the base, build defences; «Centrar»/«Ir para a base» | `ev.baseSpotted` |
| `baseAttack` | ✔ | `baseId, ufoId` | World.contacts | popup «A base está a ser atacada!» (defences have fired; ready armed crafts are taking off), then the dogfights, then the result | `ev.baseAttack` |
| `baseDefence` | ✔ | `baseId, ufoId, shots:[{type, hit, dmg}], result:'ufoDestroyed'\|'repelled'\|'lost', soldiersLost:[ids]` | Campaign.baseDefence | result popup (CampaignUI) | `ev.baseDefence.<result>` |
| `pactSigned` | – | `countryId` | Missions.monthEnd | listed in the month report | `ev.pactSigned` |
| `monthEnd` | ✔ | `report` (§5.7) | World (step 18) | `CampaignUI.monthReport(G, report)` | `mr.*` |
| `gameOver` | ✔ | `reason` | Campaign.endGame | `CampaignUI.gameOver(G, reason)` | `go.<reason>` |
| `victory` | ✔ | — | Campaign.endGame | `CampaignUI.victory(G)` | `vic.*` |
| `autosaveDue` | – | — | World | `CampaignUI.autosave(G)` writes slot `auto` | — |

A module that needs a new event type adds it to `OV.Campaign.EVENTS` through a change request to the architect, and
to this table. Unknown types still get pushed, as `stop:false`.

---

## 5. Module APIs

All mutating functions take `G` first and ids, never object references (`baseId`, `craftId`, …). They return
`{ok:true, …}` or `{ok:false, reason}`. `reason` is a short id that the UI turns into
`T('<area>.err.' + reason)`. Query functions return fresh plain data.

### 5.1 `OV.Clock` — §2 (implemented).

### 5.2 `OV.GMath` (implemented; points are any `{lon, lat}`)
```
D2R, NM_PER_DEG (60), EARTH_RADIUS_NM, wrapLon(lon), clampLat(lat)
vec(lon,lat)→[x,y,z] ; toLL(v)→{lon,lat} ; dot ; cross ; normalize
angle(a,b)→rad ; distNm(a,b) ; distNmLL(lon1,lat1,lon2,lat2) ; withinNm(a,b,nm)
bearing(a,b)→0..360 (0 = north) ; destination(p, bearingDeg, nm)→{lon,lat}
lerp(a,b,f) ; moveToward(a,b,nm) / stepToward(a,b,knots,seconds) → {lon,lat,arrived,remainingNm}
interceptPoint(chaser, chaserKn, target, targetDest, targetKn) → {lon,lat,hours}|null
inRect(lon,lat,rect) ; inAreas(areas,lon,lat) ; regionAt ; countryAt (orig rectangles — scoring, funding)
countryAtMap(lon,lat,reach?) (real outlines — presentation only) ; isLand(lon,lat)
sunLL(G) ; sunVec(G) ; sunElevation(G,lon,lat)→deg ; dayPhase(G,lon,lat)→'day'|'dusk'|'night'
isNightAt(G,lon,lat) ; missionShade(G,lon,lat) → TUNE.SHADE_DAY|SHADE_DUSK|SHADE_NIGHT
randomPointInAreas(rng, areas) ; randomLandPoint(rng, areas, tries=missionRules.landPointTries)→{lon,lat,land}
randomPointAround(rng, center, minDeg, maxDeg) (zone 5: geoConst.entryRingDeg)
path(a,b,maxStepDeg=2)→[[lon,lat]…] ; smallCircle(center, radiusNm, n=48)→[[lon,lat]…]
```
Day phases use `geoConst.sun`: elevation > 0° is day, −6°..0° is dusk, below −6° is night.
`randomLandPoint` picks a rectangle uniformly, then a uniform point in it, up to 10 times (orig). If none is on land
it returns the last point with `land:false`. Missions then lands for 5 s only (immediate take-off, orig).

### 5.3 `OV.World` (world.js)
```
step(G, ticks) → {ticks, stopped, reason}                    §3.1
order(G, craftId, target) → {ok, reason?, warn?}            any craft: ready (launch) or airborne (re-target)
launch(G, craftId, target) → same, but requires status 'ready'
recall(G, craftId) → {ok}                                    order(…, {kind:'base', id: craft.baseId})
patrol(G, craftId, lon, lat) → {ok}                          order(…, {kind:'point', lon, lat})
canOrder(G, craftId, target) → {ok, reason?, warn?}          pure check for the UI lists
loseCraft(G, craftId, reason)                                §3.3
radarCircles(G) → [{lon, lat, rangeNm, kind:'small_radar'|'large_radar'|'hyper_wave_decoder'|'craft', baseId|craftId}]
moveCrafts, moveUfos, contacts, burnFuel, patrolDiscovery, detect, autosave (exported for tests)
```
`target` is `{kind:'ufo'|'site'|'alienBase'|'base', id}`, `{kind:'point', lon, lat}` or `'home'`.
- Blocking reasons: `noCraft`, `notReady` (status `repair`/`rearm`/`refuel` with fuel < 50 % or hp < 50 %, orig
  allows partial launch above that), `inDogfight`, `noTarget` (missing, undetected UFO, `cydonia`), `noSoldiers`
  (transport to a ground target with no fit soldier aboard), `noFuel` (fuel 0).
- Warnings (`ok:true, warn`): `noWeapons` (unarmed craft to a flying UFO: it can only shadow it), `tooFar` (fuel will
  not cover the round trip), `tooSlow` (UFO currently faster than the craft).
- Launch sets status `out`, `missionT = t`, `patrol = false`, `lowFuel = false`.
- **Launch also tops up equipment:** for each soldier aboard, the template items missing from `craft.equipment`
  move from `base.stores` into `craft.equipment`, if available.

### 5.4 `OV.Missions` (missions.js)
```
planMonth(G)                                   runs Data.scriptsForMonth(G.month, G.difficulty, G.researched); sets plannedMonth
think30m(G)                                    countdowns, spawns, site/crash timers (§3.1 step 10, §3.2)
scan10m(G) ; daily(G) ; monthEnd(G)            §3.1 steps 6, 15, 17
spawnMission(G, type, {region?, race?, cityId?, delayMin?, targetBaseId?, alienBaseId?, script?}) → alienMission
spawnUfo(G, missionId) → ufo                   next UFO of the current wave at a zone-5 entry point
onUfoWaypoint(G, ufoId)                        next leg, landing (status 'landed', groundLeftS = traj.groundS or 5 at sea;
                                               months < NIGHT_LANDING_MONTHS, night on land: until 1 h after daylight, §11.10),
                                               objective (terror site / alien base / supply / assault run) or exit
onUfoLiftOff(G, ufoId)                         mission points (Data.scoring.missionPoints) for 'score' missions, next leg
onUfoDown(G, ufoId, how:'crashed'|'destroyed', craftId)
     → crash over water ⇒ destroyed; crashed: status 'crashed', crashLeftS = RNG(TUNE.CRASH_SITE_HOURS)·3600, speed 0;
       X-COM score ufo.score (crash) or scoreDestroyed; next-wave delay missionRules.shootDownDelayMin;
       shoot-down retaliation roll (ai) from missionRules.shootDownRetaliationFromMonth; stats; ufoCrashed|ufoDestroyed
onSiteCleared(G, siteRef, result:'win'|'abort'|'loss')
     → terror site: removed after any result (OpenXcom; no terrorSiteExpired, no −1 000 on top of the battle score);
       win: remove the UFO / alien base (+ end its mission; alien base: also +scoring.alienBaseDestroyed is already
       inside the battle score, do not add again); crash/landed/alien base abort or loss: nothing (keeps its timer)
onResearch(G, topicId)                         'immediate' scripts (researchRetaliation after martian_solution)
expiredPoints(G) → int                         alien points of a terror site ignored now (ours: 500 in months 0–1, else 1 000)
regionWeights(G) → {regionId: weight}          table-mission region weights (tests, debugging)
```
Mission rules follow `Data.alienMissions`, `Data.missionScripts`, `Data.missionRules`, `Data.raceWeights` and
DESIGN §3.18. Region choice: `missionRules.nearBaseWeightMul` (4) applies to regions whose centroid is within `nearBaseNm`
(2 600 nm, the Large Radar range; ours §11.6) of any X-COM base; terror cities use `terrorNearBaseWeightMul` (4) within
`terrorNearBaseNm` (4 000 nm). Alien bases and Battleships do not pick the Muton race when the mission needs a commander
(DATA_API "win-path risk"): if `ai.weighted` returns `muton` for an `alien_base` mission or a battleship wave, reroll
once without Muton.

### 5.5 `OV.Dogfight` (dogfight.js)
```
create(G, craftId, ufoId) → dogfight            pushes into G.dogfights, craft.dogfightId; dist = Data.dogfight.open; mode 'standoff'
tick(G, dogfightId) → events[]                  one 30-ms tick (Data.dogfight); rolls with the combat stream
setMode(G, dogfightId, mode) ; toggleWeapon(G, dogfightId, slot) ; disengage(G, dogfightId) = setMode 'disengage'
hitChance(G, dogfightId, slot) → int %          Data.dogfightHitChance(weapon.acc, ufo size)
autoResolve(G, dogfightId, mode='standard', maxTicks=20000) → outcome   headless (bot, tests): ticks until over
finish(G, dogfightId)                           applies the outcome and removes the dogfight (called by tick when over)
```
- Outcome application in `finish`:
  - `crashed` / `destroyed` → `Missions.onUfoDown`; craft `returning`.
  - `escaped` → `ufoEscaped`; craft `returning`.
  - `disengaged` / `craftRetreated` → craft `returning`.
  - `craftDestroyed` → `World.loseCraft(G, craftId, 'dogfight')`.
- Then `dogfightEnd` is pushed and `craft.dogfightId = null`.
- Craft damage lowers `craft.hp`. UFO damage raises `ufo.dmg`. Ammo is taken from `craft.weapons[slot].ammo`.
- Ours: an assault-run UFO (`ufo.targetBaseId`) never breaks off (it is committed to its target); when its escape
  countdown ends the dogfight ends `disengaged` (it flies past to the base).
- Tick-level events (returned, **not** pushed to `G.events`) feed the overlay animation:
  `{t:'df.fire', from, slot}`, `{t:'df.hit', target:'ufo'|'craft', dmg}`, `{t:'df.miss', from}`, `{t:'df.move', dist}`,
  `{t:'df.end', outcome}`.

### 5.6 `OV.BaseSim` (base.js)
```
capacities(G, baseId) → { personnel:{cap,used}, labs:{cap,used}, workshops:{cap,used}, storage:{cap,used /* float, 1 decimal */},
                          aliens:{cap,used}, crafts:{cap,used}, radars:[{type, rangeNm, chance}], defences:[{type, power, hit}],
                          hyper:bool, upkeep:int }        only completed facilities count (orig)
canPlace(G, baseId, type, x, y) → reason|null   'cells'|'overlap'|'notConnected'|'lift'|'research'|'funds'
build(G, baseId, type, x, y) → {ok,reason}       pays cost; daysLeft = def.days (debug.instantBuild ⇒ 0)
canDismantle(G, baseId, x, y) → reason|null ; dismantle(G, baseId, x, y) → {ok,reason}   no refund; refused if it breaks
                                                 connectivity, is the lift, or drops a capacity **that this facility
                                                 provides** below its use (hangars: crafts + deliveries + paid craft
                                                 production orders, as freeHangars)
hire(G, baseId, kind:'soldier'|'scientist'|'engineer', n) → {ok,reason}   pays TUNE.*_HIRE; delivery after DELIVERY_PERSONNEL_H
sack(G, baseId, kind, nOrSoldierId) → {ok,reason}     free staff only; a sacked soldier's armour/items return to stores
buy(G, baseId, itemIdOrCraftType, n) → {ok,reason}    Data.items[id].buy or Data.crafts[type].buy; ETA item.deliveryH ‖ DELIVERY_ITEMS_H ‖ def.deliveryH
sell(G, baseId, itemId, n) → {ok,reason}              immediate, Data.items[id].sell; live aliens never (Data.liveAliensSellable)
canSellCraft(G, craftId) → reason|null ; sellCraft(G, craftId) → {ok, price, rent}|{ok:false, reason}
                                                     'noCraft'|'away' (not in its hangar, in a dogfight or on a mission)|'crew'
                                                     (soldiers aboard); +Data.crafts[type].sell; fitted weapons, their loaded ammo
                                                     (whole items) and the cargo go to stores; the rent stops, the hangar frees;
                                                     `rent` = craftRentDue, added to base.rentDue (charged at month end, §11.7)
craftRentDue(G, craftId) → $                          rent × time held this month (since max(month start, acquiredT)) / month length
moveCargo(G, craftId, itemId, n) → {ok,reason}        n > 0 stores→craft.equipment, n < 0 back (craft at its base)
setArmour(G, soldierId, armourId) → {ok,reason} ; assignSoldier(G, soldierId, craftId|null) → {ok,reason}
fitWeapon(G, craftId, slot, weaponType|null) → {ok,reason}   launcher items from/to stores; ammo starts 0 → 'rearm'
startResearch(G, baseId, topic, scientists) → {ok,reason}   'unavailable'|'labs'|'scientists'|'busy'; consumes needItem / live alien
setScientists(G, baseId, topic, n) ; cancelResearch(G, baseId, topic) → {ok, returned:unitType|null}
                                                     (a consumed item is not returned, orig; ours: the live alien of an
                                                     interrogation goes back to containment, even over capacity)
startProduction(G, baseId, item, engineers, qty) → {ok,reason}   'unavailable'|'workshops'|'engineers'|'hangar' (an order whose
                                                     first unit cannot be paid or stored starts stalled, §1.8)
setEngineers(G, baseId, productionId, n) ; setQty(G, baseId, productionId, qty) ; cancelProduction(G, baseId, productionId)
halfHourly(G) ; hourly(G) ; daily(G)                 §3.1 steps 7, 11, 12
completeResearch(G, baseId, topic)                   exported for tests/debug: same path as daily completion
```
- **Research completion** (single path):
  1. `fx = Data.researchEffects(topic, G.researched, G.flags)` is taken **before** marking.
  2. Push `topic` to `G.researched`, set the flags in `fx.flags`, and append `topic.article` to `G.ufopaedia` (no
     duplicates).
  3. Free article: `fx.freeArticle` `'race'` → `race_<race>`, `'ufo'` → `ufo_<type>` for every type in
     `G.seen.ufoTypes`.
  4. `Economy.addScore(G,'research', fx.points)`, then `Missions.onResearch(G, topic)`.
  5. Push `researchDone` with `unlocked` = topics newly in `Campaign.availableResearch`, and `manufacture` = ids newly
     in `availableManufacture`.
- **Production**: workshop use = Σ (engineers + `Data.manufacture[item].space`). Each hour, if not `paid`, pay
  `cost` and the materials; if that is impossible (funds, materials, hangar for a craft, or stores: the product must
  fit after the materials leave — `stalled:'storage'`), set `stalled` and push `productionStalled` once. Otherwise
  `spent += engineers`. A unit is done when `spent ≥ hours`; then `spent −= hours`, `paid = false`, and the product
  goes in. Items and armour go to `stores`. A craft goes through `Campaign.addCraft` and needs a free hangar (else
  `stalled:'hangar'`). The order is complete at `done == qty` (never if `qty == 0`).
- **Craft maintenance** (status chain repair → rearm → refuel → ready):
  - repair: `hp += CRAFT_REPAIR_HP_H` per hour.
  - rearm: each weapon gains `rearmPerHour` ammo per hour (cannon 100 = 2 × `cannon_rounds`), using
    `ammoItem` from stores; a weapon whose ammo is out of stock is skipped; when no weapon is still rearming, push
    `craftRearmShort` once per short item and go to the next status. A `craft_ammo` delivery sets `ready` crafts with
    such a weapon back to `rearm`.
  - refuel: `+def.refuel` per 30 min; Elerium craft use 1 `elerium_115` per refuel step.
  - `craftReady` is pushed when the chain finishes.
- Personnel delivered → `Soldiers.generate` + `Campaign.addSoldier`, or `scientists` / `engineers +=`. Craft
  delivered → `Campaign.addCraft` (weapons empty).

### 5.7 `OV.Economy` (economy.js)
```
addScore(G, side:'xcom'|'alien'|'research', pts, lon?, lat?)   region/country via GMath (research: no position)
ufoActivity30m(G) ; daily(G)                                    §3.1 steps 9, 14
upkeep(G) → {facilities, salaries, crafts, total}               Data.monthlyUpkeep over all bases (completed facilities only);
                                                                crafts includes base.rentDue (reset to 0 by monthEnd)
income(G) → int                                                 Σ funding of countries without pact
rating(G) → int                                                 current month: xcom.total + research + bonus − alien.total
ratingKey(G, rating?) → 'rating.*'                              Data.ratingKey(rating, G.difficulty)
monthEnd(G) → report ; checkDefeat(G) → null|'council'|'debt'|'baseLost'
```
- **Month end.** Country changes follow REA §8.1 exactly, with `geo` rolls in `G.countries` order:
  `good = floor(xcomTotal/10) + countryXcom`, `bad = floor(alienTotal/20) + countryAlien`, delta in $1000 steps,
  capped at `fundingCap`, pact ⇒ 0.
- The council bonus (`TUNE.COUNCIL_BONUS`) is added to the X-COM side when `endedMonth + 1 ≥ COUNCIL_BONUS_FROM_MONTH`
  (from the February report on).
- `funds += income − upkeep`. Income is the funding of every country without a pact **plus** the countries whose pact
  was signed at this month end (`pactSigned` from step 17): they still pay the month that ended (SavedGame::monthlyFunding,
  orig). The +150 pact points that `Missions.monthEnd` added stay in `score.all` but are subtracted from `alienTotal`
  before the rating and the funding changes (Country::newMonth adds them after the totals, orig).
- `council.badMonths` counts consecutive months with `rating ≤ T` (`TUNE.RATING_THRESHOLD[difficulty]`).
  `council.debtMonths` counts consecutive month ends with `funds ≤ TUNE.DEBT_LIMIT`.
- Then: push `history` and `reports`, push each country's `history` (12 max), add `score.month` into `score.all`, and
  reset `score.month = Campaign.newScoreMonth()`.
- The report:
```js
report = { month /* ended monthIndex */, y, m, rating, ratingKey, councilKey:'council.pleased'|'council.satisfied'|'council.dissatisfied',
  xcom, alien, research, councilBonus, income, upkeep:{facilities, salaries, crafts, total}, fundsBefore, fundsAfter,
  countries:[{id, before, after, delta, mood, pact, newPact}], debtWarning:bool, badMonths, debtMonths,
  alienBaseRevealed:alienBaseId|null, defeat:null|reason }
```
- `checkDefeat`: `badMonths ≥ 2` → `'council'`, `debtMonths ≥ 2` → `'debt'`, no base left → `'baseLost'`.
  `debtWarning` is set the first time `debtMonths == 1`.

### 5.8 `OV.Soldiers` (soldiers.js)
```
generate(G, {baseId, rng?}) → soldier (id assigned, NOT inserted; same draw order as Campaign.makeSoldier, §1.9)
applyMission(G, soldierId, {exp, hpLost, kills}, rng) → {gains:{stat:+n}, promotedTo:int|null}
     OV.Morale.postMission(stats, exp, rng) → stats/gains/secondary; rank 0 && secondary ⇒ rank 1 (promotedTo 1);
     missions+1; kills+=; woundDays = ceil(hpLost × rng.int(WOUND_RECOVERY_MIN, MAX)/100); wounded ⇒ off the craft
promotions(G) → [{id, from, to}]   quotas TUNE.PROMO_SGT_DIV / CPT_DIV / COL_DIV / CMD_MIN over all living soldiers,
                                   promotion score DESIGN §3.2; highest score among eligible rank-below promoted first
daily(G)                           heal (§3.1 step 13)
kill(G, soldierId, cause, where?) → memorial entry   removes from G.soldiers, base and craft; unequips armour (lost);
                                   pushes G.dead; stats.soldiersLost++
value(soldier) → 20 + missions + Data.ranks.soldier[rank].scoreBonus
promotionScore(soldier) → int
```

### 5.9 `OV.Campaign` (campaign.js)
**Section A (implemented by the architect):**
```
SCHEMA, STREAMS, EVENTS, ID_PREFIX
newCampaign({difficulty=0, seed=1, baseLonLat={lon:-9.14,lat:38.72}, baseName=null}) → G   throws if the base point is not land
rng(G, stream) ; nextId(G, prefix) ; craftNumber(G, type) ; rebuildDerived(G) ; hash(G) → uint32
event(G, type, data?) → ev ; endGame(G, 'won'|'lost', reason?) → ev|null ; newScoreMonth() ; emptyLoadout()
findBase / findCraft / findSoldier / findUfo / findAlienMission / findSite / findAlienBase / findDogfight (G, id) → obj|null
baseOf(G, craftOrSoldier) ; targetOf(G, ref) → {kind, id, obj, lon, lat}|null ; removeById(array, id)
makeSoldier(G, {baseId, rng?}) ; addSoldier(G, soldier) ; addCraft(G, baseId, type, {weapons?, equipment?}) → craft
defaultLoadouts(G, craftId)
```
`newCampaign` does the following, in this order (and its RNG use is fixed):
1. Builds the skeleton. Streams are `OV.RNG.streams(seed)`, saved as uint32.
2. Country funding: `geo.int(base, 2·base)` k$ for each country in `Data.countries` order. These are scaled to exactly
   `FUNDING_TOTAL/1000` k$ (floor, then the leftover k$ go one each to the largest remainders, ties by order).
   `funds = 6 000 000`.
3. Base `b1` from `Data.startingBase`: orig layout, 10 scientists, 10 engineers, orig stores plus 3 Medi-Kits and
   6 Electro-flares.
4. Crafts `c1` Skyranger-1 (orig cargo), `c2`/`c3` Interceptor-1/2 (Stingray 6 + Cannon 200). 1 Medi-Kit and 4
   Electro-flares move from stores to the Skyranger (ours: teach triage and night play on mission 1).
5. `Data.startingBase.soldiersByDifficulty[difficulty]` soldiers — 10 / 10 / 8 (ours §11.6; orig 8) —
   (`OV.Soldiers.generate` if present, else `makeSoldier`; same draws), seated on the Skyranger up to its `seatsUI`, then
   `defaultLoadouts`:
   - strongest soldier: Heavy Cannon + AP/HE;
   - worst Firing: pistol;
   - everyone else: rifle + 2 clips + grenade;
   - first 4 riflemen: an Electro-flare;
   - strongest rifleman: the Medi-Kit.
6. `OV.Missions.planMonth(G)` if OV.Missions exists. Otherwise `plannedMonth` stays −1 and World.step runs it first
   (§3.1 0c).

**Section B (campaign engineer; append after the marker in `campaign.js`):**
```
availableResearch(G, baseId) → [topicId]   Data.researchAvailable(G.researched, G.flags, base.stores, base.aliens)
                                           minus topics already running in any base
availableManufacture(G, baseId) → [manufactureId]   Data.manufactureAvailable(G.researched)
equipPool(G, craftId) → {squad, stores}    input for OV.InventoryUI.equipScreen
applyEquip(G, craftId, {loadouts, stores}) applies the equip screen result (rules below)
briefingMeta(G, mission) → meta
startMission(G, siteRef, craftId, {settings}?) → mission       (mutates: map draw, G.activeMission)
cancelMission(G) → bool                                        (leaves the briefing: G.activeMission = null)
reseedMap(G, salt) → G.rng.map                                 (mutates only G.rng.map; retry with a fresh map, below)
finishMission(G, B) → model                                    (mutates: everything after a battle)
baseDefence(G, baseId, ufoId) → {result, shots, soldiersLost}
```

**`siteRef`** is `{kind:'ufo', id}` (status `landed`/`crashed`), `{kind:'site', id}` (terror),
`{kind:'alienBase', id}` (must be `discovered`) or `{kind:'cydonia'}`.
- Requirements: the craft is a transport with ≥ 1 fit soldier. It is at the site (status `patrol` there) or, for
  Cydonia, it is an `avenger` at base with status `ready` and `G.flags.cydoniaUnlocked`.
- Violations throw `Error('campaign.err.<reason>')`. The UI checks `canOrder` and craft status first.

**`startMission` mapping (exact object accepted by `OV.Battle.create`):**
```js
mission = {
  kind:   ufo.status==='crashed' ? 'crash' : ufo.status==='landed' ? 'landed' : site ? 'terror' : alienBase ? 'alienBase' : 'cydonia',
  siteId: ufo.id | site.id | alienBase.id | null,      craftId: craft.id,
  ufoType: ufo ? ufo.type : null,
  terrain: crash/landed → Data.terrainAt(ufo.lon, ufo.lat) ; terror → 'URBAN' ; alienBase → 'ALIENBASE' ; cydonia → 'MARS',
  shade:  GMath.missionShade(G, lon, lat)  (cydonia/alienBase: omit → battle defaults),
  night:  GMath.dayPhase(G, lon, lat) === 'night',
  race:   ufo.race | site.race | alienBase.race | 'mixed',
  month:  G.month,   difficulty: G.difficulty,   seed: Campaign.rng(G,'map').u32(),
  deploymentId: null (Battle derives: UFO deployment, dep_terror_site, dep_alien_base, dep_cydonia),
  craftType: craft.type,
  squad: [ for soldier of craft.soldiers where woundDays===0, first seatsUI:
           { soldierId:s.id, name, nat, female, rank, stats:clone(s.stats), armour:s.armour, portraitSeed, missions,
             loadout: funded(s.loadout) } ],
  craftItems: pool left after funding (loose cargo; Battle skips battle:false items),
  researched: G.researched.slice(),
  settings: opts.settings || {}            // {instantGrenades} from OV.Game.settings, passed by CampaignUI
  meta: briefingMeta(G, mission)           // ignored by Battle; used by the briefing scene
  garrison: clone(obj.garrison)            // only when the UFO / alien base has one (§11.10): Battle deploys exactly
                                           // garrison.crew (no crew table, no crash roll if garrison.crashed) and a win
                                           // adds garrison.leftovers to the recovered items
}
```
- `funded(template)`: copy `craft.equipment` into `pool`. Go through slots R, L, belt…, pack… in order. Take each item
  from `pool` if `pool[item] > 0`, otherwise drop it from the slot.
- `meta = {time: dayPhase, cityKey: site ? 'city.'+cityId : null, regionKey, countryKey|null,
  campaign:{siteRef, craftId}}`.
- `startMission` sets `G.activeMission = {siteRef, craftId, startedT: G.t}`.

**`reseedMap(G, salt)`** (§11.9): `G.rng.map = RNG.create((G.rng.map ^ imul(salt + 1, 0x9E3779B1)) >>> 0).u32()`
(all uint32). Same state and same salt ⇒ same new state; no other stream moves. The UI calls it right after loading the
«Antes da missão» slot (from «Repetir a missão» or the load dialog), with the attempt number it keeps in that save
(`obj.preMission.retries`, 1, 2, …), so the next `startMission` draws a different `mission.seed`: a retry is a fresh
map and alien layout, not a perfect-information replay. Throws `campaign.err.noGame` without `G.rng.map`.

**`finishMission(G, B) → model`**, applied in this order:
1. `deb = OV.Battle.debrief(B, {researched: G.researched, captureRoom, terrorFloor})`: `captureRoom` = free containment
   places at the craft's base (`capacities.aliens`, 0 without a base); `terrorFloor` = `Missions.expiredPoints(G)` for
   a terror site, else 0 (§1.13, §11.8). Only the first `captureRoom` captures score as captures (2 × value, or
   `SCORE_CAPTURE_KNOWN` once interrogated); the rest count in the «aliens killed» line (value) and in `deb.kills`.
   `deb.captured` still lists every capture, in the same order step 3 uses.
2. `Economy.addScore(G, 'xcom', deb.score, lon, lat)` at the site point (for Cydonia: the base's point).
3. `deb.recovered` → `base.stores`. `deb.captured` → `base.aliens` while containment has room (`capacities.aliens`).
   The rest go to `model.capturedLost` (they die; orig) and their corpse to the stores; step 1 already scored them as
   kills.
4. `craft.equipment −= deb.equipmentLost`, clamped at 0 and with no zero keys.
5. Soldiers, from `deb.soldiers`:
   - `ok` → `Soldiers.applyMission(G, id, {exp, hpLost, kills}, rng(G,'combat'))`;
   - `dead` → `Soldiers.kill(G, id, 'kia', where)`; ours (§11.6): on a won battle whose craft survived, the dead
     soldier's armour (`armours[a].storeItem`) goes back to `base.stores` and into `model.stored`;
   - `mia` → `Soldiers.kill(G, id, 'mia', where)`.

   Then run `Soldiers.promotions(G)`.
6. Craft: if `deb.craftLost`, `World.loseCraft(G, craftId, 'mission')`. Otherwise `dest = {kind:'base', id}` and status
   `returning`. A craft on a Cydonia mission is at base already, so it goes through checkup instead.
7. Not a win at a UFO or alien base: `site.garrison = Battle.garrisonAfter(B, deb)` with `visits + 1` (§11.10). Then
   `Missions.onSiteCleared(G, siteRef, deb.result)`.
8. Stats: `missionsWon` / `missionsLost` / `missionsAborted`; `aliensKilled += deb.kills`; `aliensCaptured` +=
   stored captures; `civiliansSaved += deb.civilians.saved`. Add the mission race to `G.seen.races`, and the UFO type
   to `G.seen.ufoTypes`.
9. Cydonia: a win → `endGame(G, 'won')`; a loss or abort → `endGame(G, 'lost', 'cydonia')`.
10. `G.activeMission = null`.

```js
model = { debrief: deb, mission: B.mission, meta, outcome: 'continue'|'victory'|'gameOver',
  progression: [{soldierId, gains, promoted: rankIdx|null, kills}],   // exactly the debrief scene's p.progression
  stored: {itemId:n}, capturedStored: {unitType:n}, capturedLost: {unitType:n}, craftLost: bool, scoreAdded: int }
```

**Equip pool rules** (needed because `equipScreen` works on one pool):
- `equipPool(G, craftId)`:
  - `squad` = the craft's soldiers in the `equipScreen` format (`{id, name, rank, stats, armour, portraitSeed, female,
    nat, loadout}`).
  - `stores` = `craft.equipment − Σ templates`, plus, if the craft is in its hangar, the battle-usable base stores
    (`Data.items[id].battle !== false`, not `craft_*`).
- `applyEquip(G, craftId, {loadouts, stores: R})`: set each soldier's template.
  - Craft in its hangar: `loose = min(oldLoose, R)` per item; `craft.equipment = Σ new templates + loose`; the
    battle-usable base stores become `R − loose`.
  - Away: `craft.equipment = Σ new templates + R`.

  Both keep the equipment invariant (§1.10).

**`baseVolley(G, baseId, ufoId) → {shots, destroyed}`** — the defences fire first, once per attack: each completed
defence facility rolls hit `pct(hitRatio)`, `dmg = power/2 + int(0, power)` added to `ufo.dmg`; sets
`ufo.siege = {baseId, shots}`. A second call returns the same shots without firing. World calls it on arrival, then
scrambles the base's ready armed crafts (§3.1 step 3), then calls `baseDefence` once no dogfight is left.

**`baseDefence`** (MVP auto-resolve, DESIGN §4; combat stream):
1. `baseVolley` (no-op if the defences already fired).
2. If `ufo.dmg ≥ hp`: `result 'ufoDestroyed'`, `Missions.onUfoDown(…, 'destroyed', null)`.
3. Otherwise compare the strength `Σ (tu + fire + hp)` of fit soldiers in the base (not on a craft that is out)
   `+ Σ floor(power × TUNE.BASE_DEFENCE_FACILITY_PCT / 100)` over the completed defence facilities, against
   `floor((TUNE.BASE_DEFENCE_BASE + TUNE.BASE_DEFENCE_PER_COEF × 2·difficulty) × (hp − ufo.dmg) / hp)` (the hull the
   defences and interceptors left standing). Values: 850 + 100/coef (850 / 1 050 / 1 250), defences at 100 % of their
   power (§11). The 10 starting rookies of Veterano (8 rookies already 1 105–1 198) hold; Super-humano (8) needs a defence, more or better
   soldiers, or hull damage from interceptors. With no fit soldier at home the base is always lost.
   - Win: `'repelled'`. `int(1,3)` random fit soldiers die (cause `'base'`), the UFO is removed with
     `+ufo.score`, the retaliation mission ends.
   - Loss: `'lost'` → the base is destroyed → `endGame(G, 'lost', 'baseLost')`.
4. Push `baseDefence`.

### 5.10 `OV.Save` (save.js; the only sim file that touches `localStorage`, guarded by `typeof localStorage`)
```
SCHEMA = 1 ; SLOTS = ['auto','auto2','preMission','autoTurn','1','2','3'] ; KEY(slot) = 'ovni1999.save.' + slot
                                (auto2 = previous autosave, preMission = state before the last mission; written by the UI)
toJSON(G, B?, meta?) → obj      throws Error('save.err.busy') if G.dogfights.length; B via OV.Battle.serialize
fromJSON(obj) → {G, B, meta}    validates game/schema, runs MIGRATIONS, deep validation of G (below),
                                Campaign.rebuildDerived(G), G.events = [], B via OV.Battle.deserialize;
                                throws Error('save.err.game'|'save.err.schema'|'save.err.parse')
write(slot, obj) → {ok, reason?:'quota'|'unavailable'} ; read(slot) → obj|null ; remove(slot) → bool
list() → [{slot, label, savedAt, t, month, battle:bool}] (existing slots only) ; slots() → same (alias)
load(slot) → {G, B, meta}|null
exportFile(obj) → {filename:'ovni1999-YYYY-MM-DD.json' (game date), mime:'application/json', text}   UI downloads it
importFile(text) → {G, B, meta}  (= fromJSON(JSON.parse(text)))
MIGRATIONS = []                  MIGRATIONS[n] upgrades a schema-n save object to n+1 (in place, returns it)
```
- Deep validation (`fromJSON`): `t` integer ≥ 0 and a multiple of 5, `month === Clock.monthIndex(t)`, integer funds,
  `ids.seq`/`craftNum`, `score.month`/`score.all`, every country, base (arrays `grid soldiers crafts research production
  deliveries`, known facility types), craft (known type, existing base that lists it, known status), soldier (stats,
  base that lists it, craft that seats it), UFO, alien mission, site and alien base must be well-formed, or
  `save.err.parse`. Obvious defaults are repaired: missing `transfers`/`aliens`/`spotted`, counters, flags, `seen`, a
  short or null `weapons` list, a missing loadout, a non-object `ui`; hand-written dogfights are dropped. Then every
  clock handler of §3.1 runs once on a JSON clone; any exception ⇒ `save.err.parse` (the real G is untouched).
- Save shape (DESIGN §18): `{game:'ovni-1999', schema, savedAt, label, build, campaign: G without events,
  battle: null|serialized B}`.
- `meta.label` is supplied by the UI (translated, e.g. «Mar 1999 — Base Lusitânia»). `savedAt` is an ISO string,
  `meta.savedAt` or `new Date().toISOString()`.
- These match what `js/ui/screens.js` already calls: `list()` / `slots()`, `load(slot)` → `{G, B}`,
  `read()` + `fromJSON()`, `importFile(text)`.

### 5.11 Ufopaedia articles
Article ids are strings. Always-open articles need no research: X-COM crafts, conventional weapons, starting
facilities, and items with `research:null`. Every other article is open when its id is in `G.ufopaedia`, or when the
research topic that names it is in `G.researched`.
Conventions:
- topic articles use `topic.article` (default: the topic id);
- alien races use `race_<race>`;
- UFO types use `ufo_<type>`;
- items use `item_<itemId>`;
- facilities use `facility_<type>`;
- crafts use `craft_<type>`.

`OV.Ufopaedia.isOpen(G, articleId)` is the single source of that rule (UI owner).

---

## 6. UI scenes and cross-module entry points

### 6.1 Scenes (registered in `OV.SceneDefs`)
| Scene | Params | isScreen | Owner file |
|---|---|---|---|
| `newgame` | `{}` | yes | campaign_ui.js |
| `geoscape` | `{G}` | yes | geo_ui.js |
| `basescape` | `{G, baseId, tab}` — tab ∈ `facilities, research, production, personnel, stores, crafts, soldiers, market, containment` | yes | base_ui.js |
| `dogfight` | `{G, dogfightIds:[id]}` (overlay; ≤ 2 panels) | no | dogfight_ui.js |
| `ufopaedia` | `{G?, articleId?, section?}` | yes | ufopaedia.js |
| `monthReport` | `{G, report}` | no (modal over geoscape) | campaign_ui.js |
| `gameOver` | `{G, reason}` | yes | campaign_ui.js |
| `victory` | `{G}` | yes | campaign_ui.js |
| `saveload` | `{G?, mode:'save'\|'load'}` | no | campaign_ui.js |
| `equip` | `{G, craftId, onDone?}` (wraps `OV.InventoryUI.equipScreen` with `equipPool`/`applyEquip`) | yes | campaign_ui.js |
| `briefing`, `debrief`, `battlescape`, `inventory`, `options`, `menu` | existing (screens.js, battle_ui.js, inventory_ui.js) | | |

### 6.2 Entry points (all call `OV.Scenes`; none mutate `G` except through sim APIs)
```
OV.GeoUI.open(G)                         Scenes.set('geoscape', {G}); also centreOn(G, {lon,lat}) and intercept(G, ufoId?)
OV.BaseUI.open(G, baseId, tab?)          push 'basescape'
OV.DogfightUI.open(G, dogfightId)        push 'dogfight' or add a panel to the open overlay
OV.Ufopaedia.open(G, articleId?)         push 'ufopaedia' ; OV.Ufopaedia.isOpen(G, articleId)
OV.CampaignUI.newGame()                  push 'newgame' (the menu already pushes 'newgame' when it exists)
OV.CampaignUI.launchMission(G, siteRef, craftId)   startMission → push 'briefing' {mission, meta} (meta.campaign set)
OV.CampaignUI.startBattle(mission, meta)           B = OV.Battle.create(mission); OV.Game.B = B;
                                                   replace with 'battlescape' {B, mission, meta, onExit: r => afterBattle(G, B, r)}
OV.CampaignUI.afterBattle(G, B, result)            model = finishMission(G, B) → replace with 'debrief'
                                                   {B, debrief: model.debrief, mission, meta, progression: model.progression,
                                                    stingerPlayed:true, onDone} ; onDone → victory | gameOver | GeoUI.open(G)
OV.CampaignUI.resume({G, B})             after loading a save: B ⇒ battlescape with campaign onExit; else GeoUI.open(G)
OV.CampaignUI.monthReport(G, report) ; gameOver(G, reason) ; victory(G)
OV.CampaignUI.saveDialog(G) ; loadDialog() ; autosave(G)   (slot 'auto'; label translated here)
```
**Required `screens.js` hooks** (screens owner): `startBattle(mission, meta)` must delegate to
`OV.CampaignUI.startBattle(mission, meta)` when `meta && meta.campaign`, and `resumeGame(st)` must delegate to
`OV.CampaignUI.resume(st)` when `st.G`. Until those hooks exist, CampaignUI skips the shared briefing and calls
`startBattle` from its own «Iniciar missão» confirmation.

### 6.3 Geoscape time loop (GeoUI `think(dt)`)
```js
// speedIdx 0..5 → OV.Clock.SPEEDS ; GEO_STEP_MS = 80 ; up to TUNE.GEO_MAX_STEPS_PER_FRAME (3) steps per frame
acc += dt; let steps = 0; const t0 = performance.now();
while (!paused && acc >= GEO_STEP_MS && steps < 3) {
  acc -= GEO_STEP_MS; steps++;
  let left = SPEEDS[speedIdx];
  while (left > 0) {
    const r = OV.World.step(G, Math.min(left, TUNE.GEO_CHUNK_TICKS /* 720 */));
    left -= r.ticks; handle(G.events.splice(0));
    if (r.stopped) { speedIdx = 0; acc = 0; return; }        // popups were pushed by handle()
    if (performance.now() - t0 > TUNE.GEO_FRAME_BUDGET_MS /* 12 */) { acc = 0; return; }
  }
}
```
- Speeds: «5 seg», «1 min», «5 min», «30 min», «1 hora», «1 dia», on keys 1–6. P or Space pauses or resumes.
- Any `stop:true` event drops the speed to 5 s. The popup scene sits on top, so the Geoscape does not think until it
  closes.
- Dogfights pause the Geoscape (World.step returns `reason:'dogfight'`) until DogfightUI closes the last panel.
- Redraw the globe at most 10 Hz while time runs (DESIGN §12).

### 6.4 Dogfight loop (DogfightUI)
The overlay ticks every open dogfight once per 30 ms of real time (`Data.dogfight.tickMs`), at most 8 ticks per frame:
`Dogfight.tick(G, id)` → animate the returned events. When `over`, the panel shows the outcome for 1.5 s, then closes.
`G.events` (pushed by `finish`) is handed to GeoUI's handler. The overlay never calls `World.step`.

---

## 7. Determinism, JSON safety and saving
1. Randomness only through `Campaign.rng(G, stream)` (§1.4). No `Math.random`, `Date.now` or `performance` in
   `js/sim/**` (Save may read `Date` for `savedAt` only).
2. Same seed + same sequence of API calls ⇒ same `Campaign.hash(G)`. Every sim module ships a determinism test: run
   its handler N times on two copies, then compare hashes.
3. Iteration: arrays by index; maps (`G.soldiers`, `G.crafts`) by insertion order; never by sorting floats with ties.
   Deleting a map key and adding a new id keeps both orders deterministic.
4. JSON safety: no `undefined` (use `null`), no `NaN`/`Infinity` (guard divisions), integer money, scores, counts and
   timers. Floats only for `lon`, `lat`, `speed` and dogfight `pos`. After every handler, `JSON.parse(JSON.stringify(G))`
   must deep-equal `G` minus `events` (a debug invariant, and part of the World test).
5. Derived and rebuilt on load (`Campaign.rebuildDerived`): `G._` (bound RNG objects, optional caches such as base
   capacities keyed by base id). Modules that cache in `G._` must tolerate it being empty at any moment.
6. Saving is allowed only at quiescent points:
   - Geoscape: between `World.step` calls, with no dogfight.
   - Battle: at the start of a player turn (B serialized, `G.activeMission` set).
   - `Save.toJSON` refuses while `G.dogfights.length > 0`.
7. Never stored: `G.events`, `G._`, sprite or DOM caches, functions, references.

---

## 8. Pacing knobs (what the campaign bot may tune, and where)

| Knob | Where | Default | Effect |
|---|---|---|---|
| `GEO_SPEEDS`, `GEO_STEP_MS` | tuning.js | 1/12/60/360/720/17280, 80 | real-time pace of the clock |
| `GEO_MAX_STEPS_PER_FRAME`, `GEO_CHUNK_TICKS`, `GEO_FRAME_BUDGET_MS` | tuning.js (**new**) | 3, 720, 12 | UI loop budget (§6.3) |
| `AUTOSAVE_DAYS` | tuning.js (**new**) | [1, 10, 20] | autosave days |
| `FUNDING_TOTAL`, `DEBT_LIMIT` | tuning.js | 6 000 000, −1 000 000 | starting money, debt defeat |
| `COUNCIL_BONUS`, `COUNCIL_BONUS_FROM_MONTH`, `RATING_THRESHOLD` | tuning.js | 400, 2, [−900,−700,−500] | council |
| `TERROR_SITE_HOURS`, `CRASH_SITE_HOURS` | tuning.js (+ `missionRules.terrorSiteHours`) | [8,16], [24,72] | site lifetimes |
| `DELIVERY_PERSONNEL_H`, `DELIVERY_ITEMS_H` | tuning.js | 48, 24 | delivery waits |
| `CRAFT_REPAIR_HP_H`, `MAX_DOGFIGHTS`, `RETALIATION_PCT` | tuning.js | 5, 2, [4,12,20] | craft turnaround, dogfights |
| `LOW_FUEL_MARGIN_10M` | tuning.js (**new**) | 1 | low-fuel return margin (10-min steps) |
| `WOUND_RECOVERY_MIN/MAX`, `PROMO_*` | tuning.js | 25/75, 4/8/15/20 | soldier turnaround and ranks |
| `SOLDIER_/SCIENTIST_/ENGINEER_HIRE/SALARY` | tuning.js | orig, except **ours** `SCIENTIST_HIRE` 30 000 and `ENGINEER_HIRE` 25 000 (orig 60 000 / 50 000; §11.10) | personnel economy |
| `BASE_DEFENCE_BASE`, `BASE_DEFENCE_PER_COEF`, `BASE_DEFENCE_FACILITY_PCT` | tuning.js | 850, 100, 100 (§11) | retaliation auto-resolve |
| `RETALIATION_WARNING_MIN` | tuning.js (**new**) | 1440 (§11.5) | minimum time from `baseSpotted` to the assault Battleship's launch |
| `MISSION_ARRIVE_NM` | tuning.js | 5 | a patrolling transport this close to a site counts as arrived (`startMission`) |
| `ALIEN_BASE_SURRENDER` | tuning.js | `['commander','leader','leader']` (§11) | ranks handed over alive when an alien base falls |
| `TU_ALIEN_MELEE` | tuning.js | 22 (§11; orig 15) | Chryssalid/Reaper/Zombie attack cost |
| `SHADE_DAY/DUSK/NIGHT`, `CHEAT_TURN`, `SQUAD_MAX_UI` | tuning.js | 0/6/13, [12,10,8], 10 | battle feel |
| facility `cost`, `days`, `upkeep`, radar `radarChance`/`radarRange` | data/base.js `FAC` | §3.14 | build pace, detection |
| `startingBase` (layout, personnel, crafts, stores), `soldiersByDifficulty` | data/base.js | orig + extras; 10 / 10 / 8 soldiers (§11.6) | opening |
| craft `speed`, `fuel`, `hp`, `refuel`; `craftRules.*`; `dogfight.*` | data/crafts.js | §3.13 | interception |
| craft `sell` | data/crafts.js | Skyranger 375 000, Interceptor 450 000, Firestorm 300 000, Avenger 675 000 (ours: 75 % of the purchase or of the $ production cost) | `BaseSim.sellCraft` |
| craft weapon `dmg`, `acc`, `ammoMax`, `reload` | data/crafts.js | §3.13 | interception |
| UFO `hp`, `speed`, `weapon`, `breakOff`, `score`; `ufoRules.*` | data/ufos.js | §3.12; Small Scout `breakOff` 360 (§11.6) | interception, recovery |
| research `cost`, `points`; `researchRules.costRandPct` | data/research.js | ×0.25 orig | tech pace |
| manufacture `hours`, `cost`, `materials`, `space` | data/research.js | ×0.1–0.2 orig | production pace |
| `alienMissions[*].waves[*].timer` (`WAVE_TIMER_SCALE`) | data/geo.js | ×0.5 orig | alien tempo |
| `missionScripts` (`startDelay`, `firstMonth`, `seedAlienBase.maxBaseDistNm`) | data/geo.js | §3.18; `firstTerror` +10 days, `regionalScouts` months 0–2 +14 days (§11.6) | escalation, dead time |
| `raceSchedule` | data/geo.js | §3.18 | enemy progression |
| `missionRules` (`shootDownDelay`, `nearBaseNm`, `nearBaseWeightMul`, `terrorNearBaseNm`, `terrorNearBaseWeightMul`, `crashCoastNm`, `shootDownRetaliationFromMonth`, `landPointTries`, `alienBaseRevealMonthlyPct`, `patrolReveal`) | data/geo.js | §3.18, §11 (2 600 nm ×4; terror 4 000 nm ×4) | alien pressure, UFOs in radar range, crash sites on land, reachable terror |
| `scoring` (`ufoActivity` incl. `everyMin`, `alienBasePerDay`, `terrorSiteExpired`, `terrorSiteExpiredByMonth`, `alienBaseDestroyed`, `rating`) | data/geo.js | §3.17, §11 (expired terror 500 in months 0–1) | council pressure |
| `geoConst.entryRingDeg`, `geoConst.sun` | data/geo.js | [25,35], no seasons | UFO entry, day and night |
| country `fundingBase`, `fundingCap` | data/geo.js | orig + Portugal 120 / 2 500 k$ (§11.6) | funding |
| `alienItemTiers`, deployments `rows[*].qty`, `crewRules` (`earlyMonths` 1, `earlyDiffStep` 1) | data/units.js | §3.12; month-0 UFO crews one difficulty lower (§11.6) | battle difficulty |
| manufacture `avenger.materials` | data/research.js | 25 alloys, 2 power sources, 1 navigation (§11.6) | ending gate |
| starting Skyranger extras (1 Medi-Kit, 4 flares) and `defaultLoadouts` roles | campaign.js section A | ours | first-mission teaching |

The campaign bot (`tools/sim.js campaign`) reports these targets from DESIGN §14: victory day (100–170), victories
(Recruta ≥ 80 %, Veterano ≥ 55 %), median battles (14–18), council defeats (≤ 20 % on Veterano), first battle by day 3
(≥ 80 % of seeds) and the longest stretch without a newly detected UFO in months 0–2 (≤ 15 days, `gapDays`).

---

## 9. Test obligations (`tools/tests/<area>_*.test.js`, `node ovni-1999/tools/test.js --strict` green)
- **World**:
  - order and canOrder reasons;
  - interception contact creates a dogfight;
  - low-fuel return;
  - detection probability over 2 000 rolls within ±3 % of the formula;
  - idle coalescing equals per-tick stepping (`hash`);
  - JSON round-trip after a simulated week.
- **Missions**: month 0 plan (gameStart + firstTerror + regionalScouts); a full wave cycle spawns UFOs on schedule; a terror
  site appears and expires (−500 in months 0–1, −1 000 after); onUfoDown (crash over water ⇒ destroyed); alien base creation and reveal.
- **Dogfight**: the hit-chance table (REA §6.2); a Stingray interceptor vs a Small Scout crashes it in ≤ N ticks over
  20 seeds; the cautious retreat at 50 %; escape timing; finish outcomes.
- **BaseSim**: build/dismantle connectivity; capacities; the research cost range and the completion path (flags,
  unlocked lists); production stall and resume; deliveries; maintenance chain; equipment invariant.
- **Economy**: funding change function (REA §8.1 fixtures); upkeep of the starting base ≈ $2.58 M; council bonus
  month; defeat after 2 bad months; debt warning.
- **Soldiers**: generate == makeSoldier; promotion quotas; wound days range; kill/memorial.
- **Campaign B**: the startMission mapping (validated by `OV.Battle.create`); finishMission on a scripted win, abort
  and loss; Cydonia victory; baseDefence outcomes.
- **Save**: round trip (`hash` equal), with and without B; migration path; bad game/schema rejected; busy refusal.
- **UI QA** (`qa/*.mjs`, outputs outside the repo): new game → geoscape → detect → intercept → crash → mission →
  debrief → back to geoscape → month report → save → reload → same date/funds. No console errors, no `⟦missing⟧`
  keys.

---

## 10. Deviations from DESIGN recorded here
- `startMission` returns the mission object (DESIGN §5.3 said `→ B`). Creating `B` is the UI's job
  (`CampaignUI.startBattle`), so the briefing can come first.
- Crash and landed sites are UFO records (OpenXcom model). `G.sites` holds only terror sites.
- `G.alienMissions` replaces DESIGN §6 `missions`. `base.aliens` is `{unitType:n}`, not `[{type}]`. `craft.equipment`
  replaces `cargo`.
- Craft refuel runs every 30 min (orig and `craftRules.refuelEveryMin`). Repair and rearm run every hour.
- Terror sites expire even when a craft is en route (orig exploit removed).
- Ids use one counter per prefix (`s1…`, `c1…`), not one global counter.
- `G.ui` is a UI-owned bag that is saved but ignored by the sim and the hash.
- Starting Skyranger carries 1 Medi-Kit + 4 Electro-flares taken from base stores (DESIGN §3.14 extras, loaded aboard).

---

## 11. Pacing changes from the campaign bot (wave 4, stage 3)

The campaign bot (`tools/campaign_bot.js`, run with `node ovni-1999/tools/sim.js campaign`) plays whole campaigns
through the public sim APIs and the battle playerBot (`OV.AI`, X-COM side). Every change below was measured with it or
with `tools/sim.js battle` (Veterano, 10 soldiers unless noted). All are data or tuning values, except the four rule
changes marked **rule**, which are small sim fixes with tests in `tools/tests/campaign_pacing.test.js`.

### 11.1 Rule changes (contract-level)
| Change | Where | Before → after | Why / measured effect |
|---|---|---|---|
| **rule** Craft check-up has one definition | `OV.Data.craftServiceStatus(craft, from)` (crafts.js); `BaseSim.checkup` / new `BaseSim.serviceStatus`; `World` lands crafts with `BaseSim.checkup` | two copies (World, BaseSim) → one | `World.checkup` stays a pure query. Without BaseSim, World falls back to the same data function. |
| **rule** `ufo_<type>` Ufopaedia article on first recovery | `Campaign.finishMission` step 8 | only via engineer interrogation → also on the first **won** crash/landed battle of that type | §5.11 rule unchanged; Campaign writes `G.ufopaedia`. |
| **rule** Base defence strength | `Campaign.baseDefence` step 3 (§5.9) | garrison only vs 1 800 + 300/coef → garrison + defences (`BASE_DEFENCE_FACILITY_PCT` % of their power) vs (1 000 + 250/coef) × hull left | 8 rookies (≈ 1 150) always lost before, even on Recruta. Now they repel a Battleship on Recruta. On Veterano, 3 soldiers plus 2 Missile Defences hold. No soldier at home still loses the base. |
| **rule** Crash near the coast lands | `Missions.onUfoDown`, `missionRules.crashCoastNm` 180 | crash at sea always destroyed (orig) → crash site on the nearest land point within 180 nm (20-nm rings, 30° bearings, no RNG) | Bot campaigns: 1–9 of 140–270 shoot-downs per batch end at sea (≈ 3 %). The world engineer's Europe sample had 2 of 3. |
| **rule** Terror city choice | `Missions` (`pickTerrorCity`), `missionRules.terrorNearBaseWeightMul` 4 | uniform region → regions with a centroid within `nearBaseNm` of an X-COM base weigh ×4 | One base in the MVP. Out-of-reach sites expired unattended (−1 000 each). The chance of a far region drops from 5/9 to 5/21. |
| **rule** Alien activity cadence | `Economy.ufoActivity30m` honours `scoring.ufoActivity.everyMin` | +1/+2 every 30 min → every 120 min | UFO-activity and alien-base points in months 2–3: ≈ 2 600 → 500–1 000 per month. One base cannot cover the globe, and the compressed wave timers multiply the traffic. |
| **rule** Alien base surrender | `Campaign.finishMission` step 3, `TUNE.ALIEN_BASE_SURRENDER` | — → a won alien-base assault adds `['commander','leader','leader']` of the base race to containment (counts captures; needs room) | The playerBot almost never captures leaders: abductor 0/12, battleship 0/10, alien base 2/12 leader and 1/12 commander, even with stun launchers and a focus tactic. Without this no Veterano bot reached Cydonia. A human gets the same «Crisis» beat as DESIGN §14: assault the base, take the commander. |

### 11.2 Data and tuning values
| Knob | Before → after | Measured effect |
|---|---|---|
| `TUNE.MISSION_ARRIVE_NM` | read with default 5 → defined 5 | — |
| `raceSchedule.alien_terror` | m0 {sectoid 60, floater 40}; m1+ {snakeman 60, floater 20, sectoid 20}; m2 +ethereal 20 → m0–1 {floater 100}; m2 {floater 40, sectoid 40, muton 20}; m3+ {sectoid 25, muton 30, snakeman 25, floater 20}; no Ethereals | Terror win rate by race and gear, 10 soldiers: Sectoid with rifles m0 5 %, m1 0 % (Cyberdiscs). Floater with rifles m0 85 %, m1 90 % (night 67 %). With lasers and armour: Sectoid m1 81 %, m2 75 % (night 67 %); Muton m2 81 % (night 67 %); Snakeman m2 6 %. With plasma: Snakeman 58 % at m2 and 42 % at m3; Ethereal 0 %. The stage-1 sweep put month-1 terror at 18 % (Veterano). The bot now wins 67 % (Veterano) and 78 % (Recruta) of all its campaign terror sites, months 0–7, night ones included. |
| `deployments.dep_terror_site.civilians` | 10–14 → 6–9 | Snakeman m3 with plasma: 42 % → 83 % win, 7.3 → 3.8 losses (fewer zombies). |
| `TUNE.TU_ALIEN_MELEE` | 15 → 22 | Same sweep (Chryssalids attack less per turn). Floater m0 with rifles is unchanged (85 % → 83 %). |
| `WAVE_TIMER_SCALE` | 0.5 → 0.7 (the opening Alien Research waves and the terror waves keep their 0.5 timers explicitly) | Less traffic. With the bot's battle choice, median battles 32–38 → 19–20. The first crash site still comes by day 3 in 50–60 % of seeds, the first battle in 70 %. |
| `scoring.ufoActivity.everyMin` | 30 → 120 | see 11.1 |
| `TUNE.BASE_DEFENCE_BASE`, `_PER_COEF`, `_FACILITY_PCT` | 1 800, 300, — → 1 000, 250, 100 → (wave 4 fixer) 850, 100, 100 | see 11.1 and 11.5 |
| `dogfight.approach` (crafts.js) | 2 → 4 per tick | shorter duels; the first shoot-down is feasible on Veterano with the starting Interceptors (DESIGN §3.13 / REA §6 say −2; DESIGN §22 still needs the entry) |

`TERROR_SITE_HOURS` (8–16 h) was **not** changed: `geo_missions.test.js` pins it. A longer window (16–28 h) would let
one Skyranger reach any city; the terror city weighting does most of that job instead.

### 11.3 Still pinned by other owners' tests (proposals, not applied)
- Terror crews per difficulty (`battle_spawn_race.test.js`, `data_items_units.test.js`): making the Veterano terror
  site 5 instead of 5–7 aliens lifted night terror from 67 % to 75 % for Floaters, Sectoids and Mutons alike.
- Terror site lifetime 16–28 h (`geo_missions.test.js` line 196).
- ~~A lost terror battle keeps the site~~ — applied in §11.5.
- Council constants (`geo_economy.test.js`).

### 11.4 Results (bot, `--days 240`) — stage 3, superseded by §11.6
10 seeds per difficulty (4 for Super-humano), `node ovni-1999/tools/sim.js campaign --seeds 10 --diff 0|1 --days 240`:

| | Recruta | Veterano | Super-humano (4) | DESIGN §14 target |
|---|---|---|---|---|
| Victories | 80 % (8/10) | 40 % (4/10) | 0 % | ≥ 50 % of runs never hit a council defeat |
| Victory day (median, range) | 128 (122–187) | 159 (130–212) | – | 100–170 (months 4–6) |
| Council defeats | 0 % | 20 % | 100 % (days 150–211) | ≤ 20 % on Veterano |
| Other endings | 1 Cydonia lost, 1 timeout | 2 Cydonia lost, 2 timeout | – | – |
| Battles (median; in victories) | 19.5; 19 | 19; 24 | 19 | 12–16 |
| Battle win rate: crash / landed / terror / alien base / Cydonia | 96 / 93 / 78 / 90 / 89 % | 96 / 75 / 67 / 81 / 67 % | 88 / 63 / 50 / 0 / – % | – |
| Soldiers lost (median) | 56.5 | 76 | 99.5 | – |
| First crash ≤ day 3 / first battle ≤ day 3 | 50 % / 70 % | 60 % / 70 % | 50 % / 75 % | "most seeds" |
| Shoot-downs ending at sea | 8 / 282 | 6 / 351 | 1 / 147 | – |
| Infiltration pacts (all runs) | 21 | 25 | 13 | – |
| Research medians (day): laser rifle, personal armour, Alien Origins, Martian Solution, Cydonia, Avenger | 26.5, 25.5, 45.5, 95.5, 115.5, 104.5 | 26.5, 25, 59.5, 101, 123.5, 119 | – | – |

`--det` and `--save-mid 50` (3 Veterano seeds, 150 days) give identical hashes. In the bot's runs the Veterano
defeats come from three causes: terror losses, which cost twice (see 11.3); repeated squad wipes on landed or crashed
Ethereal and Muton scouts; and Cydonia, where the bot has no Blaster Launchers.
The bot's own battle policy (also documented in its header):
- up to 2 optional crash or landed battles a month;
- small and medium scouts only in month 0, or when the story needs a live alien;
- large scouts only when alloys are short;
- terror sites always;
- crash sites by daylight;
- the Avenger kept for Cydonia.

The bot is weaker than a human in battle: the battle engineers' sweeps already show about twice a careful player's
losses per battle. It cannot stun leaders. So treat the Veterano numbers as a floor.

### 11.5 Wave 4 fixes (sim/data fixer)
Verified review findings, fixed at the root with tests in `tools/tests/geo_wave4fix.test.js` (plus the pinned tests
they changed). **rule** = contract-level change.

| Change | Where | Before → after |
|---|---|---|
| **rule** Retroactive interrogation (ours) | `Data.researchEffects` (research.js) | a leader/commander interrogated before `alien_origins` / `martian_solution` was wasted (the alien-base surrender gives exactly 1 commander + 2 leaders, so one wrong click locked Cydonia) → the flag is granted when that topic completes (§1.16) |
| **rule** Cancel an interrogation | `BaseSim.cancelResearch` | the live alien was lost → it returns to containment (`{ok, returned}`) |
| **rule** Terror site after a lost/aborted battle | `Missions.onSiteCleared` | the site stayed and later expired (−1 000 on top of the negative battle score) → removed after any battle (OpenXcom) |
| **rule** Retaliation warning | `Missions.scan10m`, event `baseSpotted` (stop) | the base was found silently and the assault could arrive within an hour → `baseSpotted {baseId, missionId, etaS}` and ≥ `RETALIATION_WARNING_MIN` (24 h) before the assault Battleship launches |
| **rule** Assault Battleship | `Missions.spawnUfo`, `World.detect` | usually never seen → spawns detected (`ufoDetected`) and stays tracked |
| **rule** Base defence sequence | `World.contacts`, `Campaign.baseVolley` / `baseDefence`, `Dogfight` | defences + garrison in one roll → defences fire first (`ufo.siege`), then ready armed non-transport crafts in that hangar scramble into dogfights (no speed requirement against an assault on their own base; the assault ship never breaks off, its escape timer ends the duel `disengaged`), then the garrison against the hull left |
| Base defence sizing | `TUNE.BASE_DEFENCE_BASE / _PER_COEF` | 1 000 + 250/coef (Veterano 1 500 > any 8-rookie garrison, 1 105–1 198) → 850 + 100/coef (850 / 1 050 / 1 250): an alert Veterano player with the 8 starting soldiers at home holds (20/20 seeds, 1–3 killed); Super-humano needs a defence or better soldiers |
| **rule** Sell crafts | `BaseSim.sellCraft` / `canSellCraft`, craft `sell` | crafts could never be sold (rent forever, no free hangar in the starting base) → sold at `Data.crafts[type].sell` from the hangar, without crew |
| **rule** Pact month-end order | `Economy.monthEnd` | the pact country's last funding was never paid and its +150 lowered that month's rating → paid, and the points stay out of the rating (§5.7) |
| Rearm notifications | `BaseSim` rearm | `craftRearmShort` every hour while another weapon rearmed → once per service cycle |
| Dismantle checks | `BaseSim.canDismantle` | a hangar reserved by paid craft production could be dismantled; an overfull store made every facility «em uso» → only capacities the facility provides, hangars count reserved production |
| Save validation | `Save.fromJSON` | only top-level types → deep validation + repair + a dry run of every clock handler on a clone (§5.10) |
| Contract values | this file | §5.9/§8 said defences count 50 % (shipped 100 %); the dogfight approach 2 → 4 is now listed in §11.2 |

The campaign bot keeps its squad at home while its base is spotted (`baseSpotted` until the retaliation ends) and
disengages scrambles that cannot hurt the attacker (`canFight`).

Bot sweep, `node ovni-1999/tools/sim.js campaign --seeds 6 --diff 0,1 --days 240 --det` (deterministic, exit 0), before
→ after these fixes (the bot also stopped spending the Avenger's alloys on power suits when Cydonia is researched first):

| | Recruta before | Recruta after | Veterano before | Veterano after |
|---|---|---|---|---|
| Victories | 5/6 (83 %) | 5/6 (83 %) | 2/6 (33 %) | 1/6 (17 %) |
| Council defeats | 0 | 0 | 2/6 (33 %) | 1/6 (17 %) |
| Base losses (attacks; all repelled) | 0 (–) | 0 (4) | 0 (–) | 0 (10) |
| Median victory day | 132 | 135.5 | 159 | 144.5 |
| Other endings | 1 Cydonia lost | 1 timeout | 1 timeout, 1 Cydonia lost | 2 timeouts, 2 Cydonia lost |
| Terror sites expired | 7 | 4 | 15 | 8 |

Six seeds are noisy: the Veterano victory lost is seed 2, where the bot's Cydonia battle failed (the bot has no Blaster
Launchers; Cydonia 67 % → 33 % on 3 attempts). Seed 5 now survives the council to day 240 (was defeated on day 119).

### 11.6 Pacing pass 2 (wave 4): fair opening, no dead time, Portugal, bot endgame
Inputs: the verified findings (unfair first terror site, late-January dead time, stale §11.4) and the full-campaign
playtest notes (cannon-only Small Scout, January council, first Large Scout on Veterano, Portugal). Tests:
`tools/tests/campaign_pacing2.test.js` (plus the pinned values updated in `data_geo`, `data_strategy`, `data_crossref`,
`geo_core`, `geo_base`, `geo_economy`, `geo_missions`, `geo_soldiers`, `geo_dogfight`, `geo_wave4fix`, `campaign_flow`).
No new event type and no new reason code. **rule** = contract-level change; DESIGN §22 lists every deviation.

| Change | Where | Before → after | Why / measured |
|---|---|---|---|
| **rule** Portugal funds X-COM | `Data.countries.portugal` (geo.js), outline already in `world.js` | 16 → 17 funding countries; Portugal `fundingBase` 120 k$, `fundingCap` 2 500 k$, Europe; rectangles `[-9.6,-8.2,36.75,42.15]`, `[-8.2,-7,36.75,41.85]` | The default Lisbon base read «Fora dos países financiadores» on the first decision. Start funding still normalised to exactly $6 000 000 (Portugal ≈ $150 000). Nationality `pt` → country `portugal`. |
| Starting soldiers | `startingBase.soldiersByDifficulty` (base.js), `newCampaign` step 5 | 8 → 10 / 10 / 8 (Recruta / Veterano / Super-humano) | Skyranger leaves full. Month-0 day terror with 8 rookies on Veterano 46 % → 83 % with 10 (finding). Upkeep $2 579 000 → $2 619 000. |
| **rule** Month-0 UFO crews | `Data.crewRules`, `Data.crewDifficulty(depId, diff, month)`, `Data.deploymentRange(depId, diff, month?)`, `Battle.create` | crew table of the mission difficulty → one difficulty lower in month 0, UFO deployments only (stats and weapons unchanged) | Veterano Large Scout month 0: 5–6 → 4–5 aliens; day 96 % / 2.5 losses → 100 % / 1.4 (24 seeds). Night stays hard (58 %): the briefing says it is night. |
| First terror | `missionScripts.firstTerror.startDelay` | 3 → 10 days (Terror Ship ≈ days 12–15) | Was days 5–10, often before the first battle and at night. |
| Mid-month scouts, months 0–2 | new script `regionalScouts` (Alien Research, base region, +14 days, months 0–2) | — | Late January had ≈ 20 days with no UFO; months 1–2 had 30–43-day holes when the table missions went out of radar range. |
| Region weighting | `missionRules.nearBaseNm` / `nearBaseWeightMul`; new `terrorNearBaseNm` | ×3 within 4 000 nm → ×4 within 2 600 nm (Large Radar range); terror keeps ×4 within 4 000 nm | 4 000 nm counted North America and the Arctic as «near» Lisbon, where no radar reaches. |
| Opening Medium Scout | `alienMissions.alien_research.waves[1].timer` | 3 900 → 2 400 min | First battle by day 3: 70 % → 90 % (Recruta), 70 % → 80 % (Veterano). |
| Ignored terror in months 0–1 | `scoring.terrorSiteExpiredByMonth` [500, 500]; `Missions.expiredPoints(G)` | −1 000 → −500 (months 0–1), −1 000 after | A new player survives the first missed site: one missed site no longer makes January «Terrível» on its own. |
| Small Scout escape | `ufos.small_scout.breakOff` | 200 → 360 | Stingray off + cannon on Veterano: always escaped → 20/20 crash sites (`campaign_pacing2`). |
| Avenger materials | `manufacture.avenger.materials.alien_alloys` | 40 → 25 | The Avenger was the ending gate (Cydonia researched, no Avenger 100 days later). |
| **rule** Armour of the fallen | `Campaign.finishMission` step 5 | lost → back to `base.stores` and `model.stored` when the battle is won and the craft survives (KIA only; MIA and lost battles still lose it) | Each death cost 2–3 Alien Alloys; on Veterano the armour drain starved every alloy use (alien-base kit, Cydonia suits, Avenger). |

Campaign bot (`tools/campaign_bot.js`; the header lists the full policy): Blaster Launchers researched (priority 85),
built (2 + 6 bombs) and carried to Cydonia; Heavy Plasma built for the Cydonia team; the Cydonia team boards the Avenger
only with the final kit (12 power suits; after 20 days 12 armours; after 40 days 10 — before, it launched after 12 days
with whatever it had, often 4–12 in coveralls); a lost
Skyranger is always replaced (the Avenger stays for Cydonia); reserve soldiers hand their armour to the craft team;
loads stay within Strength (above it the turn's TU drop); personal armour keeps refilling the squad after losses; alien
bases only while the story needs a commander, with lasers and ≥ 8 armoured (Recruta 4; Veterano and Snakemen: plasma;
Ethereals: 6 suits), retried after 12 days; the Avenger alloy reserve starts only once a commander is held; big ships
and Muton or Ethereal crews only with plasma and ≥ 6 armoured; at most 2 optional crash/landed battles a month, plus
one when the story stalls (live alien, Avenger or Cydonia kit, alien-base armour); medium crash sites never at night.
New report fields: `gapDays` (longest stretch without a newly detected UFO in days 0–90) and `detectDays`.

Results, `node ovni-1999/tools/sim.js campaign --seeds 10 --diff 0|1 --days 240 --det` (both exit 0; before = the
same sweep on the code at the start of this pass, without `--det`):

| | Recruta before | Recruta after | Veterano before | Veterano after | Target (DESIGN §14) |
|---|---|---|---|---|---|
| Victories | 90 % | 80 % | 20 % | 40 % | ≥ 80 % / ≥ 55 % |
| Median victory day | 135.5 | 139 | 133 | 141 | 100–170 |
| Council defeats | 0 % | 0 % | 10 % | 0 % | ≤ 20 % (Veterano) |
| Other endings | 1 timeout | 1 Cydonia lost, 1 timeout | 4 Cydonia lost, 3 timeouts | 2 Cydonia lost, 4 timeouts | – |
| Median battles (in victories) | 19 (19) | 22.5 (22.5) | 18.5 (20.5) | 24 (22) | 14–18 |
| First battle by day 3 | 70 % | 90 % | 70 % | 80 % | ≥ 80 % |
| Longest gap without a detected UFO, months 0–2 (> 15 days) | ≈ 20 days in month 0 (finding), 30–43 in months 1–2 | 1/10 (max 15.6, median 8.9) | same | 0/10 (max 13, median 8.6) | none > 15 days |
| Battle wins: crash / landed / terror / alien base / Cydonia | 94 / 91 / 81 / 84 / 100 % | 100 / 93 / 89 / 80 / 89 % | 92 / 76 / 67 / 69 / 33 % | 98 / 89 / 86 / 65 / 67 % | – |
| Terror sites expired (all seeds) | 6 | 3 | 11 | 6 | – |
| Month-0 rating (median) | 623 | 745 | 528.5 | 740.5 | – |
| Soldiers lost (median) | 57 | 43 | 68.5 | 76 | – |

Not met, and why:
- **Veterano victories** (40 %, target 55 %; 20 % before). The 6 other runs are 2 lost Cydonia assaults (4 of 6 won)
  and 4 timeouts in which no alien base fell early enough (alien-base assaults: 13 of 20 won), so there was no commander
  and no Martian Solution. These are battles the headless X-COM player loses: in `sim.js battle` (12 seeds each) the
  Cydonia squad wins 83 % with Blaster Launchers, 67 % without them and 92 % with veteran stats, but the bot loses ≈ 75
  soldiers a campaign and fights the finale with recent recruits. The remaining levers are the battle AI (OV.AI, X-COM
  side) or a gentler Veterano alien base and finale; pacing data alone did not close the gap.
- **Battles** (median ≈ 22.5–24 against 14–18). Two optional battles a month plus the story exceptions; one a
  month from month 2 brought the median to 19.5 but cost 2–3 Recruta victories (fewer alloys), so it was not kept. The
  count includes the bot's retries after failed alien-base assaults and its alloy hunts.

### 11.7 Persona round 1 (sim/data fixer)
Verified persona findings, fixed at the root. Tests: `tools/tests/sim_persona_r1.test.js` (plus the pinned values updated
in `geo_base` and `geo_wave4fix`). **rule** = contract-level change; DESIGN §22 lists every deviation. New reason codes:
`bs.noRoute` (Act) and the production stall `storage` (§1.8); new state: `base.rentDue`, `craft.acquiredT`,
`B.flashes` (battle, JSON, in `hash`).

| Change | Where | Before → after | Why / measured |
|---|---|---|---|
| Kneel reserve while walking | `Act.reserveTU(B, u, {standing})`, `V.walk`, `P.walk`, `walkPreview` | a soldier who started the walk kneeling reserved only the shot (`!u.kneel`), walked into it and could not kneel again (`reserved`) | a walk always stands the soldier up: the 4 TU count (`standing: true`); preview marks and the walk agree |
| **rule** Blaster Launcher route | `V.shoot` (guided weapons) | refused with `noLOF` without a straight line of fire | validated by `Path.flyRoute(B, from, target)`; fails only with **`noRoute`**; `validate` returns `route` (tile list, null for other weapons) for the preview. The alien AI still fires it only with a line of fire (`AI.explosivePlan`): with routes, the month-3 Veterano alien base fell 54 % → 38 % (24 seeds) |
| **rule** Power-source deaths | `Battle.beginBattle` | aliens killed by the crashed UFO's power sources counted as X-COM kills (debrief line and points) | marked `crashDead` like the crew killed in the crash (`stats.aliensKilled` not incremented) |
| **rule** Muzzle flash | `Act` (shoot), `LOS.computeLight`, `Battle.sideStart`, `TUNE.MUZZLE_FLASH_LIGHT` 6 | at night aliens shot from the dark: 78 % of alien shots came from shooters X-COM could not see | a shot from a dark tile lights that tile (`B.flashes [{i, side}]`, power 6 = the tile only) until the shooter's side starts its next turn; LOS is refreshed, so X-COM sees (and can react to) the shooter |
| Recruta alien grenades | `AI.explosivePlan`, `TUNE.AI_GRENADE_FUSE` [1, 0, 0] | a clumped beginner squad lost 34 soldiers to 4 alien grenades (24 landed Medium Scouts, day) | on Recruta the grenade is primed with fuse 1: it lands in the alien turn and explodes at the end of the X-COM turn (10 soldiers lost) |
| Manufacture profit | `Data.manufacture[*].cost` (`costOrig` kept), `TUNE.MANUFACTURE_PROFIT_CAP_H` 100 | Laser Cannon 483 $/engineer-hour, Motion Scanner 258, Medi-Kit 231 (original 97 / 53 / 44): ×0.2 hours with original sale prices | `cost = max(costOrig, sale − materials at sale − 100 × hours)` rounded to $500: 14 items (Laser Pistol 14 000, Laser Rifle 29 000, Heavy Laser 47 000, Medi-Kit 38 500, Motion Scanner 41 500, Plasma Pistol 65 500, Plasma Rifle 104 000, Heavy Plasma 145 500, Small Launcher 95 500, Blaster Launcher 113 500, Personal Armour 25 000, Laser Cannon 205 000, Plasma Beam 227 500, UFO Power Source 162 500). Persona script (10 engineers on scanners, 90 days): +6.0 M$ → +2.7 M$ over doing nothing |
| **rule** Prorated craft rent | `BaseSim.sellCraft` → `{ok, price, rent}`, `BaseSim.craftRentDue`, `base.rentDue`, `Economy.baseUpkeep` / `monthEnd`, `craft.acquiredT` (purchase time for bought crafts) | selling both Interceptors 2 h before each month end and buying them back saved ≈ 450 k$ per Interceptor per month (persona: 14.58 → 17.28 M$ by day 95) | the sold craft pays rent for the time held this month (from the month start or its purchase), charged with the upkeep at month end; the same cycle now ends at 13.71 M$ (loses ≈ 0.9 M$) |
| **rule** Manufacture vs stores | `BaseSim` `payBlock` | production delivered over capacity (72/50 with 101 Heavy Lasers) | the next unit is not paid while its product would not fit after its materials leave: `stalled:'storage'`, `productionStalled {reason:'storage'}` once; resumes when there is room |

Battle sweep, month 0, 10 rookies, the headless playerBot (`node ovni-1999/tools/sim.js battle --ufo U --month 0 --diff D
--night 1 --landed L --seeds 24 --squad 10`), wins / X-COM losses per battle, before → after:

| Night, month 0 | Recruta crash | Recruta landed | Veterano crash | Veterano landed |
|---|---|---|---|---|
| Small Scout | 100 % / 0.58 → 100 % / 0.29 | 96 % / 0.71 → 100 % / 0.25 | 96 % / 1.21 → 100 % / 0.46 | 100 % / 0.79 → 100 % / 0.50 |
| Medium Scout | 92 % / 3.00 → 96 % / 1.88 | 75 % / 4.25 → 100 % / 1.75 | 75 % / 4.58 → 100 % / 2.04 | 75 % / 5.63 → 96 % / 3.04 |
| Large Scout | 79 % / 4.17 → 100 % / 1.25 | 75 % / 5.21 → 100 % / 2.17 | 83 % / 4.21 → 92 % / 3.04 | 58 % / 6.00 → 92 % / 3.54 |

Daylight month-0 battles are unchanged (Recruta 92–100 %). With `--novice` (new: a beginner X-COM — clumped squad, no
kneeling, smoke, grenades or very-lights), Recruta month 0: Medium Scout night 67–75 % → 92 %, Large Scout night
54–63 % → 79–83 %, day 92–96 % → 92–96 % with 2.0–3.1 → 1.9–2.7 losses. The standard day sweep
(`--ufo all --diff 1 --seeds 12`) is identical before and after; at night (`--night 1 --squad 10`) Large Scout 42 → 92 %,
Abductor 42 → 92 %, Supply Ship 17 → 50 %, Terror Ship 33 → 50 %, Battleship 33 → 75 %, terror 58 → 67 %; alien base and
Cydonia are not dark (shade 8) and do not change.

Campaign bot, `node ovni-1999/tools/sim.js campaign --seeds 6 --diff 0,1 --days 240 --det` (exit 0 both), before → after:

| | Recruta before | Recruta after | Veterano before | Veterano after |
|---|---|---|---|---|
| Victories | 4/6 (67 %) | 5/6 (83 %) | 3/6 (50 %) | 4/6 (67 %) |
| Other endings | 1 Cydonia lost, 1 timeout | 1 timeout | 2 Cydonia lost, 1 timeout | 2 timeouts |
| Median victory day | 138 | 135.5 | 154.5 | 160 |
| Battle wins crash / landed / terror / alien base / Cydonia | 100 / 95 / 87 / 75 / 80 % | 100 / 100 / 89 / 90 / 100 % | 99 / 90 / 90 / 80 / 60 % | 97 / 86 / 79 / 80 / 100 % |
| Soldiers lost (median) | 44.5 | 40.5 | 71.5 | 73 |
| Council defeats | 0 | 0 | 0 | 0 |

Six seeds are noisy (any change re-rolls every later battle); the Veterano terror rate moved 90 → 79 % on the same 29
battles while the battle sweep shows no terror change by day or at month 2/4.

`tools/sim.js` gained `--landed 1`, `--novice` and `runBattle({onEvent})` (per-event observer for statistics).

### 11.8 Persona round 2 (sim/data fixer)
Verified persona findings, fixed at the root. Tests: `tools/tests/sim_persona_r2.test.js` (plus the pinned item value in
`data_items_units`). New: `OV.Battle.TERROR_ABANDONED_KEY` (the debrief line key, `'cp.mr.alienTerror.one'` =
«Ataque terrorista sem resposta», an existing text; since §11.9 `'bs.debrief.terrorAbandoned'`) and the `Battle.debrief` context fields `captureRoom` and
`terrorFloor` (both optional; a skirmish passes neither and keeps the old report).

| Change | Where | Before → after | Why / measured |
|---|---|---|---|
| **rule** Abandoned terror | `Battle.debrief` (`ctx.terrorFloor`), `Campaign.finishMission` step 1 | a «token response» (fly in, start, abort on turn 1) cost only civilians × 30 ≈ −240, against −500 (months 0–1) / −1 000 (later) for ignoring the site, with no risk: it was the dominant play | a lost or aborted terror battle costs at least `Missions.expiredPoints(G)` in civilians (line «Ataque terrorista sem resposta» with the shortfall); persona script: turn-1 abort −240 → −500 (month 0) and −1 000 (month 2). Kills made before aborting still score, so a real attempt that goes wrong is never worse than ignoring the site plus its own losses |
| **rule** Medi-Kit usable from the start | `Data.items.medikit.research` `'medikit'` → `null` | the 3 starting kits (one in the Skyranger, one in the medic's pack) were refused with `notResearched` until the «Kit Médico» topic, while the briefing warned «Ninguém leva um kit médico» | the kit is used without research, as in OpenXcom (no `requires`); the «Kit Médico» topic still exists and unlocks manufacture (`manufacture.medikit.requires`), DESIGN §3.15 already said «manuf.». The Ufopaedia article is now always open (`!research && !topic`) |
| **rule** Captures without containment | `Battle.debrief` (`ctx.captureRoom`), `Campaign.finishMission` steps 1 and 3 | a stunned alien with no containment place scored 2 × value as «captured alive» while the same report said it did not survive, and its corpse was stored too | only captures that fit score as captures; the rest are «aliens killed» (value, `deb.kills`, `stats.aliensKilled`), as OpenXcom gives «live alien recovered» only with containment |


`tools/campaign_bot.js`: engineers skip an unpaid stalled order (`p.stalled && !p.paid`; BaseSim retries the payment
every hour). With usable starting Medi-Kits the bot's runs re-rolled into three Recruta timeouts in which a Power Suit
order stalled by full stores (`storage`, §11.7) held all 20 engineers for 40+ days while the Avenger, already paid,
had none.

Campaign bot, `node ovni-1999/tools/sim.js campaign --seeds 6 [--seed0 7] --diff 0|1 --days 240 --det` (exit 0), seeds
1–12, before → after (the three changes plus the bot fix):

| | Recruta before | Recruta after | Veterano before | Veterano after |
|---|---|---|---|---|
| Victories (seeds 1–6 + 7–12) | 5 + 6 = 11/12 | 5 + 6 = 11/12 | 4 + 2 = 6/12 | 2 + 4 = 6/12 |
| Other endings | 1 timeout | 1 timeout | 4 Cydonia lost, 3 timeouts | 3 Cydonia lost, 3 timeouts |
| Soldiers lost (median, seeds 1–6 / 7–12) | 40.5 / 28 | 32 / 34 | 73 / 56 | 51.5 / 85 |

Twelve seeds per difficulty are still noisy (any change re-rolls every later battle); the Veterano Cydonia result swings
40–100 % between seed sets both before and after.

### 11.9 Persona round 2 (integration)
- `OV.Battle.TERROR_ABANDONED_KEY` is now `'bs.debrief.terrorAbandoned'` («Local de terror abandonado», a dedicated
  debrief line) instead of reusing the monthly-report text `'cp.mr.alienTerror.one'`. The points rule of §11.8 is
  unchanged. The Geoscape terror popup says that abandoning the battle costs at least as much as ignoring the site.
- New `Campaign.reseedMap(G, salt)` (§5.9). Before, loading «Antes da missão» and launching again gave the same
  `mission.seed`, so the map and every alien position repeated: a retry was a perfect-information replay. Now each load
  of that slot is attempt n (kept in the save as `preMission.retries`) and the map stream is salted with n. Loading the
  same slot state with the same attempt number still gives the same map (deterministic, tested in
  `tools/tests/integration_r2.test.js`); other saves (manual slots, autosaves) are untouched.

### 11.10 Persona round 3 (sim/data fixer)
Verified persona findings, fixed at the root. Tests: `tools/tests/sim_persona_r3.test.js`. New: `ufo.garrison` /
`alienBase.garrison` (§1.11, §1.14), `mission.garrison` (§5.9), `B.crew` (`[{id, type, rank, tier, outside}]`, every
spawned alien), `debrief.aliensLeft` / `debrief.leftOnField`, `OV.Battle.garrisonAfter(B, deb)`, `OV.Battle.crewRange(mission)`,
`Data.deployments.dep_alien_base.artefacts`, `Data.soldierNamesTaken(soldiers, extra?)` and the 4th argument `taken(name)`
of `Data.soldierName`, `TUNE.NIGHT_LANDING_MONTHS` / `NIGHT_LANDING_DAY_MARGIN_S` / `NIGHT_LANDING_MAX_S`.

| Change | Where | Before → after | Why / measured |
|---|---|---|---|
| **rule** Garrison after an abort | `Campaign.finishMission` step 7, `startMission`, `Battle.create` / `debrief` / `garrisonAfter` | a site left without a win was regenerated from the crew table on the next visit: «abort and fly back» farmed kills, loot carried to the ramp, artefact points, experience and promotions (persona script, Medium Scout crashed next to the base: 25 / 26 / 35 / 30 points and 186–319 k$ of loot per visit, the UFO never left) | the UFO / alien base keeps `garrison = {crew, leftovers, crashed, visits}`: the survivors (type, row rank, weapon tier, % outside) and the items left on the ground (corpses, dropped weapons, X-COM gear left behind). The next battle deploys exactly the crew (no crash roll again unless the UFO crashed since) and a win adds the leftovers to the recovery. Same script now: 25 points on visit 1, then 0 (one survivor left, nothing new to carry). An empty crew is a site with only loot left: the next battle is won at once. A Supply Ship landing at the alien base deletes its garrison |
| **rule** Alien-base artefacts | `Data.deployments.dep_alien_base.artefacts`, `Battle.debrief` | an alien-base victory gave no artefacts (only UFOs had a table) | 2 Alien Food, 2 Alien Entertainment, 1 Alien Surgery, 1 Examination Room, 1 Alien Reproduction × intact DEVICE tiles / all DEVICE tiles (rounded half up), points while unresearched (7 items × 2 = 14). Validated in `strategy.validate` |
| **rule** Night landings, months 0–1 | `Missions` `land()` | a UFO landing at night stayed `traj.groundS` (2.8–12.5 h), so «Esperar pelo dia» (UI: «cerca de 9 h») usually found the UFO gone | on land, at night, while `G.month < NIGHT_LANDING_MONTHS` (2): `groundLeftS = max(groundS, first daylight (30-min steps) + NIGHT_LANDING_DAY_MARGIN_S (1 h))`, at most `NIGHT_LANDING_MAX_S` (16 h). The UI's hourly dawn check always finds it still on the ground. Day landings and month ≥ 2 are unchanged |
| Unique recruit names | `Data.soldierName(rng, nat, female, taken)`, `Soldiers.generate`, `Campaign.makeSoldier`, `Battle.quickMission` | duplicates allowed (two «Richard Moore» in one starting squad: the US pool is 12 × 15 male names) | re-drawn up to 8 times (2 draws each) while a living soldier has the name, then « II», « III»…; 60 new campaigns and 30 quick squads checked |
| Hiring costs labelled | `TUNE.SCIENTIST_HIRE` / `ENGINEER_HIRE` (comment), §8 table, DESIGN §22 | 30 000 / 25 000 $ marked «orig» (orig 60 000 / 50 000) | kept as **ours** (pacing). With the original costs the bot (Veterano, seeds 1–24) won 7/24 with 2 council defeats, against 12/24 and none |

Night battles (persona claim: landed Large Scout at night, month 0, Veterano, 75 % / 4.50). With the Skyranger full (10)
and 24 seeds (`--squad 10`), the bot does as well by night as by day on a landed Large Scout (92 % / 3.5 losses against
92 % / 3.2); crashed ones are 92 % / 3.2 at night against 96 % / 1.8 by day. Almost every alien shot (116 of 117) targets
a soldier lit by the bot's own very-lights or muzzle flashes, so a shorter alien sight in the dark (14 tiles, tried)
changed nothing measurable and was not kept; the crew tables are unchanged (month 0 already uses the next easier one,
§11.6). The fix is to make waiting for daylight a real option in the learning months (above).

Campaign bot, 240 days, final code (`tools/campaign_bot.js` `run({seed, difficulty, days: 240})` per seed, as
`sim.js campaign` does; `node ovni-1999/tools/sim.js campaign --seeds 2 --diff 1 --days 150 --det --save-mid` exit 0),
against §11.8:

| | Recruta §11.8 | Recruta now | Veterano §11.8 | Veterano now |
|---|---|---|---|---|
| Victories, seeds 1–12 | 11/12 | 10/12 (2 timeouts) | 6/12 | 7/12 (4 timeouts, 1 Cydonia lost) |
| Victories, seeds 13–24 | – | – | – | 5/12 |
| Council defeats | 0 | 0 | 0 | 0 |
