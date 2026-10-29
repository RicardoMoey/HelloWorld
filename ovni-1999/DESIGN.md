# DESIGN.md — OVNI: Inimigo Desconhecido (browser REA of UFO: Enemy Unknown, 1994)

Status: build blueprint v1 (lead designer synthesis of 5 analyst reports: RTS audit, Geoscape, Battlescape, OpenXcom architecture, Web iso/globe).
Audience: lead engineer + helper agents. English for the engineering text; **player-facing names in pt-PT** are given in `«guillemets»` where decided.
Sources: OpenXcom master source + `xcom1/*.rul` (read directly by the analysts; local copies in `scratchpad/oxc/`), UFOpaedia only via search snippets (the host was not reachable). Every number is tagged **orig** (UFO1/OpenXcom value) or **ours** (deliberate change for a 2–4 h campaign or for scope), and deviations are listed in §22 "Uncertain / deviations".

---

## 0. Decisions at a glance

| Decision | Choice | Why |
|---|---|---|
| Game name (pt-PT) | **«OVNI: Inimigo Desconhecido»** (subtitle on the title screen: «Defesa da Terra — 1999») | Literal translation of the original title; recognisable to Portuguese players who knew "UFO: Enemy Unknown"; no better alternative found ("X-COM" is a trademark and the original EU title never used it). |
| Folder | **`ovni-1999/`** at repo root, served at `/ovni-1999/index.html` | Matches the existing kebab-case + year convention (`command-2026/`); short, ASCII, no spaces; the year is the in-game start year. |
| Hub entry | New card in root `index.html`, assets appended to `sw.js` `ASSETS` (sw.js is already network-first for html/js/css/json — keep it so) | Same distribution path as the RTS (GitHub Pages / local `python3 -m http.server`). |
| Tech | Vanilla JS (ES2020, classic `<script>` tags, one global namespace `window.OV`), Canvas 2D for map/globe, DOM overlay for all text/panels, Web Audio synth, zero dependencies, zero runtime network | Works from a local http server on Safari/Chrome macOS; sim loads in Node with `globalThis.window = globalThis`. |
| Session budget | 2–4 h real time to win on «Recruta»/«Veterano» | Original is 12+ game months; we compress research (×~0.25), manufacture (×~0.1–0.2), facility build days (×0.4), double the early escalation and shrink tactical maps/crews. Target: win in game month 4–6 (May–July 1999) after ~12–16 battles of ~8–15 min each. |
| Difficulty | 3 levels: «Recruta» (coef 0), «Veterano» (coef 2), «Super-humano» (coef 4) | Maps onto OpenXcom's 0..4 coefficient so all formulas carry over. |
| Polish priorities | Path preview with TU colours, hit-chance-on-cursor, reaction fire both ways, hidden-movement presentation with fast-forward, night + flares, destructible terrain, panic, persistent named soldiers, clear Mac controls | Brief: «capricha na jogabilidade». |

---

## 1. Vision and pillars

1. **Tension of the unknown** — fog of war, night maps (you see 9 tiles in the dark, aliens see 20), closed UFO doors, the first step off the ramp, spotting interrupts movement, the alien turn is hidden except what your soldiers see.
2. **Time Units are the whole game** — one budget for moving, shooting and staying ready for reaction fire; reserve buttons make "move 2 tiles, keep a snap shot" a decision.
3. **Fragile people, swingy weapons** — 0–200 % damage rolls, fatal wounds, medikit triage, armour that wears, panic cascades; named soldiers die permanently.
4. **Destructible world** — rockets open lanes, fire spreads, smoke blinds, floors collapse, UFO power sources blow on crashed ships.
5. **Strategic squeeze** — the council pays for results; ignored terror sites cost −1000; money, scientists and engineers are always short; the path to Cydonia goes through captured alien leaders.
6. **Respect the player's input** — no undo (faithful), but every action shows its cost and odds before you commit; misclicks on a trackpad are prevented by two-step move confirmation (option).

---

## 2. Learnings from the RTS framework (`command-2026`) → engineering rules

Measured: sim runs headless in Node at 0.08–0.10 ms/tick, deterministic per seed; `JSON.stringify(G)` fails (cycles, Map, class instances, def refs); `opts.humanAI` crashes (game.js:29 vs ai.js:89); 20 hard-coded pt-PT strings inside sim; colour helpers mixed `rgb()`/`#hex` (sprites.js:9-23 bug); stale SW cache-first (fixed since: sw.js v3 is network-first); stale GitHub default branch; no tests/QA committed; ~2 800 magic numbers in gameplay code; one 8 781-line commit.

Rules (binding for `ovni-1999/`):

| # | Rule | Concrete practice |
|---|---|---|
| R1 | **Layered modules, no upward imports** | `core → data → sim (battle, geo, campaign, save) → ai → gfx → ui → main`. Files under `js/sim/**` and `js/data/**` never touch `document`, `window.*` APIs, `performance`, `Math.random`, `requestAnimationFrame`, `OV.audio/ui/gfx`. A test (`tools/test.js`) greps sim files for forbidden tokens. |
| R2 | **State = plain JSON** | `G` (campaign) and `B` (battle) hold only numbers, strings, arrays, plain objects and typed arrays (serialised as base64). References by id (`craftId`, `ufoId`, `typeId`), never object refs to defs. Derived caches (`unitAt`, `byId`, visibility, light, sprite caches) live in a non-serialised `_` (underscore) side object rebuilt by `rebuildDerived()`. |
| R3 | **Seeded RNG streams with saveable state** | mulberry32 with explicit `state` field; streams `geo`, `map`, `combat`, `ai`, and a non-sim `ui` stream (hit-chance Monte Carlo, cosmetic variation). UI code must never consume sim streams. |
| R4 | **Integer arithmetic for battle outcomes** | TU, accuracy, deviation, damage, LOS/LOF (integer 3-D Bresenham in voxel/tile units), explosions (precomputed integer rays), light (integer `isqrt` table). Floats only in presentation and in the Geoscape (where saved positions make cross-engine drift irrelevant). |
| R5 | **Sim emits typed events, UI owns words** | Sim: `yield {t:'shot', ...}` / `G.events.push({t:'ufoDetected', ufoId})`. All strings in `js/i18n/pt-PT.js` keyed by id (`OV.T('ev.ufoDetected', {name})`). Zero pt-PT literals in sim. |
| R6 | **Presentation never mutates sim** | Particles/decals/sprite caches live in `OV.FX` / renderer objects, never in `G`/`B`. Renderer reads sim state read-only. |
| R7 | **No hidden module singletons reading globals** | Modules export pure functions taking `G`/`B` explicitly. Only `main.js` holds the current game. No `OV.G` reads inside modules. |
| R8 | **Non-reentrant scratch is forbidden** | Query functions take caller-provided output arrays or allocate; no bookkeeping stamps written onto units. |
| R9 | **One canonical colour type** | Colours are packed ints `0xRRGGBB` in code; helpers `shade(c, f)`, `mix(a, b, t)` take/return ints; CSS string produced once at `fillStyle` via `css(c, a)`. Unit test `shade(shade(c,.2),-.3)` etc. |
| R10 | **All gameplay constants named** | `js/data/tuning.js` (`TU_WALK=4`, `VIEW_DIST=20`, `NIGHT_VIEW=9`, `CHEAT_TURN=10`…) with comments citing orig/ours; art constants separate. |
| R11 | **Headless harness is part of the product** | `tools/sim.js` (battle AI-vs-AI, campaign bot), `tools/test.js` (unit + determinism + save round-trip), `qa/qa.mjs` (Playwright). README capability claims link to these scripts. Run before every push. |
| R12 | **Determinism tests** | same seed ⇒ same `hash(B)` after N turns; `hash(load(save(B))) === hash(B)`; "save at turn k, resume, play to turn n" equals uninterrupted play. |
| R13 | **Save only at quiescent points** | Between actions (no active action generator), never mid-animation; autosave at start of each player turn and each Geoscape day 1/10/20. `schema` version + migration table. |
| R14 | **Ship hygiene** | Per-milestone commits, tags `v0.x`; `?debug=1` panel lists every cheat flag; `?nosw=1` unregisters SW; cache-busting `?v=<stamp>` on script tags; SW asset list updated in the same commit; `git remote set-head origin main` / default branch check script. |
| R15 | **Keep the good patterns** | Fixed-step accumulator with step cap (presentation loop), snapshot-then-interpolate for animation, deferred removal, typed arrays + generation stamps in A*, cadence table, dirty-signature DOM updates (10 Hz HUD refresh), caches keyed by quantised zoom×dpr with 220 ms debounce, guard optional subsystems (`if (OV.audio)`), `aria-live` toasts, safe-area insets, `touch-action:none`, `(hover:none)` tooltip suppression, Mac ctrl+click = secondary. |
| R16 | **Reuse from `command-2026` deliberately** | Copy-adapt (not import): `core.js` math/fmt/esc/store, RNG (add state), A* heap + generation stamps (path.js), audio engine (`noise/tone/play/MIN_GAP/voices/speak/music`), render `resize()` dpr handling, sprite cache-by-scale, input pointer unification/`isRightClick`/wheel+pinch/Safari `gesture*` suppression, ui toast/tooltip/segmented controls/settings persistence, CSS tokens & panels, BT DSL idea not needed (AI is a decision procedure). Drop spatial hash, real-time unit FSMs, production queues, powers. |

---

## 3. REA summary — systems and the numbers we use

### 3.1 Time (Geoscape)
- Start: **1 Jan 1999, 12:00** (orig). Real calendar months/leap years.
- Base tick 5 s game time; triggers 5 s / 10 min / 30 min / 1 h / 1 day / 1 month (month handler also runs day/hour/... handlers) (orig).
- Speed buttons «5 seg», «1 min», «5 min», «30 min», «1 hora», «1 dia» = 1 / 12 / 60 / 360 / 720 / 17 280 ticks per 80 ms real step (orig). Optimisation (ours): when nothing is airborne and no 30-min roll is due, jump straight to the next trigger.
- Any popup (UFO detected/lost, craft arrived, dogfight, research/production/construction complete, site appeared, monthly report, low fuel, items arrived) drops speed to 5 s and pauses (only the top scene thinks) (orig).

### 3.2 Soldiers (orig unless noted)

| Stat | Rookie min–max | Cap |
|---|---|---|
| TU «UT» | 50–60 | 80 |
| Stamina «Energia» | 40–70 | 100 |
| Health «Saúde» | 25–40 | 60 |
| Bravery «Bravura» | 10–60 (RNG(1,6)×10) | 100 |
| Reactions «Reações» | 30–60 | 100 |
| Firing «Pontaria» | 40–70 | 120 |
| Throwing «Lançamento» | 50–80 | 120 |
| Strength «Força» | 20–40 | 70 |
| Melee | 20–40 | 120 |
| Psi Str/Skill | cut in MVP (player psi deferred); stored 0..100 for future |

- Hire $40 000, salary $20 000/month; 25 % female; stand height 22, kneel 14; morale 100 at mission start.
- Experience counters (firing hit on hostile, throw, chosen as reactor, melee hit, bravery check passed when morale < 50). Post-mission: Bravery +10 if `exp > RNG(0,10)`; other stats via `improveStat(exp)`: 0→0, 1–2→RNG(0,1), 3–5→RNG(1,3), 6–10→RNG(1,4), >10→RNG(2,6). Secondary growth if any of Bravery/Reactions/Firing/Melee exp > 0: TU, Health, Strength += RNG(0,(cap−cur)/10+2); Stamina += RNG(0,(cap−cur)/15+2); Rookie→Squaddie.
- Ranks «Recruta, Soldado, Sargento, Capitão, Coronel, Comandante». Promotion quotas (ours, roster is small): Sergeant N/4, Captain N/8, Colonel N/15, Commander 1 if N ≥ 20 (orig N/5, N/11, N/23, ≥30). Promotion score formula orig: `2·HP + 2·Sta + 4·React + 4·Brav + 3·(TU + 2·Firing) + Melee + Throw + Str + 10·(missions + kills)`.
- Wound recovery (ours): `RNG(25, 75) % × HP lost` days (orig 50–150 %).
- Soldier value for score: 20 + missions + rank bonus (Sgt 1, Cpt 3, Col 6, Cdr 10).
- Names: per-nationality name tables (16 funding countries + Portugal weighted ×2 — ours), procedural portrait (face/skin/hair colour seed), player can rename; memorial «Memorial» lists the dead with missions/kills.

### 3.3 TU, energy, actions (orig unless noted)

| Action | Cost |
|---|---|
| Walk orthogonal | floor TU + object TU of destination (typ. 4; crops/bush 6; rubble 6) |
| Walk diagonal | floor(cost × 1.5) (4→6) + wall costs crossed |
| Energy per step | TU/2 (2 orthogonal, 3 diagonal); vertical lift 0 |
| Gravlift / flying vertical move | 8 TU, 0 energy |
| Stairs `s↔S` vertical link (ours) | 6 TU, 3 energy |
| Turn | 1 TU per 45° |
| Kneel / stand | 4 / 8 TU (walking from kneel auto-stands for 8) |
| Run (Ctrl+click, P1) | TU ×0.75, energy ×1.5 |
| Snap/aimed/auto | weapon % of **max** TU (table §3.5) |
| Prime grenade / throw | 50 % / 25 % of max TU |
| Reload | 15 TU |
| Medi-kit use | 10 TU per click |
| Motion scanner | 25 % |
| Stun rod | 30 % |
| Alien melee | 15 TU flat |
| Open door (right-click/Option-click) | 4 TU (swing door, ours fixed), UFO door 4 TU |
| Inventory moves | table §3.7 |

Turn-start: TU = maxTU × min(1, Strength/weight) × (1 − 0.1 per leg wound); soldiers regain `maxTU/3` energy (aliens `energyRecovery` 30–50), −10 % recovery per torso wound, capped at Stamina; −1 HP per fatal wound; burning unit −RNG(5,10)×IN mod; stun −1; panic check.

TU reservation «Reservar UT»: None/Snap/Aimed/Auto (+ Kneel +4). Blocks any action that would eat into the reserve; fallback Auto→Snap→Aimed when the weapon lacks the mode.

### 3.4 Accuracy, shot model, damage (orig formulas)

```
acc% = Firing × weaponAcc[mode] / 100
     × 115/100 if kneeling
     × 80/100  if two-handed weapon and other hand holds an item
     × max(10, 75 + 25·HP/maxHP − 10·(headWounds + firingArmWounds)) / 100
throw acc = Throwing × healthMod/100 ;  melee acc = 100(stun rod)/accuracyMelee × healthMod/100
Beginner («Recruta»): alien Firing ×0.5 and alien armour ×0.5
Deviation (voxels; tile = 16×16×24):
  xyShift = (xDist/2 <= yDist) ? xDist/4 + yDist : (xDist+yDist)/2
  zShift  = (xyShift <= zDist) ? xyShift/2 + zDist : xyShift + zDist/2
  d = RNG(0,100) − acc ; d += (d >= 0) ? 50 : 10 ; d = max(1, zShift·d/200)
  tx += RNG(0,d) − d/2 ; ty += RNG(0,d) − d/2 ; tz += RNG(0,d/2)/2 − d/8
  extend the line to 30 tiles (ours; orig 1000), trace: first floor/wall/object/unit voxel hit takes the shot
Auto = 3 rounds, each rolled independently, one TU payment.
```
Approx effective hit (no cover): displayed 35 % → 90/66/53/47/44 % at 3/6/10/15/20 tiles; 60 % → 98/81/72/69/66; 90 % → ~100/96/94/92/91.

Damage to a unit:
```
rnd = RNG(power×(100−R)/100, power×(100+R)/100)  ; R=100 (0–200 %) except HE R=50 (50–150 %)
p = floor(rnd × armour.mod[type])                 ; SMOKE→STUN
side = FRONT/LEFT/RIGHT/REAR from impact direction vs facing (45° zones roll 2/3–1/3), same tile/explosion ground zero → UNDER
p -= armour[side]
if p > 0: STUN → stun += p
          else HP −= p; if not IN: stun += RNG(0, p/4);
               soldiers: if RNG(0,10) < p → body part gets RNG(1,3) fatal wounds, morale −= wounds in part
               armour[side] −= p/10 + 1
morale loss = 100·(p·((110−Bravery)/10)/10)/leaderMod
```
Damage types: AP, IN (ignores armour, no wounds), HE (radius power/20 cap 11 unless blastRadius), LASER, PLASMA, STUN, MELEE, ACID (P1, Celatid), SMOKE.
Terrain hit by a projectile: RNG(25 %, 75 %) of power vs part armour → destroyed → die-part (rubble); z0 floor → scorched floor.

### 3.5 Weapons (orig; accuracy % / TU % of max TU)

