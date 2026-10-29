# UFO: Enemy Unknown — GEOSCAPE deconstruction (strategic layer)

**Sources & method.** `www.ufopaedia.org` / `temp.ufopaedia.org` are NOT reachable from this session (host not in the allowed network list), so every number below comes from the OpenXcom project, which re-implements the original rules and ships the original's data as YAML: the `xcom1` rulesets (`vars, crafts, craftWeapons, ufos, facilities, research, manufacture, items, regions, countries, alienMissions, alienDeployments, alienRaces, missionScripts, ufoTrajectories, soldiers, units, alienItemLevels, startingBase`) and the engine code (`GeoscapeState, DogfightState, Country, Base, Craft, Ufo, AlienMission, AlienStrategy, MonthlyReportState, DebriefingState, BattlescapeGenerator, Mod, SavedGame, Soldier, BattleUnit…`), master branch plus v1.0 where master moved a constant into the ruleset. Local copies for the lead: `scratchpad/oxc/*.rul` and `.../oxc/src/*.cpp`. Where OpenXcom knowingly differs from the DOS original, it is flagged. Anything I could not verify is listed in *uncertain*.

Units: distances in **nautical miles (nm)** = 1 arc-minute of the globe (OpenXcom `Nautical(x) = x/60 deg`; 1 nm = 1.852 km). Speeds in **knots** (nm/h). Dogfight distances are abstract "km" units. Money in US$.

---

## 1. Time

| Item | Value |
|---|---|
| Game start | 1 Jan 1999, 12:00 (weekday 6 = Friday), year has real month lengths + leap years |
| Base tick | 5 s. Everything is driven by triggers: every 5 s, 10 min, 30 min, 1 h, 1 day, 1 month (month trigger fires at day rollover to the 1st) |
| Time-compression buttons | 5 s = 1 tick/step; 1 min = 12; 5 min = 60; 30 min = 360; 1 h = 720; 1 day = 17 280 ticks/step. OpenXcom real-time pacing: one step every 80 ms (`geoClockSpeed`), dogfight frame every 30 ms |
| Auto slow-down to 5 s ("timerReset") | UFO detected, UFO lost, craft reaches destination/UFO, dogfight start, base under attack, research/production/construction complete, mission site appears, monthly report, low fuel, items arriving |
| Per-trigger logic | **5 s**: UFO & craft movement, landings/crashes lifecycle, dogfight opening (max 4 simultaneous), base-defence trigger, craft lost. **10 min**: craft fuel consumption + low-fuel return, patrol craft alien-base discovery, UFO detection of X-COM bases. **30 min**: alien mission countdowns & UFO spawning, crash-site expiry, craft refuelling, UFO radar detection/loss, alien activity points, terror-site countdown. **1 h**: craft repair & rearm, transfers arrive, manufacturing progress, storage-limit check. **1 day**: construction, research progress, wound healing, (optional) daily psi, alien-base points & supply roll, autosave on 10th/20th. **1 month**: new alien missions, psi training (original monthly), funding/monthly report, 20 % chance to reveal an alien base |
| Hotkeys (OpenXcom) | 1–6 time speeds, I intercept, B bases, G graphs, U UFOpaedia, F funding, Esc options, Tab toggle detail, R toggle radar circles, arrows rotate, +/− zoom |

---

## 2. World

### 2.1 Regions (15; 12 land regions generate missions, 3 ocean regions redirect)

