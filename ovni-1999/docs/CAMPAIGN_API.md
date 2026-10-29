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
| `map` | `Campaign.startMission`: one `u32()` per battle, used as `mission.seed` |
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
forever.

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
  spotted:bool }                           // aliens know where it is (Missions)
```
- `research[i]`: `topic` is a topic id (including synthesised `interrogate_<unit>`). `cost` is fixed at start as
  `max(1, floor(topic.cost × RNG(80..120)/100))` (geo; `Data.researchRules.costRandPct`). Each day
  `spent += scientists`. The topic is done when `spent ≥ cost`.
- `production[i]`: `item` is a `Data.manufacture` id. `qty` is the order size (0 = «contínuo»). `done` counts units
  finished. `spent` is engineer-hours on the current unit. `paid` is true once the current unit's money and
  materials were taken. `stalled` is `null | 'funds' | 'materials' | 'hangar' | 'space'`.
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
  order: `Data.pickNationality` (1), female `pct(soldierGen.femalePct)` (1), `Data.soldierName` (2),
  `Data.rollSoldierStats` (11), `portraitSeed = int(0, 0x7fffffff)` (1). The recruit gets armour
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
  dogfightId:string|null, lowFuel:bool, missionT:int|null /* t of launch */ }
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
  targetBaseId:string|null /* retaliation assault run */, siteCity:string|null /* terror objective city */ }
```
- Crash and landed sites are UFO records with status `crashed` or `landed`. They are not in `G.sites`.
- A `crashed` UFO never moves. A `landed` UFO lifts off when `groundLeftS ≤ 0`.
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
leftS}`. A terror site is always visible. Each 30-min check does `leftS −= 1800`. At ≤ 0 the site expires (§3.2).
Ours: a craft flying to the site does **not** stop the timer (the orig "cheeky exploit" is removed).

### 1.14 Alien bases
`alienBase = {id, lon, lat, race, region, country, missionId, discovered:bool, foundT:int|null, supplyT:int|null}`.
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
| 3 | 5 s | `World.contacts(G)` | craft–UFO contacts that came from UFO movement (UFO reached a chasing craft); assault runs reaching an X-COM base → `Campaign.baseDefence(G, baseId, ufoId)` |
| 4 | 10 min | `World.burnFuel(G)` | fuel use, low-fuel auto return (§3.3) |
| 5 | 10 min | `World.patrolDiscovery(G)` | each patrolling craft (`patrol:true`) within 1 696 nm of an undiscovered alien base: `geo.pct(50 − 50·d/1696)` ⇒ discovered (`alienBaseFound`, how `'patrol'`) |
| 6 | 10 min | `Missions.scan10m(G)` | retaliation UFOs search for X-COM bases (REA §3.2 chance; sets `base.spotted`, `mission.targetBaseId`) |
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
- Terror site expires: `Economy.addScore(G,'alien', scoring.terrorSiteExpired, site)`, `stats.terrorIgnored++`, the
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
    `dogfightStart`.
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
| `craftRearmShort` | – | `craftId, itemId, what:'ammo'\|'fuel'` | BaseSim | toast «Sem munições/combustível em armazém» | `ev.craftRearmShort` |
| `craftLost` | ✔ | `craftId, type, reason:'dogfight'\|'mission'\|'base', soldiers` | World.loseCraft | popup | `ev.craftLost` |
| `targetLost` | ✔ | `craftId, target` | World | popup «Alvo perdido» with «Patrulhar / Regressar» | `ev.targetLost` |
| `interceptOrderInvalid` | – | `craftId, reason` | World (an order became invalid by itself) | toast | `ev.orderInvalid.<reason>` |
| `dogfightStart` | ✔ | `dogfightId, craftId, ufoId` | World | `DogfightUI.open(G, dogfightId)` | `df.start` |
| `dogfightEnd` | – | `dogfightId, craftId, ufoId, outcome` | Dogfight.finish | DogfightUI closes that panel | `df.end.<outcome>` |
| `researchDone` | ✔ | `baseId, topic, article, unlocked:[topicId], manufacture:[manufactureId], flags:[flag]` | BaseSim | popup «Investigação concluída» → «Ver Ufopédia» (`Ufopaedia.open`) and «Novo projeto» (`BaseUI.open(G, baseId, 'research')`) (GeoUI) | `ev.researchDone` |
| `productionDone` | ✔ | `baseId, item, qty` | BaseSim | popup → «Ir para a base» | `ev.productionDone` |
| `productionStalled` | ✔ (first time per order) | `baseId, item, reason` | BaseSim | popup | `ev.productionStalled.<reason>` |
| `facilityDone` | ✔ | `baseId, type, x, y` | BaseSim | popup | `ev.facilityDone` |
| `deliveryArrived` | ✔ | `baseId, kind, itemId, n` | BaseSim | popup «Chegaram encomendas» | `ev.deliveryArrived.<kind>` |
| `transferArrived` | – | `baseId, kind, itemId, n` | BaseSim (P1) | toast | `ev.transferArrived` |
| `soldierRecovered` | – | `soldierId, baseId` | Soldiers | toast | `ev.soldierRecovered` |
| `terrorSite` | ✔ | `siteId, cityId, lon, lat, race` | Missions | red popup with siren, «Enviar equipa» | `ev.terrorSite` |
| `terrorSiteExpired` | ✔ | `siteId, cityId, points` | Missions | popup (−1 000) | `ev.terrorSiteExpired` |
| `crashSiteExpired` | – | `ufoId` | Missions | toast | `ev.crashSiteExpired` |
| `landedUfoGone` | – | `ufoId` | Missions | toast (a landed UFO we targeted lifted off and was lost) | `ev.landedUfoGone` |
| `alienBaseFound` | ✔ | `alienBaseId, how:'patrol'\|'agents'\|'supply'` | World / Missions | popup + centre the globe | `ev.alienBaseFound` |
| `alienBaseBuilt` | – | `alienBaseId` | Missions | nothing (hidden); debug toast | — |
| `retaliation` | – | `missionId, region` | Missions | nothing (hidden) unless `G.debug` | — |
| `baseAttack` | ✔ | `baseId, ufoId` | World.contacts | popup «A base está a ser atacada!» then the result | `ev.baseAttack` |
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
onUfoWaypoint(G, ufoId)                        next leg, landing (status 'landed', groundLeftS = traj.groundS or 5 at sea),
                                               objective (terror site / alien base / supply / assault run) or exit
onUfoLiftOff(G, ufoId)                         mission points (Data.scoring.missionPoints) for 'score' missions, next leg
onUfoDown(G, ufoId, how:'crashed'|'destroyed', craftId)
     → crash over water ⇒ destroyed; crashed: status 'crashed', crashLeftS = RNG(TUNE.CRASH_SITE_HOURS)·3600, speed 0;
       X-COM score ufo.score (crash) or scoreDestroyed; next-wave delay missionRules.shootDownDelayMin;
       shoot-down retaliation roll (ai) from missionRules.shootDownRetaliationFromMonth; stats; ufoCrashed|ufoDestroyed
onSiteCleared(G, siteRef, result:'win'|'abort'|'loss')
     → win: remove the UFO / terror site / alien base (+ end its mission; alien base: also +scoring.alienBaseDestroyed
       is already inside the battle score, do not add again); abort/loss: nothing (the site keeps its timer)
onResearch(G, topicId)                         'immediate' scripts (researchRetaliation after martian_solution)
```
Mission rules follow `Data.alienMissions`, `Data.missionScripts`, `Data.missionRules`, `Data.raceWeights` and
DESIGN §3.18. Region choice: `missionRules.nearBaseWeightMul` applies to regions whose centroid is within `nearBaseNm`
of any X-COM base. Alien bases and Battleships do not pick the Muton race when the mission needs a commander
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
                                                 connectivity, is the lift, or drops a capacity below its use
