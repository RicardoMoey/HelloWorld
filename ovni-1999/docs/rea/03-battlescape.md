# UFO: Enemy Unknown — BATTLESCAPE, deconstructed (numbers, formulas, rules)

**Reference implementation.** I read the OpenXcom source and the xcom1 rulesets directly, so the numbers below come from code, not from memory.
- `bin/standard/xcom1/*.rul`: I compared them byte for byte with current `master` on raw.githubusercontent.com and they are identical. Copies are in `scratchpad/oxc/*.rul`.
- `src/Battlescape`, `src/Savegame` and `src/Mod`: copies are in `scratchpad/oxc/src/`.
- `difficulty.rul` (from master): `scratchpad/dl/vars_test.txt`.

**Sources I could not reach.** ufopaedia.org did not resolve from this session (the session's network settings would have to allow it). I used only search snippets from it, to cross-check a few facts. Anything that rests on my memory of the original DOS game rather than on code is marked (unverified) and listed under "uncertain".

**Conventions.**
- 1 tile = 16×16×24 voxels.
- Maps have 4 levels (z), except bases, which have 2.
- Directions run 0 to 7, clockwise, starting at N (−y).
- "%TU" means a percentage of the unit's **base (maximum) TU stat**, floored.
- `RNG(a,b)` is an inclusive integer roll.

---

## 1. Soldier stats

### 1.1 Rookie generation and caps (`soldiers.rul`)
| Stat | Rookie min | Rookie max | Cap (training) | Notes |
|---|---|---|---|---|
| Time Units (TU) | 50 | 60 | 80 | |
| Stamina (Energy) | 40 | 70 | 100 | |
| Health | 25 | 40 | 60 | |
| Bravery | 10 | 60 | 100 | rolled as `RNG(1,6)*10`, so always a multiple of 10 |
| Reactions | 30 | 60 | 100 | |
| Firing Accuracy | 40 | 70 | 120 | |
| Throwing Accuracy | 50 | 80 | 120 | |
| Strength | 20 | 40 | 70 | |
| Psi Strength | 0 | 100 | 100 | hidden until Psi Lab testing |
| Psi Skill | 0 | 0 at hire (16 = initial training max) | 100 | 0 means no psi |
| Melee (OpenXcom extra) | 20 | 40 | 120 | |

Every stat is uniform in [min, max]. Other soldier facts:
- Cost: $40,000 to hire, $20,000 salary.
- Stand height 22 voxels, kneel height 14.
- 25% of recruits are female.
- Base value (for scoring) is 20, plus missions, plus a rank bonus (Sergeant +1, Captain +3, Colonel +6, Commander +10).
- Every mission starts at morale 100.

### 1.2 Experience counters during a mission (`BattleUnit`)
| Counter | +1 when |
|---|---|
| Firing | A shot or explosion by this soldier damages a **hostile** unit (not melee). This counts every bullet that hits and every hostile caught in a blast. |
| Throwing | Every successful throw, of any item. |
| Reactions | Every time this soldier is chosen as the reaction-fire reactor. |
| Melee | A successful melee hit on a hostile. |
| Psi Skill | +1 per psi attempt; +2 more if it succeeds. |
| Psi Strength | When targeted by psi. Only with the option `allowPsiStrengthImprovement`. |
| Bravery | Each turn-start panic check the soldier passes while the panic chance is above 1% (that is, morale below about 50). |

### 1.3 Improvement rolls at mission end (`postMissionProcedures`)
- **Bravery:** if `expBravery > RNG(0,10)`, then +10. Only while below the cap.
- **Reactions, Firing, Melee, Throwing, Psi Skill, Psi Strength** each get `improveStat(exp)` while below the cap:

| exp | Gain |
|---|---|
| 0 | 0 |
| 1–2 | RNG(0,1) |
| 3–5 | RNG(1,3) |
| 6–10 | RNG(1,4) |
| >10 | RNG(2,6) |

- **"Secondary" growth.** If any of these counters is above 0 — Bravery, Reactions, Firing, Psi Skill, Psi Strength, Melee (note that **Throwing is excluded**, an OpenXcom quirk) — then:
  - TU += RNG(0, (cap−cur)/10 + 2)
  - Health += RNG(0, (cap−cur)/10 + 2)
  - Strength += RNG(0, (cap−cur)/10 + 2)
  - Stamina += RNG(0, (cap−cur)/15 + 2)
  - Each stat grows only while cur < cap, and there is no clamp afterwards, so a stat can overshoot its cap by up to 2.
  - A Rookie is also promoted to Squaddie.
- **Injury recovery:** `RNG(0.5×HPlost, 1.5×HPlost)` days.

### 1.4 Promotions (after each mission; `SavedGame::handlePromotions`)
Quotas depend on the total number of soldiers, N:

| Rank | Quota |
|---|---|
| Sergeant | N/5 |
| Captain | N/11 |
| Colonel | N/23 |
| Commander | 1, only if N ≥ 30 |

- The candidate is the soldier one rank below with the highest score. With the `fieldPromotions` option, only mission participants are candidates.
- Score = 2·HP + 2·Sta + 4·React + 4·Brav + 3·(TU + 2·Firing) + Melee + Throw + Str + [PsiStr + 2·PsiSkill if PsiSkill > 0] + 10·(missions + kills).
- Ranks run Rookie → Squaddie → Sergeant → Captain → Colonel → Commander.

### 1.5 Turn-start recovery (`prepareNewTurn` / `recoverTimeUnits`)
- **TU** = baseTU × min(1, Strength / carriedWeight), then −10% per fatal wound in **either leg**.
- **Energy:**
  - Soldiers regain `initialTU/3` per turn (initial TU, not current).
  - Aliens regain the unit's `energyRecovery` (default 30; many aliens 40, mechanical units 50, Reaper 34).
  - Each torso wound subtracts 10% of current energy from the recovery.
  - Energy is capped at Stamina.
- **Bleeding:** HP −1 per fatal wound per turn.
- **Burning unit:** HP −RNG(5,10) × incendiary modifier, and the burn timer drops by 1.
- **Stun:** −1 per turn.
- **Panic check:** see §6.
- A unit with HP 0 dies. A unit with stun ≥ HP falls unconscious. At each new turn, unconscious units with stun < HP get back up on a free tile.

---

## 2. Time Unit and Energy costs

### 2.1 Movement (`Pathfinding::getTUCost`)
- **Step cost** = floor TU cost + object TU cost from the destination tile's MCD.
  - Typical open ground: **4 TU** (unverified per-tile values; they live in the binary MCD data).
  - Any part with cost 255 is impassable.
- **Diagonal step:** cost × 1.5, so 4 → **6**. This multiplier is applied before wall costs are added.
- **Walls crossed** (including rubble and walls, but not doors walked diagonally): add the average of the TU costs of the walls crossed.
- **Stairs:** a tile with terrain level ≤ −16 lets you step up a level, at **+1 TU**. A step down of more than 8 voxels of terrain level is not allowed.
- **No floor at the destination:** the base cost is 4 and the unit falls. Falling itself costs 0 TU.
- **Vertical move** (flying suit, or a gravlift up or down one level): **8 TU**, 0 energy.
- **Aliens** treat burning tiles as costing +32 in path search only (to avoid fire). They are not charged it.
- **Energy per step** = stepTU/2 (2 for a normal tile, 3 for a diagonal). Vertical moves cost 0 energy. When energy runs out, the unit cannot move.
- **Running** (OpenXcom, Ctrl+click with the "strafe" option): TU × 0.75 and energy × 1.5, so a normal tile costs 3 TU and 3 energy.
- **Walking from kneeling** first stands up, at **8 TU**.
- **Turning:** **1 TU per 45° step** (8 steps per full turn). A shot automatically includes the turn cost.
- **Kneel 4 TU, stand 8 TU.** Soldiers only; not available while floating or for HWPs.
  - Kneeling gives **+15% accuracy** and lowers the unit's height to 14.
  - Kneeling triggers a reaction-fire check.

### 2.2 Actions (`getActionTUs`)
- Weapon actions cost a percentage of base TU, unless the item is `flatRate`.
- Priming a grenade costs **50%** of base TU.
- Throwing costs **25%** of base TU.
- These are always percentages, even for flat-rate items.

| Action | Cost |
|---|---|
| Snap / Aimed / Auto shot | weapon tuSnap / tuAimed / tuAuto % (see §12) |
| Launch (blaster) | tuAimed % |
| Melee (stun rod) | 30% |
| Melee (alien living weapons) | 15 TU flat |
| Prime grenade | 50% |
| Throw anything | 25% |
| Medi-kit use (each click: heal / stimulant / painkiller) | 10 TU flat |
| Motion scanner | 25% |
| Psi-Amp (Panic or Mind Control) | 25 TU flat; alien psi is also 25 TU flat |
| Mind probe | 50% |
| Reload button (find a clip anywhere in inventory) | 15 TU flat |
| Load by dragging a clip onto the weapon in inventory | 15 TU |
| Inventory moves | per-slot table in §13 (e.g. ground→hand 8, belt→hand 4, hand→ground 2) |
| Open door by right-click | the door's MCD TU cost |
| Walking through a door | its cost is included in the step |
| AI grenade use | 4 (take from belt) + prime 50% + throw 25% |

**TU reservation buttons** (None / Snap / Aimed / Auto, plus Reserve-Kneel +4):
- The player is blocked from any action that would eat into the reserved TU.
- If the weapon lacks the reserved mode, the reservation falls back Auto → Snap → Aimed.
- Aliens reserve by aggression while patrolling: aggression 0 → Aimed (keeps 50% TU), 1 → Auto (keeps 40%), 2 → Snap (keeps 33%).

---

## 3. Firing accuracy and the shot model

### 3.1 Accuracy formula (`BattleUnit::getFiringAccuracy`)
```
acc = Firing × weaponAcc(mode) / 100                  (integer)
if kneeling:  acc = acc × 115/100
if weapon is two-handed AND both hands hold items: acc = acc × 80/100
acc = acc × healthMod / 100
healthMod = max(10, 75 + 25×HP/maxHP − 10×wounds)
  wounds = head wounds + (two-handed weapon: both arm wounds; one-handed: that hand's arm wounds)
melee: acc = accuracyMelee × healthMod/100   (× Melee/100 if skillApplied; the stun rod has skillApplied = false)
throw: acc = Throwing × healthMod/100
```
**Examples:**
- Firing 55 with a rifle:
  - Snap 33%, kneeling 37%.
  - Aimed 60%, kneeling 69%.
  - Auto 19% per round.
- Firing 90 with a heavy plasma, aimed and kneeling: 113%, which gives the tightest possible spread.
- On Beginner, aliens' Firing (and armour) is halved (×0.5).

**Display.** The action menu shows the acc% above (no distance factor) and the TU cost for each mode. A distance-aware cursor display is an OXCE feature, not vanilla OpenXcom.

### 3.2 Projectile deviation (`Projectile::applyAccuracy`)
The original game made a percentile "on target or not" roll and then sent misses astray. OpenXcom folds that roll into the deviation:
```
xDist,yDist,zDist = |origin − target| (voxels)
xyShift = (xDist/2 <= yDist) ? xDist/4 + yDist : (xDist+yDist)/2
zShift  = (xyShift <= zDist) ? xyShift/2 + zDist : xyShift + zDist/2
d = RNG(0,100) − acc                     (acc in %)
d = (d >= 0) ? d + 50 : d + 10           // "miss" branch is wide, "hit" branch is tight (acc >= 109 is always the tightest)
d = max(1, zShift × d / 200)
target.x += RNG(0,d) − d/2
target.y += RNG(0,d) − d/2
target.z += RNG(0,d/2)/2 − d/8
then extend the line to 1000 tiles and voxel-trace it: the first voxel hit (wall, object, floor or ANY unit) takes the shot.
```
**Consequences:**
- At short range even "misses" often hit, because the spread is proportional to distance.
- Stray shots hit cover, other aliens, or your own soldiers.

**Approximate effective hit chance.** A Monte Carlo of the model above, against a man-sized target (±4 voxels wide, ±10 high) with no cover:

| Displayed acc | 3 tiles | 6 tiles | 10 tiles | 15 tiles | 20 tiles |
|---|---|---|---|---|---|
| 35% | 90% | 66% | 53% | 47% | 44% |
| 60% | 98% | 81% | 72% | 69% | 66% |
| 90% | 100% | 96% | 94% | 92% | 91% |

These are an approximation (see "uncertain").

**Other rules:**
- **Auto shot:** `autoShots = 3` rounds per action, each one rolled independently, for one TU payment.
- **Guided launch (blaster):** accuracy is fixed at 0.60 for the player (0.55 for aliens). Waypoints are allowed.
- **Berserk shots:** accuracy is halved.
- **Optional range model** (`battleUFOExtenderAccuracy`, off by default): accuracy drops by 2% per tile (`dropoff`) beyond aimRange 200, snapRange 15 or autoRange 7.
- **Line of fire vs line of sight:**
  - For the player, if the traced line would hit something other than the target first, the shot is refused ("no line of fire").
  - `Ctrl+click` force-fires at any tile; terrain can also be fired at deliberately.
  - LOF is checked in voxel space using LOFT templates (12 layers of 16×16 masks per MCD part).
- **Throws and arcing shots** (Celatid spit) use a parabola. Thrown items scatter by `applyAccuracy` with `keepRange`. Throwing is blocked onto tiles whose object has walk cost 255.
- **Max throw range** (`getMaxThrowDistance`) is an iterative arc with `dz −= (50×weight/strength)/100` per 8-voxel step, starting at dz = 1. Computed values for a standing soldier, in tiles:
  - Weight 3 (grenade): strength 20 → 16, 30 → 22, 40 → 35, 60 → 52.
  - Weight 6: strength 20 → 9, 30 → 12, 40 → 16, 70 → 27.
  - Weight 8: strength 20 → 7, 40 → 12, 70 → 22.
  - These are generous; tune them for your game.

---

## 4. Damage

### 4.1 Direct hit on a unit (`TileEngine::hit` → `BattleUnit::damage`)
```
rnd    = RNG(power×(100−R)/100, power×(100+R)/100)
         R = 100 for most damage (0–200%: identical to the original); R = 50 for HE (50–150%)
         (xcom1 constants: damageRange 100, explosiveDamageRange 50)
p      = floor(rnd × armour.damageModifier[type])
type   = SMOKE becomes STUN
side   = from the impact direction relative to the unit's facing:
         front, left, right, rear; the 45° in-between zones roll 2/3 vs 1/3;
         impacts at the same tile (explosion ground zero) hit UNDER
part   = head if impact height ≥ unit height; torso or arms if above 4 voxels; legs below
p     -= currentArmour[side]
if p > 0:
   STUN: stunLevel += p
   else: HP −= p
         if type ≠ Incendiary:
            if the unit can be stunned: stunLevel += RNG(0, p/4)
            soldiers only (aliens too with the alienBleeding option): if RNG(0,10) < p → that body part gains RNG(1,3) fatal wounds,
                                                                      and morale −= wounds in that part
            armour[side] −= p/10 + 1      // armour degrades with each penetrating hit
```
- **Melee:** to-hit is `RNG::percent(acc)`. Power is the weapon's melee power, plus Strength for living-weapon aliens; then the same 0–200% roll applies.
- **Death:** HP = 0.
- **Unconscious:** stunLevel ≥ HP.
- **Morale loss from being wounded:**
  - Loss = `100 × (p × ((110−Bravery)/10) / 10) / mod`.
  - mod is the X-COM leadership modifier (100–150, see §6); it is 100 for aliens.
- When a player unit hits an alien, the shooter is "revealed": its `turnsSinceSpotted` is set to 0 and the alien remembers who hit it.

### 4.2 Damage types (enum order) and what they do
| # | Type | Notes |
|---|---|---|
| 1 | AP (Armour Piercing) | Conventional bullets and shells. Muton ×0.6, Cyberdisc ×0.8, Zombie ×0.6. |
| 2 | IN (Incendiary) | Sets tiles and units on fire. Damage ignores armour. No wounds or extra stun. Explosion power is halved, radius = power/30 + 1. |
| 3 | HE (High Explosive) | 50–150% roll. Area effect, radius = power/20 (capped at 11) unless `blastRadius` is set. Destroys terrain and items. |
| 4 | Laser | Single point. Sectopod is ×1.5 weaker to it. |
| 5 | Plasma | Single point. |
| 6 | Stun | Adds stun only. Area variant (stun bomb) radius = power/20. Immune: Zombie, HWPs (×0). |
| 7 | Melee | Living weapons; bare humans and Sectoids/Floaters ×1.2. |
| 8 | Acid | Celatid spit; ×1.6 unarmoured, ×1.1 personal armour. |
| 9 | Smoke | Area effect; creates smoke (§7). Smoke stun works only on units with modifier > 0. |

### 4.3 Explosions (`TileEngine::explode`)
- **Propagation:** rays are cast every 3° horizontally and 5° vertically. Each ray steps 1 tile at a time.
  - **power −10 per tile.**
  - Minus 2× the HE-block of walls and objects between tiles.
  - Fire loses an extra 5 on diagonals.
  - Each ray stops at radius `maxRadius` or when power reaches 0.
  - The explosion is flat (one level) unless the `battleExplosionHeight` option is set (vertical decay 30/10/5).
- **HE:**
  - Units take RNG(50%, 150%) of the remaining power at their tile.
  - Ground zero (the 3×3 around the center, same level) or units above the blast are hit on UNDER armour; others on the side facing the blast.
  - Items on the tile are destroyed if power > item armour (default 20, corpses 26, flare 8, plasma guns 45–50). An unconscious body destroyed this way kills that unit.
  - Each tile then **detonates** at its maximum ray power: parts are destroyed while `2×armour ≤ remaining` (so HE effectively does half its power to terrain), each destroyed step subtracts 2×armour, and parts follow die-MCD chains. Leftover power above 2×flammability ignites the tile. Destroyed parts emit smoke.
- **Stun area:** RNG(0–200%) stun to units in the area, and to unconscious bodies lying there.
- **IN area:** every tile with a floor or object catches fire for fuel+1 turns, and smoke = clamp(15 − flammability/10, 1, 12). Units on those tiles:
  - Take RNG(5,10) IN damage, ignoring armour (× the IN modifier).
  - Catch fire for RNG(0, 5×mod) turns.
- **Smoke grenade:** tiles in radius get smoke RNG(7,15) turns. Any fire there is put out.
- **Terrain hit by a projectile:** RNG(25%, 75%) of power against the part's armour. If ≥ armour, the part is destroyed and replaced by its die-MCD (rubble). Ground-level floors are replaced by scorched earth.
- **Chain explosions:** explosive MCD parts (fuel tanks, UFO power sources) store `explosive` power. When destroyed they detonate at the end of the action or turn (radius = explosive/10).

### 4.4 Wounds, stun, fire and smoke over time
- **Fatal wounds** (soldiers):
  - −1 HP per wound per turn.
  - Head wound: −10% accuracy each.
  - Arm wound: −10% accuracy each, for the weapon in that arm (two-handed weapons count both arms).
  - Leg wound: −10% TU each.
  - Torso wound: −10% energy recovery each.
- **Medi-kit** (10 TU per click; 10 charges each of Heal, Stimulant and Painkiller):
  - Heal: −1 wound on the selected body part and +3 HP.
  - Stimulant: +10 energy and −4 stun (revives the target if stun < HP).
  - Painkiller: morale += HP lost (once per HP point lost).
- **Standing in fire at turn start:** damage = the tile's smoke value (fire intensity) as IN, ignoring armour. Then a 40% × IN-mod chance to be set ablaze for RNG(0, 5×mod) turns.
- **Standing in smoke (no fire) at turn start:** +(smoke/4 + 1) stun, only for units with smoke modifier > 0. All aliens, power suits and flying suits are immune.

---

## 5. Reaction fire (`TileEngine::checkReactionFire`)
- **Trigger:** a reaction check runs after every step of movement, after kneeling or standing up, and after a shot or throw (once the projectile resolves) by a unit of the side whose turn it is.
  - There is no reaction fire during the civilian turn.
  - Turning on the spot does not trigger it.
- **Spotters** are opposing, non-civilian units that are not out and are within 20 tiles. Each must:
  - Have the mover inside its **90° view cone**, or have been hit by the mover. Aliens remember who hit them until the end of the player's turn; X-COM uses a "was hit" flag.
  - Have a clear line of fire.
  - Actually see the mover (light and smoke rules apply).
- **Reaction score** = `Reactions × currentTU / baseTU`.
- **Reactor selection:**
  - The spotter with the highest score reacts **if its score ≥ the mover's own score**.
  - After it fires its TU drop, so the scores are recomputed and the loop repeats until the mover's score is the highest.
  - Several reactors can each shoot, and the same one can shoot more than once.
  - X-COM gains +1 reaction exp each time it is picked.
- **Reaction type:**
  - **Melee first**, if the reactor has a melee weapon, is adjacent and facing the mover, and has TU > the melee cost.
  - Otherwise a **snap shot**, if it has a snap-capable gun with ammo in hand, the target is within weapon range, and **TU > the snap cost** (strictly greater).
  - X-COM also needs the item researched.
- Reaction is always a single snap shot (never auto or aimed).
- An alien will not reaction-fire an explosive weapon if the explosion would hurt itself or its friends.

---

## 6. Morale, panic, berserk, psi

### 6.1 Leadership modifiers (`getMoraleModifier`)
- **X-COM team modifier**, from the highest-ranked soldier present:

| Highest rank present | Modifier |
|---|---|
| Rookie / Squaddie | 100 |
| Sergeant | 110 |
| Captain | 115 |
| Colonel | 125 |
| Commander | 150 |

- **A dying soldier's rank weight:**

| Rank of the dead soldier | Weight |
|---|---|
| Rookie / Squaddie | 100 |
| Sergeant | 120 |
| Captain | 130 |
| Colonel | 150 |
| Commander | 175 |

- Aliens always use 100. Large (2×2) units are immune to morale.

### 6.2 Morale changes (clamped 0–100; start 100)
`B = (110 − Bravery)/10` (integer). Bravery 10 gives B = 10; Bravery 50 gives B = 6; Bravery 80 gives B = 3; Bravery 100 gives B = 1.

| Event | Change |
|---|---|
| Taking damage p | −100·(p·B/10)/teamMod |
| Receiving fatal wounds on a body part | −(wounds now in that part) |
| A friendly unit dies (all same-side units, size 1) | −(rankWeight(victim) × 200 × B / teamMod / 100). A rookie death with Bravery 30 and no leader: −16. A commander death: −28. |
| An enemy dies (all units on the winning side) | +10 × winnerMod / 100 (X-COM uses its team modifier) |
| The killer kills an enemy | +20 × mod/100 |
| The killer kills a friend | −2000/mod |
| X-COM kills a civilian | −1000/mod |
| An alien kills a civilian | +10 |
| After a panic or berserk episode | +15 |
| Psi Panic success | −(110 − Bravery) |
| Painkiller | + HP lost so far (not repeatable for the same HP) |

When an alien dies, the killer's position becomes known to the aliens (`turnsSinceSpotted = 0`).

### 6.3 Panic check (each turn start, own side, conscious units)
```
chance = 100 − 2×morale   (morale ≥ 50 → 0%; 40 → 20%; 25 → 50%; 0 → 100%)
if roll ≤ chance:  33%  BERSERK, 67% PANIC
else (and chance > 1): bravery exp +1
```
- **Panic:**
  - 50%: freeze.
  - 50%: drop both hand items and run toward a random tile within ±5 tiles (tries lower levels if it fails).
  - Then TU are set to 0.
- **Berserk:**
  - Up to 10 shots, auto if possible (otherwise snap), at the nearest visible enemy. With no enemy in view it fires at a random tile within ±6 tiles, so friendly fire is possible.
  - Accuracy is halved, and the turn costs are paid.
  - Then TU are set to 0.
- Each episode gives +15 morale afterwards. Panic messages are shown even for unseen aliens unless `noAlienPanicMessages` is set.

### 6.4 Psionics (`PsiAttackBState`)
```
attack  = PsiStr × PsiSkill / 50 − distance(tiles) + RNG(0,55)
defense = target PsiStr + (target PsiSkill > 0 ? 10 + PsiSkill/5 : 10)  (+20 extra vs Mind Control)
success if attack > defense
```
- **Panic success:** target morale −(110 − Bravery).
- **Mind Control success:**
  - The unit switches side immediately with full TU.
  - It reverts at the start of its original side's next turn. So an X-COM soldier controlled by aliens stays alien through the X-COM turn, and an alien controlled by X-COM is usable only for the current X-COM turn.
- **Alien psi AI:**
  - Requires TU > escapeTU + 25.
  - Line of sight is not required: any X-COM unit "known" within the alien's intelligence memory can be targeted.
  - Target choice score = `psiAttackStrength − 0.4×targetPsiSkill − dist − targetPsiStr + RNG(55,105)`.
  - If enemies are visible and the weapon's power ≥ that score, it shoots instead.
  - Otherwise it attempts psi if `RNG(35,155) < score`.
  - It tries Mind Control (rather than Panic) if score ≥ 30 and `percent(controlOdds)`:
    - controlOdds starts at 40.
    - −15 if the target's B > 6; +15 if B < 4.
    - Morale ≥ 40 and (morale − 10B) < 50: −15.
    - Morale < 40: +15.
    - Morale 0: 100.
  - Otherwise it tries Panic.
- Psi users in UFO1: Sectoid Leader (PsiStr 50 / Skill 50) and Commander (50/60); Ethereals (Soldier 50/40, Leader 60/45, Commander 65/50).

---

## 7. Visibility, line of sight, light, smoke

**Field of view:**
- A **90° cone** in the facing direction, radius **20 tiles** (`MAX_VIEW_DISTANCE`, circle test x²+y² ≤ 400), across all levels.
- Eye voxel = unit height + float height − 1.
- Large (2×2) units have "4 pairs of eyes".
- Tiles become "discovered" along a Bresenham line in tile space. The walls east and south of a seen tile are revealed too.
- Units are seen by a voxel trace from the eye to the target's exposed voxels. The scan steps through height offsets 0, ±2, ±4, … ±12 around the target's centre.

**Darkness:**
- X-COM cannot see a unit more than **9 tiles** away if that unit's tile shade is > 9.
- **Aliens see 20 tiles regardless of light.**
- Friendly units are always visible.

**Light:**
- Tile shade = `max(0, 15 − brightest light layer)`.
- Ambient light = 15 − globalShade. globalShade runs from 0 (day) to 15 (night). Fixed values: alien base 15, X-COM base 5, Cydonia landing 15, final assault 5.
- At dusk or night (globalShade ≤ 4 test), tiles under roofs get −2.
- **Point lights** fall off by 1 per tile, so a light of 15 brightens up to shade ≤ 9 out to about 9 tiles:

| Source | Light power |
|---|---|
| Fire | 15 |
| Electro-flare on the ground | 15 |
| Burning unit | 15 |
| MCD lamps | lightSource value |
| OpenXcom "personal lighting" (toggle key) | 15 per X-COM soldier |

- **Flares** let X-COM see aliens out to 20 tiles when the aliens stand in the lit area.

**Smoke and vision:**
- Along the sight line, every voxel step through a non-burning tile adds `smoke/3` voxels of "distance"; the maximum is 320 voxels (20 tiles).
- In fresh smoke (density 15), each tile costs about 6×, so you see about 3–4 tiles through it.
- Smoke does not block line of fire.

**Fog of war and spotting:**
- Undiscovered tiles are black; discovered but not currently seen tiles keep their last appearance.
- Aliens are visible only while in some soldier's view. All aliens are re-hidden at the start of each side's turn, then field of view is recalculated.
- Spotting a new enemy interrupts movement: the walk stops when the visible-unit count increases.
- **"Seen enemies" list:**
  - Red numbered buttons (up to 10) on the right of the HUD show the aliens the **selected** soldier can see.
  - Clicking a button centres the camera on that alien.
  - A soldier can shoot at any alien any X-COM unit sees, provided it has a line of fire.

**Motion scanner:**
- Each tile a unit moves adds 30 motion points.
- The scanner shows blips sized by motion points accumulated this turn; points reset each turn.

---

## 8. Terrain model (tiles, MCD, destruction, fire, doors, levels)

**Tile structure.** A tile has 4 parts: **floor, west wall, north wall, object**. Each part is an MCD record with:
- TU cost (walk / fly / slide); 255 = blocked.
- **Armour** (destroyed by damage ≥ armour; 255 = indestructible, e.g. UFO hull).
- Die-MCD (the rubble replacement; chains possible).
- Alt-MCD (the open-door state).
- Flammability (255 = fireproof) and fuel (fire turns = fuel + 1).
- Explosive power and type (chain explosions).
- Blocks: light, LOS (stop LOS), HE block, smoke block, fire block.
- Light source.
- Terrain level (voxel height offset; stairs ≤ −16).
- Footstep sound.
- Big-wall type (diagonal and full-tile walls).
- Flags: isDoor, isUFODoor, isGravLift, noFloor, baseModule.
- Special type (UFO components, start point, etc.).
- 12 LOFT voxel-mask ids.

**Destruction:**
- Projectiles deal 25–75% of power to terrain; HE deals half its power to terrain.
- A destroyed part becomes its die-MCD. A destroyed ground-level floor becomes scorched earth.
- Gravity is applied after destruction: units and items fall, and units without flight drop.
- Roofs can be blown away, which changes lighting.

**Fire** (each new full turn, `SavedBattleGame::prepareNewTurn`):
- Each burning tile's timer −1.
- While a tile is still burning, it tries to ignite each of its 4 orthogonal neighbours that are not wall-blocked:
  - Chance% = sourceSmoke − flammability/10 + 15.
  - The neighbour needs fuel > 0.
  - A newly ignited tile gets fire = fuel + 1 and smoke = 15 − clamp(flammability/10, 1, 12).
- When the fire ends, the flammable object and floor are destroyed (burnt).

**Smoke:**
- Decays by 1 per turn on non-burning tiles.
- Spreads its value to the 4 orthogonal neighbours that are not wall-blocked. Overlapping smoke averages: `smoke/overlaps − 1`, range 0–15.
- Fire tiles emit smoke at half intensity to the neighbours and one level up (if there is no floor).
- From a smoke grenade, smoke lasts roughly 7–15 turns.

**Doors:**
- **Normal (swing) doors:** walking into the door, or right-clicking it while facing it, swaps in the Alt-MCD (open). It stays open for the rest of the mission and costs the door's TU. 2×2 units cannot open them.
- **UFO sliding doors:** open with a 7-frame animation; you cannot pass until it finishes. Adjacent UFO door segments open together. **They close at the end of every turn** unless a unit stands in the doorway.
- A door can be opened only if the unit has TU for the door plus any reserved TU.

**Levels:**
- Up to 4 z-levels.
- Stairs are ramps by terrain level: +1 TU to climb a level.
- **Gravlift** tiles (UFO and base): up or down for 8 TU. They cannot be destroyed.
- Flying units and flying armour can move up or down anywhere with no floor above, for 8 TU.
- A unit standing on a stair can poke its head into the tile above, and can be hit there.
- Explosions damage the floor above them but not the units on it (unless the 3D option is on).

---

## 9. Map generation (`BattlescapeGenerator` + `mapScripts.rul`)

**Map sizes:**

| Mission | Size (x×y×z) |
|---|---|
| Small scout | 40×40×4 |
| Other UFOs and terror sites | 50×50×4 |
| Alien base | 50×50×2 |
| X-COM base | 60×60×2 |
| Cydonia 1 | 50×50×4 |
| Cydonia 2 | 60×60×2 |

**Blocks.** Map blocks are 10×10 or 20×20 (each block has its own route nodes for AI spawn and patrol).

**Terrain choice:**
- UFO sites take their terrain from the globe texture under the UFO: Farm (CULTA), Forest, Jungle, Desert, Mountain, Polar.
- Terror sites are URBAN; alien bases are UBASE; base defence is XBASE (laid out from your base facilities); Mars is MARS then UBASE.

**Scripts:**

| Script | Commands |
|---|---|
| DEFAULT (Forest, Mountain) | addUFO; addCraft; 2× addBlock size 2 (20×20); fillArea |
| FARM | addUFO; addCraft; fill with 10×10 blocks 1–18, max 3 uses each |
| DESERT | addUFO; addCraft; 3× 20×20; fill |
| JUNGLE | addUFO; addCraft; weighted fill |
| POLAR | addUFO; addCraft; 1× 20×20; fill |
| URBAN | addCraft; roads via addLine (vertical 50%, horizontal 50%, else both); 4× 20×20; weighted fill |
| ALIENBASE / BOSSBATTLE | fixed groups (command centre etc.); digTunnel corridors |
| XBASE | your base layout; tunnels between facilities |

**Placement:**
- The UFO and the craft are placed at random positions that do not overlap.
- Skyranger block: 10×20 (14 soldiers + 3 HWP; an HWP takes 4 seats).
- Avenger: 10×20 (26 / 4).
- Lightning: 20×10 (12 / 0).

**UFO interior blocks:**

| UFO | Block | Datasets (contents, unverified) |
|---|---|---|
| Small Scout | 10×10 (UFO1A) | single room |
| Medium Scout | 10×10 (UFO_110) | |
| Large Scout | 20×20 (UFO_120) | |
| Harvester | 20×20 (UFO_130) | U_DISEC2: dissection / food |
| Abductor | 20×20 (UFO_140) | U_OPER2: surgery / examination |
| Terror Ship | 30×20 (UFO_150) | U_PODS |
| Battleship | 30×30 (UFO_160) | U_PODS |
| Supply Ship | 30×20 (UFO_170) | U_DISEC2 |

**Crashed vs landed UFO:**
- Each **UFO power source** explodes with **75% probability** at generation: HE 180–250, radius 10. This blasts the hull and interior and can kill aliens; terrain chain explosions follow.
- A landed UFO keeps all power sources, and each one carries Elerium.
- **Elerium on the ground** (`alienFuel: [STR_ELERIUM_115, 50]`) is placed on each intact power source.

---

## 10. Alien deployment, races, stats, difficulty

**Rank slots per race.** The deployment rank index is CMD, LDR, ENG, MED, NAV, SOL, TER, TER2. Each race fills those slots as follows:

| Race | CMD | LDR | ENG | MED | NAV | SOL | TER | TER2 |
|---|---|---|---|---|---|---|---|---|
| Sectoid | Commander | Leader | Engineer | Medic | Navigator | Soldier | Cyberdisc | Cyberdisc |
| Snakeman | Commander | Leader | Engineer | Soldier | Navigator | Soldier | Chryssalid | Chryssalid |
| Ethereal | Commander | Leader | Leader | Leader | Leader | Soldier | Sectopod | Sectopod |
| Muton | Soldier | Soldier | Engineer | Soldier | Navigator | Soldier | Silacoid | Celatid |
| Floater | Commander | Leader | Engineer | Medic | Navigator | Soldier | Reaper | Reaper |
| Mixed (Cydonia) | Ethereal Soldier | Ethereal Leader | Ethereal Commander | Chryssalid | Silacoid | Celatid | Sectopod | Sectopod |

**Quantity per row:**
- Beginner / Experienced: `low + RNG(0,dQty)`.
- Veteran / Genius: `low + (high−low)/2 + RNG(0,dQty)`.
- Superhuman: `high + RNG(0,dQty)`.

**Outside the UFO.** Each alien is placed outside with probability `percentageOutsideUfo`: soldiers 50–70%, navigators 20–25%, engineers 20–35%, medics 20%, leaders and commanders 0%, terror units 50%.

**Spawn nodes.** Ranks try node ranks in this order:
- Commander: 4, 3, 5, 8, 7, 2, 0.
- Soldier: 2, 5, 3, 4, 6, 8, 0.
- Node rank 0 = scout or outside.

**Initial facing.** An alien within 20 tiles of the craft faces it with probability 20%×difficulty.

**Crew totals** (rank breakdown in brackets):

| Mission | Beginner / Experienced | Veteran / Genius | Superhuman |
|---|---|---|---|
| Small Scout | 1 [SOL1] | 1 | 1 |
| Medium Scout | 3–6 [SOL2–4, NAV1–2] | 4–7 | 6–9 |
| Large Scout | 3–10 [SOL1–6, NAV1–2, ENG1–2] | 4–11 | 6–13 |
| Harvester | 10–15 [SOL5–9, NAV1, MED1, ENG2, LDR1–2] | 12–17 | 16–21 |
| Abductor | 9–14 [SOL3–7, NAV1–2, MED2, ENG2, LDR1] | 11–16 | 13–18 |
| Terror Ship / Terror site | 10–16 [SOL4–5, NAV1, MED1–2, ENG1, LDR1, TER1–3 ×2 rows] | 13–19 | 18–24 |
| Battleship | 9–15 [SOL4–8, NAV1, MED1, ENG1, LDR1, CMD1, TER0–1 ×2] | 14–20 | 22–28 |
| Supply Ship | 9–15 [SOL5–11, NAV1, MED1, ENG1, LDR1] | 10–16 | 14–20 |
| Alien Base | 12–18 [TER1–2, TER2 0–1, SOL5–9, NAV1, MED1, ENG1, LDR2, CMD1] | 16–22 | 22–28 |
| X-COM Base Defence | as Battleship | as Battleship | as Battleship |
| Cydonia 1 (Sectoid) | 12 [SOL4, LDR3, CMD3, TER (Cyberdisc) 2, all outside] | 16 | 20 |
| Cydonia 2 (Mixed) | 16 | 23 | 31 |

Terror sites also have 16 civilians as the maximum; `RNG(8,16)` spawn.

**Alien weapons by month.** Each alien rolls a weapon tier from the month's row of `alienItemLevels` (10 entries):
- Month 0: 70% tier 0 (Plasma Pistol set), 20% tier 1 (Plasma Rifle set), 10% tier 2 (Heavy Plasma set).
- The tiers shift up each month.
- From month 9: always tier 2.
- Some ranks and tier sets carry extras: Alien Grenades, Mind Probe, Small Launcher + Stun Bombs (medics, engineers), Blaster Launcher (Battleship / base engineers, leaders, commanders).

**Difficulty scaling of alien stats** (`difficulty.rul`):
- `stat += stat × growth% × coef / 100`, where coef = 0, 1, 2, 3, 4 for Beginner through Superhuman.
- growth%: TU 4, Stamina 4, Health 0, Bravery 0, Reactions 6, Firing 6, Throwing 0, Strength 2, PsiStr 4, PsiSkill 4, Melee 4.
- So Superhuman gives TU +16%, Reactions +24%, Firing +24%, Strength +8%, Psi +16%, Melee +16%.
- **Beginner:** alien Firing ×0.5 and armour ×0.5.

### Alien stats (`units.rul` / `armors.rul`)
Armour is listed F/S/R/U (front / side / rear / under); "side" applies to both left and right. Modifiers not listed are 100%. **Every alien has Smoke 0%.**

| Unit | TU | Sta | HP | Brav | React | Fire | Thr | Str | PsiS | PsiK | Melee | Armour F/S/R/U | Damage modifiers | Int | Aggr | Value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sectoid (Soldier / Eng / Med / Nav) | 54 | 90 | 30 | 80 | 63 | 52 | 58 | 30 | 40 | 0 | 76 | 4/3/2/2 | Melee 120, Acid 160 | 3 / 6 / 5 / 4 | 2 / 2 / 1 / 2 | 10 / 16 / 14 / 12 |
| Sectoid Leader / Commander | 54 | 90 | 30 | 80 | 63 | 52 | 58 | 30 | 50 | 50 / 60 | 76 | 4/3/2/2 | same | 7 / 8 | 1 / 0 | 20 / 25 |
| Floater (Soldier / Eng / Nav / Med); flies | 50 | 90 | 35 | 80 | 50 | 50 | 58 | 40 | 35 | 0 | 70 | 8/6/4/12 | Melee 120, Acid 160 | 4 / 7 / 5 / 6 | 2 / 2 / 2 / 1 | 12 / 18 / 14 / 16 |
| Floater Leader | 55 | 95 | 40 | 80 | 60 | 60 | 58 | 47 | 40 | 0 | 70 | 16/12/8/12 | same | 8 | 0 | 25 |
| Floater Commander | 60 | 100 | 45 | 80 | 66 | 63 | 65 | 48 | 45 | 0 | 76 | 24/18/12/16 | same | 8 | 0 | 35 |
| Snakeman (Soldier / Nav / Eng); slides | 40 | 80 | 45 | 80 | 45 | 58 | 65 | 47 | 40 | 0 | 76 | 20/18/16/12 | Inc 70 | 2 / 3 / 4 | 2 | 15 / 17 / 20 |
| Snakeman Leader | 40 | 80 | 45 | 80 | 55 | 65 | 65 | 47 | 45 | 0 | 76 | 20/24/22/20 | Inc 70 | 5 | 2 | 28 |
| Snakeman Commander | 45 | 84 | 55 | 80 | 65 | 58 | 65 | 47 | 50 | 0 | 76 | 26/26/22/20 | Inc 70 | 6 | 2 | 36 |
| Muton (Soldier / Nav / Eng) | 56 | 90 | 125 | 80 | 60 | 54 | 62 | 70 | 25 | 0 | 76 | Sol 20/20/20/10; Nav 24/24/24/15; Eng 28/28/28/20 | **AP 60** | 2 / 3 / 4 | 2 | 15 / 17 / 19 |
| Ethereal (Soldier / Leader / Commander); flies | 68 | 96 | 55 | 80 | 75 | 74 | 80 | 48 | 50 / 60 / 65 | 40 / 45 / 50 | 85 | 35 / 40 / 45 on all sides | Inc 70, Stun 80 | 6 / 7 / 8 | 1 | 20 / 30 / 40 |
| Cyberdisc (2×2, flies) | 62 | 90 | 120 | 110 | 64 | 60 | 0 | 90 | 100 | 0 | 0 | 34 all sides | AP 80, HE 60 | 5 | 1 | 20 |
| Sectopod (2×2) | 62 | 90 | 96 | 110 | 64 | 60 | 0 | 90 | 100 | 0 | 80 | 145/130/100/90 | HE 80, **Laser 150**, Plasma 80 | 4 | 1 | 30 |
| Reaper (2×2) | 62 | 90 | 148 | 90 | 64 | 0 | 0 | 90 | 35 | 0 | 80 | 28/28/28/4 | **Inc 170** | 2 | 2 | 25 |
| Chryssalid | 110 | 140 | 96 | 100 | 70 | 0 | 0 | 110 | 50 | 0 | 80 | 34 all sides | Inc 80, Stun 90 | 4 | 1 | 25 |
| Zombie | 40 | 110 | 84 | 110 | 40 | 0 | 0 | 84 | 80 | 0 | 80 | 4 all sides | AP 60, HE 80, Laser 70, Plasma 70, **Stun 0** | 3 | 2 | 18 |
| Silacoid (slides) | 40 | 80 | 114 | 100 | 40 | 0 | 0 | 70 | 80 | 0 | 80 | 50/50/50/10 | **Inc 0**, HE 130 | 3 | 2 | 20 |
| Celatid (float height 6) | 70 | 90 | 68 | 90 | 40 | 100 | 0 | 70 | 80 | 0 | 80 | 20 all sides | Melee 120, Acid 160 | 3 | 2 | 20 |
| Civilian | 35 | 65 | 30 | 80 | 30 | 30 | 50 | 20 | 5 | 0 | 50 | 0 | Melee 120, Acid 160 (no Smoke immunity) | 4 | – | 30 |

**Weapons and special abilities:**

| Unit | Weapon | Special |
|---|---|---|
| Sectoid Leader / Commander | — | psi (see §6.4) |
| Ethereals | — | psi (see §6.4); fly |
| Cyberdisc | built-in Plasma 130 (snap 75% / 30% TU, aimed 110% / 60% TU) | **explodes on death: HE 120, radius 6**; cannot be captured |
| Sectopod | built-in beam 100 (damage type Laser in the ruleset); snap 75/30%, aimed 110/60%, auto 50/35% | cannot be captured |
| Reaper | melee = Strength (90), 15 TU | — |
| Chryssalid | melee 110, 15 TU | A successful hit on a soldier or civilian infects them. They turn into a **Zombie** at once if still alive and conscious after the attack, otherwise when they die. |
| Zombie | melee 84 | spawns a **Chryssalid** when killed |
| Silacoid | melee 70 | sets fire to floors it moves over |
| Celatid | arcing **Acid** spit 140 (snap 75/30%, aimed 110/60%) | — |

**HWPs (X-COM tanks, 2×2):**
- Tank: TU 70, Sta 100, HP 90, Brav 110, React 20, Fire 60, Str 60; armour 90/75/60/60; modifiers Inc 40, HE 75, Stun 0, Melee 90, Acid 40.
  - Cannon: 60 AP × 30 rounds; snap 60% / 33% TU, aimed 90% / 80% TU.
  - Rocket Launcher: 85 HE × 8; snap 55/45, aimed 115/75.
  - Laser Cannon: 110 Laser, unlimited; snap 50/33, aimed 85/75.
- Hovertank (flies): TU 100, React 30, armour 130/130/130/100.
  - Plasma: 110, unlimited; snap 85/30, aimed 100/60.
  - Fusion Launcher: fusion bomb 140 HE, radius 11, × 8; aimed 100/66.

---

## 11. Alien AI (`AIModule`, OpenXcom's current AlienBAIState)

**Per-turn loop:**
- Each alien gets about 2 AI decisions per pass.
- After all aliens have acted, a second pass ("second move") runs for any alien that still has TU.
- An alien with ≤ 5 TU is done.

**Memory:**
- An X-COM unit is "known" while `turnsSinceSpotted ≤ intelligence` (2–8 by rank, see the table).
- turnsSinceSpotted resets to 0 when:
  - any alien sees the unit;
  - the unit hits an alien;
  - the unit kills an alien.
- It increments at the start of each X-COM turn.
- **Cheat turn:** after turn **20**, or after turn 10 when ≤ 2 aliens are alive, aliens know every X-COM position every turn. They force Combat mode and all leave the UFO to scout.

**Modes:** Patrol / Ambush / Combat / Escape. A mode is re-evaluated when:
- the alien is spotted;
- enemies are visible or known (or at random 10% of the time while patrolling);
- more than 2 X-COM units can see it;
- its HP < 2/3;
- its target has been lost from memory.

**Mode weights:**
1. Base weights: escape 15 (12 if melee; 5 if TU > 50% or charging), ambush 12, combat 20, patrol 30 (15 if it sees enemies; 0 if it is being spotted).
2. ×1.1 for the current mode.
3. Health:

| Health | Escape | Combat | Ambush |
|---|---|---|---|
| < 1/3 | ×1.7 | ×0.6 | ×0.75 |
| < 2/3 | ×1.4 | ×0.8 | ×0.8 |
| hurt (but ≥ 2/3) | ×1.1 | — | — |

4. Aggression:
   - 0: escape ×1.4, combat ×0.7.
   - 1: ambush ×1.1.
   - 2: combat ×1.4, escape ×0.7.
5. Spotters: escape = 10·esc·(n+10)/100; combat = 5·cmb·(n+20)/100. With no spotters, escape is halved.
6. Visible enemies: combat ×(10·(v+10)/100). Ambush = 0 if the closest enemy is < 5 tiles away.
7. Ambush needs a prepared ambush tile (×1.7); otherwise it is 0. Melee and blaster units never ambush.
8. One known enemy: combat ×1.2. No known enemies: combat = 0 and escape = 0.
9. Base defence: escape ×0.75, ambush ×0.6.
10. A unit with no weapon, grenade or psi cannot pick combat or ambush.

**Patrol:**
- Walks between route nodes. At a node it looks out of nearby windows.
- Units on rank-0 (scout) nodes roam the map. Others stay on UFO nodes until the cheat turn, low morale, or fire.
- In base defence, aliens walk to "target" nodes and shoot base modules (consoles).

**Combat:**
1. Psi first, if possible.
2. Blaster with waypoints, if it has one.
3. If an enemy is visible:
   - Melee vs ranged choice: melee odds 10 + (dmg − 50)/2 − 20 per extra visible enemy, modified by aggression.
   - Grenade check (see below).
   - Melee charge, or shot.
4. If nothing to do and (spotted, or aggression < RNG(0,3)), find a firing point in an 11×11 area with a line of fire to the target.

**Fire mode:**
- Distance < 4: auto > snap > aimed.
- Distance > 12: aimed, or snap if distance < 20.
- Otherwise: snap > aimed > auto.

**Grenades and blasters:**
- Not before turn 3 (`turnAIUseGrenade` 3, `turnAIUseBlaster` 3).
- Efficacy = desperation + difficulty/2 + 1 per enemy in radius − 2 per friendly in radius − 4 if the thrower itself is within radius.
  - desperation = (100 − morale)/10, +3 if HP < 1/3.
- Requires efficacy > 0. For grenades it also requires ≥ 2 enemies, unless desperation ≥ 6.
- Never throws at flying targets. Never targets a tile already grenaded this turn (it is marked "dangerous").

**Escape:**
- Searches up to 150 tiles (random order) for one that no X-COM unit can see. Fire costs −40, each spotter −10.
- Moves there and turns 180° ("hiding"), then ends its turn.

**Ambush:**
- A rifle-armed alien finds a tile overlooking the likely X-COM approach, faces it, and ends its turn with reserved TU for reaction fire.

**Other behaviour:**
- **Reaction aggro:** an alien that reacts enters an aggro state.
- **Pick-up:** aliens without a weapon or ammo pick up items on the ground.
- **sneakyAI option:** aliens route around tiles X-COM can see.

---

## 12. Equipment (`items.rul`)

### 12.1 Firearms
Each mode is shown as accuracy% / TU% of base TU.

| Weapon | Weight | 2-handed | Snap | Aimed | Auto (3 rounds) | Ammo: power, type, rounds, weight, radius | Buy |
|---|---|---|---|---|---|---|---|
| Pistol | 5 | no | 60 / 18 | 78 / 30 | – | Clip: 26 AP ×12, wt 3 | $800 / clip $70 |
| Rifle | 8 | yes | 60 / 25 | 110 / 80 | 35 / 35 | Clip: 30 AP ×20, wt 3 | $3,000 / $200 |
| Heavy Cannon | 18 | yes | 60 / 33 | 90 / 80 | – | AP 56; HE 52 (r2); I 60 (r3); ×6, wt 6 | $6,400 / $300–500 |
| Auto-Cannon | 19 | yes | 56 / 33 | 82 / 80 | 32 / 40 | AP 42; HE 44 (r2); I 48 (r2); ×14, wt 5 | $13,500 / $500–700 |
| Rocket Launcher | 10 | yes | 55 / 45 | 115 / 75 | – | Small 75 HE (r3, wt 6); Large 100 HE (r5, wt 8); Incendiary 90 IN (r4, wt 8); 1 round | $4,000 / $600–1,200 |
| Laser Pistol | 7 | no | 40 / 20 | 68 / 55 | 28 / 25 | 46 Laser, unlimited | manufacture |
| Laser Rifle | 8 | yes | 65 / 25 | 100 / 50 | 46 / 34 | 60 Laser, unlimited | |
| Heavy Laser | 18 | yes | 50 / 33 | 84 / 75 | – | 85 Laser, unlimited | |
| Plasma Pistol | 3 | no | 65 / 30 | 85 / 60 | 50 / 30 | 52 Plasma ×26, wt 3 | alien |
| Plasma Rifle | 5 | yes | 86 / 30 | 100 / 60 | 55 / 36 | 80 Plasma ×28, wt 3 | alien |
| Heavy Plasma | 8 | yes | 75 / 30 | 110 / 60 | 50 / 35 | 115 Plasma ×35, wt 3 | alien |
| Small Launcher | 10 | yes | 65 / 40 | 110 / 75 | – | Stun Bomb 90 Stun (r4) ×1, wt 3 | alien |
| Blaster Launcher | 16 | yes | – | 120 / 66 (launch; waypoints; guided accuracy 60%) | – | Blaster Bomb 200 HE (r10) ×1, wt 3 | alien |

### 12.2 Explosives and other items
All grenades are primed for 50% TU, thrown for 25% TU, and the fuse is set to 0–23 turns.
- A grenade with fuse 0 that is lying on the ground explodes at the end of the turn. With the `battleInstantGrenade` option, a fuse-0 grenade explodes on landing.
- A proximity grenade arms once thrown or dropped, then detonates when any unit enters one of the 8 adjacent tiles or its own tile.

| Item | Weight | Effect |
|---|---|---|
| Grenade | 3 | 50 HE, radius 5 ($300) |
| Smoke Grenade | 3 | 60 smoke, radius 5 ($150) |
| Proximity Grenade | 3 | 70 HE, radius 5 ($500) |
| High Explosive | 6 | 110 HE, radius 5 ($1,500); 2×1 inventory cells |
| Alien Grenade | 3 | 90 HE, radius 5 |
| Electro-flare | 3 | light 15 where it lands; 25% TU to throw ($60) |
| Stun Rod | 6, 2-handed | 65 Stun melee; 30% TU; to-hit 100% × health modifier ($1,260) |
| Medi-Kit | 5 | 10 TU per use; 10 heals (−1 wound, +3 HP), 10 stimulants (+10 energy, −4 stun), 10 painkillers |
| Motion Scanner | 3 | 25% TU |
| Psi-Amp | 10, 2-handed | 25 TU; Panic or Mind Control |
| Mind Probe | 5 | 50% TU; shows an alien's stats |

**Corpses** weigh 20–40 (inventory 2×3).

### 12.3 Armour
OpenXcom UFO1 armour has **weight 0**. Armour is F/S/R/U (side = left and right).

| Armour | F | S | R | U | Modifiers | Notes |
|---|---|---|---|---|---|---|
| None (coveralls) | 12 | 8 | 5 | 2 | Melee 120, Acid 160 | |
| Personal Armour | 50 | 40 | 30 | 30 | Inc 80, Stun 90, Acid 110 | |
| Power Suit | 100 | 80 | 70 | 60 | **Inc 0**, Stun 80, **Smoke 0** | |
| Flying Suit | 110 | 90 | 80 | 70 | Inc 0, Stun 80, Smoke 0 | flight; 8 TU per level up or down |

---

## 13. Inventory (`inventories.rul`)

**Slots:**
- Right hand and Left hand: each holds 1 item of any size.
- Belt: 6 cells (4 on the top row + the 2 bottom corners).
- Each leg: 2×1.
- Each shoulder: 2×1.
- Backpack: 3×3.
- Ground: shared with the tile.
- Item footprints: rifle 1×3, pistol 1×2, heavy weapons 2×3, ammo 1×1 or 2×1, rockets 1×3.

**Move costs in TU** (row = from, column = to):

| From \ To | Right hand | Left hand | Belt | Right leg | Left leg | Right shoulder | Left shoulder | Backpack | Ground |
|---|---|---|---|---|---|---|---|---|---|
| Ground | 8 | 8 | 12 | 10 | 10 | 12 | 12 | 20 | – |
| Right hand | – | 4 | 8 | 8 | 10 | 10 | 10 | 14 | 2 |
| Left hand | 4 | – | 8 | 10 | 8 | 10 | 10 | 14 | 2 |
| Belt | 4 | 4 | – | 10 | 10 | 12 | 12 | 16 | 6 |
| Right leg | 4 | 6 | 10 | – | 10 | 10 | 10 | 18 | 6 |
| Left leg | 6 | 4 | 10 | 10 | – | 10 | 10 | 18 | 6 |
| Shoulders | 3 | 3 | 10 | 12 | 12 | 8 (to the other shoulder) | 8 | 16 | 4 |
| Backpack | 8 | 8 | 12 | 16 | 16 | 14 | 14 | – | 10 |

- **Reload:** 15 TU.
- **Weight:** carried weight = items + loaded ammo + armour weight (0).
  - If weight > Strength, next turn's TU = TU × Strength/weight. The inventory weight figure turns red.
  - Throw range also drops with item weight.
- **Two-handed weapons:** −20% accuracy if the other hand holds anything.
- **Main-hand weapon:** the AI and reaction fire use the main-hand weapon; the player picks a hand via the two hand buttons.

---

## 14. Mission flow and scoring

**Turn order:** X-COM → Aliens → Civilians (the civilian turn is skipped if none exist) → next turn.

**End of a side's turn:**
1. UFO doors close (unless someone stands in the doorway).
2. Grenades with fuse 0 on the ground explode, and fuses decrement.
3. Chained terrain explosions resolve.
4. The next side's units get their turn-start recovery (§1.5).

At the start of each new full round, fire and smoke update (§8) and unconscious units are checked for revival.

**Victory and defeat:**
- **Win:** liveAliens == 0 (all aliens dead or stunned; mind-controlled aliens count as dead only with `allowPsionicCapture`).
- **Loss:** all X-COM units dead, unconscious or mind-controlled.
- **Abort:** possible from the craft tiles (START_POINT). Everyone outside the craft is **MIA**. Only items lying on craft tiles are recovered, unless the objective was already done. Cydonia uses END_POINT.
- With no X-COM unit standing in the craft when the mission ends, the craft is lost.
- Base defence: base modules can be destroyed, and losing means the base is lost.
- Alien base: destroying the control objective scores +500 (`STR_ALIEN_BASE_CONTROL_DESTROYED`).

**Debriefing score:**

| Event | Points |
|---|---|
| Alien killed | +unit value (Sectoid soldier 10 … Ethereal Commander 40) |
| Live alien captured | +2×value if not yet researched, otherwise +10 |
| Civilian saved | +30 |
| Civilian killed by aliens | −30 |
| Civilian killed by X-COM | −50 |
| X-COM soldier killed or MIA | −(20 + missions + rank bonus) |
| HWP lost | −20 |
| Craft lost | −craft score |
| Corpse | +5 (terror units +3) |
| Artefacts | Plasma Pistol 3, Rifle 4, Heavy Plasma 5, Blaster 5, Small Launcher 4, ammo / grenade / Mind Probe 1 |
| UFO components | Power Source 20, Navigation 5, Construction 2, Food / Reproduction / Entertainment / Surgery / Examination 2, Habitat 1 |
| Alien Alloys | 1 per tile ÷10 for a UFO (÷150 for an alien base) |
| Elerium | per intact power source |

Every recovered item goes to base stores.

---

## 15. What makes it feel good (design notes for "capricha na jogabilidade")

1. **The unknown.** Fog of war, night maps where aliens see 20 tiles but you see 9, the closed UFO door, and the first step off the Skyranger ramp. Spotting interrupts movement. The alien turn is shown only where you can see ("hidden movement" tension). Keep the camera off unseen alien moves.
2. **TU economy as risk and reward.** Every step spends the same budget used for shooting and for reaction readiness. Reserve-TU buttons make "move 2 tiles, keep a snap shot" a real decision. Reaction score scales with TU left, so a soldier who moved little is a better guard.
3. **Reaction fire both ways.** Aliens with high Reactions (Chryssalid 70 with 110 TU, Ethereal 75) punish careless movement. Kneeling plus a high Reactions stat makes overwatch-like play emerge without an overwatch button.
4. **Fragile soldiers, swingy damage.** A 0–200% roll means a Sectoid can one-shot a rookie and a rifle can one-shot a Sectoid about 44% of the time. Armour degrades with hits. Fatal wounds force medikit triage.
5. **Destructible cover.** HE and missed shots carve walls (25–75% of power to terrain). Rockets open new firing lanes; fire spreads in fields; collapsing floors drop units.
6. **Night and flares.** Light is a resource. A thrown flare (power 15, about a 9-tile lit radius) reveals aliens out to 20 tiles. Fires light the map too.
7. **Panic cascades.** A dead squadmate costs morale scaled by rank and bravery. Panicked soldiers drop weapons; berserkers shoot friends. Officers present raise the threshold (+10 to +50%). Psi Panic and Mind Control turn this into horror.
8. **Unpredictable misses.** Stray shots hit other targets. Auto fire at close range is deadly. Grenades bounce and roll.
9. **Persistent squad.** Stats grow only from real use (shooting hits, reacting, surviving panic checks). Named soldiers die permanently.

### OpenXcom quality-of-life features worth copying
- **Path preview:** first click previews, second click confirms. Each step shows the TU left; tiles are green (reachable keeping the reserve), yellow (reachable but eats into reserved TU) or red (not reachable, out of TU or energy). Energy is included.
- **Ctrl+click run:** 0.75× TU, 1.5× energy. Alt for strafe.
- **Ctrl+click force fire** at any tile or wall.
- **Action menu** shows TU cost and accuracy% for each mode. Better still (OXCE): show a distance-aware hit chance on the cursor; a hit chance computed by simulating the shot model is recommended.
- **Doors:** right-click opens a door without walking through it.
- **Center-on-enemy buttons:** the red numbered list.
- **Unit cycling:** next unit / done with unit.
- **Kneel reservation;** the reload button (15 TU).
- **Inventory:** loadout templates (copy / paste), auto-equip, carried-weight display.
- **Feedback:** death notifications, alien panic message filter, skip-next-turn-screen, smooth camera, battle auto-end when no aliens remain.
- **Optional rules:** instant grenades, UFO-Extender range dropoff, 3D explosion height, alien bleeding, psionic capture, field promotions, sneaky AI.
- **No undo.** Neither the original nor OpenXcom has one; keep it that way so decisions carry weight. Pair this with clear previews, so any error is the player's own risk, not a misclick.
- **Speed sliders:** separate X-COM and alien animation speeds (default 30 ms per step).
- **Hidden-movement screen** during the alien turn, and a "Next turn" screen between turns.

---

## 16. Implementation hints for the browser game (my suggestions, not REA facts)
- Store maps as `tiles[z][y][x] = {floor, wallW, wallN, object}`, with a small JS MCD table: tuWalk, armor, dieId, altId, flammable, fuel, blockLOS, blockHE, light, terrainLevel, isDoor, isUfoDoor.
- A 2.5D voxel trace can be simplified: per tile part, use a height range and a thin-wall rule.
- Keep the exact formulas from §2–§7. They are cheap.
- The deviation shot model plus a line trace gives the "stray bullet" feel. Precompute the displayed hit% by sampling about 200 traces when the target is selected.
- Alien AI: implement the four-mode weighted choice, the intelligence memory and the cheat turn. These carry most of the "smart alien" feel.

## KEY NUMBERS
Soldier rookie ranges: TU 50-60, Sta 40-70, HP 25-40, Brav 10-60 (x10), React 30-60, Firing 40-70, Throw 50-80, Str 20-40, PsiStr 0-100 (high)
Soldier caps: TU 80, Sta 100, HP 60, Brav 100, React 100, Firing 120, Throw 120, Str 70, Psi 100, Melee 120 (high)
improveStat: exp>10 -> 2-6; 6-10 -> 1-4; 3-5 -> 1-3; 1-2 -> 0-1; Bravery +10 if exp>RNG(0,10) (high)
Secondary growth: TU/HP/Str += RNG(0,(cap-cur)/10+2), Sta += RNG(0,(cap-cur)/15+2) (high)
Walk 4 TU/tile, diagonal x1.5 (6), stair climb +1, fly/gravlift vertical 8, energy = TU/2 per step; run = 0.75 TU, 1.5 energy (high; 4 TU base is from MCD data, medium)
Kneel 4 TU, stand 8 TU, turn 1 TU per 45 degrees, kneel accuracy x1.15 (high)
Prime 50% TU, throw 25% TU, reload 15 TU, medikit 10 TU, psi-amp 25 TU, stun rod 30% (high)
Rifle: snap 60%acc/25%TU, aimed 110/80, auto 35/35, 30 AP x20 (high)
Accuracy = Firing x weaponAcc/100 x1.15 kneel x0.8 (two-handed, other hand full) x max(10, 75+25*HP/maxHP-10*wounds)/100 (high)
Deviation: d = RNG(0,100)-acc; d += (d>=0?50:10); spread = max(1, zShift*d/200) voxels (high)
Damage roll: 0-200% (non-HE), 50-150% HE; then x damage modifier, minus side armour (high)
Armour degrades by damage/10+1 per penetrating hit; fatal wound if RNG(0,10)<damage, +1-3 wounds; bleed 1 HP per wound per turn (high)
Extra stun from conventional hits: RNG(0,damage/4); unconscious when stun>=HP; stun -1/turn (high)
Explosion: -10 power per tile, minus 2x HE-block of walls; radius HE=power/20, IN=power/30+1, cap 11 unless blastRadius set (high)
Reaction score = Reactions x curTU/maxTU; reacts if score >= mover's score; snap needs TU > cost (high)
Panic chance per turn = 100-2*morale; 33% berserk, else 50% freeze / 50% flee and drop items; +15 morale after (high)
Leader morale modifier: Sgt 110, Capt 115, Col 125, Cmdr 150; death weight Sgt 120, Capt 130, Col 150, Cmdr 175 (high)
Friend-death morale loss = rankWeight*200*((110-Brav)/10)/teamMod/100 (high)
Psi: attack = PsiStr*PsiSkill/50 - dist + RNG(0,55) vs defense = PsiStr + 10 + PsiSkill/5 (+20 vs Mind Control) (high)
Vision: 90-degree cone, 20 tiles; X-COM 9 tiles in dark (tile shade>9); aliens 20 always; light falls off 1/tile; fire/flare light 15 (high)
Smoke: visibility cost +smoke/3 per voxel (about 3-4 tiles in fresh smoke); smoke grenade 7-15 turns; smoke stun smoke/4+1 per turn (high)
Fire on unit: 5-10 x IN modifier per turn; tile fire lasts fuel+1 turns; ignite chance = smoke - flammability/10 + 15 (high)
Crashed UFO: 75% chance per power source to explode, HE 180-250, radius 10 (high)
Alien count per row: Beg/Exp low+RNG(0,dQty); Vet/Gen low+(high-low)/2+RNG; SH high+RNG (high)
Alien difficulty growth per coefficient (0-4): TU 4%, Sta 4%, React 6%, Firing 6%, Str 2%, Psi 4%, Melee 4%; Beginner firing and armour x0.5 (high)
AI: grenades/blaster from turn 3; cheat turn 20 (or turn >10 with <=2 aliens alive); intelligence = memory turns 2-8 (high)
Map sizes: small scout 40x40x4, others 50x50x4, alien base 50x50x2, X-COM base 60x60x2; blocks 10x10 and 20x20; Skyranger 10x20 (high)
Debrief: alien killed +value (10-40), live capture 2x value if unresearched else 10, civilian saved +30, civilian killed by aliens -30 / by X-COM -50, power source +20, navigation +5 (high)
Promotion quotas: Sgt N/5, Capt N/11, Col N/23, Cmdr 1 if N>=30 (high)

## UNCERTAIN
ufopaedia.org could not be reached from this session (DNS blocked; the session's network settings would have to allow it); original-DOS-game behaviour not visible in OpenXcom code could not be cross-checked. Only search snippets were used (e.g. Muton AP 60% confirmed: https://www.ufopaedia.org/index.php/Muton).
Exact per-MCD TU walk costs (4 TU for typical ground is standard but individual tiles vary), door TU costs, and terrain armour values live in the binary MCD files and were not read.
Effective hit-probability table (section 3.2) is my Monte Carlo of applyAccuracy with an assumed +-4 x +-10 voxel target and no cover; real values depend on LOFT shapes and geometry.
Max throw distances come from OpenXcom getMaxThrowDistance and look generous (e.g. grenade at strength 40 is about 35 tiles); the original game's throw formula may differ.
The original game used a separate 'on target' accuracy roll before deviation; OpenXcom folds it into the deviation formula. Equivalence is approximate.
UFO interior room contents per UFO type were inferred from the dataset names (U_DISEC2, U_OPER2, U_PODS), not verified.
Sectopod weapon damage type is 4 (Laser) in the OpenXcom ruleset, although lore calls it a plasma beam.
Whether aliens suffer fatal wounds in the original DOS game: OpenXcom default is no (option alienBleeding).
Mind-control duration (until the start of the victim's original side's next turn) is read from code; it may differ from the original.
Elerium per intact power source: alienFuel [STR_ELERIUM_115, 50] places an Elerium item on each power source; the exact quantity credited at debrief was not traced.
Globe shade values for day, dusk and night that select the battlescape globalShade (0-15) were not traced in Globe.cpp.
OXCE-only features (cursor hit-chance display) are noted as such; vanilla OpenXcom shows accuracy only in the action menu.