| Weapon «pt-PT» | Wt | 2H | Snap | Aimed | Auto ×3 | Ammo (power, type, rounds, wt) | Buy $ | MVP |
|---|---|---|---|---|---|---|---|---|
| Pistol «Pistola» | 5 | no | 60/18 | 78/30 | – | 26 AP ×12, wt 3 | 800 / clip 70 | yes |
| Rifle «Espingarda» | 8 | yes | 60/25 | 110/80 | 35/35 | 30 AP ×20, wt 3 | 3 000 / 200 | yes |
| Heavy Cannon «Canhão Pesado» | 18 | yes | 60/33 | 90/80 | – | AP 56; HE 52 r2; IN 60 r3; ×6, wt 6 | 6 400 / 300–500 | yes |
| Auto-Cannon «Canhão Automático» | 19 | yes | 56/33 | 82/80 | 32/40 | AP 42; HE 44 r2; IN 48 r2; ×14, wt 5 | 13 500 / 500–700 | yes |
| Rocket Launcher «Lança-Foguetes» | 10 | yes | 55/45 | 115/75 | – | Small 75 HE r3 wt 6; Large 100 HE r5 wt 8; Incendiary 90 IN r4 wt 8 | 4 000 / 600–1 200 | yes |
| Laser Pistol | 7 | no | 40/20 | 68/55 | 28/25 | 46 LASER ∞ | manuf. | yes |
| Laser Rifle | 8 | yes | 65/25 | 100/50 | 46/34 | 60 LASER ∞ | manuf. | yes |
| Heavy Laser | 18 | yes | 50/33 | 84/75 | – | 85 LASER ∞ | manuf. | yes |
| Plasma Pistol | 3 | no | 65/30 | 85/60 | 50/30 | 52 PLASMA ×26 wt 3 | alien | yes |
| Plasma Rifle | 5 | yes | 86/30 | 100/60 | 55/36 | 80 PLASMA ×28 wt 3 | alien | yes |
| Heavy Plasma | 8 | yes | 75/30 | 110/60 | 50/35 | 115 PLASMA ×35 wt 3 | alien | yes |
| Small Launcher | 10 | yes | 65/40 | 110/75 | – | Stun Bomb 90 STUN r4 ×1 wt 3 | alien | yes (captures) |
| Blaster Launcher | 16 | yes | – | launch 120/66, guided acc fixed 60 (aliens 55) | – | Blaster Bomb 200 HE r10 ×1 | alien | yes, **auto-routed** (fly-path A* to target; waypoints P2) |
| Stun Rod «Bastão Atordoador» | 6 | yes | melee 65 STUN, 30 % TU, to-hit 100×healthMod | | | | 1 260 | yes |

Unit-built weapons: Cyberdisc plasma 130 (snap 75/30, aimed 110/60, explodes on death HE 120 r6); Sectopod beam 100 LASER (snap 75/30, aimed 110/60, auto 50/35); Reaper melee = Str 90; Chryssalid melee 110 (zombifies); Zombie melee 84; Celatid acid 140 (P1).

### 3.6 Explosives and equipment (orig)

| Item | Wt | Effect | Buy $ |
|---|---|---|---|
| Grenade «Granada» | 3 | 50 HE r5, prime 50 %, throw 25 %, fuse 0–5 turns (ours: UI offers 0–5; orig 0–23) | 300 |
| Smoke Grenade | 3 | 60 smoke r5 (smoke RNG(7,15) per tile) | 150 |
| Proximity Grenade (P1) | 3 | 70 HE r5, triggers on adjacent movement | 500 |
| High Explosive «Explosivo» | 6 | 110 HE r5 | 1 500 |
| Alien Grenade | 3 | 90 HE r5 | alien |
| Electro-flare «Sinalizador» | 3 | light 15 where it lands; throw 25 % TU | 60 |
| Medi-Kit «Kit Médico» | 5 | 10 heals (−1 wound on part, +3 HP), 10 stims (+10 energy, −4 stun), 10 painkillers (morale += HP lost) | research |
| Motion Scanner «Detetor de Movimento» | 3 | 25 % TU; blips sized by motion points this turn (30 per tile moved) | research |

Grenade fuse 0 explodes at end of the current turn when on the ground; option «Granadas instantâneas» (default **ON** in ours for pace, P0 setting) explodes fuse-0 grenades on landing.
Throw range (ours, simple, tunable): `tiles = clamp(floor(Strength × 4 / (weight + 3)), 3, 18)` (grenade wt 3: Str 20→13, 30→18; HE wt 6: Str 20→8, 40→17).

### 3.7 Inventory (ours, simplified from orig slot grid)

Slots: **Right hand, Left hand** (1 item each, any size), **Belt «Cinto»** (capacity 4 size units, items size ≤ 2), **Backpack «Mochila»** (capacity 9 size units, size ≤ 3), **Ground «Chão»** (list of items on the tile). Sizes: clip/grenade/flare/scanner/stun bomb 1; pistol/medikit/stun rod 2; rifle/laser rifle/rocket 3; heavy weapons, launchers, corpses, stunned bodies 4 (hands only).

| From \ To (TU) | Hand | Other hand | Belt | Backpack | Ground |
|---|---|---|---|---|---|
| Hand | – | 4 | 8 | 14 | 2 |
| Belt | 4 | 4 | – | 16 | 6 |
| Backpack | 8 | 8 | 12 | – | 10 |
| Ground | 8 | 8 | 12 | 20 | – |

Weight = Σ items + loaded clips (armour weight 0, orig). Weight > Strength → next turn TU × Str/weight (shown red). Two-handed weapon −20 % if the other hand holds anything. Pre-mission «Equipar» screen has per-soldier loadout, «Copiar/Colar», «Auto-equipar» (rifle + 2 clips + 2 grenades + flare at night + medikit for the best-health soldier).

### 3.8 Armour (orig; F/S/R/U; modifiers ×%)

| Armour | F | S | R | U | Modifiers | Notes |
|---|---|---|---|---|---|---|
| Coveralls «Fato de Combate» | 12 | 8 | 5 | 2 | Melee 120, Acid 160 | |
| Personal Armour «Armadura Pessoal» | 50 | 40 | 30 | 30 | IN 80, Stun 90, Acid 110 | |
| Power Suit «Fato Energético» | 100 | 80 | 70 | 60 | IN 0, Stun 80, Smoke 0 | |
| Flying Suit «Fato Voador» | 110 | 90 | 80 | 70 | IN 0, Stun 80, Smoke 0 | flight, 8 TU per level |

### 3.9 Aliens (orig stats; armour F/S/R/U; Int = memory turns; Aggr 0..2; Value = score)

| Unit | TU | Sta | HP | Brav | React | Fire | Str | Melee | Armour | Mods | Int | Aggr | Value | MVP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sectoid Sol/Eng/Med/Nav | 54 | 90 | 30 | 80 | 63 | 52 | 30 | 76 | 4/3/2/2 | Melee 120 | 3/6/5/4 | 2/2/1/2 | 10/16/14/12 | yes |
| Sectoid Leader / Cmdr | 54 | 90 | 30 | 80 | 63 | 52 | 30 | 76 | 4/3/2/2 | | 7/8 | 1/0 | 20/25 | yes (psi 50/50, 50/60) |
| Floater Sol/Eng/Nav/Med (flies) | 50 | 90 | 35 | 80 | 50 | 50 | 40 | 70 | 8/6/4/12 | Melee 120 | 4/7/5/6 | 2/2/2/1 | 12/18/14/16 | yes |
| Floater Leader / Cmdr | 55/60 | 95/100 | 40/45 | 80 | 60/66 | 60/63 | 47/48 | 70/76 | 16/12/8/12 ; 24/18/12/16 | | 8 | 0 | 25/35 | yes |
| Snakeman Sol/Nav/Eng | 40 | 80 | 45 | 80 | 45 | 58 | 47 | 76 | 20/18/16/12 | IN 70 | 2/3/4 | 2 | 15/17/20 | yes |
| Snakeman Leader / Cmdr | 40/45 | 80/84 | 45/55 | 80 | 55/65 | 65/58 | 47 | 76 | 20/24/22/20 ; 26/26/22/20 | IN 70 | 5/6 | 2 | 28/36 | yes |
| Muton Sol/Nav/Eng | 56 | 90 | 125 | 80 | 60 | 54 | 70 | 76 | 20/20/20/10 ; 24/24/24/15 ; 28/28/28/20 | **AP 60** | 2/3/4 | 2 | 15/17/19 | yes |
| Ethereal Sol/Ldr/Cmdr (flies) | 68 | 96 | 55 | 80 | 75 | 74 | 48 | 85 | 35/40/45 all | IN 70, Stun 80 | 6/7/8 | 1 | 20/30/40 | yes (psi 50/40, 60/45, 65/50) |
| Cyberdisc (2×2, flies) | 62 | 90 | 120 | 110 | 64 | 60 | 90 | 0 | 34 all | AP 80, HE 60 | 5 | 1 | 20 | yes |
| Sectopod (2×2) | 62 | 90 | 96 | 110 | 64 | 60 | 90 | 80 | 145/130/100/90 | HE 80, **Laser 150**, Plasma 80 | 4 | 1 | 30 | yes |
| Reaper (2×2) | 62 | 90 | 148 | 90 | 64 | 0 | 90 | 80 | 28/28/28/4 | **IN 170** | 2 | 2 | 25 | yes |
| Chryssalid | 110 | 140 | 96 | 100 | 70 | 0 | 110 | 80 | 34 all | IN 80, Stun 90 | 4 | 1 | 25 | yes |
| Zombie | 40 | 110 | 84 | 110 | 40 | 0 | 84 | 80 | 4 all | AP 60, HE 80, Laser 70, Plasma 70, Stun 0 | 3 | 2 | 18 | yes |
| Silacoid / Celatid | see orig | | | | | | | | | | | | 20 | **P1** |
| Civilian «Civil» | 35 | 65 | 30 | 80 | 30 | 30 | 20 | 50 | 0 | | 4 | – | 30 | yes |

All aliens: Smoke modifier 0 (immune to smoke stun). Difficulty growth: `stat += stat × growth × coef / 100` with growth TU 4, Sta 4, React 6, Firing 6, Str 2, Psi 4, Melee 4.

Race rosters (rank slots CMD, LDR, ENG, MED, NAV, SOL, TER, TER2): Sectoid full + Cyberdisc×2; Floater full + Reaper×2; Snakeman (MED→Soldier) + Chryssalid×2; Muton (CMD/LDR/MED→Soldier) + **ours MVP: Muton Soldier ×2** in TER slots (orig Silacoid/Celatid, P1); Ethereal CMD, LDR×4 (ENG/MED/NAV→Leader), SOL + Sectopod×2; Mixed (Cydonia) Ethereal SOL/LDR/CMD + Chryssalid + Muton + Sectopod×2.

Alien item sets: tier 0 Plasma Pistol + 2 clips; tier 1 Plasma Rifle + 2 clips; tier 2 Heavy Plasma + 2 clips. Extras: Navigator/Engineer 50 % +1 Alien Grenade; Medic 40 % Small Launcher + 2 Stun Bombs instead of gun; Leader +1 Alien Grenade; Commander in Battleship/alien base 50 % Blaster Launcher + 2 bombs. Ethereals carry Heavy Plasma. Tier roll per alien by **our month** (ours, compressed from orig months 0..9):

| Our month | 0 | 1 | 2 | 3 | 4+ |
|---|---|---|---|---|---|
| tier 0/1/2 % | 70/20/10 | 40/35/25 | 20/40/40 | 0/40/60 | 0/10/90 |

### 3.10 Reaction fire, morale, panic, psi (orig)
- Trigger after every walk step, kneel/stand, shot/throw (when resolved) by the active side; not on civilian turn; turning on the spot does not trigger (orig).
- Spotters: opposing non-civilian conscious units ≤ 20 tiles with the mover in their 90° cone (or hit by the mover this turn), with line of fire and actual visibility (light/smoke).
- Score = `Reactions × curTU / maxTU`; best spotter reacts if score ≥ mover's score; loop re-evaluates after each shot (several reactors, same reactor repeatedly). Reaction = melee if adjacent+facing+TU>cost, else **snap shot** if gun with ammo in hand, in range, TU > snap cost. Aliens never react with explosives that would hit friends. X-COM reactor +1 reaction exp.
- Morale: `B=(110−Bravery)/10`. Hit: −100·(p·B/10)/teamMod. Friendly death: −rankWeight·200·B/teamMod/100 (rank weight 100/120/130/150/175 for ≤Squaddie/Sgt/Cpt/Col/Cdr). Enemy death: +10·mod/100 to side, killer +20·mod/100. X-COM kills civilian −1000/mod. Team leadership modifier from highest rank present: 100/110/115/125/150. Large units immune.
- Panic at turn start: `chance = 100 − 2·morale`; on roll ≤ chance: 33 % berserk (up to 10 shots at nearest visible enemy or random tile within 6, accuracy halved), else 50 % freeze / 50 % drop hand items and flee ±5 tiles; then TU = 0; +15 morale after. Bravery exp +1 if passed with chance > 1.
- Alien psi (MVP: Panic; Mind Control P1): `attack = PsiStr×PsiSkill/50 − distTiles + RNG(0,55)` vs `defense = PsiStr + 10 + PsiSkill/5` (+20 vs MC); target only "known" X-COM units; cost 25 TU; requires TU > reserve+25; Panic success: morale −(110−Bravery). Soldier PsiStr is rolled at hire (0–100) and hidden.

### 3.11 Light, vision, smoke, fire (orig numbers, our tile algorithm in §8)
- View cone 90°, radius 20 tiles (x²+y² ≤ 400), all levels. X-COM can see a unit > 9 tiles away only if that unit's tile shade ≤ 9 (light ≥ 6). Aliens see 20 regardless of light. Friends always visible.
- Light layers: ambient = 15 − globalShade (day 0 → 15; night ours 13 → 2), roofed tiles −2 by day; point lights fall off 1 per tile (integer `isqrt`), all levels: fire 15, flare on ground 15, burning unit 15, street lamps 12, UFO interior lamps 10, alien base 8 ambient-lit consoles.
- Smoke: each tile traversed by a sight line with smoke s (no fire) adds `s/3` extra tiles to the distance (fresh smoke 15 ⇒ ~3–4 tiles of sight). Smoke decays −1/turn, spreads to 4 orthogonal non-wall-blocked neighbours averaged `smoke/overlaps − 1`. Smoke does not block line of fire. Standing in smoke at turn start: +(s/4+1) stun for units with smoke mod > 0.
- Fire: tile fire = fuel+1 turns; spreads each round to 4 orthogonal neighbours with chance `smoke − flammability/10 + 15` %; when it ends, flammable floor/object burns out (die-part); unit in fire at turn start takes `smoke` as IN damage and 40 %×IN mod to ignite for RNG(0,5×mod) turns; IN explosions: tiles get fire fuel+1 and smoke clamp(15 − flammability/10, 1, 12).

### 3.12 UFOs (orig stats; crews/maps are **ours**)

| UFO «pt-PT» | Size | HP | Speed kn | Weapon pwr / range (×8) / reload | breakOff | Score crash/destroyed | Block | Map (ours) | Power sources | Alloys recovered (ours) |
|---|---|---|---|---|---|---|---|---|---|---|
| Small Scout «Batedor Pequeno» | very small (−30) | 50 | 2 200 | 0/0/56 | 200 | 50/100 | 10×10 | 30×30×3 | 1 | 3 |
| Medium Scout «Batedor Médio» | small (−15) | 200 | 2 400 | 20/15/56 | 250 | 75/150 | 10×10 | 30×30×3 | 1 | 6 |
| Large Scout «Batedor Grande» | small | 250 | 2 700 | 20/34/48 | 300 | 125/250 | 20×20 | 40×40×3 | 1 | 10 |
| Harvester «Ceifeira» | medium (0) | 500 | 4 000 | 40/22/48 | 500 | 250/500 | 20×20 | 40×40×3 | 2 | 16 |
| Abductor «Raptor» | medium | 500 | 4 300 | 40/20/32 | 500 | 250/500 | 20×20 | 40×40×3 | 2 | 16 |
| Supply Ship «Nave de Abastecimento» | large (+15) | 2 200 | 3 200 | 60/36/24 | 3 000 | 400/800 | 30×20 | 40×40×3 | 4 | 24 |
| Terror Ship «Nave de Terror» | large | 1 200 | 4 800 | 120/42/24 | 2 000 | 500/1 000 | 30×20 | 40×40×3 | 4 | 24 |
| Battleship «Couraçado» | very large (+30) | 3 000 | 5 000 | 140/65/24 | 4 000 | 700/1 400 | 30×30 | 50×50×3 | 4 | 36 |

Crash at > 50 % damage, destroyed at ≥ 100 %; crash over water = destroyed. Crash site lasts 24–72 h (ours; orig 24–96). Crashed UFO at generation: each power source 75 % explodes (ours: HE RNG(120,180), radius 6; orig 180–250 r10, scaled to our smaller hulls), each alien 20 % dies, 3–6 random hull tiles breached; crashed alloys ×0.7. Intact power source yields 1 «Fonte de Energia OVNI» + 50 Elerium.

Crews (ours; `rank: min–max` on «Recruta»; Veterano +⌈25 %⌉, Super-humano +⌈50 %⌉ on soldiers/terrorists; percentage outside UFO: soldiers 50, nav/eng/med 20, leaders/cmd 0, terrorists 50):

| Deployment | Recruta crew | Total R / V / S |
|---|---|---|
| Small Scout | SOL 1 | 1 / 1–2 / 2 |
| Medium Scout | SOL 2–3, NAV 1 | 3–4 / 4–5 / 5–6 |
| Large Scout | SOL 2–3, NAV 1, ENG 1 | 4–5 / 5–6 / 6–8 |
| Harvester | SOL 3–4, NAV 1, ENG 1, MED 1, LDR 1 | 7–8 / 8–10 / 10–12 |
| Abductor | SOL 3–4, NAV 1, ENG 1, MED 1–2, LDR 1 | 7–9 / 8–10 / 10–12 |
| Supply Ship | SOL 4–5, NAV 1, ENG 1, MED 1, LDR 1 | 8–9 / 10–11 / 12–13 |
| Terror Ship (landed/crashed) | SOL 3, NAV 1, ENG 1, MED 1, LDR 1, TER 2 | 9 / 11 / 13 |
| Battleship | CMD 1, LDR 1, ENG 1, MED 1, NAV 1, SOL 4–5, TER 1–2 | 10–12 / 12–14 / 14–16 |
| Terror site (urban 40×40×3) | LDR 1, SOL 2–3, TER 3–4; civilians 10–14 | 6–8 / 8–10 / 10–12 |
| Alien base (40×40×2) | CMD 1, LDR 2, ENG 1, MED 1, NAV 1, SOL 4–5, TER 2 | 12–13 / 14–15 / 16–18 |
| Cydonia «Cidónia» (Mars 50×50×2, one stage) | Eth CMD 2, Eth LDR 3, Eth SOL 3, Chryssalid 2, Sectopod 2, Muton SOL 2 + Alien Brain `@` | 14 / 16 / 18 |