hire(G, baseId, kind:'soldier'|'scientist'|'engineer', n) → {ok,reason}   pays TUNE.*_HIRE; delivery after DELIVERY_PERSONNEL_H
sack(G, baseId, kind, nOrSoldierId) → {ok,reason}     free staff only; a sacked soldier's armour/items return to stores
buy(G, baseId, itemIdOrCraftType, n) → {ok,reason}    Data.items[id].buy or Data.crafts[type].buy; ETA item.deliveryH ‖ DELIVERY_ITEMS_H ‖ def.deliveryH
sell(G, baseId, itemId, n) → {ok,reason}              immediate, Data.items[id].sell; live aliens never (Data.liveAliensSellable)
moveCargo(G, craftId, itemId, n) → {ok,reason}        n > 0 stores→craft.equipment, n < 0 back (craft at its base)
setArmour(G, soldierId, armourId) → {ok,reason} ; assignSoldier(G, soldierId, craftId|null) → {ok,reason}
fitWeapon(G, craftId, slot, weaponType|null) → {ok,reason}   launcher items from/to stores; ammo starts 0 → 'rearm'
startResearch(G, baseId, topic, scientists) → {ok,reason}   'unavailable'|'labs'|'scientists'|'busy'; consumes needItem / live alien
setScientists(G, baseId, topic, n) ; cancelResearch(G, baseId, topic)   (cancel keeps nothing consumed, orig)
startProduction(G, baseId, item, engineers, qty) → {ok,reason}   'unavailable'|'workshops'|'engineers'|'hangar'
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
  `cost` and the materials; if that is impossible, set `stalled` and push `productionStalled` once. Otherwise
  `spent += engineers`. A unit is done when `spent ≥ hours`; then `spent −= hours`, `paid = false`, and the product
  goes in. Items and armour go to `stores`. A craft goes through `Campaign.addCraft` and needs a free hangar (else
  `stalled:'hangar'`). The order is complete at `done == qty` (never if `qty == 0`).