Coordinates in the ruleset: longitude 0–360 east, **latitude negative = North**. `regionWeight` = chance the alien strategy picks the region for a table mission (total 124). `missionWeights` = relative odds of mission type inside that region (month-0 table; a chosen mission is removed from that region's table until the whole table empties and is reset).

| Region | New-base cost | Weight | Research / Harvest / Abduction / Infiltration / Base | Terror cities (zone 3) |
|---|---|---|---|---|
| North America | $800 000 | 18 | 14 / 17 / 20 / 20 / 20 | New York, Washington, Los Angeles, Montreal, Havana, Mexico City, Chicago, Vancouver, Dallas |
| Arctic | $950 000 | 4 | 25 / – / – / – / 35 | – |
| Antarctica | $900 000 | 4 | 25 / – / – / – / 35 | – |
| South America | $600 000 | 10 | 10 / 24 / 12 / 18 / 22 | Brasilia, Bogota, Buenos Aires, Santiago, Rio de Janeiro, Lima, Caracas |
| Europe | $1 000 000 | 16 | 10 / 10 / 15 / 20 / 6 | London, Paris, Berlin, Moscow, Rome, Madrid, Budapest |
| North Africa | $650 000 | 12 | 8 / 8 / 8 / 8 / 19 | Lagos, Cairo, Casablanca |
| Southern Africa | $550 000 | 8 | 7 / 8 / 8 / 8 / 9 | Pretoria, Nairobi, Cape Town, Kinshasa |
| Central Asia | $500 000 | 12 | 5 / 5 / 6 / 10 / 8 | Ankara, Delhi, Karachi, Baghdad, Tehran, Bombay, Calcutta |
| South East Asia | $750 000 | 15 | 8 / 13 / 21 / 13 / 8 | Tokyo, Beijing, Bangkok, Manila, Seoul, Singapore, Jakarta, Shanghai, Hong Kong |
| Siberia | $800 000 | 10 | 6 / – / 4 / – / 9 | Novosibirsk |
| Australasia | $750 000 | 10 | 15 / 11 / 4 / 8 / 16 | Canberra, Wellington, Melbourne, Perth |
| Pacific | $600 000 | 5 | 15 / – / – / – / 27 | – |
| North Atlantic | $500 000 | – (missions → North America) | – | – |
| South Atlantic | $500 000 | – (→ Antarctica) | – | – |
| Indian Ocean | $500 000 | – (→ Southern Africa) | – | – |

51 terror cities in total. Terror missions never use these weights: every month one terror mission picks a random region that has a city not hit recently.

Region bounding boxes (lon min–max, lat min–max; lat<0 = N): North America [195–305,−70–−55],[230–305,−55–−30],[240–300,−30–−10]; Arctic [0–360,−90–−70]; Antarctica [0–360,60–90]; South America [270–315,−10–0],[275–330,0–15],[275–325,15–60]; Europe [335–60,−70–−35]; North Africa [335–40,−35–−15],[335–55,−15–0]; Southern Africa [5–55,0–40]; Central Asia [40–70,−35–−15],[60–90,−50–−35],[70–90,−35–−5]; South East Asia [90–105,−50–10],[105–150,−50–−5]; Siberia [60–180,−70–−50]; Australasia [105–180,−5–60]; Pacific [180–195,−70–−55],[180–230,−55–−30],[180–240,−30–−10],[180–270,−10–0],[180–275,0–60],[150–180,−50–−5]; North Atlantic [305–335,−70–−30],[300–335,−30–−10],[315–335,−10–0]; South Atlantic [330–5,0–15],[325–5,15–60],[5–55,40–60]; Indian Ocean [55–70,−15–10],[70–90,−5–10],[55–105,10–60].

**Mission zones per region** (each region has 6 lists of rectangles): zones 0, 1, 2 = patrol/landing areas (10 boxes each, used by UFO trajectories); zone 3 = cities (terror sites, infiltration landings); zone 4 = alien-base sites; zone 5 = entry/exit areas (polar caps + far-away boxes: UFOs appear and vanish there).

### 2.2 Funding countries (16)

Starting funding = `RNG(base, 2×base) × $1000`, then every country gets the same correction so the total is **$6 000 000/month** (`initialFunding: 6000`). Starting cash = that first month's total (≈ $6.0 M). Cap = maximum monthly funding ever reachable (sum of caps = $95 M/month). Region = region containing the country's label point (used for infiltration pacts).

| Country | Region | Start range (k$/mo) | Cap (k$/mo) |
|---|---|---|---|
| USA | North America | 600–1200 | 10 000 |
| Canada | North America | 230–460 | 4 000 |
| Brazil | South America | 300–600 | 4 000 |
| UK | Europe | 240–480 | 7 000 |
| France | Europe | 320–640 | 8 000 |
| Germany | Europe | 250–500 | 9 000 |
| Italy | Europe | 160–320 | 6 000 |
| Spain | Europe | 140–280 | 5 000 |
| Russia | Europe (label 60°E 60°N; also on the Siberia border → infiltration from either region can turn it) | 230–460 | 8 000 |
| Egypt | North Africa | 230–460 | 2 000 |
| Nigeria | North Africa | 180–360 | 2 000 |
| South Africa | Southern Africa | 230–460 | 3 000 |
| India | Central Asia | 150–300 | 5 000 |
| China | South East Asia | 245–490 | 7 000 |
| Japan | South East Asia | 400–800 | 10 000 |
| Australia | Australasia | 280–560 | 5 000 |

Sum of bases = 4 185 k → raw random total 4.2–8.4 M, normalised to 6.0 M. Arctic, Antarctica, Siberia (no funder besides Russia's border), Pacific and the oceans have no funders → infiltration there achieves nothing (code still spawns the base).

### 2.3 Base placement
- Max **8 bases**; grid **6×6** tiles per base; first facility is the Access Lift (free placement), every other facility must touch an existing completed/under-construction facility (connected to the lift).
- New-base price = region cost above (paid when the lift is placed) + $300 000 for the lift itself; cannot be placed on water.
- Facility cost is paid up-front; dismantling refunds nothing; unfinished facilities count for nothing (no capacity, no upkeep, no radar).

---

## 3. Detection (radar)

### 3.1 X-COM radar
| Source | Range (nm / km) | Chance per check | Notes |
|---|---|---|---|
| Small Radar System | 1 695 nm / 3 139 km | 10 % | checks every **30 min** (OpenXcom) |
| Large Radar System | 2 577 nm / 4 773 km | 20 % | chances of all radars **in the same base add up** (Small+Large = 30 %) |
| Hyper-Wave Decoder | 2 759 nm / 5 110 km | **100 %** | also reveals: craft type, race, mission, zone(region); keeps tracking anything inside its range |
| Craft radar (any airborne craft) | 672 nm / 1 245 km | 100 % | only while status = OUT |

Detection roll (per base, per undetected UFO, every 30 min): `chance = Σ radarChance(facilities in range) × (100 + visibility)/100`, where UFO **visibility** = size modifier + altitude modifier:

| Size class | modifier | | Altitude | modifier |
|---|---|---|---|---|
| very small (Small Scout) | −30 | | landed (ground) | −30 (overrides size) |
| small (Medium/Large Scout) | −15 | | very low | size −20 |
| medium (Harvester, Abductor) | 0 | | low | size −10 |
| large (Terror Ship, Supply Ship) | +15 | | high | size |
| very large (Battleship) | +30 | | very high | size −10 |

Examples (Small Radar alone, per 30 min): Small Scout at very low 5 %, at high 7 %; Battleship at high 13 %; any landed UFO 7 %. Mean time-to-detect at 7 % ≈ 7 h. A UFO is **lost** when it is outside every radar circle at a 30-min check (popup "UFO lost" if a craft was chasing it). Hyper-wave ranges are checked first and never lose track inside range.

### 3.2 Alien detection of X-COM bases (leads to retaliation)
- Only UFOs of a **Retaliation** mission scan (OpenXcom option `aggressiveRetaliation` lets every UFO scan). A scanning UFO must be past its 2nd trajectory point, not in zone 5, not crashed, within **268 nm** (UFO sight range).
- Every 10 min: `chance% = (Σ facility tiles / 6 + 15) / (mindShields + 1)` → starting base (18 tiles) 18 %, full 36-tile base 21 %, halved per Mind Shield.
- Once a base is marked, the mission's final wave spawns a **Battleship** flying directly to the base (assault run), regardless of the normal wave list. In OpenXcom only the last base found per region is remembered.

### 3.3 Discovering alien bases
- Each month: 20 % chance that one undiscovered alien base is revealed by "X-COM operatives".
- A **patrolling** craft (no destination) within 1 696 nm of an alien base: every 10 min chance = `50 − 50×(distance/1696)` %.
- Attacking a Supply Ship landing at a base / following it reveals the base's position indirectly (player-side knowledge only).

---

## 4. UFOs

### 4.1 Stats
| UFO | Size class | Damage capacity | Max speed (kn) | Weapon power | Weapon range (dogfight ×8) | Reload (ticks) | breakOffTime | Score crash / destroyed | Battlescape footprint |
|---|---|---|---|---|---|---|---|---|---|
| Small Scout | very small | 50 | 2 200 | 0 (unarmed) | 0 | 56 | 200 | 50 / 100 | 10×10 |
| Medium Scout | small | 200 | 2 400 | 20 | 15 (120) | 56 | 250 | 75 / 150 | 10×10 |
| Large Scout | small | 250 | 2 700 | 20 | 34 (272) | 48 | 300 | 125 / 250 | 20×20 |
| Harvester | medium | 500 | 4 000 | 40 | 22 (176) | 48 | 500 | 250 / 500 | 20×20 |
| Abductor | medium | 500 | 4 300 | 40 | 20 (160) | 32 | 500 | 250 / 500 | 20×20 |
| Terror Ship | large | 1 200 | 4 800 | 120 | 42 (336) | 24 | 2 000 | 500 / 1 000 | 30×20 |
| Battleship | very large | 3 000 | 5 000 | 140 | 65 (520) | 24 | 4 000 | 700 / 1 400 | 30×30 |
| Supply Ship | large | 2 200 | 3 200 | 60 | 36 (288) | 24 | 3 000 | 400 / 800 | 30×20 |

- **Crash** when damage > 50 % of capacity (26 / 101 / 126 / 251 / 251 / 601 / 1 501 / 1 101); **destroyed** at ≥ 100 % (no recovery). UFOpaedia notes the original could not destroy Supply/Terror/Battleships outright; OpenXcom can.
- A crashed UFO over water is destroyed. A crash site on land lasts `RNG(24, 96)` hours, then disappears.
- A UFO's actual speed on each trajectory leg is a % of max speed (see §5.2) — that is what makes Battleships (5 000 kn) interceptable by an Interceptor (2 100 kn) on slow legs.

### 4.2 Crews (alienDeployments: `low–high (+RNG(0,dQty))`)
Alien count per rank: **Beginner/Experienced** = low + RNG(0,d); **Veteran/Genius** = low + (high−low)/2 + RNG(0,d); **Superhuman** = high + RNG(0,d). Rank slots: 0 Commander, 1 Leader, 2 Engineer, 3 Medic, 4 Navigator, 5 Soldier, 6/7 Terrorists.

| Deployment | Cmdr | Leader | Eng | Medic | Nav | Soldier | Terrorist A | Terrorist B | Total Beg/Exp | Total Superhuman |
|---|---|---|---|---|---|---|---|---|---|---|
| Small Scout | – | – | – | – | – | 1–1 | – | – | 1 | 1 |
| Medium Scout | – | – | – | – | 1–2 (+1) | 2–4 (+2) | – | – | 3–6 | 6–9 |
| Large Scout | – | – | 1–2 (+1) | – | 1–1 (+1) | 1–3 (+5) | – | – | 3–10 | 6–13 |
| Harvester | – | 1–1 (+1) | 2–2 | 1–2 | 1–2 | 5–9 (+4) | – | – | 10–15 | 16–21 |
| Abductor | – | 1–1 | 2–2 | 2–4 | 1–1 (+1) | 3–5 (+4) | – | – | 9–14 | 13–18 |
| Terror Ship / Terror site | – | 1–1 | 1–2 | 1–1 (+1) | 1–2 | 4–6 (+1) | 1–3 (+2) | 1–3 (+2) | 10–16 | 18–24 |
| Battleship / Base Defence | 1–1 | 1–3 | 1–2 | 1–2 | 1–2 | 4–8 (+4) | 0–2 (+1) | 0–2 (+1) | 9–15 | 22–28 |
| Supply Ship | – | 1–1 | 1–2 | 1–2 | 1–2 | 5–7 (+6) | – | – | 9–15 | 14–20 |
| Alien Base assault | 1–1 | 2–4 | 1–2 | 1–1 | 1–2 | 5–7 (+4) | 1–3 (+1) | 0–2 (+1) | 13–19 | 22–28 |
| Cydonia landing | 3–5 | 3–5 | – | – | – | 4–6 | 2–4 | – | 12 | 20 |
| Cydonia final assault | 2–4 | 1–3 | 3–5 | 3–5 | 3–5 | 3–5 | 1–4 | – | 16 | 31 |

Race composition of the 8 rank slots (`alienRaces`): **Sectoid** full set + Cyberdisc×2; **Floater** full set + Reaper×2; **Snakeman** no Medic (→ Soldier) + Chryssalid×2; **Muton** no Commander/Leader/Medic (→ Soldiers), has Engineer & Navigator + Silacoid & Celatid; **Ethereal** Commander, 4× Leader (no Eng/Medic/Nav), Soldier + Sectopod×2; **Mixed** (Cydonia) Ethereal Soldier/Leader/Commander, Chryssalid, Silacoid, Celatid, Sectopod×2.

### 4.3 Alien unit score values (points for a kill; live capture = ×2 if not yet interrogated, else 10)
Sectoid Sol 10 / Nav 12 / Med 14 / Eng 16 / Ldr 20 / Cdr 25; Floater Sol 12 / Nav 14 / Med 16 / Eng 18 / Ldr 25 / Cdr 35; Snakeman Sol 15 / Nav 17 / Eng 20 / Ldr 28 / Cdr 36; Muton Sol 15 / Nav 17 / Eng 19; Ethereal Sol 20 / Ldr 30 / Cdr 40; Cyberdisc 20, Reaper 25, Chryssalid 25, Silacoid 20, Celatid 20, Sectopod 30, Zombie 18; civilians 30; X-COM HWP 20. Alien psi: Sectoid Leader psiSkill 50 / Commander 60, Ethereal Sol 40 / Ldr 45 / Cdr 50 (only these races use psionics).

---

## 5. Alien missions

### 5.1 Mission definitions (`alienMissions.rul`)
Points = alien activity added to region AND country (at UFO lift-off from a landing for Harvest/Abduction/Terror; at base creation for Base; Infiltration's 150 only when the pact is signed at month end). Wave timer `T` (minutes): the next UFO spawns after `(T/2 … 1.5 T)` rounded to 30 min; multi-count waves repeat the same timer per UFO.

| Mission | Points | Objective | Waves (UFO × count, trajectory, T) |
|---|---|---|---|
| Alien Research | 0 | score only | Small Scout P0 9000 → Medium Scout P2 7800 → Large Scout ×2 P4 9000 |
| Alien Harvest | 30 | score | SS P0 7800 → SS P2 7800 → MS P2 6000 → LS P0 7800 → LS P3 9000 → Harvester P4 3000 → Harvester P4 750 → Battleship P2 1500 |
| Alien Abduction | 50 | score | SS P0 15000 → MS P1 18000 → LS P3 9000 → Abductor P3 9000 → Abductor ×2 P4 60 |
| Alien Infiltration | 150 (pact) | pact + alien base (zone 4); **never ends** – after the last wave it signs a pact with one non-pact country of the region, spawns a base and restarts from wave 1 | SS P0 16500 → MS P1 15000 → MS P6 13800 → LS P7 9000 → LS P7 60 → Terror Ship P7 60 → Supply Ship P7 60 → Battleship ×2 P7 60 |
| Alien Base | 50 | build base (zone 4) after last wave | SS P1 13500 → MS P5 15000 → LS P5 60 → Supply Ship ×2 P5 60 → Battleship P6 60 |
| Alien Terror | 10 | terror site at a city (zone 3) | MS P1 15000 → LS P1 9600 → Terror Ship P0 12000 → **Terror Ship P7 9000 (objective: becomes the terror site)** |
| Alien Retaliation | 0 | find & assault X-COM base | SS P8 3000 → MS ×2 P8 3000 → LS ×3 P8 3000 → Battleship ×2 P8 3000; once a base is found the next spawn is a Battleship on the `__RETALIATION_ASSAULT_RUN` straight to the base |
| Alien Supply | 0 | resupply an alien base | Supply Ship P9 6000, lands on the base |

Extra timers: a shot-down UFO delays its mission's next wave by `30×(RNG(0,400)+48)` min = **24 h–224 h**; a Battleship that reaches a base likewise delays the mission 24–224 h. Race weights by month (key applies until the next key):

| Mission | m0 | m1 | m3 | m6 | m9+ |
|---|---|---|---|---|---|
| Research | Sec 70 Snk 10 Flt 20 | 60/10/30 | Sec 30 Snk 10 Mut 30 Flt 30 | 20/10/40/30 | 30/10/30/30 |
| Harvest | Sec 50 Snk 20 Flt 30 | Sec 50 Flt 50 | Sec 30 Mut 30 Flt 40 | 10/40/50 | 30/30/40 |
| Abduction | Sec 60 Flt 40 | 40/60 | 50/50 | 30/70 | 50/50 |
| Infiltration | Sec 60 Snk 20 Flt 20 | 50/20/30 | Sec 20 Snk 20 Mut 50 Flt 10 | Sec 10 Snk 10 **Eth 40** Mut 30 Flt 10 | 20/20/10/40/10 |
| Base | Sec 30 Snk 20 Flt 50 | 40/20/40 | Sec 10 Snk 40 Mut 30 Flt 20 | Sec 10 Snk 40 Eth 10 Mut 20 Flt 20 | Sec 10 Snk 20 Eth 40 Mut 20 Flt 10 |
| Terror | Sec 30 Flt 70 | 60/40 | Sec 20 **Snk 60** Flt 20 | Sec 10 Snk 20 Eth 40 Mut 20 Flt 10 | 20/30/20/20/10 |
| Retaliation | 20 % each race (or the race of the UFO that was shot down) | | | | |
| Supply | race of the base | | | | |

→ Sectoids/Floaters months 0–2, Snakemen (Chryssalid terror) from month 3, Mutons from month 3, Ethereals from month 6.

### 5.2 Trajectories (`[zone, altitude, speed %]`; altitude 0 ground, 1 very low, 2 low, 3 high, 4 very high)
A waypoint with altitude 0 means: **land at the previous waypoint's position for `groundTimer × 5 s`**, then fly to this one. The last waypoint is the exit (UFO leaves the globe).

| Id | groundTimer → landing time | Waypoints | Landings |
|---|---|---|---|
| P0 | 3000 → 4 h 10 | [5,4,100] [0,3,74] [0,1,28] [1,1,47] [5,2,100] | none (fly-over) |
| P1 | 4000 → 5 h 33 | [5,4,100] [0,2,76] [0,2,20] [1,1,44] [0,0,20] [0,2,32] [2,1,65] [5,0,100] | 2 (zone 1, zone 2) |
| P2 | 5000 → 6 h 57 | [5,4,100] [0,3,57] [0,2,26] [1,1,50] [5,0,100] | 1 (zone 1) |
| P3 | 6000 → 8 h 20 | [5,4,100] [0,3,30] [0,2,25] [2,1,20] [5,0,100] | 1 (zone 2) |
| P4 | 7000 → 9 h 43 | [5,4,100] [0,2,67] [0,2,52] [2,1,40] [0,0,30] [0,2,20] [2,1,30] [5,0,100] | 2 (zone 2 ×2) |
| P5 | 4000 → 5 h 33 | [5,4,100] [0,2,50] [0,2,20] [4,1,15] [0,0,20] [0,2,29] [4,1,42] [5,0,90] | 2 (zone 4 = base sites) |
| P6 | 5000 → 6 h 57 | [5,4,100] [0,3,50] [0,2,25] [4,1,16] [5,0,100] | 1 (zone 4) |
| P7 | 9000 → 12 h 30 | [5,4,100] [0,3,60] [0,2,30] [3,1,20] [5,0,100] | 1 at a **city** (zone 3); for the terror objective wave the ship is consumed and the terror site appears instead |
| P8 | 6000 (unused) | [5,4,100] [1,1,60] [2,1,20] [3,1,30] [4,1,20] [0,1,42] [2,1,56] [5,4,100] | none – retaliation sweep at very low altitude through every zone |
| P9 | 2000 → 2 h 47 | [5,4,80] [5,0,100] | lands on the alien base |
| assault run | 1000 | [5,4,100] [5,0,100] | flies straight to the X-COM base |

Landings over water last 5 s (immediate take-off). Speeds: e.g. a Battleship on P7 flies 5000 → 3000 → 1500 → 1000 kn, so even an Interceptor can catch it on the last legs.

### 5.3 Monthly scheduling (`missionScripts.rul`, evaluated at each month start)
| Command | When | Effect |
|---|---|---|
| gameStart | month 0 only | 1 Alien Research mission, race Sectoid, **targets the region containing an X-COM base**, first UFO 120 min after start |
| recurringTerror | every month from month 0 | 1 Alien Terror mission in a random region with an unused city; first UFO after 150 min |
| recon | from month 1 | 1 mission from the regional table (region by weight, type by region's weights; type then removed from that region's table) |
| invasion | from month 6 | a 2nd table mission per month |
| researchRetaliation | every month once **The Martian Solution** is researched | Retaliation against a region with an X-COM base |
| difficulty retaliation | from month 14 (Beginner) / 13 / 12 / 11 / 10 (Superhuman) | 1 Retaliation vs a base region if none already created this month |
| shoot-down retaliation | any time | see §6.3 (4–20 % per UFO shot down) |
| alien-base supply | every day per alien base | 6 % → Alien Supply mission |

So: month 0 = 2 missions, months 1–5 = 2, month 6+ = 3 (+ retaliations). The same mission type never runs twice simultaneously in one region.

### 5.4 Terror sites, alien bases
- Terror site: appears when the objective Terror Ship reaches its city; lasts `RNG(4, 10)` **hours**; 16 civilians; if it expires without being attacked: **−1 000** points to region and country (a craft merely targeting it keeps it alive — "cheeky exploit"). Mission completion itself gives the aliens +10 at landing.
- Alien base: **+5 alien points per day** to region & country (≈150/month); supply roll 6 %/day; destroying the control centre +500 (objectiveComplete) plus kills/recovery; alien-alloy tile recovery divided by 150 at bases (by 10 at UFOs). Base race = mission race; a base never grows.

---

## 6. Interception

### 6.1 Craft
| Craft | Max speed | Accel | Fuel | Fuel use | Damage cap. | Weapon slots | Soldiers | HWP | Cost | Monthly rent | Lost-craft penalty | Delivery | Flight endurance (full speed) → total range |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Skyranger | 760 kn | 2 | 1 500 | 7 / 10 min | 150 | 0 | 14 | 3 | $500 000 | $500 000 | 200 | 72 h | 35.7 h → ≈27 100 nm (global) |
| Interceptor | 2 100 | 3 | 1 000 | 21 / 10 min | 100 | 2 | 0 | 0 | $600 000 | $600 000 | 250 | 96 h | 7.9 h → ≈16 700 nm (radius ≈8 300 nm / 15 400 km) |
| Firestorm | 4 200 | 9 | 20 | 1 Elerium-unit of fuel / 10 min | 500 | 2 | 0 | 0 | manuf. (§10) | 0 | 250 | – | 3 h 20 → ≈14 000 nm |
| Lightning | 3 100 | 9 | 30 | 1 / 10 min | 800 | 1 | 12 | 0 | manuf. | 0 | 300 | – | 5 h → ≈15 500 nm |
| Avenger | 5 400 | 10 | 60 | 1 / 10 min | 1 200 | 2 | 26 | 4 | manuf. | 0 | 400 | – | 10 h → 54 000 nm; only craft able to fly to Cydonia |

Rules: conventional fuel burn = `floor(speed/100)` per 10 min at the **current** speed (max speed when flying to a target, **half** speed while patrolling → half consumption); Elerium craft burn 1 unit/10 min regardless. Low-fuel auto-return when `fuel ≤ fuel needed to reach base at max speed`. Take-off delay 5 min. Refuel +50 fuel per 30 min (kerosene), Elerium craft +5 fuel per 30 min consuming **1 Elerium-115 per 5 fuel** (full tank: Firestorm 4, Lightning 6, Avenger 12 Elerium). Repair **1 damage/hour** (Avenger from 0 → 50 days!). Rearm per hour: 1 missile (Stingray/Avalanche/Fusion Ball), 100 cannon rounds (two 50-round clips), 50 laser/plasma charges (no ammo item). A craft can engage a UFO only if `UFO current speed ≤ craft max speed`. Craft radar 672 nm, sight 1 696 nm (alien-base spotting).

### 6.2 Craft weapons
| Weapon | Damage per hit (roll ½–1×) | Range (dogfight) | Accuracy | Ammo | Reload Cautious / Standard / Aggressive (ticks) | Price | Ammo price |
|---|---|---|---|---|---|---|---|
| Stingray | 70 (35–70) | 30 (240) | 70 | 6 | 64 / 48 / 32 | $16 000 | missile $3 000 |
| Avalanche | 100 (50–100) | 60 (480) | 80 | 3 | 96 / 72 / 48 | $17 000 | missile $9 000 |
| Cannon | 10 (5–10) | 10 (80) | 25 | 200 | 4 / 4 / 4 | $30 000 | 50 rounds $1 240 |
| Laser Cannon | 70 (35–70) | 21 (168) | 35 | 100 | 24 / 24 / 24 | manuf. $182 000, 300 eng-h | free |
| Plasma Beam | 140 (70–140) | 52 (416) | 50 | 100 | 24 / 24 / 24 | manuf. $226 000 + 15 Elerium, 500 eng-h | free |
| Fusion Ball Launcher | 230 (115–230) | 65 (520) | 100 | 2 | 64 / 48 / 32 | manuf. $242 000 + 1 Alloy, 400 eng-h | Fusion Ball $28 000 + 4 Elerium, 600 eng-h |

**Hit chance** = `(acc × (100 + 300/(5 − sizeIdx)) + 100) / 200` (sizeIdx 0 very small … 4 very large), capped 100 %:

| Weapon | vs Small Scout | vs Med/Large Scout | vs Harvester/Abductor | vs Terror/Supply | vs Battleship |
|---|---|---|---|---|---|
| Stingray | 56 % | 61 % | 70 % | 88 % | 100 % |
| Avalanche | 64 | 70 | 80 | 100 | 100 |
| Cannon | 20 | 22 | 25 | 31 | 50 |
| Laser Cannon | 28 | 31 | 35 | 44 | 70 |
| Plasma Beam | 40 | 44 | 50 | 63 | 100 |
| Fusion Ball | 80 | 88 | 100 | 100 | 100 |

### 6.3 Dogfight procedure (OpenXcom reproduction of the original)
- Window opens at distance **640**; initial mode Standoff (target distance **560**). Modes: **Standoff** 560 (no firing, outside every UFO range → safe, only mode that can be minimised); **Cautious** = distance of the longest-ranged loaded weapon ×8, cautious reload rates, auto-retreat to standoff when craft damage ≥ 50 %; **Standard** = shortest loaded weapon range ×8, standard reload; **Aggressive** = 64, fastest reload; **Disengage** = move to 800, dogfight ends when distance > 640. Closing speed −2 units/tick, retreating +4 units/tick. Weapons fire automatically when `distance ≤ range×8`, ammo > 0, reload counter 0 and mode ≠ Standoff/Disengage; each weapon can be toggled off.
- Projectiles travel 8 units/tick; missiles vanish beyond their range; beams resolve instantly.
- **UFO return fire**: only when `distance ≤ UFO range×8`; a UFO shoots at one interceptor at a time; shot accuracy **60 %**, damage `RNG(0, power)`; first shot immediate, then countdown `RNG(0, R) + R` ticks with `R = max(1, reload − 2×difficultyCoeff)`.
- **UFO escape**: countdown `breakOff + RNG(0, breakOff) − 30×difficultyCoeff` ticks at first engagement; at 0 the UFO accelerates to max speed → if that exceeds the craft's max speed: "UFO outrunning interceptor", dogfight ends and craft returns.
- Crash (>50 % damage): UFO speed 0, status Crashed, crash site for 24–96 h (destroyed if over water); destroyed (100 %): removed. Score to country+region: crash = UFO score, destroyed = ×2 (only to the craft that landed the killing shot). Craft destroyed: −craft score to country+region, all soldiers aboard die.
- **Retaliation trigger** on every UFO crash/kill: chance `100 − 4×(24 − coeff)` = 4 / 8 / 12 / 16 / 20 % (Beginner→Superhuman). If triggered, with `50 − 6×coeff` % (50/44/38/32/26 %) the retaliation targets the UFO's mission region, otherwise the region of the intercepting craft's home base (i.e. 50 → 74 % chance it hunts your base). Race = the UFO's race; first scout after a fixed 3 000 min (50 h). Not spawned if a retaliation already runs there.
- Max **4** simultaneous dogfights; a transport with soldiers that reaches a crashed/landed UFO gets the "land?" prompt; empty transports return.

---

## 7. Bases

### 7.1 Facilities
| Facility | Size | Build cost | Build days | Upkeep / month | Capacity / effect | Requires research |
|---|---|---|---|---|---|---|
| Access Lift | 1×1 | $300 000 | 1 | $4 000 | mandatory, exactly 1 | – |
| Living Quarters | 1×1 | $400 000 | 16 | $10 000 | 50 personnel (soldiers+scientists+engineers) | – |
| Laboratory | 1×1 | $750 000 | 26 | $30 000 | 50 scientists working | – |
| Workshop | 1×1 | $800 000 | 32 | $35 000 | 50 workshop space (engineers + project space) | – |
| General Stores | 1×1 | $150 000 | 10 | $5 000 | 50 storage units (item sizes: rifle 0.2, clip 0.1, Elerium 0.1/unit, alloys 0.1, armour 0.8, HWP 6, UFO power source 0.7…) | – |
| Alien Containment | 1×1 | $400 000 | 18 | $15 000 | 10 live aliens | – |
| Hangar | **2×2** | $200 000 | 25 | $25 000 | 1 craft | – |
| Small Radar System | 1×1 | $500 000 | 12 | $10 000 | 1 695 nm, 10 % | – |
| Large Radar System | 1×1 | $800 000 | 25 | $15 000 | 2 577 nm, 20 % | – |
| Missile Defences | 1×1 | $200 000 | 16 | $5 000 | 500 dmg (250–750), 50 % hit | – |
| Laser Defences | 1×1 | $400 000 | 24 | $10 000 | 600 (300–900), 60 % | Laser Defense |
| Plasma Defences | 1×1 | $600 000 | 34 | $12 000 | 900 (450–1 350), 70 % | Plasma Defense |
| Fusion Ball Defences | 1×1 | $800 000 | 34 | $14 000 | 1 200 (600–1 800), 80 % | Fusion Defense |
| Grav Shield | 1×1 | $1 200 000 | 38 | $15 000 | all defences fire one extra volley per shield | Grav Shield |
| Mind Shield | 1×1 | $1 300 000 | 33 | $5 000 | halves alien base-detection chance (per shield) | Mind Shield |
| Psionic Laboratory | 1×1 | $750 000 | 24 | $16 000 | 10 soldiers in psi training | Psi Lab |
| Hyper-Wave Decoder | 1×1 | $1 400 000 | 26 | $30 000 | 2 759 nm, 100 % + UFO identification | Hyper-Wave Decoder |

Base defence sequence (Battleship 3 000 HP arrives): for each completed defence facility, roll hit %, damage `dmg/2 + RNG(0,dmg)`; repeat the whole list once more per Grav Shield; if the UFO reaches ≥ 3 000 damage it is destroyed and no battle happens, otherwise Base Defence battlescape (Battleship crew, see §4.2) if the base has combat-ready soldiers or HWPs, else the base is **destroyed**. Expected damage per volley: Missile 250, Laser 360, Plasma 630, Fusion 960.

### 7.2 Starting base (`startingBase.rul`)
Layout on the 6×6 grid (x,y): Access Lift (2,2); Hangars at (2,0), (0,4), (4,4) (each 2×2); Living Quarters (3,2); General Stores (2,3); Laboratory (3,3); Workshop (4,3); Small Radar (1,3). Personnel: **8 soldiers, 10 scientists, 10 engineers**. Craft: Skyranger-1 (fuel 1500; carries 6 Rifles, 12 Rifle clips, 3 Pistols, 5 Pistol clips, 1 Heavy Cannon, 2 AP + 2 HE HC ammo, 8 Grenades), Interceptor-1 and -2 (each Stingray ×6 missiles + Cannon ×200 rounds). Stores: Auto-Cannon 1 + 6 AP ammo, Avalanche Launcher 1 + 10 missiles, Cannon 2 + 1×50 rounds, Grenade 5, Heavy Cannon 1 + 6 AP, Pistol 2 + 8 clips, Rifle 2 + 8 clips, Rocket Launcher 1 + 4 Small Rockets, Smoke Grenade 5, Stingray Launcher 1 + 25 missiles. Starting monthly upkeep ≈ $2 579 000 (facilities 169 k + craft rent 1 700 k + salaries 710 k) against ≈ $6 000 000 income.

---

## 8. Economy

### 8.1 Monthly funding per country (`Country::newMonth`, run at month end)
```
good = xcomTotal/10 + countryXcomActivity        // xcomTotal = world X-COM activity + research score (incl. +400 bonus)
bad  = alienTotal/20 + countryAlienActivity      // alienTotal = world alien activity
delta = floor(funding_k$ × RNG(5,20) / 100) × $1000   // 5–20 % of current funding, in $1000 steps
if bad ≤ good+30 and good > bad+30 and RNG(0,good) > bad → funding += delta (capped at fundingCap)   → "particularly pleased"
else if bad > good+30 and RNG(0,bad) > good           → funding −= delta (not below 0)             → "unhappy"
else unchanged
pact country → funding = 0 for ever (+150 alien points to that country when signed)
```
Total funds += Σ funding − Σ base maintenance, once per month. 12 months of history kept for the Graphs screen.

### 8.2 Costs
| Item | Buy | Monthly |
|---|---|---|
| Soldier | $40 000 | $20 000 salary |
| Scientist | $30 000 | $30 000 |
| Engineer | $25 000 | $25 000 |
| Skyranger / Interceptor | $500 000 / $600 000 | same amount as rent each month |
| Personnel transfer/delivery | 72 h | – |
| Item delivery | 24 h default; craft weapons & missiles 48 h; cannon rounds & HWPs 96 h; Skyranger 72 h, Interceptor 96 h | |

Conventional items (buy / sell): Pistol 800/600, Pistol clip 70/52, Rifle 3 000/2 250, Rifle clip 200/150, Heavy Cannon 6 400/4 800 (AP 300, HE 500, I 400), Auto-Cannon 13 500/10 125 (AP 500, HE 700, I 650), Rocket Launcher 4 000/3 000 (Small 600, Large 900, Incendiary 1 200), Grenade 300, Smoke 150, Proximity 500, High Explosive 1 500, Stun Rod 1 260, Electro-flare 60, Tank/Cannon 420 000 (shells 200), Tank/Rocket 480 000 (rockets 3 000), Stingray missiles 3 000, Avalanche missiles 9 000, Cannon rounds 1 240. Sell ≈ 75 % of buy.

Alien/manufactured sell prices: Heavy Plasma 171 600, HP clip 9 590, Plasma Rifle 126 500, PR clip 6 290, Plasma Pistol 84 000, PP clip 4 440, Blaster Launcher 144 000, Blaster Bomb 17 028, Small Launcher 120 000, Stun Bomb 15 200, Alien Grenade 14 850, Mind Probe 304 000, **Elerium-115 5 000/unit**, **Alien Alloys 6 500**, UFO Power Source 250 000, UFO Navigation 80 000, UFO Construction 20 000, Alien Food 5 000, Reproduction 40 000, Entertainment 20 000, Surgery 38 000, Examination Room 9 000, Alien Habitat 100, any corpse 20 000, Laser Pistol 20 000, Laser Rifle 36 900, Heavy Laser 61 000, Laser Cannon 211 000, Plasma Beam 267 300, Fusion Ball Launcher 281 000, Fusion Ball 53 300, Motion Scanner 45 600, Medi-Kit 46 500, Psi-Amp 194 700, Personal Armour 54 000, Power Suit 85 000, Flying Suit 115 000, Tank/Laser 594 000, Hovertank/Plasma 980 000, Hovertank/Launcher 1 043 000, HWP Fusion Bomb 31 500. Live aliens (OpenXcom option only): soldiers/terrorists 40 000, ranked 60 000, Ethereal Commander / Sectopod / Cyberdisc 80 000. Note every manufacturable sells above its material cost → "manufacture-for-profit" exploit exists (Laser Cannon: 182 000 + 300 eng-h → 211 000).

### 8.3 Personnel mechanics
- Soldier rookie stats `RNG(min,max)`: TU 50–60, Stamina 40–70, Health 25–40, Bravery 10–60 (steps of 10), Reactions 30–60, Firing 40–70, Throwing 50–80, Strength 20–40, Melee 20–40, Psi Strength 0–100, Psi Skill 0 (16 after 1st training month). Caps: TU 80, Stamina 100, Health 60, Bravery 100, Reactions 100, Firing 120, Throwing 120, Strength 70, Melee 120, Psi 100/100. 25 % female.
- Wounds: recovery days = `RNG(0.5, 1.5) × health lost`, 1 day healed per day.
- Psi training (monthly, 10 per Psi Lab): first month psiSkill = RNG(16, 24); then while ≤ 50: +5–12/month; < 100: +1–3.
- Promotions after each mission: Rookie→Squaddie after a mission; 1 Sergeant per 5 soldiers, 1 Captain per 11, 1 Colonel per 23, 1 Commander when ≥ 30 soldiers (highest-scoring eligible soldier promoted).
- Soldier death penalty = 20 + missions + rank bonus (Sgt 1, Cpt 3, Col 6, Cdr 10).

---

## 9. Score and Council rating

### 9.1 X-COM activity (added to the region AND the country where it happens)
| Event | Points |
|---|---|
| UFO shot down (crash) / destroyed | + UFO score / ×2 (50–700 / 100–1 400) |
| X-COM craft destroyed (dogfight) or lost (abort with nobody at exit / all dead) | − craft score (200–400) |
| Alien killed | + unit value (10–40) |
| Live alien recovered | + 2 × value if not yet interrogated, else +10 (needs Alien Containment space) |
| Civilian saved / killed by aliens / killed by X-COM | +30 / −30 / −50 |
| Soldier killed or MIA | −(20 + missions + rank bonus) |
| HWP destroyed | −20 |
| Items recovered (unresearched only) | recoveryPoints: UFO Power Source 20, Elerium 5 (per 50 units), UFO Navigation 5, Heavy Plasma 5, corpses 5 (terrorist corpses 3), Plasma Rifle 4, Small Launcher 4, Blaster Launcher 5, Plasma Pistol 3, clips/grenades/Mind Probe 1, alien goods 2, UFO Construction 2, Alloys 1 (tile count/10) |
| Alien base control destroyed | +500 |
| Research completed | + topic points (10–60; autopsies & interrogations 50; added to the "research score", council only) |
| Monthly council bonus | +400 from the 2nd month onward (council only) |

### 9.2 Alien activity
| Event | Points |
|---|---|
| Each UFO flying, per 30 min | +1 (×2 while landed) |
| Mission completion (at lift-off from the landing) | Harvest 30, Abduction 50, Terror 10, Base 50 at base creation, Infiltration 150 to the pact country at month end; Research/Retaliation/Supply 0 |
| Alien base existing | +5 per day |
| Terror site expired un-attacked | +1 000 |
| Pact signed | country funding → 0 |

### 9.3 Monthly rating & game over
`rating = (Σ regional X-COM activity + research score) − Σ regional alien activity`. Threshold `T` (v1.0 code) = `100 × (difficultyIndex − 9)` → **−900 Beginner, −800, −700, −600, −500 Superhuman** (master: `defeatScore + 100×coeff`, ruleset-driven). Labels: ≤ T−300 **Terrible**, > T−300 **Poor**, > T **OK**, > 0 **Good**, > 500 **Excellent**. Council text: dissatisfied ≤ T, generally satisfied > T, very pleased > 500.
**Defeat**: rating ≤ T in **two consecutive months**; or funds ≤ **−$1 000 000** at two consecutive month ends (first time only a "reduce debts" warning); or no bases left (base destroyed in retaliation with no garrison / lost defence). **Victory**: destroy the alien brain in the Cydonia final assault (requires Avenger + "Cydonia or Bust").

---

## 10. Research (cost = scientist-days; at project start the cost is randomised ×RNG(0.5…1.5); progress += assigned scientists per day; lab = 50 scientists)
| Topic | Cost | Score | Dependencies / notes |
|---|---|---|---|
| Laser Weapons | 50 | 10 | – |
| Laser Pistol | 100 | 10 | Laser Weapons |
| Laser Rifle | 300 | 10 | Laser Pistol |
| Heavy Laser | 460 | 10 | Laser Rifle |
| Laser Cannon (craft) | 420 | 15 | Heavy Laser |
| Laser Defense | 510 | 15 | Laser Cannon |
| Motion Scanner | 180 | 20 | – |
| Medi-Kit | 210 | 20 | – |
| Alien Alloys | 400 | 30 | item |
| Elerium-115 | 450 | 60 | item |
| UFO Power Source | 450 | 30 | item |
| UFO Navigation | 450 | 30 | item |
| UFO Construction | 450 | 30 | Alloys + Elerium + Power Source + Navigation |
| New Fighter Craft (Firestorm) | 600 | 30 | UFO Construction |
| New Fighter-Transporter (Lightning) | 700 | 30 | Firestorm |
| Ultimate Craft (Avenger) | 900 | 30 | Lightning |
| Grav Shield | 930 | 25 | Lightning |
| Personal Armour | 180 | 20 | Alien Alloys |
| Power Suit | 205 | 20 | Elerium + Power Source + Personal Armour |
| Flying Suit | 330 | 20 | Power Suit + UFO Navigation |
| Plasma Pistol / clip | 600 / 400 | 20 / 5 | item each (weapon usable only after both) |
| Plasma Rifle / clip | 700 / 400 | 25 / 6 | item |
| Heavy Plasma / clip | 800 / 400 | 30 / 7 | item |
| Plasma Cannon (Plasma Beam) | 660 | 25 | (Heavy Plasma + clip) or (Plasma Rifle + clip) |
| Plasma Defense | 620 | 25 | Plasma Cannon |
| Blaster Launcher / Blaster Bomb | 900 / 300 | 10 / 10 | item |
| Fusion Missile (Fusion Ball) | 880 | 25 | Blaster Launcher + Bomb |
| Fusion Defense | 800 | 25 | Fusion Missile |
| Small Launcher / Stun Bomb | 550 / 180 | 30 / 10 | item |
| Alien Grenade | 200 | 20 | item |
| Mind Probe | 600 | 25 | item |
| Alien Food / Reproduction / Entertainment / Surgery / Examination Room | 150 each | 30 | item (UFO interior parts) |
| Autopsies (11 corpses) | 180 each | 50 | corpse item |
| Live alien interrogation | 190 (Sectoid Cdr) / 192 ranks / 170 terrorists | 50 | consumes the alien. **Engineer** → free UFO article; **Medic** → free race/autopsy article; **Navigator** → free alien-mission article + unlocks **Hyper-Wave Decoder**; **Leader/Commander** (Sectoid or Ethereal) → unlocks **Psi Lab**; any Leader/Commander → "Leader+" gate; any Commander → "Commander+" gate; any interrogation → unlocks Alien Origins |
| Hyper-Wave Decoder | 670 | 25 | any Navigator |
| Psi Lab | 420 | 25 | Sectoid Leader/Cdr or Ethereal Sol/Ldr/Cdr |
| Psi-Amp | 500 | 20 | Psi Lab |
| Mind Shield | 360 | 25 | Psi Lab |
| Alien Origins | 300 | 60 | any live alien |
| The Martian Solution | 500 | 60 | Alien Origins + a Leader or Commander interrogated after Alien Origins |
| Cydonia or Bust | 600 | 60 | a Commander interrogated after Martian Solution → unlocks final mission |
Progress label: "Unknown" until 33 % spent; then by scientists/cost: ≤7 % Poor, ≤13 % Average, ≤25 % Good, else Excellent. Minimum win path ≈ Alloys 400 + Elerium 450 + Power Source 450 + Navigation 450 + UFO Construction 450 + Firestorm 600 + Lightning 700 + Avenger 900 + 3 interrogations ≈ 575 + Alien Origins 300 + Martian Solution 500 + Cydonia 600 ≈ 6 400 scientist-days (≈ 4.3 months with 50 scientists) plus whatever armour/weapons the player wants.

---

## 11. Manufacturing (hourly: progress += engineers; one unit per `time` engineer-hours; cost & materials per unit; `space` occupies workshop capacity together with the engineers)
| Item | Eng-hours | Cost | Materials | Space |
|---|---|---|---|---|
| Laser Pistol / Rifle / Heavy Laser | 300 / 400 / 700 | 8 000 / 20 000 / 32 000 | – | 2 / 3 / 4 |
| Motion Scanner / Medi-Kit | 220 / 420 | 34 000 / 28 000 | – | 4 |
| Psi-Amp | 500 | 160 000 | 1 Elerium | 6 |
| Mind Probe | 1 200 | 262 000 | 1 Elerium | 4 |
| Plasma Pistol / clip | 600 / 60 | 56 000 / 2 000 | 1 Alloy / 1 Elerium | 3 / 4 |
| Plasma Rifle / clip | 820 / 80 | 88 000 / 3 000 | 1 Alloy / 2 Elerium | 4 |
| Heavy Plasma / clip | 1 000 / 80 | 122 000 / 6 000 | 1 Alloy / 3 Elerium | 4 |
| Small Launcher / Stun Bomb | 900 / 200 | 78 000 / 7 000 | 1 Alloy / 1 Elerium | 3 / 2 |
| Blaster Launcher / Blaster Bomb | 1 200 / 220 | 90 000 / 8 000 | 1 Alloy / 3 Elerium | 5 / 3 |
| Alien Grenade | 200 | 6 700 | 2 Elerium | 2 |
| Personal Armour | 800 | 22 000 | 4 Alloys | 12 |
| Power Suit | 1 000 | 42 000 | 5 Alloys + 5 Elerium | 16 |
| Flying Suit | 1 400 | 58 000 | 5 Alloys + 16 Elerium | 16 |
| Laser Cannon | 300 | 182 000 | – | 6 |
| Plasma Beam | 500 | 226 000 | 15 Elerium | 8 |
| Fusion Ball Launcher / Fusion Ball | 400 / 600 | 242 000 / 28 000 | 1 Alloy / 4 Elerium | 6 |
| Tank/Laser Cannon | 1 200 | 500 000 | – | 25 |
| Hovertank/Plasma | 1 200 | 850 000 | 5 Alloys + 30 Elerium | 30 |
| Hovertank/Launcher / Fusion Bomb | 1 400 / 400 | 900 000 / 15 000 | 8 Alloys + 25 Elerium / 8 Alloys + 5 Elerium | 30 / 25 |
| Alien Alloys (1 unit) | 100 | 3 000 | – | 10 |
| UFO Power Source | 1 400 | 130 000 | 5 Alloys + 16 Elerium | 22 |
| UFO Navigation | 1 600 | 150 000 | 3 Alloys | 18 |
| **Firestorm** | 14 000 | 400 000 | 65 Alloys + 1 Power Source + 1 Navigation | 30 |
| **Lightning** | 18 000 | 600 000 | 85 Alloys + 1 Power Source + 1 Navigation | 34 |
| **Avenger** | 34 000 | 900 000 | 120 Alloys + 2 Power Sources + 1 Navigation | 36 |
Elerium is never manufactured (only recovered: 50 units per intact UFO power source). Workshop: 50 space each.

---

## 12. Difficulty (index 0–4 = Beginner, Experienced, Veteran, Genius, Superhuman; `coeff` = index)
| Effect | Formula / values |
|---|---|
| Alien crew size | low+RNG(0,d) / low+RNG(0,d) / mid+RNG(0,d) / mid+RNG(0,d) / high+RNG(0,d) (see §4.2) |
| Alien accuracy & armour | ×0.5 on Beginner, ×1.0 otherwise |
| UFO fire rate | reload − 2×coeff |
| UFO escape timer | − 30×coeff ticks |
| Retaliation per shoot-down | 4 / 8 / 12 / 16 / 20 %; targets your base's region with 50 / 56 / 62 / 68 / 74 % |
| Scheduled retaliation starts | month 14 / 13 / 12 / 11 / 10 |
| Council threshold | −900 / −800 / −700 / −600 / −500 |
| Not affected | funding, prices, research, radar, alien tech schedule |
| Original bug | DOS v1.0–1.2: difficulty silently reset to Beginner after the first tactical mission (OpenXcom has no such bug) |

**Alien tech by month** (`alienItemLevels`: loadout tier 0/1/2 drawn per alien; tier 2 = heavy plasma/blaster class): m0 70/20/10 %, m1 50/30/20, m2 30/40/30, m3 20/40/40, m4 20/30/50, m5 10/30/60, m6–7 0/30/70, m8 0/20/80, m9+ 100 % tier 2.

---

## 13. OpenXcom vs original — what matters for design
1. Mission generation is data-driven (mission scripts) but reproduces the original schedule: 1 base-region research mission at start, 1 terror/month, 1 table mission from month 1, 2 from month 6, retaliation from month 10–14 or after Martian Solution.
2. Retaliation: OpenXcom spawns the base-assault Battleship only when a scout actually locates the base (original spawned it when the final wave came due — comment in `DogfightState.cpp`). Only retaliation UFOs scan for bases unless option `aggressiveRetaliation`.
3. Infiltration keeps running forever in its region (pact + base each cycle) instead of ending.
4. Interception: up to 4 dogfights; `meetingPoint` option plots an intercept course instead of tail-chasing; dogfight distances/timers as above; UFO fire chance was "10 %" in the original comment but implemented as the countdown model above.
5. Fixed original bugs: difficulty reset bug; funding math in $1 000 steps with proper caps; alien base supply/discovery coded explicitly; crash sites 24–96 h; terror sites 4–10 h with 1 000-point penalty.
6. Optional rule changes (all off by default, worth exposing as "regras" toggles in our game): storage limits enforced (original ignored stores capacity), building queue, custom initial base, craft launch with no weapons/ammo warning, sell live aliens, psi training any time (daily increments), psi-strength visible after research, psi-strength improvement, transfer airborne craft, retain corpses after interrogation, field promotions, globe seasons; battlescape: UFO-Extender range-based accuracy, instant grenades, sneaky AI, alien bleeding, explosion height, auto-end battle, strafing, force-fire, skip next-turn screen, etc.
7. Research: "getOneFree" + "protected unlocks" model; warning popup when a weapon is researched before its clip; topic cost randomised 50–150 % like the original.
8. Alien alloy recovery divided by 10 (UFO) / 150 (base); only unresearched items give recovery points; recovered live aliens worth 2× when new.
9. Original limitation kept: UFO crews' race for retaliation = race of the UFO shot down; Supply ship race = base race.

---

## 14. Derived constants handy for implementation
- 1 geoscape unit = 1 nm = 1/60°; craft/UFO move `speed/720` nm per 5-s tick (great-circle).
- Radar circles to draw: 1 695 / 2 577 / 2 759 nm (base), 672 nm (craft); UFO base-sight 268 nm; craft alien-base sight 1 696 nm.
- Detection chance per 30 min = Σradar% × (100+visibility)/100; hyperwave = certain.
- Dogfight: open 640, standoff 560, aggressive 64, disengage >640, approach −2/tick, retreat +4/tick, projectile 8/tick, UFO shot 60 % × RNG(0,power), craft shot = table §6.2 × RNG(½dmg,dmg).
- Economy start: income ≈ $6.0 M, upkeep ≈ $2.58 M, cash ≈ $6.0 M; soldier 40 k/20 k, scientist 30 k/30 k, engineer 25 k/25 k.
- Score anchors: scout kill 50–125, Battleship 700, alien kill 10–40, civilian ±30, soldier −20…−40, terror ignored −1 000, alien base −150/month, research +10…+60, council +400/month; lose at rating ≤ −900…−500 twice or debt ≤ −$1 M twice.

## KEY NUMBERS
Game start: 1 Jan 1999 12:00; tick 5 s; speeds 5s/1m/5m/30m/1h/1d = 1/12/60/360/720/17280 ticks (verified, OpenXcom)
Initial funding total $6,000,000/month (initialFunding 6000) = starting cash; 16 countries, start RNG(base,2×base)k, caps sum $95M (verified)
Country funding change: ±5–20 % of current funding per month in $1000 steps; good = xcomTotal/10 + local, bad = alienTotal/20 + local; pact → $0 (verified)
Radar: Small 1695 nm 10%/30min, Large 2577 nm 20%, Hyper-Wave 2759 nm 100%; craft radar 672 nm; chance × (100+visibility)/100 (verified OpenXcom; original km figures unverified)
UFO HP/speed/power/range: SS 50/2200/0/0, MS 200/2400/20/15, LS 250/2700/20/34, Harvester 500/4000/40/22, Abductor 500/4300/40/20, Terror 1200/4800/120/42, Battleship 3000/5000/140/65, Supply 2200/3200/60/36; crash at >50% HP; crash site 24–96 h (verified)
UFO score crash/destroyed: 50/100, 75/150, 125/250, 250/500, 250/500, 500/1000, 700/1400, 400/800 (verified)
Craft: Skyranger 760kn/1500 fuel/150HP/14 soldiers/$500k; Interceptor 2100/1000/100/2 weapons/$600k; Firestorm 4200/20 Elerium-fuel/500HP; Lightning 3100/30/800/12 soldiers/1 weapon; Avenger 5400/60/1200/26 soldiers/2 weapons (verified)
Craft weapons dmg/range/acc/ammo: Stingray 70/30/70/6, Avalanche 100/60/80/3, Cannon 10/10/25/200, Laser 70/21/35/100, Plasma Beam 140/52/50/100, Fusion Ball 230/65/100/2; hit% = (acc×(100+300/(5−size))+100)/200 (verified)
Dogfight: start 640, standoff 560, aggressive 64, disengage target 800/exit >640, approach −2/tick, retreat +4/tick; UFO shot 60% acc, dmg RNG(0,power); escape = breakOff+RNG(0,breakOff)−30×coeff; retaliation on shoot-down 4/8/12/16/20% (verified)
Facilities cost/days/upkeep: Lift 300k/1/4k, LQ 400k/16/10k (50), Lab 750k/26/30k (50), Workshop 800k/32/35k (50), Stores 150k/10/5k (50), Containment 400k/18/15k (10), Hangar 200k/25/25k (2×2), Small Radar 500k/12/10k, Large Radar 800k/25/15k, Missile Def 200k/16/5k (500,50%), Laser Def 400k/24/10k (600,60%), Plasma Def 600k/34/12k (900,70%), Fusion Def 800k/34/14k (1200,80%), Grav Shield 1.2M/38/15k, Mind Shield 1.3M/33/5k, Psi Lab 750k/24/16k (10), Hyper-Wave 1.4M/26/30k (verified)
Starting base: 8 soldiers, 10 scientists, 10 engineers, 1 Skyranger, 2 Interceptors (Stingray+Cannon), Lift+3 Hangars+LQ+Stores+Lab+Workshop+Small Radar; upkeep ≈ $2.58M/month (verified)
Personnel: soldier $40k buy/$20k salary; scientist $30k/$30k; engineer $25k/$25k; transfer 72 h; items 24 h (verified)
Scoring: alien kill +value (10–40), live alien 2×value or 10, civilian +30/−30/−50, soldier −(20+missions+rank), craft lost −200…−400, UFO flying +1/30min (landed ×2), alien base +5/day, terror expired +1000, mission points Harvest 30/Abduction 50/Terror 10/Base 50/Infiltration 150, research +points, council +400/month from month 2 (verified)
Rating threshold T = 100×(difficulty−9) = −900…−500 (v1.0 code); labels ≤T−300 Terrible, >T−300 Poor, >T OK, >0 Good, >500 Excellent; lose if ≤T two months running or funds ≤ −$1M two month-ends (verified v1.0; master uses ruleset defeatScore/defeatFunds)
Research costs (scientist-days, ×0.5–1.5 random): Laser Weapons 50, Laser Pistol 100, Rifle 300, Heavy Laser 460, Laser Cannon 420, Motion Scanner 180, Medi-Kit 210, Alloys 400, Elerium 450, Power Source 450, Navigation 450, UFO Construction 450, Firestorm 600, Lightning 700, Avenger 900, Personal Armour 180, Power Suit 205, Flying Suit 330, Plasma Pistol/Rifle/Heavy 600/700/800 (+400 clips), Plasma Cannon 660, Fusion Missile 880, Hyper-Wave 670, Psi Lab 420, Psi-Amp 500, Alien Origins 300, Martian Solution 500, Cydonia or Bust 600, autopsies 180, interrogations 190–192 (verified)
Manufacturing eng-hours/cost: Firestorm 14000h/$400k/65 alloys+PS+Nav; Lightning 18000h/$600k/85 alloys; Avenger 34000h/$900k/120 alloys+2 PS; Laser Cannon 300h/$182k; Plasma Beam 500h/$226k+15 Elerium; Power Suit 1000h/$42k/5 alloys+5 Elerium; Flying Suit 1400h/$58k/5+16 (verified)
Alien missions/month: month 0 = 1 Research (Sectoid, base region, +120 min) + 1 Terror; months 1–5: 1 table mission + Terror; month 6+: 2 table + Terror; retaliation from month 14/13/12/11/10 or after Martian Solution (verified)
Races: Sectoid/Floater from month 0, Snakeman present from month 0 (dominant terror from month 3), Muton from month 3, Ethereal from month 6; alien item tier 2 share 10%→100% over months 0–9 (verified)
Difficulty: Beginner alien aim & armour ×0.5; crew low/low/mid/mid/high + RNG(0,d); UFO reload −2×coeff; escape −30×coeff (verified)
Alien crews Beg/Exp → Superhuman: SS 1, MS 3–6→6–9, LS 3–10→6–13, Harvester 10–15→16–21, Abductor 9–14→13–18, Terror Ship 10–16→18–24, Battleship 9–15→22–28, Supply 9–15→14–20, Alien Base 13–19→22–28 (verified)
Terror site: 16 civilians, lasts 4–10 h, −1000 if ignored; alien base supply 6%/day, revealed 20%/month; X-COM base detected by retaliation UFO within 268 nm at (tiles/6+15)/(mindShields+1) % per 10 min (verified)
Max 8 bases, 6×6 grid; new base $500k–$1,000k by region + $300k lift (verified)

## UNCERTAIN
UFOpaedia.org (and temp.ufopaedia.org) could not be fetched from this session (host not allowed); all values are from OpenXcom rulesets/engine, which replicate the original but are not the original binary. The wiki's own radar figures (often quoted as 1500/2250/2400 nm or 'km') differ from OpenXcom's measured 1695/2577/2759 nm; the km conversion (×1.852) assumes OpenXcom's nautical-mile unit.
Rating threshold: v1.0 hard-coded 100×(difficulty−9) and debt limit −$1,000,000 verified in code; OpenXcom master moved these to ruleset keys defeatScore/defeatFunds, which were NOT present in the xcom1/vars.rul I fetched (defaults 0) — treat −900…−500 and −$1M as the original-faithful values.
Original DOS 'difficulty bug' (reset to Beginner after first mission, v1.0–1.2) is well documented in the community but was not verifiable here.
Whether the original checks radar detection every 10 min or every 30 min: OpenXcom checks every 30 min and comments that the original processed crash expiry every 30 min; the wiki text was not accessible.
Starting cash being exactly one month of funding (≈$6M) is OpenXcom behaviour (`setFunds(getCountryFunding())`); the original's exact starting balance was not verified.
Workshop capacity accounting (engineers + project 'space' both consume the 50 units) is from memory of OpenXcom's Base::getFreeWorkshops, not re-read in this session.
Rookie→Squaddie promotion after first mission is from memory of BattleUnit::postMissionProcedures, not re-read here.
Alien stat growth per month: OpenXcom multiplies by difficulty coefficient but the xcom1 ruleset I fetched defines no statGrowthMultipliers, implying no growth; I could not list the xcom1 directory (GitHub API blocked) to confirm no extra ruleset file exists.
UFOpaedia search snippet claims Supply/Terror/Battleships cannot be destroyed outright in the original (only grounded); OpenXcom allows destruction at 100% damage.