### 3.13 Craft and craft weapons (orig; Lightning cut)

| Craft | Speed kn | Accel | Fuel | Burn | HP | Weapons | Seats | Cost / rent | Score lost |
|---|---|---|---|---|---|---|---|---|---|
| Skyranger «Skyranger» | 760 | 2 | 1 500 | floor(speed/100) per 10 min | 150 | 0 | 14 (MVP UI squad ≤ 10) | $500 k / $500 k | 200 |
| Interceptor «Intercetor» | 2 100 | 3 | 1 000 | same | 100 | 2 | 0 | $600 k / $600 k | 250 |
| Firestorm «Tempestade de Fogo» | 4 200 | 9 | 20 | 1 per 10 min | 500 | 2 | 0 | manuf. / 0 | 250 |
| Avenger «Vingador» | 5 400 | 10 | 60 | 1 per 10 min | 1 200 | 2 | 26 (UI ≤ 12) | manuf. / 0 | 400 |

Rules (orig): patrol at half speed; low-fuel auto-return; take-off 5 min (ours: immediate, polish); refuel +50/30 min (Elerium craft +5 per 30 min consuming 1 Elerium per 5 fuel); repair 1 HP/h (ours **5 HP/h**); rearm 1 missile/h, 100 cannon rounds/h, beams free; craft radar 672 nm (100 %); can engage only if UFO current speed ≤ craft max speed.

| Craft weapon | Dmg (roll ½–1) | Range ×8 | Acc | Ammo | Reload C/S/A ticks | MVP |
|---|---|---|---|---|---|---|
| Stingray | 70 | 30 | 70 | 6 | 64/48/32 | yes |
| Avalanche | 100 | 60 | 80 | 3 | 96/72/48 | yes |
| Cannon «Canhão» | 10 | 10 | 25 | 200 | 4/4/4 | yes |
| Laser Cannon | 70 | 21 | 35 | ∞ | 24 | yes |
| Plasma Beam «Feixe de Plasma» | 140 | 52 | 50 | ∞ | 24 | yes |
| Fusion Ball | 230 | 65 | 100 | 2 | 64/48/32 | P2 |

Hit chance = `(acc × (100 + 300/(5 − sizeIdx)) + 100) / 200` % (sizeIdx 0..4). Dogfight: open 640, Standoff 560 (no fire), Cautious = longest range×8 (auto-retreat at ≥50 % damage), Standard = shortest range×8, Aggressive 64, Disengage 800 (ends > 640); approach −2/tick, retreat +4/tick, projectile 8/tick, tick 30 ms. UFO fires if dist ≤ range×8: 60 % hit, dmg RNG(0,power), countdown `RNG(0,R)+R`, `R = max(1, reload − 2·coef)`. UFO escape countdown `breakOff + RNG(0,breakOff) − 30·coef`; at 0 accelerates to max speed (outruns slower craft). Retaliation roll per shoot-down `4 + 4·coef` % (ours uses coef 0/2/4 ⇒ 4/12/20 %).

### 3.14 Facilities (orig cost/upkeep; build days **ours ×0.4**)

| Facility «pt-PT» | Size | Cost $ | Days orig → ours | Upkeep $/mo | Effect | Gate | MVP |
|---|---|---|---|---|---|---|---|
| Access Lift «Elevador de Acesso» | 1 | 300 000 | 1 → 1 | 4 000 | mandatory | – | yes |
| Living Quarters «Alojamentos» | 1 | 400 000 | 16 → 6 | 10 000 | 50 personnel | – | yes |
| Laboratory «Laboratório» | 1 | 750 000 | 26 → 10 | 30 000 | 50 scientists | – | yes |
| Workshop «Oficina» | 1 | 800 000 | 32 → 13 | 35 000 | 50 space | – | yes |
| General Stores «Armazém» | 1 | 150 000 | 10 → 4 | 5 000 | 50 storage units | – | yes |
| Alien Containment «Contenção Alienígena» | 1 | 400 000 | 18 → 7 | 15 000 | 10 live aliens | – | yes |
| Hangar | 2×2 | 200 000 | 25 → 10 | 25 000 | 1 craft | – | yes |
| Small Radar «Radar Pequeno» | 1 | 500 000 | 12 → 5 | 10 000 | 1 695 nm, **15 %** (ours; orig 10 %) | – | yes |
| Large Radar «Radar Grande» | 1 | 800 000 | 25 → 10 | 15 000 | 2 577 nm, **30 %** (orig 20 %) | – | yes |
| Missile Defences «Defesa de Mísseis» | 1 | 200 000 | 16 → 6 | 5 000 | 500 (250–750), 50 % | – | yes |
| Laser Defences | 1 | 400 000 | 24 → 10 | 10 000 | 600, 60 % | Laser Defense | yes |
| Plasma Defences | 1 | 600 000 | 34 → 14 | 12 000 | 900, 70 % | Plasma Defense | yes |
| Hyper-Wave Decoder | 1 | 1 400 000 | 26 → 10 | 30 000 | 2 759 nm, 100 % + identify | Hyper-Wave | P1 |
| Fusion Def / Grav Shield / Mind Shield / Psi Lab | | | | | | | P2 |

Grid 6×6, every facility must connect orthogonally to the lift (through built or building facilities); cost paid up-front; dismantle refunds 0; unfinished facilities have no effect. Starting base (orig): Lift (2,2); Hangars (2,0),(0,4),(4,4); Quarters (3,2); Stores (2,3); Lab (3,3); Workshop (4,3); Small Radar (1,3). Personnel 8 soldiers / 10 scientists / 10 engineers; Skyranger + 2 Interceptors (Stingray 6 + Cannon 200). Skyranger cargo and base stores orig **plus (ours) 3 Medi-Kits and 6 Electro-flares** so wound triage and night play are teachable from mission 1. Monthly upkeep ≈ $2.58 M vs income ≈ $6.0 M (orig).

### 3.15 Research tree (ours: scientist-days, roughly orig ×0.25; started cost × RNG(80..120)/100; progress += assigned scientists per day; label «Desconhecido» until 33 %, then by scientists/cost ≤7 % «Fraco», ≤13 % «Médio», ≤25 % «Bom», else «Excelente»)

| Id | «pt-PT» | Cost (orig) | Requires | Unlocks |
|---|---|---|---|---|
| laser_weapons | Armas Laser | 20 (50) | – | laser_pistol |
| laser_pistol | Pistola Laser | 35 (100) | laser_weapons | manuf. Laser Pistol |
| laser_rifle | Espingarda Laser | 90 (300) | laser_pistol | manuf. |
| heavy_laser | Laser Pesado | 140 (460) | laser_rifle | manuf. |
| laser_cannon | Canhão Laser | 120 (420) | heavy_laser | manuf. craft weapon |
| laser_defense | Defesa Laser | 140 (510) | laser_cannon | facility |
| medikit | Kit Médico | 40 (210) | – | manuf. |
| motion_scanner | Detetor de Movimento | 50 (180) | – | manuf. |
| alien_alloys | Ligas Alienígenas | 110 (400) | item Alloys | personal_armour |
| elerium | Elerium-115 | 120 (450) | item Elerium | |
| power_source | Fonte de Energia OVNI | 120 (450) | item | manuf. Power Source |
| ufo_navigation | Navegação OVNI | 120 (450) | item | manuf. Navigation |
| ufo_construction | Construção OVNI | 120 (450) | alloys+elerium+power_source+navigation | new_fighter |
| personal_armour | Armadura Pessoal | 50 (180) | alien_alloys | manuf. |
| power_suit | Fato Energético | 70 (205) | elerium+power_source+personal_armour | manuf. |
| flying_suit | Fato Voador | 100 (330) | power_suit+ufo_navigation | manuf. |
| plasma_pistol | Pistola de Plasma (incl. clip) | 160 (600+400) | item | manuf. + clips |
| plasma_rifle | Espingarda de Plasma (incl. clip) | 190 (700+400) | item | |
| heavy_plasma | Plasma Pesado (incl. clip) | 220 (800+400) | item | |
| plasma_cannon | Feixe de Plasma | 180 (660) | heavy_plasma or plasma_rifle | craft weapon |
| plasma_defense | Defesa de Plasma | 170 (620) | plasma_cannon | facility |
| small_launcher | Lançador Pequeno + Bomba Atordoante | 150 (550+180) | item | manuf. |
| blaster_launcher | Lançador Blaster + Bomba | 240 (900+300) | item | manuf. |
| alien_grenade | Granada Alienígena | 55 (200) | item | manuf. |
| autopsy_<race> ×10 | Autópsia: Sectoide, Flutuante, Homem-Serpente, Muton, Etéreo, Ciberdisco, Ceifador, Sectopode, Crisálida, Zombie | 50 each (180) | corpse | Ufopédia entry; Sectoid autopsy → +10 % Recruta hit-chance hint text only |
| interrogate_<race>_<rank> | Interrogatório | soldier/nav/eng/med 45, leader 55, commander 65 (170–192) | live alien (consumed) | Navigator → hyper_wave (P1); any → alien_origins; leader/cmdr → flag `leaderInterrogated`; commander → flag `commanderInterrogated` |
| alien_origins | Origens Alienígenas | 80 (300) | any interrogation | martian_solution |
| martian_solution | A Solução Marciana | 130 (500) | alien_origins + leaderInterrogated | cydonia; starts scheduled retaliation |
| cydonia | Cidónia ou Desastre | 160 (600) | martian_solution + commanderInterrogated | final mission |
| new_fighter | Novo Caça (Firestorm) | 160 (600) | ufo_construction | manuf. Firestorm |
| ultimate_craft | Nave Suprema (Avenger) | 240 (900; Lightning step cut) | new_fighter | manuf. Avenger |
| hyper_wave | Descodificador Hiper-Onda | 180 (670) | navigator interrogation | facility (P1) |

Minimum win path ≈ 990 (craft line) + 3 interrogations ≈ 165 + 370 (origins/martian/cydonia) ≈ **1 525 scientist-days** (orig ≈ 6 400). With 10 → 30 scientists that is ~55–110 game days, i.e. win in months 3–5 depending on hiring. Commanders are guaranteed in alien bases and Battleships, so the alien base assault is on the critical path.

### 3.16 Manufacturing (ours: engineer-hours, orig ×~0.2 for items, ×~0.1 for craft; materials ×~0.35; cost $ orig; progress += engineers per hour; space orig)

| Item | Eng-h (orig) | $ | Materials (orig) | Space |
|---|---|---|---|---|
| Laser Pistol / Rifle / Heavy | 60 / 80 / 140 (300/400/700) | 8 000 / 20 000 / 32 000 | – | 2/3/4 |
| Medi-Kit / Motion Scanner | 80 / 45 | 28 000 / 34 000 | – | 4 |
| Plasma Pistol / clip | 120 / 12 | 56 000 / 2 000 | 1 Alloy / 1 Elerium | 3 |
| Plasma Rifle / clip | 160 / 16 | 88 000 / 3 000 | 1 Alloy / 1 Elerium (2) | 4 |
| Heavy Plasma / clip | 200 / 16 | 122 000 / 6 000 | 1 Alloy / 1 Elerium (3) | 4 |
| Small Launcher / Stun Bomb | 180 / 40 | 78 000 / 7 000 | 1 Alloy / 1 Elerium | 3/2 |
| Blaster Launcher / Bomb | 240 / 45 | 90 000 / 8 000 | 1 Alloy / 2 Elerium (3) | 5/3 |
| Alien Grenade | 40 | 6 700 | 1 Elerium (2) | 2 |
| Personal Armour | 160 (800) | 22 000 | 2 Alloys (4) | 12 |
| Power Suit | 200 (1 000) | 42 000 | 3 Alloys + 2 Elerium (5+5) | 16 |
| Flying Suit | 280 (1 400) | 58 000 | 3 Alloys + 6 Elerium (5+16) | 16 |
| Laser Cannon | 60 (300) | 182 000 | – | 6 |
| Plasma Beam | 100 (500) | 226 000 | 6 Elerium (15) | 8 |
| UFO Power Source | 280 (1 400) | 130 000 | 3 Alloys + 8 Elerium (5+16) | 22 |
| UFO Navigation | 320 (1 600) | 150 000 | 2 Alloys (3) | 18 |
| **Firestorm** | 1 400 (14 000) | 400 000 | 25 Alloys + 1 Power Source + 1 Navigation (65+1+1) | 30 |
| **Avenger** | 2 400 (34 000) | 900 000 | 40 Alloys + 2 Power Sources + 1 Navigation (120+2+1) | 36 |

Elerium is never manufactured. Sell prices orig (≈75 % of buy for conventional; alien items orig list: Plasma Rifle 126 500, Heavy Plasma 171 600, Elerium 5 000/unit, Alloys 6 500, Power Source 250 000, Navigation 80 000, corpses 20 000, Laser Cannon 211 000…). Live aliens cannot be sold (orig default).

### 3.17 Economy, score, council (orig unless noted)
- Initial funding: each of 16 countries `RNG(base, 2·base)` k$, normalised to total **$6 000 000/month**; starting cash = that total.

| Country «pt-PT» | Region | Start base k$ | Cap k$ |
|---|---|---|---|
| EUA | América do Norte | 600 | 10 000 |
| Canadá | América do Norte | 230 | 4 000 |
| Brasil | América do Sul | 300 | 4 000 |
| Reino Unido | Europa | 240 | 7 000 |
| França | Europa | 320 | 8 000 |
| Alemanha | Europa | 250 | 9 000 |
| Itália | Europa | 160 | 6 000 |
| Espanha | Europa | 140 | 5 000 |
| Rússia | Europa/Sibéria | 230 | 8 000 |
| Egito | Norte de África | 230 | 2 000 |
| Nigéria | Norte de África | 180 | 2 000 |
| África do Sul | África Austral | 230 | 3 000 |
| Índia | Ásia Central | 150 | 5 000 |
| China | Sudeste Asiático | 245 | 7 000 |
| Japão | Sudeste Asiático | 400 | 10 000 |
| Austrália | Australásia | 280 | 5 000 |

- Month end per country: `good = xcomTotal/10 + countryXcom`, `bad = alienTotal/20 + countryAlien`, `delta = floor(funding_k × RNG(5,20)/100) k$`; increase if `good > bad+30 and RNG(0,good) > bad` (cap), decrease if `bad > good+30 and RNG(0,bad) > good`; pact ⇒ 0 forever.
- X-COM points: UFO crash = UFO score / destroyed ×2; alien kill +value; live capture 2×value (if race/rank not yet interrogated) else +10; civilian saved +30, killed by aliens −30, by X-COM −50; soldier lost −(20+missions+rank bonus); craft lost −score; recovered unresearched artefacts (Power Source 20, Navigation 5, corpse 5 / terror corpse 3, plasma guns 3/4/5, alien devices 2, alloys tiles 1 each ÷10); alien base destroyed +500; research completed +topic points (10–60); council +400/month from month 2.
- Alien points: each flying UFO +1 per 30 min (landed ×2); mission completion Harvest 30, Abduction 50, Terror 10, Base 50, Infiltration 150 (pact); alien base +5/day; terror site expired un-attacked +1 000.
- Rating = X-COM − alien. Threshold T = −900 / −700 / −500 for «Recruta»/«Veterano»/«Super-humano» (orig `−900 + 100·coef` with coef 0/2/4). Labels: ≤ T−300 «Terrível», > T−300 «Fraco», > T «Razoável», > 0 «Bom», > 500 «Excelente».
- **Defeat**: rating ≤ T two consecutive months; funds ≤ −$1 000 000 at two consecutive month ends (warning first); base lost. **Victory**: destroy the Alien Brain at Cydonia.
- Costs: soldier 40 k/20 k, scientist 30 k/30 k, engineer 25 k/25 k; personnel delivery 48 h (ours; orig 72 h); items 24 h; craft weapons 48 h.

### 3.18 Alien mission schedule (ours, compressed; data-driven, same machinery as orig)

| Our month | Script commands |
|---|---|
| 0 (Jan) | `gameStart`: Alien Research, Sectoid 100 %, base region, first UFO +120 min; `recurringTerror` (first UFO +3 days) |
| 1 | Terror; 1 table mission; **`seedAlienBase`**: Alien Base mission in a land region within 4 000 nm of the X-COM base (guarantees a base exists by month 2) |
| 2 | Terror; 2 table missions; retaliation possible (shoot-down roll) |
| 3+ | Terror; 3 table missions; scheduled Retaliation from month 3 («Recruta») / 2 («Super-humano») or right after Martian Solution |

- Wave timers = orig × 0.5 (e.g. Alien Research: SS P0 4 500 min → MS P2 3 900 → LS ×2 P4 4 500). Terror mission (ours): MS P1 6 000 → Terror Ship objective P7 4 500 (fewer waves). Next-wave delay after shoot-down `30×(RNG(0,200)+48)` min (ours; orig RNG(0,400)).
- Region choice: table missions use orig `regionWeight` × **3 for regions whose centroid is within 4 000 nm of the X-COM base** (ours; only one base in MVP). Mission type by region weights (orig), removed until table empties.
- Races by our month (ours): m0 Sectoid 60 / Floater 40; m1 Sectoid 30 / Floater 30 / Snakeman 20 / Muton 20; terror m1+ Snakeman 60 (Chryssalids) / Floater 20 / Sectoid 20; m2 adds Ethereal 20; m3+ Muton 30 / Ethereal 30 / Snakeman 20 / Floater 10 / Sectoid 10.
- Trajectories P0–P9 + assault run orig (`[zone, altitude 0..4, speed %]`, groundTimer×5 s landing). Terror sites last **8–16 h** (ours; orig 4–10). Alien base revealed by agents **50 %/month** (ours; orig 20 %) + patrol discovery `50 − 50·d/1696` % per 10 min + Supply Ship landing reveals it.
- Infiltration (orig: pact + base, then restart) kept; pacts are the slow funding bleed.