- **Craft maintenance** (status chain repair → rearm → refuel → ready):
  - repair: `hp += CRAFT_REPAIR_HP_H` per hour.
  - rearm: each weapon gains `rearmPerHour` ammo per hour (cannon 100 = 2 × `cannon_rounds`), using
    `ammoItem` from stores; if stores are short, push `craftRearmShort` and skip to the next status.
  - refuel: `+def.refuel` per 30 min; Elerium craft use 1 `elerium_115` per refuel step.
  - `craftReady` is pushed when the chain finishes.
- Personnel delivered → `Soldiers.generate` + `Campaign.addSoldier`, or `scientists` / `engineers +=`. Craft
  delivered → `Campaign.addCraft` (weapons empty).

### 5.7 `OV.Economy` (economy.js)
```
addScore(G, side:'xcom'|'alien'|'research', pts, lon?, lat?)   region/country via GMath (research: no position)
ufoActivity30m(G) ; daily(G)                                    §3.1 steps 9, 14
upkeep(G) → {facilities, salaries, crafts, total}               Data.monthlyUpkeep over all bases (completed facilities only)
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
- `funds += income − upkeep`.
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
5. 8 soldiers (`OV.Soldiers.generate` if present, else `makeSoldier`; same draws), all seated on the Skyranger, then
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
}
```
- `funded(template)`: copy `craft.equipment` into `pool`. Go through slots R, L, belt…, pack… in order. Take each item
  from `pool` if `pool[item] > 0`, otherwise drop it from the slot.
- `meta = {time: dayPhase, cityKey: site ? 'city.'+cityId : null, regionKey, countryKey|null,
  campaign:{siteRef, craftId}}`.
- `startMission` sets `G.activeMission = {siteRef, craftId, startedT: G.t}`.