### 3.19 Difficulty summary
| Effect | Recruta | Veterano | Super-humano |
|---|---|---|---|
| coef | 0 | 2 | 4 |
| Alien Firing & armour | ×0.5 | ×1 | ×1 |
| Alien stat growth | 0 | +2×growth% | +4×growth% |
| Crew size | low | +25 % | +50 % |
| UFO reload / escape | orig formulas with coef |
| Retaliation per shoot-down | 4 % | 12 % | 20 % |
| Council threshold | −900 | −700 | −500 |
| Alien cheat turn | 12 | 10 | 8 |

---

## 4. MVP scope vs later

**MVP (must ship in this session)**
- Main menu, new game (difficulty, base placement on globe), options, 3 save slots + autosave, JSON export/import.
- Geoscape: orthographic globe (land polygons, day/night terminator, radar circles, region/country hover), 6 time speeds with auto-stop, UFO missions/trajectories/landings, radar detection, craft orders (intercept/transport/patrol/return), simplified dogfight (orig modes/formulas), crash sites, landed UFOs, terror sites, alien bases (discovery + assault), retaliation (base defences fire; base-defence battle **P1**, MVP auto-resolve: if the Battleship survives defences, `garrisonPower = Σ soldier (TU+Firing+HP)` vs `1 800 + 300·coef`; win ⇒ lose 1–3 soldiers, kill the UFO (score 700); loss ⇒ base destroyed ⇒ game over), monthly report with funding changes and council verdict, game over / victory.
- Basescape: one base, 6×6 facility grid (build, connectivity, build days), personnel hire/sack, buy/sell, stores, containment, research (assign scientists), manufacturing (assign engineers, materials), soldier list/details/rename/armour, craft list (weapons, crew, equipment), Ufopaedia.
- Battlescape: 3-level maps (2 for alien base/Mars) from ASCII blocks; tile parts floor/west wall/north wall/object; terrains Farm, Forest, Desert (+Mountain/Polar palettes), Urban, Alien Base, Mars, UFO interiors ×7, Skyranger/Avenger; TU/energy/health/morale/stun; snap/aimed/auto/throw/prime/melee; reaction fire; grenades/explosions/destructible terrain/gravity; smoke; fire; night + flares; fatal wounds + medikit; stun + capture (stun rod, stun bombs; stunned aliens recovered to containment); simplified inventory (hands + belt + backpack + ground); panic/berserk; alien psi Panic; 2×2 units; alien AI (4 modes, memory, cheat turn, grenades); civilians; UFO doors; abort mission; debrief with score/recovery/experience/promotions.
- Alien roster: Sectoid, Floater, Snakeman, Muton, Ethereal (+ Cyberdisc, Reaper, Sectopod, Chryssalid, Zombie) = 10 unit types.
- Campaign end: alien base assault yields commanders; Cydonia single-stage final mission with Alien Brain.
- Audio: synthesised SFX set + 3 generative music moods.
- Tools: Node sim harness, tests, Playwright QA.

**P1 (if time remains, in this order)**: base-defence battlescape (facility blocks), Mind Control, Hyper-Wave Decoder, run/strafe, proximity grenades, Silacoid/Celatid, 2nd/3rd base (no transfers), Graphs screen, blaster waypoints, loadout templates library, colour-blind palette.
**P2**: player psionics (Psi Lab, Psi-Amp, Mind Shield), HWPs/tanks, Fusion weapons/Grav Shield, transfers, Lightning, two-stage Cydonia, TFTD-style extras, retro pixel mode.

---

## 5. Architecture

### 5.1 Directory layout
```
ovni-1999/
  index.html            # classic <script> tags in layer order, ?v=<stamp>
  css/style.css
  js/core/   util.js rng.js
  js/i18n/   pt-PT.js
  js/data/   tuning.js items.js units.js geo.js world.js ufos.js base.js research.js tiles.js
             blocks_ufo.js blocks_farm.js blocks_wild.js blocks_urban.js blocks_alien.js finalize.js
  js/sim/battle/ map.js mapgen.js path.js los.js combat.js env.js bunits.js actions.js morale.js ai.js battle.js
  js/sim/geo/    clock.js gmath.js world.js missions.js dogfight.js base.js economy.js soldiers.js
  js/sim/    campaign.js save.js
  js/gfx/    color.js iso.js sprites_tiles.js sprites_units.js battle_render.js fx.js globe_render.js base_render.js
  js/ui/     dom.js input.js presenter.js battle_ui.js inventory_ui.js geo_ui.js dogfight_ui.js base_ui.js screens.js ufopaedia.js
  js/audio/  audio.js
  js/main.js
  tools/     load.js sim.js test.js build_world.mjs
  qa/        qa.mjs
  serve.command  package.json (scripts only, no deps except optional playwright for qa)
```
Module idiom: `(function (OV) { 'use strict'; ... OV.Path = { ... }; })(globalThis.OV || (globalThis.OV = {}));` — works in browsers (classic scripts) and in Node via `tools/load.js` (`vm.runInThisContext` over the sim/data file list with `globalThis.window = globalThis`).

### 5.2 Layers and the scene model
- `core` (pure helpers) → `data` (immutable rules; `finalize.js` resolves string refs, compiles ASCII blocks into typed arrays, validates) → `sim` (mutable state functions; Node-safe) → `gfx` (canvas drawing; reads state) → `ui` (DOM + input + presenter) → `main.js` (scene stack + rAF loop).
- Scene stack (copied from OpenXcom's State stack): `OV.Scenes.push(scene)`, `pop()` (deferred), `set()`; scene = `{id, isScreen, enter(), exit(), handle(evt), think(dtMs), draw()}`. Only the top scene thinks ⇒ popups pause the Geoscape for free. Draw from the nearest `isScreen` scene upward.
- Scenes: `menu`, `geoscape`, `basescape`, `dogfight` (overlay), `popup` (generic modal), `briefing`, `equip`, `battlescape`, `inventory` (overlay), `debrief`, `monthly`, `ufopaedia`, `gameover`, `victory`.
- Loop (`main.js`): rAF; Geoscape advances one speed step every 80 ms of real time (accumulator, max 3 steps/frame); dogfight 30 ms ticks; Battlescape has no sim clock — it runs action generators driven by the presenter; render on demand (dirty flag) plus ambient 10 fps for fire/smoke/door/selection bob when visible; pause on `visibilitychange`.

### 5.3 Module interfaces (signatures; `G` = campaign state, `B` = battle state)

**core/util.js** — `OV.U = { clamp(v,a,b), idiv(a,b), isqrt(n), hash32(a,b,c), DX:[0,1,1,1,0,-1,-1,-1], DY:[-1,-1,0,1,1,1,0,-1], dirTo(dx,dy)→0..7, chebyshev(a,b), dist2(ax,ay,bx,by), b64enc(typedArray)→str, b64dec(str,Ctor)→typedArray, fmtMoney(n), fmtDate(t), esc(s), deepFreeze(o) }`
**core/rng.js** — `OV.RNG.create(seed)→{s, int(a,b), pct(p)→bool, pick(arr), weighted(obj)→key, state()→uint32, setState(u32)}`; `OV.RNG.streams(seed)→{geo,map,combat,ai}`.
**i18n/pt-PT.js** — `OV.STR = {...}`; `OV.T(key, params)→string`; `OV.name(def)` uses `def.nameKey`.
**data/finalize.js** — `OV.Data.finalize()`: assigns ids, resolves refs, compiles blocks (`compileBlock(block, tileset)→{w,h,d, parts:Uint16Array(w*h*d*4), nodes:[]}`), throws on unknown legend chars / bad widths (unit-tested).

**sim/battle/map.js**
```
OV.BMap.create(w,h,d) → map {w,h,d,n, parts:Uint16Array(n*4), fire:Uint8Array(n), smoke:Uint8Array(n),
                              ufoDoorOpen:Uint8Array(n), disc:Uint8Array(n) /*bit0 floor/content, bit1 west, bit2 north*/}
OV.BMap.idx(m,x,y,z) ; xyz(m,i)→[x,y,z] ; inB(m,x,y,z)
OV.BMap.def(m,i,part)→tileDef|null          // part 0 floor,1 west,2 north,3 object
OV.BMap.setPart(B,i,part,defId)              // emits {t:'tile', i, part, defId}; marks light/LOS dirty
OV.BMap.hasFloor(m,i) ; isFullBlock(m,i) ; edgeBlocks(m,x,y,z,dir,kind)  // kind: MOVE|LOS|HE|SMOKE|FIRE
OV.BMap.verticalLink(m,i,up)→{to, tu, energy}|null   // gravlift, stairs, flight
```
**sim/battle/mapgen.js**
```
OV.MapGen.generate(spec, rng) → {map, nodes:[{x,y,z,rank,prio}], xcomStarts:[i], craftTiles:Set, ufo:{x,y,w,h}, objectiveTiles:[i], layout:[...] }
  spec = {deployment, terrain, ufoType|null, crashed, craftType, w,h,d, night}
```
**sim/battle/path.js**
```
OV.Path.stepCost(B, unit, fromI, dir /*0..9*/) → {tu, energy, to} | null
OV.Path.reachable(B, unit, tuBudget, energyBudget) → {cost:Int16Array(n) (−1 unreachable), parent:Int32Array(n), list:Int32Array}
OV.Path.find(B, unit, toI, maxTU) → {steps:[dir...], tu, energy} | null      // A*, heuristic 4·octile3d
OV.Path.flyRoute(B, fromI, toI) → [i...] | null                               // blaster bomb
```
**sim/battle/los.js**
```
OV.LOS.computeLight(B)                       // fills B._.light Uint8Array(n)
OV.LOS.fov(B, unit) → {spotted:[unitId], discovered:[i]}   // updates unit.vis, side visibility, discovery
OV.LOS.canSee(B, viewer, target) → bool
OV.LOS.refreshAll(B)                          // after explosions/smoke/light changes
OV.LOS.traceShot(B, fromVoxel, toVoxel, ignoreUnitId, maxTiles) → {kind:'unit'|'floor'|'west'|'north'|'object'|'none', i, unitId, voxel}
OV.LOS.targetVoxel(B, shooter, target) → voxel|null  // LOF: any of 5 samples reachable
OV.LOS.eyeVoxel(B, unit) → voxel
```
**sim/battle/combat.js**
```
OV.Combat.accuracy(B, unit, item, mode) → int %
OV.Combat.deviate(rng, origin, target, acc) → voxel
OV.Combat.hitChance(B, unit, item, mode, targetI, uiRng, samples=100) → int %   // Monte Carlo of the real model, no sim RNG
OV.Combat.applyImpact(B, hit, power, dmgType, attackerId) → events[]
OV.Combat.explode(B, centreVoxel, power, dmgType, radius, attackerId) → events[]
OV.Combat.damageUnit(B, unit, power, dmgType, side, bodyPart, attackerId) → events[]
OV.Combat.damageTerrain(B, i, part, power) → events[]
```
**sim/battle/env.js** — `openDoor(B,unit,i,part)→events`, `closeUfoDoors(B)`, `applyGravity(B, i)→events`, `roundUpkeep(B)→events` (fire/smoke spread, burnout), `unitTurnStart(B,unit)→events`, `armedGrenadesEndTurn(B)→events`.
**sim/battle/bunits.js** — `fromSoldier(B, soldier, craftItems)`, `fromAlien(B, typeId, itemTier, rng)`, `fromCivilian(B)`, `weight(u)`, `item(u, slot)`, `actionTU(u, item, action)`, `invMoveCost(from,to)`, `canStand/size/height(u)`.
**sim/battle/actions.js**
```
OV.Act.validate(B, action) → {ok, tu, reason}        // reason keys for i18n: 'noTU','reserved','noLOF','noAmmo',...
OV.Act.perform(B, action) → Generator<Event>          // the ONLY way state changes during battle
  action = {type:'walk', unitId, to}|{type:'turn',unitId,dir}|{type:'kneel',unitId}|{type:'shoot',unitId,hand,mode,targetI,force}
         |{type:'throw',unitId,itemId,targetI}|{type:'prime',unitId,itemId,fuse}|{type:'reload',unitId,hand}
         |{type:'door',unitId,i}|{type:'medikit',unitId,targetId,part,kind}|{type:'inv',unitId,itemId,to}
         |{type:'scanner',unitId}|{type:'psi',unitId,targetId,kind}|{type:'melee',unitId,targetId}
OV.Act.reactions(B, moverId) → Generator<Event>
```
**sim/battle/morale.js** — `onHit`, `onDeath`, `panicPhase(B, side)→Generator`, `psiAttack(B, attacker, target, kind)→events`.
**sim/battle/ai.js** — `OV.AI.turn(B, side)→Generator<Event>` (aliens, civilians, and a `playerBot` profile for headless tests); `OV.AI.think(B, unit, ctx)→action|null`.
**sim/battle/battle.js**
```
OV.Battle.create(G, mission) → B          // mission = {kind:'crash'|'landed'|'terror'|'alienBase'|'cydonia'|'baseDefence', siteId, craftId, terrain, ufoType, night, seed}
OV.Battle.beginPlayerTurn(B) → Generator ; OV.Battle.endPlayerTurn(B) → Generator  // runs alien + civilian turns, upkeep, next player turn start
OV.Battle.outcome(B) → null|'win'|'loss'|'abort'
OV.Battle.debrief(B) → {score, kills, captured:[], recovered:{itemId:n}, lost:[soldierId], unitExp:{soldierId:{...}}, craftLost}
OV.Battle.hash(B) → uint32 ; serialize(B)→obj ; deserialize(obj)→B ; rebuildDerived(B)
```
**sim/geo/**
```
OV.Clock.advance(G, ticks5s) → mask(T5S|T10M|T30M|T1H|T1D|T1MO) ; OV.Clock.date(G)
OV.GMath.vec(lon,lat), toLL(v), distNm(a,b), stepToward(a,b,knots,seconds), inRect(lon,lat,r), regionAt(lon,lat), countryAt(lon,lat), isLand(lon,lat), sunVec(G)
OV.World.step(G, speedTicks) → {stopped:bool}   // runs handlers, pushes G.events, stops on 'stop' events
OV.World.order(G, craftId, target)              // target {ufoId}|{siteId}|{baseId}|{lon,lat}|'home'
OV.Missions.planMonth(G) ; OV.Missions.think30m(G) ; OV.Missions.onUfoWaypoint(G, ufo)
OV.Dogfight.create(G, craftId, ufoId) → D ; tick(G, D) → events ; setMode(D, mode)
OV.BaseSim.canPlace(base,type,x,y)→reason|null ; build(G,base,type,x,y) ; capacities(base) ; hire(G,base,kind,n) ; buy/sell(G,base,itemId,n)
OV.BaseSim.startResearch(G,base,topicId,scientists) ; setScientists(...) ; startProduction(G,base,itemId,engineers,qty) ; daily(G) ; hourly(G)
OV.Economy.addScore(G, side, pts, lon, lat) ; monthEnd(G) → report ; checkDefeat(G)
OV.Soldiers.generate(rng, natId) ; applyMission(G, soldierId, exp, hpLost) ; promotions(G) → [{id, rank}]
```
**sim/campaign.js** — `newCampaign({difficulty, seed, baseLonLat, baseName})→G`, `startMission(G, siteRef, craftId)→B`, `finishMission(G, B)→debriefModel`, `availableResearch(G)`, `availableManufacture(G)`.
**sim/save.js** — `toJSON(G, B?)→obj`, `fromJSON(obj)→{G,B}`, `slots()`, `write(slot, obj)`, `read(slot)`, `exportFile(obj)` (download via `Blob`, UI-side helper), `importFile(text)`, `MIGRATIONS[]`.

**gfx/** — `OV.Color.{css(c,a), shade(c,f), mix(a,b,t)}`; `OV.Iso.{TW:64,TH:32,LH:48, tileToScreen(x,y,z,cam), screenToTile(px,py,z,cam), voxelToScreen(vx,vy,vz,cam), zoomAt(cam,px,py,f)}`; `OV.TileSprites.get(defId, frame, scale)→canvas(+.shadow)`; `OV.UnitSprites.get(typeKey, dir, pose, frame, scale)`; `OV.BattleRender.draw(ctx, B, view)` (view = {cam, viewZ, hover, previewPath, anim, overlays}); `OV.FX.{spawn(kind, voxel, opts), update(dt), draw(ctx, cam)}`; `OV.GlobeRender.draw(ctx, G, view)`, `pick(view, px, py)→{lon,lat}|null`; `OV.BaseRender.draw(ctx, base, view)`.
**ui/** — `OV.Input.attach(canvas, handlers)` (normalised `{kind:'primary'|'secondary'|'hover'|'pan'|'zoom'|'key', ...}`); `OV.Presenter.play(gen, opts)→Promise<lastEvent>` (§10); `OV.BattleUI.enter(B)`; `OV.InventoryUI.open(B, unitId)`; `OV.GeoUI`, `OV.DogfightUI`, `OV.BaseUI`, `OV.Screens`, `OV.Ufopaedia`; `OV.Dom.{toast(key,params,kind), modal(spec)→Promise, tooltip(el, text)}`.
**audio/audio.js** — `OV.audio.{init(), play(name, {pan, vol}), music(mood), stop(), setVolumes({master,sfx,music})}`.

---

## 6. Data model (JSON examples)

```js
// data/items.js  (rules, immutable)
{ id:'rifle', nameKey:'item.rifle', kind:'firearm', twoHanded:true, weight:8, size:3, storage:0.2,
  buy:3000, sell:2250, ammo:['rifle_clip'], modes:{ snap:{acc:60,tu:25}, aimed:{acc:110,tu:80}, auto:{acc:35,tu:35,shots:3} },
  research:null, sprite:'rifle', sfx:'rifle' }
{ id:'rifle_clip', kind:'ammo', power:30, dmg:'AP', rounds:20, weight:3, size:1, buy:200, sell:150 }
{ id:'grenade', kind:'grenade', power:50, dmg:'HE', radius:5, weight:3, size:1, buy:300, sell:225 }
{ id:'plasma_rifle', kind:'firearm', twoHanded:true, weight:5, size:3, sell:126500, recoveryPoints:4, armour:45,
  ammo:['plasma_rifle_clip'], modes:{snap:{acc:86,tu:30},aimed:{acc:100,tu:60},auto:{acc:55,tu:36,shots:3}}, research:'plasma_rifle' }
// armour
{ id:'personal_armour', front:50, side:40, rear:30, under:30, mods:{IN:80,STUN:90,ACID:110}, research:'personal_armour', colour:0x5a7a50 }
// units.js
{ id:'sectoid_soldier', race:'sectoid', rank:'soldier', stats:{tu:54,sta:90,hp:30,brav:80,react:63,fire:52,thr:58,str:30,melee:76,psiStr:40,psiSkill:0},
  armour:{front:4,side:3,rear:2,under:2, mods:{MELEE:120,ACID:160,SMOKE:0}}, size:1, height:16, kneel:12, move:'walk',
  energyRecovery:30, int:3, aggr:2, value:10, corpse:'sectoid_corpse' }
// ufos.js
{ id:'small_scout', size:0, hp:50, speed:2200, weapon:{power:0,range:0,reload:56}, breakOff:200, score:50,
  block:'UFO_SMALL_SCOUT', map:{w:30,h:30,d:3}, alloys:3, deployment:'dep_small_scout' }
{ id:'dep_small_scout', rows:[{rank:'soldier', min:1, max:1, outside:50}] }
{ id:'skyranger', speed:760, accel:2, fuel:1500, burn:'speed', hp:150, weapons:0, seats:14, buy:500000, rent:500000, score:200, block:'SKYRANGER' }
{ id:'stingray', dmg:70, range:30, acc:70, ammo:6, reload:{cautious:64,standard:48,aggressive:32}, projectile:'missile', rearmPerHour:1 }
{ id:'alien_research', points:0, waves:[{ufo:'small_scout',n:1,traj:'P0',timer:4500},{ufo:'medium_scout',n:1,traj:'P2',timer:3900},{ufo:'large_scout',n:2,traj:'P4',timer:4500}] }
{ id:'P0', groundTimer:3000, pts:[[5,4,100],[0,3,74],[0,1,28],[1,1,47],[5,2,100]] }
// base.js
{ id:'laboratory', size:1, cost:750000, days:10, upkeep:30000, labs:50, research:null, sprite:'lab' }
// research.js
{ id:'ufo_construction', cost:120, points:30, requires:['alien_alloys','elerium','power_source','ufo_navigation'], needItem:null, unlocks:['new_fighter'], article:'ufo_construction' }
{ id:'interrogate', template:true, costByRank:{soldier:45,navigator:45,engineer:45,medic:45,leader:55,commander:65}, points:50, consumes:'liveAlien' }
{ id:'avenger', kind:'manufacture', hours:2400, cost:900000, materials:{alien_alloys:40, power_source:2, ufo_navigation:1}, space:36, produces:{craft:'avenger'}, requires:'ultimate_craft' }
// data/tiles.js  (tile part defs; one global id space; resolved per tileset by role)
{ id:57, set:'FARM', role:'wallBrick', part:'west', tu:255, armour:50, heBlock:20, blockLOS:true, flammable:255, fuel:0,
  height:24, die:'wallBrickRubble', light:0, sfx:'brick', colour:0x9a6b4a }
{ id:58, set:'FARM', role:'doorWood', part:'west', door:'swing', alt:'doorWoodOpen', tu:255, armour:20, blockLOS:true, flammable:30, fuel:3 }
{ id:90, set:'UFO', role:'powerSource', part:'object', tu:255, armour:60, height:16, explosive:{power:[120,180], radius:6, type:'HE'}, special:'POWER_SOURCE', light:10 }
```

Campaign state (excerpt; plain JSON):
```js
G = { schema:1, seed:12345, difficulty:2, rng:{geo:…, map:…, combat:…, ai:…}, t:0 /*seconds since 1999-01-01 12:00*/, month:0,
  funds:6000000, history:[{month:0, funds:6000000, income:0, upkeep:0, rating:0}],
  score:{ month:{xcom:{regions:{}, countries:{}}, alien:{regions:{}, countries:{}}, research:0} },
  countries:[{id:'usa', funding:900000, history:[900000], pact:false}],
  bases:[{ id:'b1', name:'Base Lusitânia', lon:-9.1, lat:38.7, region:'europe',
    grid:[{type:'access_lift',x:2,y:2,daysLeft:0}, …],
    scientists:10, engineers:10, soldiers:['s1',…], crafts:['c1','c2','c3'],
    stores:{rifle:2, rifle_clip:8, grenade:5, medikit:3, flare:6, …}, aliens:[{type:'sectoid_navigator'}],
    research:[{topic:'laser_weapons', cost:22, spent:9, scientists:10}], production:[{item:'laser_rifle', engineers:10, spent:30, qty:2, done:0}],
    deliveries:[{kind:'scientist', n:5, etaT:172800}], defences:[] }],
  soldiers:{ s1:{ id:'s1', name:'Ana Ribeiro', nat:'pt', female:true, rank:1, stats:{tu:56,sta:61,hp:33,brav:40,react:47,fire:63,thr:71,str:28,melee:31,psiStr:72},
                  armour:'none', missions:3, kills:4, woundDays:0, craftId:'c1', loadout:{R:'rifle',L:null,belt:['rifle_clip','grenade'],pack:['medikit']}, portraitSeed:771 } },
  dead:[{id:'s7', name:'…', rank:1, missions:2, kills:1, diedT:…, cause:'kia'}],
  crafts:{ c1:{id:'c1', type:'skyranger', name:'Skyranger-1', baseId:'b1', status:'ready'/*ready|out|refuel|repair|rearm*/, lon:…, lat:…,
               dest:null, fuel:1500, hp:150, weapons:[], soldiers:['s1',…], cargo:{rifle:6,…}, patrol:false } },
  ufos:[{ id:'u7', type:'medium_scout', missionId:'m3', lon:…, lat:…, alt:3, speedPct:57, traj:'P2', wp:2, status:'flying'/*flying|landed|crashed*/,
          hp:200, dmg:0, detected:true, hyper:false, groundLeftS:0, crashLeftH:0, race:'sectoid' }],
  missions:[{ id:'m3', type:'alien_research', region:'europe', race:'sectoid', wave:1, ufoCounter:0, countdownS:142200, liveUfos:['u7'] }],
  sites:[{ id:'t1', kind:'terror', city:'lisbon'?, lon:…, lat:…, race:'snakeman', leftH:12 }],
  alienBases:[{ id:'ab1', lon:…, lat:…, race:'snakeman', region:'north_africa', discovered:false }],
  researched:['laser_weapons'], ufopaedia:['rifle', …], flags:{leaderInterrogated:false, commanderInterrogated:false, cydoniaUnlocked:false},
  ids:{next:42, craftByType:{skyranger:1, interceptor:2}}, events:[] /* transient, not saved */ }
```

Battle state (excerpt):
```js
B = { schema:1, mission:{kind:'crash', siteId:'u7', craftId:'c1', terrain:'FARM', ufoType:'medium_scout', night:true, shade:13, race:'sectoid', month:1},
  map:{w:30,h:30,d:3, parts:Uint16Array, fire:Uint8Array, smoke:Uint8Array, ufoDoorOpen:Uint8Array, disc:Uint8Array},
  nodes:[{x,y,z,rank,prio}], craftTiles:[…], turn:1, side:'xcom', cheat:false, reserve:'snap', reserveKneel:false,
  rng:{combat:…, ai:…},
  units:[{ id:7, side:'alien'|'xcom'|'civ', type:'sectoid_soldier'|'soldier', soldierId:'s1'|null, x,y,z, dir:2, size:1,
           tu:54, energy:90, hp:30, stun:0, morale:100, kneel:false, float:false, armour:[4,3,3,2,2] /*F,L,R,Rear,U*/, wounds:[0,0,0,0,0,0],
           burn:0, status:'ok'|'dead'|'out'|'panic', items:{R:12,L:null,belt:[13,14],pack:[]}, exp:{fire:0,react:0,thr:0,melee:0,brav:0},
           ai:{mode:'patrol', node:3, wasHitBy:[], aggroId:null}, turnsSinceSpotted:99, motion:0, kills:0, origSide:'alien' }],
  items:[{ id:12, type:'plasma_pistol', ammo:{type:'plasma_pistol_clip', rounds:26}, owner:7 | null, at:i|null, fuse:-1, charges:null }],
  stats:{ civSaved:0, civKilledByAliens:0, civKilledByXcom:0 }, log:[] }
B._ = { unitAt:Int32Array(n), light:Uint8Array(n), visTiles:Uint8Array(n), visUnits:Set, reach:{…} }   // derived, not saved
```

---

## 7. Battlescape map system

### 7.1 Tile model
- Map `w × h × d` (d = 3 for surface/UFO maps, 2 for alien base and Mars); index `i = (z*h + y)*w + x`; directions 0=N(y−1) clockwise to 7=NW, 8=up, 9=down (OpenXcom tables; N points screen up-right).
- Each tile: 4 part slots `[floor, west, north, object]` (Uint16 def ids, 0 = empty) + `fire`, `smoke`, `ufoDoorOpen`, `disc` bits; items on ground live in `B.items` with `at = i`.
- Tile part def fields: `part, tu (255 = blocked), armour (255 = indestructible), die (def id or 0), alt (opened door), door ('swing'|'ufo'), window, blockLOS, heBlock, smokeBlock, flammable (255 never), fuel, height (object voxel height 8/12/16/24), fullBlock (bigWall 1 or diagonal), diagonal (2|3, drawn diagonally, treated as full block), stairs ('foot'|'head'), gravlift, light, explosive {power:[a,b], radius, type}, special (POWER_SOURCE, NAVIGATION, DEVICE, OBJECTIVE, START), sfx, art key + palette`.
- **Walls live on the west and north edges of a tile** (X-COM model). A wall between tile A and its east neighbour is the *west* wall of the east neighbour; this drives the authoring legend below.

### 7.2 Block authoring format
Blocks are JS objects in `js/data/blocks_*.js`, one char per tile, one string array per level (z0 first). Widths 10 or 20 (or 30 for big UFOs), heights 10/20/30. Optional per-block `legend` overrides; `nodes` may also be given as `[[x,y,z,rank,prio]]` for outdoor nodes; every outdoor 10×10 cell also gets 2 auto scout nodes (rank 0) on random free ground tiles.

```js
OV.Data.blocks.FARM_BARN = { set:'FARM', w:10, h:10, tags:['building'], weight:3, maxUses:2, levels:[ [/*z0 rows*/], [/*z1*/], [/*z2*/] ] }
```

**Default legend** (role names are resolved through the block's tileset: `wall` is brick on FARM, timber on FOREST cabins, concrete on URBAN, alloy on UFO/ALIEN, regolith rock on MARS):

| Char | Floor | West wall | North wall | Object | Notes |
|---|---|---|---|---|---|
| `.` | ground | | | | grass / sand / snow / sidewalk / regolith / alien base floor |
| `,` | ground | | | crop | low cover h8, TU +2, flammable |
| `_` | road | | | | asphalt |
| `=` | inner | | | | interior floor (wood/tile/alloy) |
| `R` | roof | | | | upper outdoor floor (breakable → hole) |
| `~` | – | | | | air (no floor), upper levels only |
| `X` | craft floor | | | | X-COM start tile |
| `r` | craft ramp | | | | craft tile (abort/recovery zone) |
| `\|` `-` `+` | inner | wall / – / wall | – / wall / wall | | interior tile with W / N / both walls |
| `!` `^` `L` | ground | wall / – / wall | – / wall / wall | | outdoor tile carrying a building's east (`!`) / south (`^`) facade |
| `]` `;` `}` | – (air) | wall / – / wall | – / wall / wall | | same facades on upper storeys |
| `d` `D` | inner | door / – | – / door | | swing door (opens permanently, alt part) |
| `e` `E` | ground | door / – | – / door | | facade door |
| `i` `I` | inner | window / – | – / window | | blocks movement, not LOS, armour 10 |
| `j` `)` `:` | ground / air / air | window / window / – | – / – / window | | facade windows |
| `f` `F` | ground | fence / – | – / fence | | blocks movement, not LOS, armour 10 |
| `#` | ground | | | rock / solid | full block h24 |
| `T` | ground | | | tree | full block, flammable, fuel 4 |
| `b` | ground | | | bush | h8 cover, TU +4, flammable |
| `h` | ground | | | hedge | h12, impassable |
| `c` `t` `B` `k` | inner | | | crate·hay / table / bed·sofa / cabinet·console | h12 imp. / h8 TU+4 / h8 TU+4 / h16 imp. |
| `l` | ground | | | street lamp | light 12 |
| `C` | road | | | car | h12 impassable, explodes HE 40 r3 when destroyed |
| `s` / `S` | inner | | | stairs foot / stairs head | vertical link s(z) ↔ S(z+1), 6 TU, 3 energy |
| `g` | inner (lift) | | | gravlift | vertical link g(z) ↔ g(z±1), 8 TU, 0 energy, indestructible |
| `H` | inner | | | hull / bulkhead | full block; armour 255 (UFO, craft), 100 (alien base), 60 (Mars ruins) |
| `/` `\` | inner | | | diagonal hull | full block, drawn as a diagonal slab (NE–SW / NW–SE) |
| `O` | inner | | | UFO sliding door | full-tile door; open 4 TU; closes end of turn unless occupied; adjacent `O` open together |
| `P` | inner | | | UFO power source | h16, armour 60, explosive HE 120–180 r6; recovers Power Source + 50 Elerium |
| `n` | inner | | | navigation console | h12, armour 50; recovers UFO Navigation |
| `u` | inner | | | alien device | h12; recovers an alien artefact (food / surgery / entertainment / examination / reproduction by UFO type) |
| `@` | inner | | | objective | alien base control core / Cydonia Alien Brain (MUST_DESTROY) |
| `1`–`6` | inner | | | | spawn/patrol node: 1 soldier, 2 engineer, 3 navigator, 4 leader/commander, 5 medic, 6 terrorist |

Authoring tip (validated by `finalize.js`): to close a room on its east/south side, mark the *outside* tiles with `!`/`^`/`L` (or `]`/`;`/`}` upstairs).

UFO roof rule: for UFO/craft blocks only, every non-`~`, non-`.` tile of the top authored level gets a roof floor at z+1, and lower-deck tiles under `~` upper tiles also get a roof floor at z+1 (walkable hull top). Terrain blocks author their roofs explicitly with `R`.

### 7.3 Map scripts (mini interpreter, cells of 10×10)
| Terrain | Sizes | Script |
|---|---|---|
| FARM «Quinta» | 30×30×3 / 40×40×3 / 50×50×3 | `addCraft` (10×20, random free 1×2 cells on an edge column/row), `addUFO` (random free cell-aligned area ≥ 1 cell from craft), `fill` (weights: fields 5, barn 2, farmhouse 2, orchard 2, silo 1; maxUses barn 2) |
| FOREST «Floresta» (+ Jungle palette) | same | addCraft, addUFO, fill (forest A–F, clearing ×2, cabin 1) |
| DESERT «Deserto» (+ Mountain «Montanha», Polar «Polar» palettes) | same | addCraft, addUFO, fill (dunes/rocks A–F, ruin 1) |
| URBAN «Cidade» (terror) | 40×40×3 | roads: 50 % one N–S road column, 50 % one E–W row, else both (cross block at the junction); addCraft on a road/plaza cell; `addBlock 20×20` ×1–2 (store, apartment); fill 10×10 (houses, shops, park, parking lot with cars) |
| ALIEN BASE «Base Alienígena» | 40×40×2 | fixed: lift module (X-COM start, edge cell), command module 20×20 with `@` cores (random interior), 2–3 labs/quarters/hangar modules, remaining cells corridor modules; every module has 2-wide openings at the middle of each edge so adjacency always connects |
| MARS «Marte» (Cydonia) | 50×50×2 | Avenger at an edge; 20×20 "pyramid" core (2 levels, `@` Alien Brain on z1 reached by gravlift) in the middle; fill rocky regolith blocks with ruins |
| XBASE (P1 base defence) | 60×60×2 | one 10×10 block per facility in the 6×6 grid, hangars 20×20, corridors joining adjacent facilities |

Placement validation: flood-fill from X-COM starts must reach every alien spawn node (retry with next seed variant, max 5). Terrain choice for UFO sites: city ⇒ URBAN; |lat| > 60 ⇒ POLAR; else lookup in `geo.js` terrain boxes (desert: Sahara, Arabia, Gobi, SW USA, inner Australia, Atacama; jungle: Amazon, Congo, SE Asia/Indonesia; mountain: Andes, Rockies, Himalaya, Alps) else FARM (55 %) / FOREST (45 %) by `hash(lon,lat)`.

### 7.4 Terrain block examples (all validated widths)

FARM_FIELD (z0 only):
```
,,,,,,,,,,
,,,,,,,,,,
,,,,,,,,,,
..........
FFFFF..FFF
,,,,,,,,,,
,,,,,,,,,,
,,,,b,,,,,
,,,,,,,,,,
..........
```
FARM_BARN (z0 / z1 hay loft / z2 roof):
```
z0              z1              z2
..........      ~~~~~~~~~~      ~~~~~~~~~~
.+------!.      ~+------]~      ~RRRRRRR~~
.|cc===s!.      ~|=====S]~      ~RRRRRRR~~
.|c=====!.      ~|c=====]~      ~RRRRRRR~~
.|======j.      ~|======)~      ~RRRRRRR~~
.|c====c!.      ~|======]~      ~RRRRRRR~~
.|cc==cc!.      ~|cc====]~      ~RRRRRRR~~
.^^^EE^^..      ~;;;;;;;~~      ~~~~~~~~~~
..........      ~~~~~~~~~~      ~~~~~~~~~~
.....b....      ~~~~~~~~~~      ~~~~~~~~~~
```
URBAN_SHOP (shop front + back room + flat upstairs):
```
z0              z1              z2
..........      ~~~~~~~~~~      ~~~~~~~~~~
.+---D---!      ~+---I---]      ~RRRRRRRR~
.|kk===kk!      ~|B=====t]      ~RRRRRRRR~
.|======c!      ~|===t==B]      ~RRRRRRRR~
.d==1===c!      ~i======c]      ~RRRRRRRR~
.|======s!      ~|======S]      ~RRRRRRRR~
.+--D---L.      ~+--D---}~      ~RRRRRRR~~
.|bb==k=!.      ~|kk====]~      ~RRRRRRR~~
.|======!.      ~|==1===]~      ~RRRRRRR~~
.^^^^^^^..      ~;;;;;;;~~      ~~~~~~~~~~
```
URBAN_ROAD_NS: `..__l__...` / `..____....` ×8 with `..__C_....` ×2 (cars) and a second lamp `..____l...`.
FOREST_A:
```
..T....b..
.TT..b....
..T...#...
b.....##..
...T......
..TTT..b..
...T....T.
.b.....TT.
....b...T.
T.........
```
DESERT_A: `..........` / `...##.....` / `..###.....` / `...#......` / `.......b..` / `......##..` / `.b....###.` / `......##..` / `..........` ×2.
ALIEN_BASE_COMMAND (z0; z1 is all `~` except the corridor roof rule does not apply — alien base ceilings are implicit, maps are d=2 and the alien base sets `ceiling:true` so no flyover):
```
HHHH==HHHH
HH4n==n4HH
H=u====u=H
H========H
===P@@P===
===u@@u===
H========H
H=1====1=H
HHk2==2kHH
HHHH==HHHH
```
SKYRANGER (10×20, nose north; rotated by the script for E/W/S edges):
```
..........
....HH....
...HXXH...
..HHXXHH..
.HHXXXXHH.
HH=XXXX=HH
...HXXH...
...HXXH...
...HXXH...
...HXXH...
...HXXH...
..HHXXHH..
.HH=XX=HH.
HH==XX==HH
....XX....
....rr....
....rr....
..........
..........
..........
```
Blocks to author (helper agent, leaf work): FARM 8×10² + 1×20², FOREST 6, DESERT 6, URBAN 8×10² + 3×20² + road straight/cross/T, ALIEN BASE 7 modules, MARS 6 + pyramid 20², AVENGER 10×20.