**`finishMission(G, B) → model`**, applied in this order:
1. `deb = OV.Battle.debrief(B, {researched: G.researched})`.
2. `Economy.addScore(G, 'xcom', deb.score, lon, lat)` at the site point (for Cydonia: the base's point).
3. `deb.recovered` → `base.stores`. `deb.captured` → `base.aliens` while containment has room (`capacities.aliens`).
   The rest go to `model.capturedLost` (they die; orig).
4. `craft.equipment −= deb.equipmentLost`, clamped at 0 and with no zero keys.
5. Soldiers, from `deb.soldiers`:
   - `ok` → `Soldiers.applyMission(G, id, {exp, hpLost, kills}, rng(G,'combat'))`;
   - `dead` → `Soldiers.kill(G, id, 'kia', where)`;
   - `mia` → `Soldiers.kill(G, id, 'mia', where)`.

   Then run `Soldiers.promotions(G)`.
6. Craft: if `deb.craftLost`, `World.loseCraft(G, craftId, 'mission')`. Otherwise `dest = {kind:'base', id}` and status
   `returning`. A craft on a Cydonia mission is at base already, so it goes through checkup instead.
7. `Missions.onSiteCleared(G, siteRef, deb.result)`.
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

**`baseDefence`** (MVP auto-resolve, DESIGN §4; combat stream):
1. Each completed defence facility fires once: hit `pct(hitRatio)`, `dmg = power/2 + int(0, power)` added to
   `ufo.dmg`.
2. If `ufo.dmg ≥ hp`: `result 'ufoDestroyed'`, `Missions.onUfoDown(…, 'destroyed', null)`.
3. Otherwise compare `garrison = Σ (tu + fire + hp)` of fit soldiers in the base (not on a craft that is out) against
   `TUNE.BASE_DEFENCE_BASE + TUNE.BASE_DEFENCE_PER_COEF × 2·difficulty`.
   - Win: `'repelled'`. `int(1,3)` random fit soldiers die (cause `'base'`), the UFO is removed with
     `+ufo.score`, the retaliation mission ends.
   - Loss: `'lost'` → the base is destroyed → `endGame(G, 'lost', 'baseLost')`.
4. Push `baseDefence`.

### 5.10 `OV.Save` (save.js; the only sim file that touches `localStorage`, guarded by `typeof localStorage`)
```
SCHEMA = 1 ; SLOTS = ['auto','autoTurn','1','2','3'] ; KEY(slot) = 'ovni1999.save.' + slot
toJSON(G, B?, meta?) → obj      throws Error('save.err.busy') if G.dogfights.length; B via OV.Battle.serialize
fromJSON(obj) → {G, B, meta}    validates game/schema, runs MIGRATIONS, Campaign.rebuildDerived(G), G.events = [],
                                B via OV.Battle.deserialize; throws Error('save.err.game'|'save.err.schema'|'save.err.parse')
write(slot, obj) → {ok, reason?:'quota'|'unavailable'} ; read(slot) → obj|null ; remove(slot) → bool
list() → [{slot, label, savedAt, t, month, battle:bool}] (existing slots only) ; slots() → same (alias)
load(slot) → {G, B, meta}|null
exportFile(obj) → {filename:'ovni1999-YYYY-MM-DD.json' (game date), mime:'application/json', text}   UI downloads it
importFile(text) → {G, B, meta}  (= fromJSON(JSON.parse(text)))
MIGRATIONS = []                  MIGRATIONS[n] upgrades a schema-n save object to n+1 (in place, returns it)
```
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
| `SOLDIER_/SCIENTIST_/ENGINEER_HIRE/SALARY` | tuning.js | orig | personnel economy |
| `BASE_DEFENCE_BASE`, `BASE_DEFENCE_PER_COEF` | tuning.js (**new**) | 1800, 300 | retaliation auto-resolve |
| `SHADE_DAY/DUSK/NIGHT`, `CHEAT_TURN`, `SQUAD_MAX_UI` | tuning.js | 0/6/13, [12,10,8], 10 | battle feel |
| facility `cost`, `days`, `upkeep`, radar `radarChance`/`radarRange` | data/base.js `FAC` | §3.14 | build pace, detection |
| `startingBase` (layout, personnel, crafts, stores) | data/base.js | orig + extras | opening |
| craft `speed`, `fuel`, `hp`, `refuel`; `craftRules.*`; `dogfight.*` | data/crafts.js | §3.13 | interception |
| craft weapon `dmg`, `acc`, `ammoMax`, `reload` | data/crafts.js | §3.13 | interception |
| UFO `hp`, `speed`, `weapon`, `breakOff`, `score`; `ufoRules.*` | data/ufos.js | §3.12 | interception, recovery |
| research `cost`, `points`; `researchRules.costRandPct` | data/research.js | ×0.25 orig | tech pace |
| manufacture `hours`, `cost`, `materials`, `space` | data/research.js | ×0.1–0.2 orig | production pace |
| `alienMissions[*].waves[*].timer` (`WAVE_TIMER_SCALE`) | data/geo.js | ×0.5 orig | alien tempo |
| `missionScripts` (`startDelay`, `firstMonth`, `seedAlienBase.maxBaseDistNm`) | data/geo.js | §3.18 | escalation |
| `raceSchedule` | data/geo.js | §3.18 | enemy progression |
| `missionRules` (`shootDownDelay`, `nearBaseNm`, `nearBaseWeightMul`, `shootDownRetaliationFromMonth`, `landPointTries`, `alienBaseRevealMonthlyPct`, `patrolReveal`) | data/geo.js | §3.18 | alien pressure |
| `scoring` (`ufoActivity`, `alienBasePerDay`, `terrorSiteExpired`, `alienBaseDestroyed`, `rating`) | data/geo.js | §3.17 | council pressure |
| `geoConst.entryRingDeg`, `geoConst.sun` | data/geo.js | [25,35], no seasons | UFO entry, day and night |
| country `fundingBase`, `fundingCap` | data/geo.js | orig | funding |
| `alienItemTiers`, deployments `rows[*].qty` | data/units.js | §3.12 | battle difficulty |
| starting Skyranger extras (1 Medi-Kit, 4 flares) and `defaultLoadouts` roles | campaign.js section A | ours | first-mission teaching |

The campaign bot (`tools/sim.js campaign`) reports these targets from DESIGN §14: victory day (100–170), number of
battles (12–18), council defeats (≤ 20 % on Veterano).

---

## 9. Test obligations (`tools/tests/<area>_*.test.js`, `node ovni-1999/tools/test.js --strict` green)
- **World**:
  - order and canOrder reasons;
  - interception contact creates a dogfight;
  - low-fuel return;
  - detection probability over 2 000 rolls within ±3 % of the formula;
  - idle coalescing equals per-tick stepping (`hash`);
  - JSON round-trip after a simulated week.
- **Missions**: month 0 plan (gameStart + firstTerror); a full wave cycle spawns UFOs on schedule; a terror site
  appears and expires (−1 000); onUfoDown (crash over water ⇒ destroyed); alien base creation and reveal.
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