### 7.5 UFO interior templates (validated: widths, gravlift alignment between decks, upper deck over hull)
Rows outside the listed range are all `.` (z0) or `~` (z1). Left number = row (y).

**Small Scout «Batedor Pequeno»** 10×10, 1 deck:
```
 2 .../HH\...
 3 ../=n=1\..
 4 ..H=P==O..
 5 ..\====/..
 6 ...\HH/...
```
**Medium Scout «Batedor Médio»** 10×10, 1 deck:
```
 2 ../HHHH\..
 3 ./3=H=n=\.
 4 .O1=O=P=H.
 5 ..\=H=1/..
 6 ...\HHH/..
```
**Large Scout «Batedor Grande»** 20×20, 1 deck:
```
 3 ....../HHHHHH\......
 4 ...../==n33n==\.....
 5 ..../====HH====\....
 6 .../HHHOHHHHOHHH\...
 7 ...H=1==H==H=P==H...
 8 ...O====O==O====H...
 9 ...H==1=H21H==1=H...
10 ...\HHHHHHHHHHHH/...
```
**Abductor «Raptor»** 20×20, 2 decks:
```
z0                              z1
 2 ......./HHHH\.......          5 ~~~~~~~/HHHH\~~~~~~~
 3 ....../u=55=u\......          6 ~~~~~~/P=nn=P\~~~~~~
 4 ...../u==HH==u\.....          7 ~~~~~/==4gg2==\~~~~~
 5 ..../HHHHOOHHHH\....          8 ~~~~~\=3====1=/~~~~~
 6 .../==1=H==H=1==\...          9 ~~~~~~\HHHHHH/~~~~~~
 7 ...H=uu=HggH=uu=H...
 8 ...H====O==O====H...
 9 ...H=u5=H21H=5u=H...
10 ...\HHHHHOOHHHHH/...
```
**Harvester «Ceifeira»** 20×20, 2 decks:
```
z0                              z1
 2 ....../HHHHHH\......          4 ~~~~~~~/HHHH\~~~~~~~
 3 ...../uu=11=uu\.....          5 ~~~~~~/P=34=P\~~~~~~
 4 ..../u===HH===u\....          6 ~~~~~~H==gg==H~~~~~~
 5 ...H====1HH1====H...          7 ~~~~~~\=n22n=/~~~~~~
 6 ...O=====gg=====O...          8 ~~~~~~~\HHHH/~~~~~~~
 7 ...H====1HH1====H...
 8 ...\u===HHHH===u/...
 9 ....\uu=5HH5=uu/....
10 .....\HHHHHHHH/.....
```
**Supply Ship «Nave de Abastecimento»** 30×20, 2 decks:
```
z0
 2 ...../HHHHHHHHHHHHHHHHHH\.....
 3 ..../=====H========H=====\....
 4 .../=uu=1=H==u1=1u=H==1=uu\...
 5 ../=======H=u===u==H=======\..
 6 ..HHHHHOHHO========OHHHOHHHH..
 7 ..O=======H===gg===H=======O..
 8 ..\=======H========H=======/..
 9 ...\=1=uu=H==5=2=5=H=uu=1=/...
10 ....\=====H========H=====/....
11 .....\HHHHHHHHOOHHHHHHHH/.....
z1
 4 ~~~~~~~~~~~~/HHHH\~~~~~~~~~~~~
 5 ~~~~~~~~~~~/P====P\~~~~~~~~~~~
 6 ~~~~~~~~~~/==n43n==\~~~~~~~~~~
 7 ~~~~~~~~~~H===gg===H~~~~~~~~~~
 8 ~~~~~~~~~~\==1==2==/~~~~~~~~~~
 9 ~~~~~~~~~~~\P====P/~~~~~~~~~~~
10 ~~~~~~~~~~~~\HHHH/~~~~~~~~~~~~
```
**Terror Ship «Nave de Terror»** 30×20, 2 decks (6 = terror units: Cyberdisc/Reaper/Chryssalid/Sectopod spawn here):
```
z0
 2 ......../HHHHHHHHHHHH\........
 3 ......./=====6==6=====\.......
 4 ....../====HHHOOHHH====\......
 5 ...../6=1==H======H==1=6\.....
 6 ....O======O==gg==O======O....
 7 ....O======H=2=2==H======O....
 8 .....\1=6==H======H==6=1/.....
 9 ......\====HHHOOHHH====/......
10 .......\=====6==6=====/.......
11 ........\HHHHHHHHHHHH/........
z1
 3 ~~~~~~~~~~~~/HHHH\~~~~~~~~~~~~
 4 ~~~~~~~~~~~/P====P\~~~~~~~~~~~
 5 ~~~~~~~~~~/==n44n==\~~~~~~~~~~
 6 ~~~~~~~~~~H===gg===H~~~~~~~~~~
 7 ~~~~~~~~~~H=3====5=H~~~~~~~~~~
 8 ~~~~~~~~~~\===11===/~~~~~~~~~~
 9 ~~~~~~~~~~~\P====P/~~~~~~~~~~~
10 ~~~~~~~~~~~~\HHHH/~~~~~~~~~~~~
```
**Battleship «Couraçado»** 30×30, 2 decks:
```
z0
 3 ......../HHHHHHHHHHHH\........
 4 ......./==============\.......
 5 ....../==1uu6uu1=======\......
 6 ...../==================\.....
 7 ..../========4==1========\....
 8 .../======================\...
 9 ...HHHHHOHHHHHOOHHHHHHHHOHH...
10 ...H=======H======H=======H...
11 ...H=u5=u==H=1==6=H=u2=u==H...
12 ...O=======O==gg==O=======O...
13 ...H==1=u==H=1====H=u=1===H...
14 ...H=======H======H=======H...
15 ...HHHHHOHHHHHOOHHHHHHHHOHH...
16 ...\======================/...
17 ....\===1=6========6=1===/....
18 .....\=======1==1=======/.....
19 ......\================/......
20 .......\==============/.......
21 ........\HHHHHOOHHHHH/........
z1
 7 ~~~~~~~~~~~/HHHHHH\~~~~~~~~~~~
 8 ~~~~~~~~~~/========\~~~~~~~~~~
 9 ~~~~~~~~~/===n44n===\~~~~~~~~~
10 ~~~~~~~~/=P========P=\~~~~~~~~
11 ~~~~~~~~H============H~~~~~~~~
12 ~~~~~~~~H===3=gg=2===H~~~~~~~~
13 ~~~~~~~~H============H~~~~~~~~
14 ~~~~~~~~\=P========P=/~~~~~~~~
15 ~~~~~~~~~\==1=34=5==/~~~~~~~~~
16 ~~~~~~~~~~\========/~~~~~~~~~~
17 ~~~~~~~~~~~\HHHHHH/~~~~~~~~~~~
```
(The generator in `scratchpad/bp/gen.js` produced/validated the three big hulls; small ones are in `.../bp/tpl.js`.)

Spawning: aliens pick nodes by rank preference (orig `Node::nodeRank`): commander/leader 4,3,2,5,1; engineer 2,4,3,1; medic 5,1,3,4; navigator 3,4,2,1; soldier/terror 1,6,2,3 then outside (rank 0) per `outside%`. Ties broken by `prio` then RNG.

---

## 8. LOS, lighting and shot tracing (concrete, integer-only)

**Units of measure**: tile = 16×16×24 voxels; voxel coords `vx = x*16 + lx` etc. Unit heights: soldier 22 standing / 14 kneeling, Sectoid 16/12, Floater 18, Muton 22, Chryssalid 20, large units 24 over 32×32 voxels. Eye voxel = floor level + height − 2. Object heights 8/12/16/24.

**Light map** (`LOS.computeLight`, recompute on tile destruction, fire change, flare landing, burning unit; < 1 ms on 50×50×3):
1. `ambient = 15 − globalShade` (day 0 ⇒ 15; dusk 6 ⇒ 9; night 13 ⇒ 2). By day, tiles with a floor or roof somewhere above them get ambient − 2.
2. Point sources (fire 15, flare on ground 15, burning unit 15, lamps 12, UFO `P`/consoles 10): for |dx|,|dy| ≤ power, every z: `v = power − ISQRT[dx*dx+dy*dy]` (precomputed integer table), `light = max(light, v)`.
3. `shade = 15 − light`; drawn as a per-tile dark overlay (§16); `shade > 9` ⇒ "dark tile".
globalShade at mission start from the Geoscape sun elevation at the site: elevation > 0° ⇒ 0; −6°..0 ⇒ 6; < −6° ⇒ 13. Fixed: alien base 10, Mars 13 (orig 15), base defence 5.

**Field of view** (`LOS.fov(unit)`; recompute for the acting unit after every step/turn; for all units after terrain/smoke/light change):
1. Candidate tiles: dx²+dy² ≤ 400 inside the 90° wedge (cardinal facing ⇒ triangle `|lateral| ≤ forward`; diagonal ⇒ quadrant), every z.
2. Tile line: integer 3-D Bresenham from the eye tile to the candidate (longest-axis stepping). At each step A→B: blocked if `edgeBlocks(A,B,LOS)` (west/north wall parts with `blockLOS` on the crossed edge; a diagonal step checks both orthogonal sub-paths and is blocked only if both are blocked — orig per-direction table), if B is a full-block object (unless B is the target), or a vertical step crosses a LOS-blocking floor. Smoke budget: `cost3 += 3 + smoke(B)` (non-burning tiles); stop when `cost3 > 60` (= 20 tiles).
3. Player only: every traversed tile gets `disc|=1` and `visTiles=1`; the east neighbour gets `disc|=2` (its west wall), the south neighbour `disc|=4`.
4. Units in visible candidate tiles: `canSee(viewer, target)` = in range, darkness rule (X-COM viewer and `dist > 9` and target tile shade > 9 ⇒ false; aliens ignore light), and **height-sampled line**: for samples at target heights {top−2, mid, bottom+4} (and lateral ±4 voxels for the mid sample) trace in voxel space with step = 4 voxels, failing on any floor/wall/object voxel box (object box = centred 12×12 footprint, or full tile if `fullBlock`, height = def.height). Any sample passing ⇒ visible. This gives real partial cover (kneel behind a h12 crate and you are hidden from far shooters).
5. Return `spotted` = units newly visible this turn ⇒ the walk generator interrupts the path (`unitsSpottedThisTurn` grew).
Side visibility = union over side units. At each side's turn start, all enemy units are re-hidden then FOV recomputed (orig).

**Shot trace** (`LOS.traceShot`): origin = shooter eye voxel (+ muzzle offset 4 toward target); target = `deviate(...)`; extend to 30 tiles; integer 3-D Bresenham in voxels with step 1 (≤ 480 steps). At each voxel: out of map ⇒ none; floor box (lz < 2 and floor present, or z-level boundary) ⇒ floor hit; west wall box (lx < 2) / north wall box (ly < 2) when the part exists (windows too: they break) ⇒ wall hit; object box ⇒ object hit; any unit cylinder `(lx−8)²+(ly−8)² ≤ 25` (large: radius 12 over 2×2) and `lz ≤ height` (skip the shooter) ⇒ unit hit. Player LOF check (`targetVoxel`): if the undeviated line hits something other than the target first, the shot is refused («Sem linha de tiro») unless Ctrl/force.
Hit-chance preview = 100 traces with the `ui` RNG stream, cached per (shooter pos, stance, mode, target); ≈ 2–4 ms.

**Explosions** (`Combat.explode`): precompute, once at load, integer Bresenham rays from (0,0) to every perimeter tile of the square of radius R for R = 1..11. For each ray step: `p -= 10` per tile, `p -= 2·heBlock` of the wall crossed and of a full-block object entered; fire rays −5 extra on diagonals; keep the max power per tile (same z). Ours (vertical polish): also apply `p − 30` to the floor part of tiles at z+1 above tiles with p > 30 (blow holes in ceilings; units above are not hurt — orig). Then per tile: HE ⇒ units RNG(50,150) % of p (ground-zero 3×3 hits UNDER armour), items destroyed if p > item armour (unconscious body destroyed ⇒ unit dies), terrain `detonate`: destroy parts while `2·armour ≤ remaining`, subtracting 2·armour each, following die chains; leftover > 2·flammability ignites; destroyed parts emit smoke 5. STUN ⇒ 0–200 % stun. SMOKE ⇒ smoke RNG(7,15). IN ⇒ fire + smoke + RNG(5,10)×mod and ignition. Chain explosions (power sources, cars) queue `explode` events after the current one. Then `applyGravity` on affected columns and `LOS.computeLight` + `LOS.refreshAll`.

---

## 9. Pathfinding
- Port OpenXcom `getTUCost` semantics with our parts: destination floor TU + object TU; diagonal `floor(cost×3/2)`; plus averaged wall costs crossed (rubble walls have TU); blocked by 255 parts, closed walls per direction table (N: start.north; NE: start.north, NE.west, E.west, E.north; E: E.west; SE: E.west, S.north, SE.north, SE.west; S: S.north; SW: start.west, S.west, S.north, SW.north; W: start.west; NW: start.west, start.north, W.north, N.west), full-block objects, visible enemy units / any friendly unit; no corner cutting.
- Vertical edges (dir 8/9): gravlift (8 TU), stairs s↔S (6 TU, 3 energy), flight (flying units/armour: 8 TU; target tile has no floor between or the source has no roof). Walking off a ledge onto `~` ⇒ the unit falls to the floor below (0 TU, fall animation, 0 damage — orig).
- Doors: swing doors on the path are opened automatically by the walk (door TU 4 charged, door becomes `alt`), UFO doors opened by walking into them (4 TU, then step).
- 2×2 units: all 4 tiles must pass with same z; cannot use stairs or swing doors (orig); flyers (Cyberdisc) can change level.
- AI bias: burning tiles +32 in search only (orig); `sneaky` option ×2 cost on tiles visible to X-COM (P1).
- A*: binary heap (from `command-2026/path.js`), generation stamps, 3-D index, heuristic `4·max(|dx|,|dy|) + 2·min(|dx|,|dy|) + 8·|dz|` (admissible octile), straight-line fast path first on same z. `reachable()` = Dijkstra bounded by TU and energy (`energy ≥ cost/2`), returns cost + parent arrays (≤ 7 500 nodes, < 3 ms). Recomputed after every action of the selected unit; hover path reconstructs from parents instantly.

---

## 10. Action queue, animation, hidden alien movement

Design: **sim actions are generators**. `OV.Act.perform(B, action)` returns a generator that mutates `B` *one atomic step at a time* and `yield`s an event describing what just happened (state is already updated when the event is yielded). The presenter awaits each event's animation before calling `next()`; headless code just drains the generator. Because the sim never waits on anything the presenter does, determinism and Node testability are guaranteed, and the renderer can read `B` directly (no mirror state), using the current event's tween to draw the in-between frame.

Event types (all carry `vis:boolean` = visible to the player at that moment, plus `pos` for camera):
`step{unitId, from, to, dir}`, `turn{unitId, from, to}`, `kneel{unitId, down}`, `door{i, part, kind}`, `spotted{unitId, by}` , `interrupt{reason}`, `shot{shooterId, weapon, mode, path:[voxel…], hit}`, `throw{unitId, itemId, arc:[voxel…], land}`, `impact{voxel, kind}`, `explosion{voxel, radius, dmgType}`, `damage{unitId, amount, armourHit, wounds}`, `stun{unitId}`, `death{unitId, cause}`, `tile{i, part, defId}`, `fall{unitId, fromZ, toZ}`, `fire{i}`, `smoke{i}`, `morale{unitId, kind:'panic'|'berserk'|'freeze'}`, `psi{attackerId, targetId, kind, success}`, `reaction{reactorId, targetId}`, `pickup/drop`, `zombify{unitId}`, `spawn{unitId}`, `turnStart{side, turn}`, `message{key, params}`.

Walk generator (core of the feel):
```
for each step dir in path:
  cost = Path.stepCost(...); if !cost or unit.tu < cost.tu + reserve or unit.energy < cost.energy: yield interrupt('noTU'); return
  open door if needed → yield door
  move unit (unitAt update), tu -= cost.tu, energy -= cost.energy, motion += 30
  yield step
  {spotted} = LOS.fov(B, unit); for each newly spotted by the player: yield spotted
  yield* Act.reactions(B, unit)            // may kill the mover → return
  if unit dead/out: return
  if spotted.length && !action.desperate: yield interrupt('spotted'); return   // TU kept
  check proximity grenades (P1)
```
Reaction loop (`Act.reactions`): compute spotters and scores; while best ≥ mover's score: `yield reaction`, then `yield* shoot(reactor, snap, mover)`; recompute.

Presenter (`ui/presenter.js`):
```
async play(gen, {side}) {
  input.lock(); let hidden = 0
  for (let r = gen.next(); !r.done; r = gen.next()) {
    const ev = r.value
    if (!ev.vis) { hidden++; if (side !== 'xcom') ui.showHiddenMovement(true); continue }   // fast-forward: zero time
    ui.showHiddenMovement(false)
    if (ev.pos && !camera.onScreen(ev.pos)) await camera.panTo(ev.pos, 280 / speed)        // ease-out cubic
    await anim[ev.t](ev)          // durations below ÷ speed
    hud.refresh(ev)
  }
  input.unlock()
}
```
Durations at speed 1: step 240 ms (8 phases × 30 ms, orig), turn 60 ms per 45°, door 280 ms (UFO door 7 frames), bullet ~30 tiles/s, laser beam 150 ms fade, plasma bolt 18 tiles/s, thrown item parabola 450–800 ms, explosion 400 ms rings + ring-delayed tiles 40 ms/tile, death 500 ms, spotted sting 350 ms pause + red exclamation over the alien. Speed settings: X-COM ×1/×2/×4 and Aliens ×1/×2/×4 separately (orig has both); holding **Space** or clicking during playback = ×8; every alien turn shows a top banner «Movimento Oculto…» while hidden events stream, and the camera only moves for visible events (orig "Hidden Movement" without blanking the screen — polish). Turn change banner: «Turno 5 — Forças X-COM» 900 ms (skippable).

Alien turn driver: `Battle.endPlayerTurn(B)` yields: end-of-turn effects (UFO doors close, fuse-0 grenades explode, chain explosions), `turnStart{side:'alien'}`, panic phase, then `AI.turn(B,'alien')` (each alien up to 3 actions, then a second pass for aliens with TU ≥ 20), civilians, round upkeep (fire/smoke/regrowth), `turnStart{side:'xcom'}`, X-COM upkeep/panic. Autosave fires when the presenter returns at the start of the player turn.

---

## 11. Alien AI (decision procedure, `sim/battle/ai.js`)

Per alien, per AI pass (≤ 3 actions per alien, ≤ 2 passes; stop when TU ≤ 5 or action fails):

0. **Context**: `known` = X-COM units with `turnsSinceSpotted ≤ intelligence` (memory: reset to 0 when any alien sees them, when they hit or kill an alien; +1 at each X-COM turn start). `cheat` = turn > CHEAT_TURN (12/10/8 by difficulty; orig 20) or (turn > CHEAT_TURN/2 and live aliens ≤ 2) ⇒ every X-COM unit is known and mode is forced to COMBAT; all aliens leave the UFO. `visible` = known units this alien sees now. `spotters` = X-COM units that can see this alien. `reach = Path.reachable(tu)`, `reachAtk = reachable(tu − attackTU)` where attackTU = snap TU (rifle class), aimed (blaster), 15 (melee).
1. **Re-evaluate mode** if: patrol and (any visible/known enemy or 10 % random); ambush and (no gun, no ambush spot, or enemies visible); combat and last attack failed; escape and nobody spots it; always if spotted by > 2, HP < 2/3, aggro target lost, or cheat.
   Weights: base escape 15 (12 melee; 5 if TU > 50 %), ambush 12, combat 20, patrol 30 (15 if sees enemies; 0 if spotted). Current mode ×1.1 (combat→ambush ×1.5). HP < 1/3: escape ×1.7, combat ×0.6, ambush ×0.75; < 2/3: ×1.4/×0.8/×0.8; hurt: escape ×1.1. Aggression 0: escape ×1.4, combat ×0.7; 1: ambush ×1.1; 2: combat ×1.4, escape ×0.7. Spotted by N: escape = 10·esc·(N+10)/100, combat = 5·cmb·(N+20)/100; none: escape /2. Visible V: combat ×(V+10)/10; closest enemy < 5 tiles ⇒ ambush 0. Exactly 1 known: combat ×1.2; none known: combat = escape = 0. Ambush needs a found ambush tile (×1.7) else 0; melee/blaster units never ambush. No weapon/grenade/psi ⇒ combat = ambush = 0. Weighted roll with `rng.ai`; fallback COMBAT→PATROL→AMBUSH→ESCAPE.
2. **COMBAT**:
   a. Psi (Sectoid Leader/Cmdr, Ethereals) if TU > reserve + 25: target score `psiAttackStrength − 0.4·psiSkill − dist − psiStr + RNG(55,105)` over known units; if a visible target exists and weapon power ≥ score, shoot instead; else attempt if `RNG(35,155) < score` (Panic; Mind Control P1 with orig controlOdds).
   b. Melee units (Chryssalid, Reaper, Zombie): if a known target is reachable with ≥ 15 TU left ⇒ walk adjacent (desperate = true, no interrupt) and attack; Chryssalid prefers civilians/low-armour, then nearest.
   c. Grenade/blaster (turn ≥ 3): for each candidate target tile among visible/known units, `efficacy = desperation + difficulty/2 + enemiesInRadius − 2·friendsInRadius − 4·selfInRadius` (desperation = (100−morale)/10, +3 if HP < 1/3); need > 0 and (≥ 2 enemies or desperation ≥ 6); never at flyers; never at a tile already grenaded this turn. Cost 4 + 50 % + 25 % TU.
   d. Shot at the best visible target (lowest HP·armour, prefer targets that can't see it): fire mode by distance — < 4 tiles: auto > snap > aimed; > 12: aimed, or snap if < 20; else snap > aimed > auto — whichever TU allows (after keeping reserve 0 in combat).
   e. If no visible target (known only) and (spotted or `aggression < RNG(0,3)`): **find fire point** — sample up to 60 tiles from `reachAtk` within an 11×11 box around self, score = `100 − tuCost + 20·(target visible from tile) + 10·(cover: adjacent wall/object between tile and target) − 30·(tile visible by > 1 X-COM) − 40·burning`; walk there (normal interrupt rules), then shoot if possible.
3. **AMBUSH** (gun units): candidate nodes ≤ 10 tiles away, same z, in `reachAtk`, not dangerous, not visible to the aggro target; score `100 − TU to reach + 25·(window adjacent)`, accept immediately > 80; walk, face toward the expected X-COM approach (direction of the nearest known unit's path), end turn keeping TU (reaction fire).
4. **ESCAPE**: sample up to 150 reachable tiles (random order), score `100 − 10·spottersThatSee − 40·burning + 2·distanceFromNearestEnemy`; walk desperate; turn 180°; end turn.
5. **PATROL**: if on a rank-0 node or cheat/fire ⇒ scout: pick any random reachable node; else move along nearby nodes preferring higher `prio` and own rank; avoid nodes marked dangerous (an alien was shot there this turn) and grenade danger zones. Reserve TU by aggression (0 aimed, 1 auto, 2 snap) for reaction fire.
6. **Pick-up**: an unarmed alien with ammo/weapon on its tile or ≤ 3 tiles away picks it up.
7. **Spawn facing**: face a window if adjacent, else with chance 20 %·coef face the X-COM craft if ≤ 20 tiles.
8. **Civilians**: escape-only AI from aliens they see (or within 6 tiles); otherwise random short walk; never shoot.
9. **Terror units special**: Cyberdisc/Sectopod use ranged; Reaper/Chryssalid always combat; Chryssalid hit ⇒ target becomes Zombie (if alive) and zombie death spawns a Chryssalid (orig).
10. **playerBot** (headless tests only): same procedure with side swapped, aggression 1, intelligence 10, using flares at night, retreating when HP < 1/3; used for balance sweeps, not shipped to players.
Performance budget: ≤ 20 ms sim per alien action on a 50×50×3 map in Node.

---

## 12. Geoscape design
- **Globe**: orthographic, land from Natural Earth 110 m (world-atlas 2.0.2 npm tarball, public domain) decoded to `js/data/world.js` (`land` 1-decimal ≈ 20 KB gz + 16 funding-country outlines ≈ 3 KB gz; pre-decoded files in `scratchpad/worldmap/dl-out/land110_d1.json` and `scratchpad/worldmap/dl-out/funding16.json`; fallback 30 coarse polygons already in the web report). Fill with the limb-collapse + antipode-parity `evenodd` method (verified), strokes only on front-facing segments, densify to ≤ 2° at load, precomputed unit vectors (9 multiplies per point). Ocean radial gradient lit toward the sun, limb darkening, night = 90° small circle around the antisolar point (rgba(0,0,40,.55)) + twilight rings, graticule faint, radar circles dashed (1 695 nm = 28.25°, 2 577 = 42.95°, craft 672 = 11.2°), great-circle paths for crafts, UFO blips (red, blinking), sites (terror red skull, crash orange), alien base (purple, once discovered), bases (blue square), cities as small dots at zoom ≥ 3. Cache to an offscreen canvas when static; redraw on rotate/zoom/time tick (≤ 10 Hz).
- **Coordinates**: rules convert OpenXcom lon 0–360 / lat-negative-north to normal lon −180..180, lat north-positive at load (`geo.js` stores the converted rectangles, cities, 15 regions, 16 countries).
- **Movement**: crafts/UFOs move `speed·5/3600` nm per tick along the great circle (`gmath.stepToward`); crafts chase a predicted intercept point; UFO waypoints from trajectories; landings `groundTimer×5 s`.
- **Zones**: zones 0–2 and 4 = random **land** point in the region rectangles (retry 10×, else ocean ⇒ immediate take-off, orig); zone 3 = city list; zone 5 = random point 25–35° from the region centroid (entry/exit).
- **Detection** every 30 min (orig rule, our chances): base radars in range sum chance × (100 + visibility)/100; airborne craft radar automatic in range; detected UFO stays detected while inside any radar; lost otherwise («OVNI perdido»).
- **Interception**: «Interceptar» button ⇒ list of ready craft in the base ⇒ pick target UFO/site/point; on contact a dogfight overlay (DOM panel + small canvas) with distance bar, mode buttons «Distância / Cauteloso / Normal / Agressivo / Desengatar», weapon toggles, ammo/HP bars, damage flashes; ≤ 2 simultaneous dogfights in MVP (orig 4).
- **Landing**: transport reaching a crashed/landed UFO, terror site, alien base ⇒ «Iniciar missão?» ⇒ briefing (terrain, time of day, expected race if hyper-detected) ⇒ equip ⇒ battle. Empty transports return.
- **Events / popups** (all pause + drop to 5 s): UFO detected (type/size/altitude/heading/speed), UFO lost, landed, crashed, craft low fuel, craft arrived/returned, research complete (opens Ufopaedia article + «novos projetos disponíveis»), production complete, facility complete, terror site (red, siren), alien base discovered, retaliation incoming, monthly report.
- **Camera**: drag or two-finger scroll rotates (Δlon = −dx/R, Δlat = +dy/R clamped ±89°), pinch / Ctrl+wheel / +− zoom through 6 radii (0.45/0.60/0.90/1.40/2.25/3.60 × height, orig) with smooth steps; double-click or Option-click centres; arrow keys rotate; auto-centre on events.
- **Right panel** (DOM): date/time «1 Jan 1999 12:05», funds, speed buttons, «Interceptar», «Bases», «Ufopédia», «Financiamento», «Opções»; lists of active UFOs/sites with click-to-centre (polish).

---

## 13. Basescape and management screens
- 6×6 grid canvas (procedural facility art) + DOM side panel with tabs «Instalações / Investigação / Produção / Pessoal / Armazém / Naves / Soldados / Mercado / Contenção».
- Build: pick facility from list (cost/days/upkeep shown, greyed if unaffordable or gated) ⇒ ghost placement with green/red validity (adjacency to lift-connected network) ⇒ confirm. Dismantle only if connectivity survives.
- Research: list of available topics; per-project scientist slider (+/− 1/5/all free); progress label; «Novo projeto» popup after completion. Interrogations appear as topics per live alien in containment.
- Production: list of manufacturable items with eng-h, cost, materials, space; quantity (or «contínuo»); engineers slider; warning when funds/materials are short (production stalls, orig).
- Market «Mercado»: buy (delivery ETA), sell (from stores), hire/sack personnel; storage and quarters capacities shown live.
- Soldiers: sortable table (rank, name, missions, kills, TU, HP, Firing, Reactions, Bravery, wounds), detail page with stat bars (initial vs current), rename, armour picker, memorial.
- Craft: status, fuel/HP/weapon/ammo, assign soldiers (seats), equipment loadout «Equipar» (per-soldier template + auto-equip), weapons fitting (Interceptor/Firestorm: Stingray/Avalanche/Cannon/Laser/Plasma).
- Monthly report «Relatório Mensal»: month rating with label, council text, funding change per country (green/red arrows), income vs upkeep, warning lines (debt, consecutive bad month).
- Ufopaedia «Ufopédia»: sections (Naves X-COM, Armamento de Naves, Armas e Equipamento, Instalações, Formas de Vida Alienígenas, Investigação Alienígena, Componentes OVNI, OVNIs); article = procedural illustration + generated stats table from rules + 2–4 sentences pt-PT (helper agent writes text).

---

## 14. Campaign pacing for 2–4 hours (tuning targets, verified by the campaign bot)
| Phase | Game time | Expected player activity | Real-time budget |
|---|---|---|---|
| Opening | Jan 1–20 | place base, start Laser/Medi-Kit research, hire 10 scientists, first Small/Medium Scout crash (tutorial-like, Sectoids, day) | 20–30 min |
| Escalation | Jan 20 – Mar | 4–6 battles (scouts, an Abductor/Harvester, first terror site with Floaters/Reapers), alloys/elerium/power source research, personal armour, laser rifles, 2nd lab, workshop | 60–80 min |
| Crisis | Mar – Apr | Snakemen + Chryssalid terror, Mutons, Supply Ship, alien base discovered and assaulted (commander captured), Firestorm built, retaliation threat | 50–70 min |
| Endgame | Apr – Jun | Ethereals, Battleship, Martian Solution + Cydonia, Avenger, final mission | 30–50 min |
Targets: ~12–16 battles, median battle 9–14 player turns, 8–12 min each; win by game month 4–6 on Recruta/Veterano with ≥ 50 % of runs by the bot never hitting council defeat when the bot plays terror sites; Super-humano may take 4 h+ or be lost. Compressions that achieve this: research ×0.25, manufacture ×0.1–0.2, facility days ×0.4, wave timers ×0.5, race/tech schedule ×~2 speed, bigger radar chances, guaranteed alien base in month 1–2, faster wound recovery, smaller maps/crews, cheat turn 8–12.

---

## 15. UX and controls spec (Mac-first; trackpad, mouse, keyboard; touch-tolerant)

### 15.1 Battlescape pointer
| Gesture | Effect |
|---|---|
| Hover tile | Path preview: dots per step coloured **green** (keeps reserve), **yellow** (eats reserve), **red** (unreachable/out of TU or energy); destination label «UT 23/54 · En 40»; two-colour reachable outline (green = can still fire reserved shot, yellow = reachable). With reserve None, green uses the snap shot (orig uses auto; ours snap — friendlier). |
| Click (primary) on own soldier | Select (viewZ jumps to the soldier's level) |
| Click on tile | Move. Default «Confirmar movimento» **ON for trackpads** (first click locks the preview, second click on the same tile walks; Esc/secondary cancels); OFF for mouse (auto-detected, user setting) |
| Secondary: right button, Ctrl+click, two-finger tap (`contextmenu`, always `preventDefault`), long-press on touch | Turn to face (1 TU/45°) / cancel targeting or move lock |
| Option+click on door | Open door without entering |
| Click hand slot (or Q/E) | Action menu: «Tiro Rápido / Apontado / Rajada / Lançar / Preparar granada / Atacar / Usar» each with TU cost and Acc %; greyed if unaffordable; digits 1–5 pick |
| In targeting mode, hover target | Cursor shows «Acerto ≈ 38 %» (Monte Carlo), TU cost, red ✕ if no line of fire, stray-risk hint if a friendly is on the line («Risco: aliado na linha») |
| Ctrl/Cmd+click in targeting | Force fire at tile/wall |
| Two-finger scroll / middle-drag / Space+drag | Pan |
| Pinch / Ctrl+wheel (Chrome pinch) / Safari `gesturechange` / +− | Zoom (0.5–2, snaps to 0.5/0.75/1/1.5/2 at gesture end) |
| Mouse wheel notch (detected) | Change level (setting: or zoom) |
Edge scroll: OFF by default (laptop), option. Wheel `preventDefault` + `overscroll-behavior:none` to block swipe-back navigation.

### 15.2 Battlescape keyboard
| Key | Action |
|---|---|
| Tab / Shift+Tab | Next / previous soldier with TU |
| Space | «Feito» (mark soldier done, next) — during playback: fast-forward ×8 |
| K | Kneel / stand |
| I | Inventory |
| R | Reload (15 TU) |
| Q / E | Left / right hand action menu |
| F | Fire again with last mode at last target |
| G | Quick grenade (prime fuse 0 + throw best belt grenade; shows total TU) |
| L | Throw flare (if carried) |
| C or H | Centre on selected |
| `,` `.` or Shift+↑ / Shift+↓ (also PgUp/PgDn) | View level down / up |
| Arrows / WASD | Pan (600 px/s, accelerating) |
| 1 … 0 | Centre on visible alien n (red numbered buttons on the HUD) |
| Shift+1..4 (and F1–F4) | Reserve None / Snap / Aimed / Auto; Shift+5 (J) reserve kneel |
| M | Minimap |
| Enter or ⌫ (Backspace) | End turn (confirm if any soldier can still move ≥ 4 tiles or snap: «Ainda há soldados com UT. Terminar turno?» + «não voltar a perguntar») |
| Esc | Cancel mode → close menu → options menu |
| Never bound | Cmd+W/Q/R/T/1–9, Cmd+arrows (browser-reserved on Mac) |

### 15.3 Battlescape HUD (DOM overlay, bottom)
Left: selected soldier card — rank badge, name, TU/Energy/Health(+stun overlay)/Morale bars with numbers, status icons (ajoelhado, a sangrar ×n, em pânico, a arder); hand slots R/L with item icon + ammo; buttons: nível ↑/↓, ajoelhar, inventário, centrar, próximo, feito, mapa, reservas (4 + kneel), terminar turno, abortar (only when units are on craft tiles or always with warning). Right edge: red numbered visible-alien buttons. Left edge: squad strip (all soldiers: mini TU/HP bars, click select, double-click centre). Toasts (top) for events («Alienígena avistado!», «Sem unidades de tempo», «Sem linha de tiro», «Soldado X ferido mortalmente»). Tooltips with shortcut on every button; all text pt-PT.

### 15.4 Inventory overlay
Paper-doll list layout: Hands (2 big slots), Belt (4-unit bar), Backpack (9-unit bar), Ground list (scroll). Drag-and-drop (pointer events) or click-item-then-click-slot (trackpad friendly); TU cost previewed on hover/drop target («−8 UT»), red when unaffordable; weight vs strength meter; reload by dropping a clip on a weapon; medikit opens a body-part panel (head/torso/arms/legs with wound counts) with Curar/Estimulante/Analgésico.

### 15.5 Geoscape & Basescape input
Drag/two-finger scroll rotate globe; pinch zoom; click select (UFO/site/base/craft) ⇒ info card; double-click/Option-click centre; keys 1–6 speeds, P or Space pause/resume (toggles 5 s ↔ last speed... pause = stop sim, ours), I intercept, B bases, U Ufopaedia, F funding, Esc options. Basescape: click grid cells; keyboard tabs 1–9 for panel tabs.

### 15.6 Touch tolerance
Tap = click, long-press (450 ms) = secondary, two fingers pan/pinch; hover-dependent previews appear on first tap (two-step confirm forced ON for touch); `(hover:none)` suppresses tooltips; minimum target 32 px.

---

## 16. Rendering & art direction
- Iso: `TW 64, TH 32, LH 48` CSS px at zoom 1 (2× OpenXcom proportions); `sx = (x−y)·32`, `sy = (x+y)·16 − z·48`; inverse per level (web report A1). DPR cap 2, `ResizeObserver`, DPR media-query watcher, sprite blits snapped to device pixels, floor diamonds expanded 0.5 device px.
- Draw order: for z = 0..viewZ: pass 1 floors (+ per-level light/fog overlay drawn as an affine-transformed 1-px-per-tile canvas with bilinear smoothing), pass 2 diagonal sweep `s = x+y`: west wall, north wall, items, units anchored at this tile (moving unit anchored to the tile with larger x+y of from/to; 2×2 to its front-most cell), object (front bigWall-style objects after units), smoke/fire, selection cursor; then projectiles/FX/path numbers on top. Levels above viewZ are not drawn (cut-away); levels below are darkened 12 % per level (polish). Picking drops through levels from viewZ to find a floor/unit (setting to pin to viewZ).
- Fog: undiscovered tiles black; discovered-but-not-visible tiles drawn with remembered parts at 55 % dark + desaturate; enemy units only drawn when visible.
- Procedural vector sprites (no assets): parameterised by part role + tileset palette + damage state + variant `hash(x,y,z)`; units: 8 directions × poses (stand, walk 4 frames, kneel, aim, fall, dead) drawn as layered silhouettes coloured by armour; aliens with distinctive silhouettes (Sectoid big head, Floater with hovering skirt, Snakeman tail, Muton bulk, Ethereal robe, Chryssalid crouched, Cyberdisc disc, Sectopod walker, Reaper quadruped). Cache key `${kind}|${id}|${variant}|${state}|${dir}|${frame}@${dpr*zoom}`, silhouette canvas for shading (`blitShaded`, 16 shade levels, night tint rgb(5,10,30)).
- FX (render-owned): muzzle flash, tracer trails, laser beams, plasma bolts, explosion rings + debris + scorch decals, smoke puffs (3 density buckets), flames (3 frames, additive glow), blood/ichor decals, camera shake (cap 8 px), flare glow (radial gradient, `lighter`).
- Palette: dark navy UI (#0b0f14 family from the hub) with X-COM amber/teal accents; terrain palettes per tileset (farm greens, desert ochres, polar whites, urban greys, UFO alloy grey-blue, alien base purple, Mars rust).
- Performance targets (M1 Air, 1280×800 @2×): battlescape ≥ 50 fps while panning a 50×50×3 map, draw < 8 ms; globe redraw < 6 ms; idle CPU near zero (render on demand).

---

## 17. Audio plan (reuse `command-2026/js/audio.js` engine)
- Engine kept: lazy `AudioContext` on first gesture, compressor, `noise()`/`tone()` primitives, MIN_GAP per name, ≤ 24 voices, positional pan from camera, speech via `speechSynthesis` (pt-PT voice) **off by default** (option «Voz»).
- SFX recipes (~34): UI click/confirm/deny buzz («sem UT»), select blip, footsteps per floor class (earth, wood, metal, alloy) quiet, door creak, UFO door hiss, kneel rustle, pistol/rifle/heavy cannon/autocannon bursts (filtered noise + low thump), rocket launch whoosh, laser zap (saw sweep), plasma bolt (FM wobble), stun rod crackle, grenade pin/throw/bounce, explosion small/large (noise burst + sub-drop), fire crackle loop, glass break, wall crumble, alien death screech per race (formant sweeps), soldier hit/death grunt (filtered noise, no voice), **alien spotted sting** (iconic two-note dissonant stab), reaction-fire alert, medikit beep, psi warble, Chryssalid skitter, Geoscape: UFO detected klaxon, radar ping, research complete chime, dogfight cannon/missile, monthly report fanfare (minor).
- Music (generative, 16-step sequencer from the RTS): Geoscape — slow pulsing minor pad + sparse bell arpeggio (70 BPM); Battlescape — low drone + irregular metallic hits, intensity layer added when aliens are visible; Terror — faster ostinato; Victory/defeat stingers. Separate volumes (master, SFX, music), mute on `visibilitychange`.

---

## 18. Save game
- Storage: `localStorage` keys `ovni1999.settings`, `ovni1999.save.auto`, `ovni1999.save.autoTurn`, `ovni1999.save.1..3`, each a JSON string; all access in try/catch; quota error ⇒ toast «Espaço insuficiente — exporte o jogo» and offer export. «Exportar» downloads `ovni1999-<date>.json` (Blob + `<a download>`); «Importar» reads a file (`<input type=file>`), validates `game` and `schema`, runs migrations.
- Shape:
```js
{ game:'ovni-1999', schema:1, savedAt:'2026-10-29T12:00:00Z', label:'Mar 1999 — Base Lusitânia', build:'<stamp>',
  campaign: G /* §6, without G.events and without derived caches */,
  battle: null | { ...B without B._, map typed arrays as base64 strings: {parts:'…', fire:[[i,v]…], smoke:[[i,v]…], ufoDoorOpen:[i…], disc:'…'} } }
```
- Sizes: campaign 50–150 KB; battle 50×50×3×4×2 B = 60 KB base64 ≈ 80 KB + units/items ⇒ < 300 KB per slot (fits 5 MB).
- Rules: save only when no action generator is active and no dogfight is mid-tick; autosave each player turn start (battle) and Geoscape days 1/10/20; load ⇒ `rebuildDerived` (unitAt, light, FOV, reachable) ⇒ hash check in debug mode.

---

## 19. QA plan
1. **Unit tests** (`node ovni-1999/tools/test.js`): colour helpers; RNG state round-trip; block compiler (every block: widths, legend chars, gravlift/stairs pairs, flood-fill reachability of nodes from craft); pathfinding fixtures (wall direction table, diagonal cost 6, stairs, gravlift, doors, 2×2); accuracy formula examples (Firing 55 rifle: snap 33, kneel 37; aimed 60, kneel 69; auto 19); deviation distribution sanity (60 % at 6 tiles ⇒ 76–86 % hit); damage roll ranges and armour degradation; explosion falloff and wall blocking; reaction-fire ordering fixture; morale/panic numbers; dogfight hit-chance table §3.13; funding change function; research/production daily/hourly arithmetic; sim-file forbidden-token scan (R1).
2. **Determinism & save** (`tools/test.js --det`): 20 seeds × battle 15 turns (playerBot vs AI) ⇒ hash equal across two runs; save at turn 5 ⇒ load ⇒ continue ⇒ equal final hash; campaign bot 60 days twice ⇒ equal hash; JSON size reported.
3. **Balance sweeps** (`node ovni-1999/tools/sim.js battles --ufo all --month 0..4 --seeds 50`): win rate and X-COM losses per UFO type/month for an 8-soldier squad with month-appropriate gear; targets: scouts 95 %+ / ≤ 1 loss; Abductor m1 80 % / ≤ 2; Terror m1 70 % / ≤ 3; Battleship m3 with lasers+armour 70 %; Cydonia with power suits + heavy plasma 60 %; median turns 8–14. `campaign --bot normal --seeds 20`: game day of victory (target 100–170), number of battles (12–18), council defeats (≤ 20 % on Veterano bot).
4. **Invariants checked every event in debug/headless**: no unit inside a full-block tile or without floor (unless flying/falling), `tu ≥ 0`, `energy ≥ 0`, `unitAt` consistent, items owned xor on ground, visible units ⊆ side FOV, no NaN in state, generator never yields after `outcome != null`.
5. **Playwright** (`node ovni-1999/qa/qa.mjs`, Chromium + WebKit): start `python3 -m http.server`, open `/ovni-1999/?debug=1&seed=7`, fail on any `console.error`/`pageerror`; click «Novo Jogo» → difficulty → place base on Lisbon → speed 1 day until UFO popup → intercept → dogfight to crash → send Skyranger → briefing → battle; in battle: select soldier, hover tile (assert path preview element), move, open action menu, snap shot, end turn, wait alien turn, `?battle=small_scout&night=1` direct-load route; save → reload page → load slot → assert same date/funds; screenshots at key steps; perf assertion `OV.debug.perf.drawMs < 8` and fps > 50 at 1280×800 dpr 2; Safari-specific: gesture handlers registered, no `OffscreenCanvas` / `ctx.filter` use (static grep).
6. **Manual Mac checklist**: trackpad pinch/scroll/secondary click in Safari and Chrome, swipe-back blocked, keyboard shortcuts on a MacBook without F-keys, audio starts after first click, night mission readability, colour contrast of path colours.

---

## 20. Build order (milestones; commit + tag each)
| M | Deliverable (playable check) | Helpers in parallel (leaf modules) |
|---|---|---|
| M0 | Skeleton: folder, index.html, CSS tokens, core/util+rng, i18n stub, tuning, scene stack, Node loader + test runner, hub card + sw.js assets, serve.command | i18n string table draft; data tables (items/units/ufos/base/research) typed from §3 |
| M1 | Battle map core: tiles.js + block compiler + UFO/craft/farm blocks, mapgen (FARM + UFO), iso renderer (floors/walls/objects, cut-away, camera, pinch/scroll) — fly the camera over a generated crash site | sprites_tiles (procedural art per tileset), farm/forest/desert blocks |
| M2 | Units + path + presenter: soldiers spawn, path preview with TU colours, walk/turn/kneel generators, doors, levels, stairs/gravlifts, falling | sprites_units (soldier + Sectoid first) |
| M3 | LOS/light/fog: FOV cones, discovery, night + flares, spotting interrupts, HUD (bars, hand slots, visible-alien buttons) | audio recipes |
| M4 | Combat: accuracy, deviation trace, hit-chance preview, damage/armour/wounds/stun, reaction fire, explosions/terrain destruction/gravity, smoke/fire, grenades/throw, reload, medikit, inventory overlay | FX module; urban/alien/Mars blocks |
| M5 | Alien AI + alien turn with hidden movement, civilians, morale/panic/berserk, psi Panic, Chryssalid/zombie, 2×2 units; debrief; **headless battle sims green** | remaining alien sprites; balance sweep scripts |
| M6 | Geoscape: globe render, clock/speeds/popups, missions/trajectories/landings, detection, craft orders, dogfight, crash/landed/terror/alien base sites ⇒ launches battles | world.js build script, geo.js data entry |
| M7 | Basescape: grid build, personnel, market, research, manufacture, soldiers, craft equip, containment/interrogation, Ufopaedia | Ufopaedia texts pt-PT, facility art |
| M8 | Campaign glue: monthly report/funding/council/game over, retaliation (auto-resolve), alien base assault, Martian Solution → Cydonia → victory; save/load/export/import | campaign bot |
| M9 | Polish pass: camera easing, stings, end-turn confirm, tooltips, settings (speeds, confirm-move, edge scroll), accessibility, performance; QA scripts green in Chromium + WebKit | Playwright scenarios |
| M10 | P1 features in order (§4) if time remains | |

---

## 21. Risks (summary; full list in the structured field)
Scope (25k lines) vs one session; iso art legibility of procedural sprites; LOS/LOF correctness and performance; pathfinding edge cases (walls/diagonals/2×2/levels); AI turn duration; balance of compressed campaign; Safari input quirks; save size/quota; determinism across Safari/Chrome for battle replays.

---

## 22. Uncertain / deviations (must stay visible to the team)
**Unverified (UFOpaedia unreachable; values from OpenXcom code/rulesets or analyst memory)**
- Per-tile TU values of original MCDs (4 TU open ground assumed; crops/bush 6 ours).
- UFO hull destructibility in the DOS original (we set outer hull armour 255; inner UFO bulkheads also 255 — original inner walls may be destructible).
- Exact DOS behaviours that OpenXcom changed: reaction-fire formula details, retaliation spawn timing, 4-dogfight limit, crash-site duration (DOS vs 24–96 h), difficulty-reset bug.
- Original interior layouts of each UFO (our templates are recognisable approximations, not MAP-file copies).
- Throw-range formula (ours simplified), explosion vertical handling (orig flat; ours damages the floor above).
- Effective hit-chance table is a Monte Carlo approximation of the OpenXcom model.
- Medi-Kit availability at start in the original (we give 3 in stores).
**Deliberate deviations (ours)**: research/manufacture/facility-time compression; doubled escalation; radar chances 15/30 %; region weighting toward the base; terror site 8–16 h; crash site 24–72 h; seeded alien base; alien base reveal 50 %/month; promotion quotas N/4, N/8, N/15, ≥ 20; wound recovery ×0.5; craft repair 5 HP/h; immediate take-off; personnel delivery 48 h; cheat turn 12/10/8; smaller maps (30–50 tiles, 3 levels) and crews; crashed power-source blast HE 120–180 r6; alloys recovered per UFO type (not per tile); Muton terror slots filled by Muton soldiers (Silacoid/Celatid P1); Lightning cut; Cydonia single stage; 3 difficulty levels; inventory slot model simplified; instant grenades option default ON; grenade fuse 0–5; stairs as vertical links (6 TU); green path colour uses snap reserve; retaliation base defence auto-resolved in MVP.
