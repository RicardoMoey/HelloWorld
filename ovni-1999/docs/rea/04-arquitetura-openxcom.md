# OpenXcom architecture deconstruction: reference for a JS/Canvas REA of UFO: Enemy Unknown

## 0. Where these facts come from

- **What was read.** Everything below comes from the **OpenXcom master source** (vanilla OpenXcom, not OXCE) and the **`bin/standard/xcom1/*.rul` rulesets**. Both were fetched from raw.githubusercontent.com on 2026-10-28 and read directly. Formulas below are transcribed from the code, not recalled from memory.
- **UFOpaedia could not be reached.** curl got a 403 from the proxy and WebFetch got ENOTFOUND. `www.ufopaedia.org` has to be allowed in this session's network settings to cross-check.
- **Local copies (scratchpad).**
  - C++ sources: `scratchpad/oxc/src/`
  - Rulesets: `scratchpad/oxc/*.rul`
  - Extra headers: `.../scratchpad/oxc2/`
  - `difficulty.rul`, `globe.rul`, `ufopaedia.rul`: `.../scratchpad/oxc3/`
- **Version caveat.** In current master, `AlienBAIState` and `CivilianBAIState` have been merged into one class, **`AIModule`**. The old per-faction classes only exist in OpenXcom ≤1.0.
- **Coordinate conventions used everywhere below.**
  - Tile positions are `Position(x,y,z)`. x grows east, y grows south, z grows up.
  - Voxel = tile × (16,16,24).
  - Directions: **0=N(y-1), 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, 8=UP, 9=DOWN**.
    - dx = `[0,1,1,1,0,-1,-1,-1,0,0]`
    - dy = `[-1,-1,0,1,1,1,0,-1,0,0]`
    - dz = `[0,0,0,0,0,0,0,0,1,-1]`
  - Geoscape rulesets give lon/lat in degrees. **Latitude is negative in the north** (USA label lat = -40). Longitude runs 0–360 east.

---

## 1. Engine layer (src/Engine)

### 1.1 Game loop (`Game::run`)

```
while (!quit):
  delete states in _deleted                    // pops are deferred → safe mid-frame
  if (!_init): _init=true; top.init(); top.resetAll(); top.handle(synthetic mouse move)
  for each OS event: build Action (scaled to 320x200 logical coords); cursor/fps handle;
       top.handle(action); if (!_init) break   // stack changed → re-init next loop
  if not PAUSED (app focus logic):
     top.think()                               // ONLY the top state thinks
     if frame due (FPS default 60, FPSInactive lower):
        screen.clear()
        i = top; while (i != bottom && !i.isScreen()) i--   // find nearest full-screen state
        for states from i..top: blit()          // popups draw over the screen below them
        cursor.blit(); screen.flip()
  SDL_Delay(1) running / 100 slowed-paused
```

- **State stack operations.**
  - `pushState(s)` → push and set `_init=false`.
  - `popState()` → move the state to `_deleted` and set `_init=false`.
  - `setState(s)` → pop everything, then push.
- **Why popups pause the game.** Only the top state thinks. A popup window is a non-screen `State` on top of `GeoscapeState`, so Geoscape time stops while it is open. `GeoscapeState::popup()` also calls `timerReset()`, which drops the speed back to 5 sec. This is the classic X-COM "event interrupts time" feel and should be copied.
- **`State` API:**
  - `init()`
  - `handle(Action*)` → forwards to child surfaces and widgets
  - `think()` → timers
  - `blit()` → children
  - `resize()`, `recenter()`
  - Flag `_screen` (full-screen vs window); `_modal` surface.
- **`Timer(interval ms)`.**
  - `think(state, surface)` calls a member-function pointer when `now - start >= interval`.
  - Optional frame-skip loop catches up to `maxFrameSkip` iterations.
  - Default intervals:

| Option / constant | Default |
|---|---|
| `geoClockSpeed` (geoscape game timer) | 80 ms |
| `dogfightSpeed` | 30 ms |
| Battlescape `_gameTimer` and `_animTimer` (`DEFAULT_ANIM_SPEED`) | 100 ms |
| `battleXcomSpeed`, `battleAlienSpeed` (walk-phase interval) | 30 ms |
| `battleFireSpeed` | 6 |
| `battleScrollSpeed` | 8 |
| `FPS` | 60 |

- **Screen and Surface.**
  - Original resolution is 320×200, 8-bit palette (`Screen::ORIGINAL_WIDTH/HEIGHT`), scaled up to the window.
  - `Surface` = indexed-colour buffer with `blitNShade(dst, x, y, shade 0..15)`; shading is a palette offset.
  - `InteractiveSurface` adds mouse handlers. Widgets: TextButton, Window, TextList, Text, Slider, ArrowButton, etc.
  - `Action` wraps an SDL event plus the scaled coordinates.
- **RNG.** Own seeded generator. The seed is saved in the savegame (`rng` key), so reloads are deterministic.
  - `RNG::generate(min,max)` is inclusive.
  - `RNG::percent(p)` = `generate(0,99) < p`.

### 1.2 Source tree and state classes (all paths verified to exist on master)

- **Engine/**: Game, State, Screen, Surface, InteractiveSurface, Timer, Action, RNG, Options, Language, Palette, Font, Sound/Music, CrossPlatform, FileMap.
- **Menu/**: MainMenuState, NewGameState, NewBattleState (skirmish), Load/SaveGameState, OptionsStates, CutsceneState.
- **Geoscape/**:
  - Core: GeoscapeState (time loop, popups, mission script engine), Globe (widget + projection).
  - Interception: DogfightState, InterceptState, DogfightErrorState.
  - Bases: BuildNewBaseState, ConfirmNewBaseState, BaseNameState, BaseDefenseState, AlienBaseState.
  - Craft movement: ConfirmLandingState, ConfirmDestinationState, SelectDestinationState, GeoscapeCraftState, CraftPatrolState, MultipleTargetsState, TargetInfoState.
  - Event popups: UfoDetectedState, UfoLostState, MissionDetectedState, LowFuelState, CraftErrorState.
  - Research/production popups: ResearchCompleteState, NewPossibleResearchState, NewPossibleManufactureState, ResearchRequiredState, ProductionCompleteState, ItemsArrivingState.
  - Reports: MonthlyReportState, FundingState, GraphsState.
- **Basescape/**:
  - Base view: BasescapeState, BaseView, MiniBaseView, BaseInfoState, MonthlyCostsState, StoresState.
  - Construction: BuildFacilitiesState, PlaceFacilityState, PlaceLiftState, DismantleFacilityState.
  - Research: ResearchState, NewResearchListState, ResearchInfoState.
  - Manufacture: ManufactureState, NewManufactureListState, ManufactureStartState, ManufactureInfoState.
  - Market and transfers: PurchaseState, SellState, TransferBaseState, TransferItemsState, TransferConfirmState, TransfersState.
  - Soldiers: SoldiersState, SoldierInfoState, SoldierArmorState, SoldierMemorialState, AllocatePsiTrainingState.
  - Craft: CraftsState, CraftInfoState, CraftSoldiersState, CraftEquipmentState, CraftArmorState, CraftWeaponsState.
  - Aliens: ManageAlienContainmentState.
- **Battlescape/**:
  - Core: BattlescapeState (UI/HUD), BattlescapeGame (action queue), Map, Camera, TileEngine, Pathfinding, AIModule, BattlescapeGenerator, Projectile, Explosion, Particle, Inventory, WarningMessage.
  - Battle substates: UnitWalkBState, UnitTurnBState, ProjectileFlyBState, ExplosionBState, MeleeAttackBState, PsiAttackBState, UnitDieBState, UnitFallBState, UnitPanicBState.
  - UI states: InventoryState, ActionMenuState, PrimeGrenadeState, MedikitState, ScannerState, UnitInfoState, NextTurnState, AbortMissionState, BriefingState, DebriefingState, AliensCrashState, PromotionsState, MiniMapState, InfoboxState.
- **Ufopaedia/**: Ufopaedia, UfopaediaStartState, UfopaediaSelectState, ArticleState plus Craft / CraftWeapon / Vehicle / Item / Armor / BaseFacility / Text / TextImage / Ufo / TFTD variants.
- **Savegame/** (runtime model):
  - Campaign: SavedGame, GameTime, Base, BaseFacility, Craft, CraftWeapon, Ufo, Waypoint, MissionSite, AlienBase, AlienMission, AlienStrategy, Country, Region, Soldier, ResearchProject, Production, Transfer, ItemContainer, Target, MovingTarget, WeightedOptions.
  - Battle: SavedBattleGame, Tile, BattleUnit, BattleItem, Node.
- **Mod/** (static rules): Mod, RuleItem, Armor, Unit, RuleSoldier, RuleCraft, RuleCraftWeapon, RuleUfo, RuleBaseFacility, RuleResearch, RuleManufacture, RuleTerrain, MapBlock, MapDataSet, MapData, MapScript, AlienDeployment, AlienRace, RuleAlienMission, UfoTrajectory, RuleMissionScript, RuleRegion, RuleCountry, RuleGlobe, Polygon, Texture, ArticleDefinition, RuleInventory.

**Architecture rule.** `Mod` = immutable rules; `Savegame` = mutable state that points at rules; `*State` = UI and controllers. Copy this split exactly.

---

## 2. Mod / ruleset layer

- **Containers.** `Mod` holds one `map<string, Rule*>` per collection, plus index vectors that keep file order:
  - countries, regions, facilities, crafts, craftWeapons, items, ufos, terrains, mapDataSets, soldiers, units, alienRaces, alienDeployments, armors, ufopaediaArticles, invs, research, manufacture, ufoTrajectories, alienMissions, missionScripts, MCDPatches, extraStrings, commendations, musics.
- **Top-level YAML keys:**
  - Rule lists: items, armors, units, soldiers, crafts, craftWeapons, ufos, facilities, research, manufacture, terrains, mapScripts, alienDeployments, alienRaces, alienMissions, missionScripts, ufoTrajectories, alienItemLevels, regions, countries, globe, startingBase, ufopaedia, invs.
  - Scalars and tables: startingTime, costEngineer, costScientist, timePersonnel, initialFunding, alienFuel, difficultyCoefficient, aimAndArmorMultipliers, statGrowthMultipliers, turnAIUseGrenade, turnAIUseBlaster, defeatScore, defeatFunds, constants.
  - Presentation and patches: extraSprites, extraSounds, extraStrings, interfaces, cutscenes, MCDPatches, converter.
- **Load semantics.**
  - Each record is keyed by `type` (or `name` for research and manufacture, `id` for trajectories, races and ufopaedia).
  - A later mod with the same key **merges and overrides** fields.
  - `delete: KEY` removes a record.
  - `listOrder` controls display order.
  - Player-visible strings are `STR_*` ids resolved through the language file. For pt-PT, keep `STR_*` ids in the data and ship a `pt-PT.json` string table.
- **xcom1 global constants (verified):**
  - **Start and economy:**
    - `startingTime` = 1999-01-01 12:00, weekday 6.
    - `costEngineer` 25000/month, `costScientist` 30000/month.
    - `timePersonnel` 72 h (hire delivery time).
    - `initialFunding` 6000 (thousands). `newSave` tops country funding up to this total, so starting funds ≈ $6,000,000.
    - `alienFuel` [STR_ELERIUM_115, 50].
  - **Difficulty and AI:**
    - `difficultyCoefficient` [0,1,2,3,4].
    - `aimAndArmorMultipliers` [0.5,1,1,1,1]. On Beginner, aliens get half firing and half armour.
    - `statGrowthMultipliers` {tu 4, stamina 4, health 0, bravery 0, reactions 6, firing 6, throwing 0, strength 2, psiStrength 4, psiSkill 4, melee 4}.
      - Alien stat += growth × coef × stat / 100.
    - `turnAIUseGrenade` 3, `turnAIUseBlaster` 3.
  - **Defeat and damage:**
    - `defeatScore` -900, `defeatFunds` -1,000,000.
    - `damageRange` 100, `explosiveDamageRange` 50, `fireDamageRange` [5,10].

---

## 3. Battlescape internals

### 3.1 SavedBattleGame (the battle world)

- **Tiles:** a flat array of `Tile*`, size X×Y×Z.
  - `index = z*sizeY*sizeX + y*sizeX + x`.
  - `getTile()` returns null when out of bounds.
- **Containers:** `_units` (all factions), `_items` (all battle items), `_nodes` (AI route nodes).
- **Turn state:**
  - `_side` (FACTION_PLAYER / HOSTILE / NEUTRAL), `_turn`, `_selectedUnit`, `_lastSelectedUnit`.
  - `_globalShade` (0 bright … 15 dark, from geoscape sun).
  - `_tuReserved` (BA_NONE / SNAPSHOT / AIMEDSHOT / AUTOSHOT), `_kneelReserved` (reserve an extra 4 TU).
- **Mission data:**
  - `_missionType`, `_objectiveType`, `_objectivesDestroyed/_needed`.
  - `_cheatTurn` = 20 (from deployment), `_turnLimit`, `_chronoTrigger`, `_depth` (TFTD), `_moduleMap` (base defence).
  - `_beforeGame` (pre-battle inventory phase).
- **Owned subsystems:** `TileEngine`, `Pathfinding`, and a pointer to `BattlescapeState` (UI).

### 3.2 Tile (`Savegame/Tile.h`)

```
objects[4]          MapData* per TilePart: O_FLOOR=0, O_WESTWALL=1, O_NORTHWALL=2, O_OBJECT=3
mapDataID[4], mapDataSetID[4]   (serialized ids)
currentFrame[4]     animation frame (UFO doors 0..7)
discovered[3]       fog: [0]=west wall seen, [1]=north wall seen, [2]=tile content seen
light[3]            light layers: 0 ambient/sun, 1 terrain/static (+fires,+flares), 2 dynamic (units)
smoke, fire         0..15 smoke density / fire turns remaining
explosive, explosiveType   pending HE to detonate (max power that reached it)
unit*               BattleUnit occupying (large units occupy 4 tiles)
inventory[]         BattleItems on the floor
visible, preview, TUMarker, markerColor, danger, obstacle, overlaps (smoke merges)
```

**Key Tile methods:**

| Method | Behaviour |
|---|---|
| `getTUCost(part, mt)` | 0 if no object; 0 if a UFO door is open (frame>1); 0 for O_OBJECT with bigWall ≥ 4; else `MapData.TU[mt]`. 255 means impassable. |
| `getTerrainLevel()` | `min(floor.T_Level, object.T_Level)`. Values are negative voxels: stairs -8/-16, -24 = full step to next level. |
| `hasNoFloor(below)` | false if the tile below has terrainLevel == -24; else `floor ? floor.isNoFloor : true`. |
| `getShade()` | `max(0, 15 - max(light[0..2]))`. |
| `openDoor(part, unit)` | **Normal door:** replace part with its `altMCD` (may change part type), returns 0. Big units (size>1) can't open normal doors; not enough TU (door TU + reserved) → 4. **UFO door:** frame 0→1 returns 1, still opening returns 3. |
| `closeUfoDoor()` | Called for all tiles at end of turn. |
| `animate()` | Every anim tick, frames cycle 0..7. UFO doors stay static at 0 (closed) or 7 (open). |
| `destroy(part)` | Gravlift is indestructible. Part → its `dieMCD` (same dataset). If the part has HE strength, `setExplosive` (chain reactions such as UFO power sources). Floor destroyed at z=0 → "scorched earth" (BLANKS #1). Returns true if the part was the mission objective special type. |
| `damage(part, power)` | `if power >= armor → destroy`. |
| `prepareNewTurn()` | Smoke/fire damage to the occupant: fire deals `smoke` as DT_IN damage, 40%×IN-modifier chance to ignite the unit for `rnd(0, 5×mod)` turns. Smoke alone stuns non-large units. |

### 3.3 MapData = MCD record (TERRAIN/*.MCD)

Each record is **62 bytes, packed**. Byte offsets:

| off | field | use in OpenXcom |
|---|---|---|
| 0-7 | Frame[8] | sprite index per animation frame (in the terrain PCK) |
| 8-19 | LOFT[12] | LOFTEMPS ids: 12 layers × (16×16 bit mask), each layer covers 2 voxel heights (24/12) |
| 20-21 | ScanG (u16 LE) | minimap icon |
| 22-29 | unused | |
| 30 | UFO_Door | animated sliding door |
| 31 | Stop_LOS | vision block (→ 255 if 1) |
| 32 | No_Floor | can fall through |
| 33 | Big_Wall | 0..9 (below) |
| 34 | Gravlift | up/down 8 TU, indestructible |
| 35 | Door | swing door (open → altMCD) |
| 36 | Block_Fire | |
| 37 | Block_Smoke | (→ 256 if 1) |
| 38 | unused | |
| 39 | TU_Walk | |
| 40 | TU_Slide | |
| 41 | TU_Fly | 255 = blocked |
| 42 | Armor | HP-like threshold; 255 = indestructible |
| 43 | HE_Block | explosion attenuation |
| 44 | Die_MCD | replacement when destroyed |
| 45 | Flammable | fire block / ignition (255 = never burns) |
| 46 | Alt_MCD | opened-door replacement |
| 47 | unused | |
| 48 | T_Level (signed) | terrain height offset in voxels (stairs) |
| 49 | P_Level | sprite Y offset when drawing |
| 50 | unused | |
| 51 | Light_Block | (unused by OpenXcom) |
| 52 | Footstep | sound index |
| 53 | Tile_Type | TilePart 0..3 |
| 54 | HE_Type | damage type of its own explosion |
| 55 | HE_Strength | explosion power when destroyed |
| 56 | Smoke_Blockage | |
| 57 | Fuel | turns it burns |
| 58 | Light_Source | light power emitted |
| 59 | Target_Type | SpecialTileType |
| 60 | Xcom_Base | base-module object (base-defence objective) |
| 61 | unused | |

- **Block values.** `setBlockValue(light, vision=Stop_LOS?255:0, HE=HE_Block, smoke=Block_Smoke?256:0, fire=Flammable, gas=HE_Block)`. `getBlock(type)` returns vision for DT_NONE, smoke for DT_SMOKE, and HE for HE/IN/STUN.
- **Enums:**
  - `MovementType` {MT_WALK, MT_FLY, MT_SLIDE, MT_FLOAT, MT_SINK}.
  - `VoxelType` {V_EMPTY=-1, V_FLOOR, V_WESTWALL, V_NORTHWALL, V_OBJECT, V_UNIT, V_OUTOFBOUNDS}.
  - `SpecialTileType` {TILE, START_POINT, UFO_POWER_SOURCE, UFO_NAVIGATION, UFO_CONSTRUCTION, ALIEN_FOOD, ALIEN_REPRODUCTION, ALIEN_ENTERTAINMENT, ALIEN_SURGERY, EXAM_ROOM, ALIEN_ALLOYS, ALIEN_HABITAT, DEAD_TILE, END_POINT, MUST_DESTROY}.
- **bigWall values** (objects that act like walls):

| Value | Meaning | Drawn |
|---|---|---|
| 0 | none | |
| 1 | full block (blocks all surrounding paths) | before units |
| 2 | diagonal NE-SW (allows ne/sw movement) | before units |
| 3 | diagonal NW-SE | before units |
| 4 | acts as west wall | before units |
| 5 | acts as north wall | before units |
| 6 | east wall | **after** units |
| 7 | south wall | **after** units |
| 8 | east+south | **after** units |
| 9 | west+north | before units |

- **Datasets.** `BLANKS` is dataset 0 of every terrain: #0 = blank, #1 = scorched earth.

### 3.4 Voxel model (LOS/LOF precision)

- **Dimensions.** Tile = 16×16×24 voxels. LOFT layer index = `(voxel.z % 24) / 2`. Bit test: `voxelData[loftID*16 + y] & (1 << (15 - x))`.
- **Units.** A unit is a vertical cylinder-ish LOFT (`armor.loftempsSet`) from `floatHeight - terrainLevel` up to `height`.
  - Soldier: stand 22, kneel 14.
  - Sectoid: 16 / 12.
  - Large units use 4 loftemps.
- **Gravlift floors** are solid only at z%24 ∈ {0,1} when there is no lift below.
- **`calculateLine(origin, target, …)`** is a 3D Bresenham (longest axis stepping, swap xy/xz).
  - In voxel mode it calls `voxelCheck` per voxel and returns the VoxelType hit.
  - In tile mode it checks wall and floor blockage between consecutive tiles; returns >127 if blocked.
  - Tile discovery uses **tile mode** (cheap). Unit visibility and firing use **voxel mode**.
- **`canTargetUnit(origin, tile, &scanVoxel, …)`** samples several target voxels: height offsets `heightFromCenter = {0,-2,+2,-4,+4,-6,+6,-8,+8,-12,+12}` around mid-height, plus lateral offsets. A unit is targetable or visible if **any** sample ray reaches it. That is how partial cover works.
- **`calculateParabola()`** handles throws and arcing shots. `validateThrow` tries target heights (+13, +8, +23, +2 …) to find a valid arc.

### 3.5 Pathfinding (`Battlescape/Pathfinding.cpp`)

**`calculate(unit, end, target=0, maxTU=-1)`:**
1. Bounds-check (account for unit size).
2. Reject if the destination floor or object is blocked.
3. Stairs fix (`isOnStairs`) → `end.z++`.
4. While destination terrainLevel == -24 → `z++`.
5. Non-flyers: while `canFallDown` → `z--`.
6. Big units: check the other 3 tiles.
7. **Strafe:** Ctrl + adjacent tile + same z.
8. Same z → try a **Bresenham straight path first**. Otherwise **A\*** with open set (priority = tuCost + tuGuess), **heuristic = 4·√(dx²+dy²+dz²)**, neighbours = 10 directions, skip cost ≥ 255, prune at `maxTUCost`.
   - With `sneakyAI` on, tiles visible to the player cost ×2 for aliens.
9. The path is stored as a list of directions in reverse; `dequeuePath()` pops the next one.

**`getTUCost(start, dir)` — one step, also returns the new position (stairs/falling).** For each sub-tile of the unit:

- **Cannot walk on air:** non-flyer on a tile with no floor (`canFallDown`) → only DIR_DOWN allowed (falling); otherwise 255.
- **Horizontal (dir<8):**
  - `isBlocked(start, dest, dir)` checks walls per direction, listed below.
  - If `start.terrainLevel - dest.terrainLevel > 8` → 255. This is the maximum step height: stairs are -8/-16 or -4/-12/-20.
- **Stairs:** if start terrainLevel ≤ -16 and the tile above the destination has a floor → go up a level (+1 TU).
- **Walking off a ledge:** non-flyer walking onto a no-floor tile whose tile-below terrainLevel ≤ -12 → step down a level.
- **Vertical (8/9):** `validateUpDown` (both tiles gravlift, or flying with no roof / no floor). **Cost 8**.
- **Wall crossing costs** (by direction):
  - N/NE/NW: start.northWall
  - E/NE/SE: dest.westWall
  - S/SE/SW: dest.northWall
  - W/SW/NW: start.westWall
  - The wall cost is **averaged** over the number of walls crossed (rubble walls have TU>0; doors are handled specially).
- **Cost assembly:**
  - `cost = dest.floor.TU[mt] + dest.object.TU[mt]` (object skipped if fell or on stairs).
  - No-floor destination → base 4.
  - **Diagonal (odd dir) cost ×1.5 (floored).**
  - Then + wallcost.
- **Modifiers:**
  - AI (non-player, not fire-immune) entering a burning tile: **+32** (discourages, does not forbid).
  - Strafing: +1 TU when direction ≠ facing; backwards strafing not allowed.
  - Big units: total averaged over 4 parts; also checks the inner X-shape between parts and rejects height differences >10. A tank cannot take one-tile stairs.
- **Missiles (blaster bombs) pathfind as MT_FLY:**
  - Friendly units and known enemies block.
  - Closed doors and closed UFO doors block.
  - Cost is 0.

**`isBlocked(tile, part)`:**
- Out of map → blocked.
- **O_FLOOR occupied by a unit:**
  - Player: blocked by any **visible** unit.
  - Same faction: blocked.
  - Aliens: blocked by units spotted this turn.
- O_BIGWALL types per direction; west/north walls also check the neighbour's east/south bigWalls.
- Any part with TU 255.

**Directional wall checks:**
- **N:** start.north.
- **NE:** start.north, NE.west, E.west, E.north, plus E/N bigWall (except type 2).
- **E:** E.west.
- **SE:** E.west, S.north, SE.north, SE.west, plus bigWall (except 3).
- **S:** S.north.
- **SW:** start.west, S.west, S.north, SW.north, plus bigWall (except 2).
- **W:** start.west.
- **NW:** start.west, start.north, W.north, N.west, plus bigWall (except 3).

**`findReachable(unit, tuMax)`.** Dijkstra flood over `getTUCost`, limited by TU and by energy (`(cost)/2 ≤ energy`). Returns tile indices sorted by cost. The AI uses it every think.

**Preview (`previewPath`):**
- Walks the path summing TU; energy use = TU/2 per step (0 for vertical).
- Each tile shows the remaining TU and a direction arrow.
- Marker colour:
  - **green (4)** = reachable while still keeping reserved TU
  - **yellow (10)** = reachable but eats into the reservation
  - **red (3)** = not enough TU or energy
- Kneeling units: 8 TU are pre-deducted (standing up).
- Running (Ctrl + strafe option): TU ×0.75, energy ×1.5.

**TU and energy costs:**
- A move spends TU = step cost and energy = TU/2.
- Turning: 1 TU per 45°.
- Kneel 4 TU, stand up 8 TU.

### 3.6 TileEngine (`Battlescape/TileEngine.cpp`)

#### Lighting
- **Layer 0, sun** (`calculateSunShading`): `power = 15 - globalShade`. In daylight (globalShade ≤ 4), tiles with any roof (floor/object blockage above) get -2.
- **Layer 1, terrain** (`calculateTerrainLighting`): sources are floor/object `Light_Source`, fires (power 15) and flares on the ground (item power).
- **Layer 2, units** (`calculateUnitLighting`): soldiers' personal light 15 (toggleable) and burning units 15.
- **`addLight(center, power, layer)`:**
  - For |dx|,|dy| ≤ power: value = `power - round(√(dx²+dy²))`, applied to **every z level**, keeping the max per tile.
  - Shade = `15 - max(layers)`.

#### Field of view (`calculateFOV(unit)`)
- **Shape:** a 90° wedge of radius **MAX_VIEW_DISTANCE = 20 tiles**, over all z.
  - Diagonal facing → quadrant.
  - Cardinal facing → triangle `y ∈ [-x, x]`.
- Eye height is raised one z if the unit pokes into the tile above.
- **Units** in the wedge: tested with `visible()`. Player units mark seen units as visible. Aliens add spotted player units and reset their `turnsSinceSpotted = 0`.
- **Terrain discovery (player only):** tile-mode line from each of the unit's tiles to the test tile. Every traversed tile gets `setVisible` and `discovered[2]`; the east neighbour gets `discovered[0]`, the south neighbour `discovered[1]`. Walls facing you are revealed.
- **Return value:** true if new units were spotted. This is used to interrupt walking.

#### `visible(viewer, tile)`
- No unit on the tile → false.
- **Darkness:** a player viewer can see a unit beyond **9 tiles only if tile shade ≤ 9** (`MAX_DARKNESS_TO_SEE_UNITS`). Aliens see in the dark. Distance > 20 → false.
- Friends are always seen.
- Otherwise `canTargetUnit` (voxel rays) and **smoke attenuation**: walk the voxel line; for each voxel in a tile with smoke and no fire, add `smoke/3` to the distance. If the total exceeds 320 voxels (20 tiles) → not visible. Fresh smoke cuts visibility to about 4 tiles.

#### Reaction fire (`checkReactionFire(actor)`)
- **When:** called after each step of a walk, and after kneeling, turning and other visible actions.
- **Spotters:** units of the non-active side (no civilians, not out, health>0, stun<health) within 20 tiles where all of the following hold:
  - the actor is in the 90° `checkViewSector`, **or** the spotter was hit by the actor this turn (AI remembers who hit it until end of turn);
  - `canTargetUnit`;
  - `visible`.
- **Reaction type** (`determineReactionType`):
  - Melee if adjacent with a melee weapon and TU > cost.
  - Else **snap shot** if the main weapon has a snap cost, ammo, `dist² < maxRange²`, and TU > snap cost.
  - Player soldiers also need the weapon researched.
- **Loop:**
  - **Reaction score = reactions × currentTU / maxTU.**
  - Pick the spotter with the best score. If it is ≥ the actor's own score, it fires (`ProjectileFlyBState` / `MeleeAttackBState` pushed to the back of the queue) and spends TU, which lowers its score.
  - Repeat until no spotter beats the actor.
  - Player reactors gain reaction experience.
  - Hostile reactors skip explosive shots that would hit friends (`explosiveEfficacy`).

#### `hit(voxel, power, type, attacker)` — single-point weapons (AP, laser, plasma, melee, acid)
- **Terrain part hit:** damage `rnd(power/4, 3·power/4)` vs part armour → destroy (base-defence module counters updated).
- **Unit hit:** damage `rnd(power·(100-R)/100, power·(100+R)/100)`.
  - R = 100 normally, so **0–200%**.
  - R = 50 for HE, so **50–150%**.
  - Relative impact position decides side and body part.
  - Morale loss = `100·(dmg·((110-bravery)/10)/10)/leaderModifier`.
  - Attacker gains firing experience.
- Then `applyGravity`, recalculate sun and terrain lighting, recalculate FOV around the impact.

#### `explode(voxel, power, type, maxRadius, attacker)` — area weapons
- DT_IN power is halved first.
- **Ray casting:**
  - Pitch fi from -90 to 90 step 5°; yaw te from 0 to 360 step 3°.
  - Each ray steps 1 tile at a time from the centre tile.
  - `power_ -= 10` per tile.
  - `-= vertdec` when z changes. Default `battleExplosionHeight` 0 → 1000, so explosions are flat; options give 30/10/5.
  - `-= 2·(verticalBlockage + horizontalBlockage)` from walls, floors and objects (HE_Block).
  - Fire rays lose an extra 5 per diagonal step.
  - Stop when `power_ ≤ 0` or `l > maxRadius`.
  - Each tile is processed once (set).
- **Effects per tile type:**
  - **HE:** `tile.setExplosive(power_)` for later terrain damage. Unit damage 50–150%; ground zero or above-the-blast hits the underside. Items destroyed if `power_ > item.armor`; unconscious units on the ground die.
  - **STUN:** 0–200% stun.
  - **SMOKE:** tiles with smoke<10 get `smoke = rnd(7,15)`.
  - **IN:** non-void tiles get `fire = fuel+1` and `smoke = clamp(15 - flammability/10, 1, 12)`. Units take `rnd(5,10)×IN-modifier` and catch fire for `rnd(0, 5×mod)` turns.
- After HE: `detonate()` every affected tile (terrain damage from stored explosive vs part armour, including neighbouring walls), then `applyGravity` on the tile and the one above.
- **Blast radius** (`RuleItem::getExplosionRadius`): explicit `blastRadius`, otherwise IN = power/30+1, HE/STUN/SMOKE = power/20, **capped at 11**. Example: xcom1 grenade power 50 HE, blastRadius 5.

#### Fire and smoke at turn rollover (`SavedBattleGame::prepareNewTurn`)
- **Fire:** each burning tile with no new fire this turn: `fire -= 1`.
  - If still burning, try to `ignite` the 4 cardinal neighbours where `horizontalBlockage(DT_IN) == 0`, using its smoke as intensity.
  - If burnt out: smoke = 0, and the object (and floor) is destroyed if flammable≠255 and armour≠255. Gravity applied.
- **Smoke** then spreads and decays. Overlapping smoke is averaged: `smoke = clamp(smoke/overlaps - 1, 0, 15)`.

#### Other TileEngine pieces
- **`applyGravity(tile)`:** a unit falls while every one of its tiles has no floor. Flyers just hover; others are added to the falling list → `UnitFallBState`. Items drop to the lowest floor.
- **Doors:** `unitOpensDoor(unit, rClick, dir)` opens the wall in front.
  - Normal doors swap to `altMCD`, which is permanent until changed.
  - UFO doors animate 8 frames and **close at end of turn** if nobody is in them.
  - `checkAdjacentDoors` opens double doors.
- **Misc:** `faceWindow(pos)` = the direction of a nearby window, used by AI facing. `getDirectionTo`, `distance` (tiles), `distanceSq`.

### 3.7 Combat math (BattleUnit / Projectile)

- **Action TU** (`getActionTUs`):
  - auto / snap / aimed / melee / use = weapon `tu*` value as a **percentage of the unit's max TU** (unless `flatRate`).
  - **Throw = 25%**, **Prime = 50%** (always %).
  - Launch = aimed cost.
  - Autoshot = **3 shots** (`autoShots` default 3).
- **Firing accuracy (%)** = `firingStat × weaponAcc[mode] / 100`
  - **×1.15 if kneeling**
  - **×0.8 if two-handed and the other hand is full**
  - **× max(10, 25·hp/maxHp + 75 − 10·(head wounds + firing-arm wounds)) / 100**
  - Melee: `meleeStat × accuracyMelee/100 × modifier` (if `skillApplied`).
- **Spread** (`applyAccuracy`, voxel space, acc = accuracy/100):

```
xyShift = (xDist/2 <= yDist) ? xDist/4 + yDist : (xDist+yDist)/2
zShift  = (xyShift <= zDist) ? xyShift/2 + zDist : xyShift + zDist/2
dev = rnd(0,100) - acc*100;  dev += (dev >= 0) ? 50 : 10      // miss cloud vs hit cloud
dev = max(1, zShift*dev/200)
target.x += rnd(0,dev) - dev/2;  target.y += rnd(0,dev) - dev/2;  target.z += rnd(0,dev/2)/2 - dev/8
then the line is extended to 1000 tiles (bullets fly on past the target)
```

  - Accuracy ≥109% → near-perfect shots.
  - Spread grows linearly with distance, so range matters without an explicit range penalty.
  - Range dropoff (`aimRange` 200, `snapRange` 15, `autoRange` 7, `minRange` 0, `dropoff` 2%/tile) only applies with option `battleUFOExtenderAccuracy` (default off).
- **Damage to units** (`BattleUnit::damage(relative, power, type)`):
  1. `power *= armor.damageModifier[type]`. Order: [NONE, AP, IN, HE, LASER, PLASMA, STUN, MELEE, ACID, SMOKE]. Smoke becomes stun.
  2. **Side.** `relative == 0` → UNDER. Otherwise derive the attack direction and compare with unit facing: `(relDir - facing) % 8` → 0 FRONT, 2 RIGHT, 4 REAR, 6 LEFT. Odd values pick randomly (2/3 vs 1/3) between the two adjacent sides.
  3. **Body part.** `relative.z ≥ height` → HEAD; z > 4 → arm on the side (torso front/back); else leg.
  4. `power -= armor[side]`.
  5. If > 0:
     - **stun** → stun += power;
     - **other** → health -= power, extra stun `rnd(0, power/4)`;
     - fatal wound if `rnd(0,10) < power`: +`rnd(1,3)` wounds on that part, morale -wounds;
     - **armour degrades: armor[side] -= power/10 + 1**.
  - IN damage does not wound or degrade armour.
- **Per-turn unit upkeep** (`prepareNewTurn`, for units of the side starting its turn):
  - **TU** = TU stat × min(1, strength/carriedWeight) × (1 - 10% per leg wound).
  - **Energy** += soldiers: initial TU/3; aliens: `energyRecovery` (default 30). Torso wounds reduce recovery by 10% of energy each. Capped at stamina.
  - **HP** -= number of fatal wounds. Burning: -`rnd(5,10)×IN-modifier`, fire turns -1.
  - **Stun** -1.
  - **Panic roll:** `chance = 100 - 2×morale` (only below 50 morale); on success 33% berserk, else panic (flee or freeze).
- **Morale:**
  - **Being hit:** as in `hit()` above.
  - **Ally killed:** each ally of the victim loses `modifier·200·((110-bravery)/10)/loserMod/100`. Winners gain +10.
  - **Killer:** +20·mod/100 for an enemy kill; penalties for killing friendlies.
  - **Leadership modifier** (highest-ranked soldier present): sergeant 110, captain 115, colonel 125, commander 150.
  - **Own-rank modifier:** sergeant 120, captain 130, colonel 150, commander 175.
- **Experience** (`postMissionProcedures`) — counters bump on use (firing exp on hits, reactions, throwing, melee, psi, bravery):
  - Stat gain by exp count: >10 → +2..6; >5 → +1..4; >2 → +1..3; >0 → +0..1.
  - Bravery: +10 if `exp > rnd(0,10)`.
  - If any exp: rookie → squaddie; TU, health and strength += `rnd(0, (cap-stat)/10 + 2)`; stamina += `rnd(0, (cap-stat)/15 + 2)`.
  - Wound recovery days = `rnd(0.5·hpLost, 1.5·hpLost)`.
- **Promotions** (base-wide totals):
  - 1 commander if ≥30 soldiers (from colonels);
  - colonels = total/23 (from captains);
  - captains = total/11 (from sergeants);
  - sergeants = total/5 (from squaddies).
  - Rank order: Rookie, Squaddie, Sergeant, Captain, Colonel, Commander.

### 3.8 BattleUnit (key fields)

- **Enums:**
  - `UnitStatus` {STANDING, WALKING, FLYING, TURNING, AIMING, COLLAPSING, DEAD, UNCONSCIOUS, PANICKING, BERSERK, IGNORE_ME}.
  - `UnitFaction` {PLAYER, HOSTILE, NEUTRAL}.
  - `UnitSide` {FRONT, LEFT, RIGHT, REAR, UNDER}.
  - `UnitBodyPart` {HEAD, TORSO, RIGHTARM, LEFTARM, RIGHTLEG, LEFTLEG}.
- **Position and motion:** `faction`, `originalFaction` (mind control), `id`, `pos`, `lastPos`, `direction`, `toDirection`, `turretDirection`, `verticalDirection`, `destination`, `status`, `walkPhase` (0..7; diagonal 0..15 for 2×2), `fallPhase`.
- **Vision:** `visibleUnits[]`, `unitsSpottedThisTurn[]`, `visibleTiles[]`, `turnsSinceSpotted` (0..255).
- **Live stats:** `tu`, `energy`, `health`, `morale`, `stunlevel`, `kneeled`, `floating`, `currentArmor[5]`, `maxArmor[5]`, `fatalWounds[6]`, `fire`.
- **Equipment:** `inventory[]`, `activeHand`, `specWeapon[3]`.
- **AI:** `aiModule`; static `intelligence`, `aggression`, `value`, `specab` (EXPLODEONDEATH, BURNFLOOR, BURN_AND_EXPLODE), `spawnUnit` (zombie → chryssalid).
- **Experience counters:** `exp*`, `kills`, `motionPoints` (for motion scanner).
- **Static data:** `stats` (tu, stamina, health, bravery, reactions, firing, throwing, strength, psiStrength, psiSkill, melee), `standHeight`, `kneelHeight`, `floatHeight`, `armor*`, `movementType`, `loftemps`.
- **`value`:**
  - Aliens: from the unit rule.
  - Soldiers: 20 + missions + rank bonus (sgt 1, capt 3, col 6, cmdr 10).

### 3.9 BattlescapeGame: action queue and battle states

```
enum BattleActionType { BA_NONE, BA_TURN, BA_WALK, BA_PRIME, BA_THROW, BA_AUTOSHOT, BA_SNAPSHOT,
                        BA_AIMEDSHOT, BA_HIT, BA_USE, BA_LAUNCH, BA_MINDCONTROL, BA_PANIC, BA_RETHINK }
struct BattleAction { type, actor, weapon, target(Position), waypoints[], TU, targeting(bool), value,
                      result(STR_ warning), strafe, run, diff, autoShotCounter, cameraPosition,
                      desperate, finalFacing, finalAction, number }
```

- **Queue.** `_states` is a `std::list<BattleState*>`. `handleState()` (on the battle game timer) calls `front.think()` only.
  - `statePushFront` (and init) puts it first.
  - `statePushNext` inserts second (e.g. an explosion caused by the current projectile).
  - `statePushBack` queues it (e.g. reaction shots).
  - A **null entry = "end turn" marker**.
- **`popState()`:**
  - Player action failed → show the `action.result` warning (STR_NOT_ENOUGH_TIME_UNITS, …).
  - Player targeted actions (shoot/throw) spend TU here; others already spent.
  - **AI performs up to 3 actions per unit** (`_AIActionCounter > 2`) before the next unit. When none is left, push the end-turn marker.
- **`think()` when the queue is empty:**
  - Falling units → `UnitFallBState`.
  - Non-player side: reset hit states; for the selected unit, handle panic, else `handleAI(unit)` (`AIModule.think(action)` → push the matching BState); select the next unit.
  - Player side: handle panicking soldiers first.
- **`BattleState` interface:** `init()`, `think()`, `cancel()`, `getAction()`.

| BattleState subclass | What it does |
|---|---|
| UnitWalkBState | Each walk phase at 30 ms. Per tile: check TU and energy (energy = TU/2), open doors in the way, move, then `calculateFOV(unit)` + `checkReactionFire(unit)`. **If new enemies are spotted (count of `unitsSpottedThisTurn` changed), abort the remaining path** (unless `desperate`, AI escape). Handles falling and burning floors. |
| UnitTurnBState | 1 TU per 45° step (unless free), recalculates FOV, can trigger reactions. |
| ProjectileFlyBState | Validates weapon, ammo and TU. Builds a `Projectile` (accuracy line or throw parabola, or waypoint missile). Animates bullet sprites at `battleFireSpeed`. On impact pushes `ExplosionBState`. Repeats for autoshot (`autoShotCounter` to 3). |
| ExplosionBState | Plays the hit or explosion animation. Then `hit()` (point) or `explode()` (AoE: grenade, HE ammo, terrain explosive, exploding unit power 120). Then `checkForCasualties`; terrain chain explosions queue more ExplosionBStates. |
| MeleeAttackBState | `RNG::percent(meleeAccuracy)`, power = weapon power (+ strength if `strengthApplied`, alien natural weapons). `hit()` at the target's centre. |
| PsiAttackBState | Panic / mind control rolls (psiStrength and psiSkill). |
| UnitDieBState | Collapse animation, drop inventory, spawn corpse item (or convert to `spawnUnit`), morale effects. |
| UnitFallBState | Falling units, one z per phase. |
| UnitPanicBState | Runs the panic or berserk behaviour. |

**End-turn sequence** (`BattlescapeGame::endTurn` + `SavedBattleGame::endTurn`):

1. Close UFO doors.
2. Explode any ground grenades with fuse 0, one at a time; re-enter `endTurn` after each (push explosion + marker).
3. Process terrain explosions (`checkForTerrainExplosions`).
4. Decrement primed-grenade fuses (not on the civilian turn).
5. **Rotate sides:** PLAYER → HOSTILE → NEUTRAL (skipped if there are no civilians) → PLAYER. On return to the player: `prepareNewTurn` (fire/smoke) and `turn++`.
6. **Cheat mode:** if `(turn > cheatTurn/2 && liveAliens ≤ 2) || turn > cheatTurn(20)`, aliens know every soldier's position.
7. `turnsSinceSpotted++` for all units. Reset AI modules. Units of the new side get `prepareNewTurn`. **Hide all non-player units, then recompute FOV.**
8. `checkForCasualties`. Mission ends when all aliens are out (stunned/dead/MC-captured) or all soldiers are out.
   - Abort = only soldiers on END_POINT / craft tiles survive.
   - → `DebriefingState`.

### 3.10 AI (`AIModule`; replaces AlienBAIState/CivilianBAIState)

- **Modes:** AI_PATROL, AI_AMBUSH, AI_COMBAT, AI_ESCAPE.
- **Saved state:** AIMode, fromNode, toNode, wasHitBy[].

**`think(action)`:**
1. Gather counts:
   - `knownEnemies` = player units with `turnsSinceSpotted ≤ intelligence`; **intelligence = turns of memory**.
   - `visibleEnemies`.
   - `spottingEnemies` = enemies who can see this tile.
   - `reachable = findReachable(TU)`, and `reachableWithAttack` with TU minus the snap (rifle) / aimed (blaster) / melee cost.
2. Set up candidate actions:
   - `setupEscape()` if spotted;
   - `setupAmbush()` if known enemies and not melee;
   - `setupAttack()`;
   - `setupPatrol()`.
   - A psi action, if any, is used first.
3. **Re-evaluate mode** if:
   - Patrol and any enemy sighted, or a 10% random chance.
   - Ambush and (no rifle, or no ambush spot, or enemies visible).
   - Combat and the attack failed.
   - Escape and nobody spots it / no known enemies.
   - Always when spotted by >2 enemies, HP < 2/3, the aggro target is lost beyond its memory, or cheat mode.
4. Execute the chosen mode's action.
   - Patrol reserves TU by aggression: 0 → aimed, 1 → auto, 2 → snap.
   - Escape sets `finalAction` and `desperate`, and the unit turns 180° at the end.

**`evaluateAIMode` weights (base → multipliers):**
- **Base odds:** escape 15 (melee 12; 5 if hostile with >50% TU or charging), ambush 12, combat 20, patrol 30 (15 if it sees enemies).
- **Spotted:** patrol = 0.
- **No rifle or no ambush spot:** ambush = 0; melee units get combat ×1.3.
- **Known enemies:** exactly 1 → combat ×1.2. None known (hostile) → combat = escape = 0.
- **Current mode:** that mode ×1.1. Already in combat → ambush ×1.5.
- **Health:**
  - <1/3: escape ×1.7, combat ×0.6, ambush ×0.75.
  - <2/3: escape ×1.4, combat ×0.8, ambush ×0.8.
  - <100%: escape ×1.1.
- **Aggression:** 0 → escape ×1.4, combat ×0.7; 1 → ambush ×1.1; 2 → combat ×1.4, escape ×0.7.
- **Spotted by N:** escape = 10·escape·(N+10)/100, combat = 5·combat·(N+20)/100. Not spotted → escape /2.
- **Visible enemies V:** combat = 10·combat·(V+10)/100. Closest enemy <5 tiles → ambush 0.
- **Ambush spot exists:** ambush ×1.7. Base defence: escape ×0.75, ambush ×0.6.
- **No weapon, grenade or psi:** combat = ambush = 0.
- **Pick:** weighted roll. Cheat mode or charging forces COMBAT.
- **Fallback chain:** COMBAT → PATROL (if it has a node) → AMBUSH → ESCAPE.

**Patrol** (nodes, see 3.12):
- `fromNode` = nearest node on the same z that fits the unit size.
- **Scout** if: not base defence and (cheat mode, fromNode rank 0 = outside, or standing in fire).
  - Scouts roam **any** node at random.
  - Guards move only along `fromNode`'s links, preferring the highest `flags` (patrol desirability) and nodes of their preferred rank.
- **Excluded nodes:** dummy, allocated, TYPE_DANGEROUS (an alien was shot there), occupied, burning, inside a grenade danger zone, wrong size or fly flags.
- Up to 5 tries; a node is valid only if the path exists.
- **Base defence:** small armed aliens walk to unallocated "target" nodes in modules and snap-shoot base objects there.

**Ambush:**
- Candidates: nodes ≤10 tiles away, same z, reachable with attack TU, not dangerous, **not targetable by the aggro target**, and not spotted.
- **Score = 100 − TU to reach + 25 if a window is adjacent** (`faceWindow`). Accept immediately when >80.
- Final facing: simulate the enemy walking the path toward the ambush spot; face where the first shot becomes possible.

**Attack (`setupAttack`):**
- Known enemies: try psi, then blaster waypoint attack.
- Visible target (nearest): choose melee or ranged; grenade (`grenadeAction`, only from turn ≥ `turnAIUseGrenade` = 3, needs explosive efficacy); melee; `projectileAction`.
- Otherwise, if spotted or `aggression < rnd(0,3)`: `findFirePoint()` (move to a tile with LOF).

**Fire mode by distance (`selectFireMethod`):**
- **< 4 tiles:** auto, else snap, else aimed.
- **> 12 tiles:** aimed, else snap if < 20.
- **Otherwise:** snap, then aimed, then auto (whichever TU allows).

**Other AI behaviour:**
- **Reaction:** AI reactor units turn aggressive. `wasHitBy` makes an alien that was shot react to its attacker even outside its view sector, until end of turn.
- **Spawn facing:** aliens face a window; or, if ≤20 tiles from the craft, with chance 20%×difficultyCoef, face the craft.
- **Civilians** use the same module with escape/patrol behaviour.

### 3.11 Map drawing and camera (`Map.cpp`, `Camera.cpp`)

- **Sprite and level size.** Terrain/unit sprite = **32×40 px**. Level height = `(40 + 32/4)/2` = **24 px**.
- **Map → screen:** `sx = (x − y)·16`, `sy = (x + y)·8 − z·24` (+ mapOffset).
- **Screen → map:**
  - `sy += −16 + viewZ·24`
  - `mapY = −sx + offX + 2sy − 2offY`
  - `mapX = sy − offY − mapY/4 − 8`
  - `mapX /= 8`, `mapY /= 32`
- **Voxel → screen:** tile position + `(dx − dy) + 16`, `20 + dx/2 + dy/2 − dz`.
- **Loops (painter's order):** `for z in 0..viewLevel` (or all with show-all-layers), then `for x`, then `for y`, culled to screen bounds.
- **Per-tile draw order:**
  1. floor (y − P_Level)
  2. cursor back half
  3. units standing in back neighbours (walking units span 2 tiles)
  4. **west wall** (door frames animated; shaded)
  5. **north wall**
  6. **object** if bigWall < 6 or == 9
  7. top floor item + item shadow
  8. thrown item / bullet + shadow on the floor
  9. **unit** on this tile (or the one below poking up)
  10. units from front neighbours
  11. **smoke / fire** particles (smoke frame offset = `floor(smoke/6 − 0.1)`)
  12. path-preview arrows / TU numbers in marker colour
  13. **front objects** (bigWall 6, 7, 8)
  14. cursor front half
  15. waypoints
- A second pass draws the selected-unit arrow (bobbing) and explosions.
- **Fog of war:** if `!discovered[2]`, shade = 16 (black) and units are not drawn. Wall visibility uses `discovered[0/1]`.
- **Cut-away:** levels above `viewLevel` are simply **not drawn**. Up/down buttons change `viewLevel`. The camera follows the acting unit (smooth scroll option) and auto-jumps to reaction shooters and explosions (`cameraPosition` stored in BattleAction).
- **Unit sprites** are composited per unit into cached surfaces (`cacheUnit`, invalidated on state or facing change).

### 3.12 BattlescapeGenerator, MAP/RMP, mapScripts, deployments

**`run()`:**
1. Pick the deployment: by UFO type or mission type.
2. Set turnLimit / chronoTrigger / cheatTurn; map size = deployment `width × length × height` (e.g. small scout 40×40×4).
3. Pick the terrain: deployment terrains, or the globe texture's terrain list at the target.
4. Pick the map script: deployment script or terrain script.
5. `generateMap(script)`.
6. Set up objectives.
7. **deployXCOM:** soldiers and HWPs on craft START_POINT tiles; the craft inventory tile holds equipment.
8. **deployAliens.**
9. Deploy civilians (count from the deployment).
10. Fill UFO power sources with Elerium; **if the UFO crashed, explode power sources** (crater damage) and leave fewer aliens alive (crash damage).
11. Set global shade from world shade; compute sun, terrain and unit lighting.

**MAP file:**
- Header 3 bytes: `[sizeY(rows), sizeX(cols), sizeZ]`.
- Then 4 bytes per tile: `[floor, westWall, northWall, object]` MCD indices into the terrain's **concatenated** mapDataSets. 0 = empty; dataset 0 = BLANKS.
- Order: **top level first** (z = sizeZ−1 down to 0), then rows y, then columns x.
- Blocks are 10×10 (or 20×20 etc.). UFO and craft blocks are stacked on top of the existing highest floor.

**RMP file** (ROUTES/*.RMP), 24 bytes per node:

| byte | meaning |
|---|---|
| 0 | y |
| 1 | x |
| 2 | z (inverted: mapZ = blockZ−1−z) |
| 3 | unused |
| 4,7,10,13,16 | 5 link node ids (+2 ignored bytes each). 255 = none; 254/253/252/251 = exit N/E/S/W, linked to the neighbouring block by `attachNodeLinks` |
| 19 | type flags: 0x01 flying-only, 0x02 small-only (0x04 DANGEROUS set at runtime) |
| 20 | rank (NodeRank) |
| 21 | flags = patrol desirability (0..n) |
| 22 | reserved |
| 23 | **priority**: spawn priority, 0 = never spawn |

- **NodeRank:** 0 SCOUT (outside UFO), 1 XCOM, 2 SOLDIER, 3 NAVIGATOR, 4 LEADER/COMMANDER, 5 ENGINEER, 6 MISC1 (terrorist), 7 MEDIC, 8 MISC2.
- **Alien rank index** (race `members` order, deployment `alienRank`): 0 commander, 1 leader, 2 engineer, 3 medic, 4 navigator, 5 soldier, 6 terrorist, 7 terrorist2.
- **Spawn node preference** (`Node::nodeRank[alienRank][0..6]`), last fallback 0:

| Alien rank | Node ranks tried in order |
|---|---|
| commander | 4, 3, 5, 8, 7, 2 |
| leader | 4, 3, 5, 8, 7, 2 |
| engineer | 5, 4, 3, 2, 7, 8 |
| medic | 7, 6, 2, 8, 3, 4 |
| navigator | 3, 4, 5, 2, 7, 8 |
| soldier / terrorist | 2, 5, 3, 4, 6, 8 |

- **`getSpawnNode(rank, unit)`:** among matching nodes (size and fly flags fit, priority > 0, free), keep those with the **highest priority** and pick one at random.
- "Outside" aliens (`percentageOutsideUfo`) only use rank-0 nodes.

**mapScripts** (xcom1) — commands run in order:
- `addUFO`, `addCraft`: place the special block at a random free position.
- `addBlock`: optional size 2, groups, executions.
- `addLine`: vertical/horizontal/both roads; `rects`, `executionChances`, labels and conditionals.
- `fillArea`: fill remaining 10×10 slots with weighted blocks; `blocks`, `freqs`, `maxUses`, `groups`.
- `digTunnel` (alien base): MCD replacements.
- `removeBlock`, `checkBlock`.
- Examples:
  - FARM = addUFO, addCraft, fillArea (blocks 1-18, maxUses 3 each).
  - URBAN = addCraft + random roads + addBlock size 2 ×4 + fillArea.
  - DEFAULT/DESERT/POLAR: addBlock size 2 ×2-3 then fill.

**deployAliens:**
- For each deployment `data` entry, quantity:
  - Beginner/Experienced: `lowQty + rnd(0,dQty)`.
  - Veteran/Genius: `lowQty + (highQty−lowQty)/2 + rnd(0,dQty)`.
  - Superhuman: `highQty + rnd(0,dQty)`.
  - Plus `rnd(0, extraQty)`.
- Each alien: `outside = rnd(0,99) < percentageOutsideUfo`.
- Item set index = `alienItemLevels[min(month, 9)][rnd(0,9)]`. Item levels: 0 = pistol set, 1 = rifle, 2 = heavy plasma, in the xcom1 tables.
- Terror units get a built-in `<RACE>_WEAPON`.

### 3.13 Debriefing score (`DebriefingState`)

- **Positive:**
  - +alien `value` per alien killed by X-COM;
  - live alien recovered: its value (or 10);
  - corpses and artifacts: each item's `recoveryPoints`;
  - UFO components counted from special tiles (power source, navigation, …);
  - civilians saved: +value.
- **Negative:**
  - −soldier value per KIA or MIA;
  - −tank value;
  - civilians killed by aliens −value; killed by X-COM −(value + 2·value/3);
  - craft lost −craft score.
- Recovered items go to base stores. Elerium from power sources: `alienFuel` 50 per source.

---

## 4. Geoscape internals

### 4.1 Time
- `GameTime.advance()` = **+5 game seconds** and returns the highest trigger crossed. Triggers fall through: MONTH → DAY → HOUR → 30MIN → 10MIN → 5SEC (a month boundary also runs the day, hour, … handlers).
- **Speed buttons = 5-sec ticks per game-timer tick (80 ms real):**

| Button | Ticks per timer tick |
|---|---|
| 5 sec | 1 |
| 1 min | 12 |
| 5 min | 60 |
| 30 min | 360 |
| 1 h | 720 |
| 1 day | 17,280 |

- Any popup or dogfight sets `_pause` and `timerReset()` → back to 5 sec.

**Handlers:**
- **5 s:** move UFOs (`Ufo.think`) and handle waypoint arrival (mission logic); landed/crashed timers; move crafts and handle arrival:
  - flying UFO → dogfight (max 4 at once, only if UFO speed ≤ craft max speed);
  - landed/crashed UFO with soldiers → ConfirmLandingState;
  - waypoint → patrol;
  - base reached → refuel.
  - Lose condition: no bases left.
- **10 min:**
  - Craft fuel: **−speed/100 per 10 min** (−1 if the craft has a `refuelItem`). Low fuel → return to base.
  - Crafts without a destination may discover alien bases in sight range: `50 − 50·dist/range %`.
  - UFOs detect X-COM bases (retaliation targeting).
- **30 min:**
  - `AlienMission.think` (wave countdowns) and remove finished missions.
  - Crashed-UFO expiry.
  - Craft refuel (`refuelRate` per 30 min).
  - **Alien activity points:** each flying UFO adds `missionScore` (default 1) to its region and country; landed ×2.
  - **UFO detection rolls** (4.4).
  - Mission sites: −30 min each; points every 30 min; on expiry `despawnPenalty`.
- **1 h:** craft repair (`repairRate`, default 1 damage/h) then rearm; transfers; **production**.
- **1 day:**
  - **Facility construction** (`buildTime` in days).
  - **Research.**
  - Soldier wound recovery (−1 day).
  - Alien base daily points (deployment points); alien base supply missions.
  - Autosave on days 10 and 20.
- **1 month:** `addMonth`; `determineAlienMissions()`; psi training; `monthlyFunding()` + MonthlyReportState; 20% chance X-COM agents reveal one hidden alien base.

### 4.2 Globe (orthographic)
- **Projection:**
  - `x = cx + R·cos(lat)·sin(lon − lon0)`
  - `y = cy + R·(cos(lat0)·sin(lat) − sin(lat0)·cos(lat)·cos(lon − lon0))`
- **Back-face test:** `cos(lat0)cos(lat)cos(lon−lon0) + sin(lat0)sin(lat) < 0`.
- **Inverse:**
  - `ρ = √(x²+y²)`, `c = asin(ρ/R)`
  - `lat = asin(y·sin c·cos lat0/ρ + cos c·sin lat0)`
  - `lon = lon0 + atan2(x·sin c, ρ·cos lat0·cos c − y·sin lat0·sin c)`
- **Zoom radii** = screen height × [0.45, 0.60, 0.90, 1.40, 2.25, 3.60]. Zooming animates in steps of (dogfight radius − r0)/10.
- **Data:** `globe.rul` → `data: GEODATA/WORLD.DAT` (land polygons of 3-4 points with texture id = battlescape terrain group), `polylines` (borders/coasts), colours.
- Night shading uses the sun direction from game time (terminator) and also drives the battlescape `globalShade` at the landing site.
- Regions and countries are lists of lon/lat **rectangles** `[lonMin, lonMax, latMin, latMax]` for `insideRegion` and `insideCountry`. Countries have a label lon/lat.

### 4.3 Moving targets (crafts, UFOs)
- Speed in knots. **Radians per 5-sec tick = (speed/60)·(π/180)/720.**
- Each tick: compute the great-circle heading to the **meet point** (intercept prediction against a moving target), step `speedRadian`, snap on arrival.
- `getDistance` returns radians; nautical miles = rad·60·180/π.

### 4.4 Detection (OpenXcom: every 30 minutes)
- **Undetected UFO**, per base: sum `radarChance` of completed radars with `radarRange ≥ distance(nm)`.
  - A hyperwave decoder in range detects (and hyper-identifies race and mission) if `percent(chance)`.
  - **Conventional radar:** `chance × (100 + visibility)/100`.
  - **Visibility:** size modifier (very small −30, small −15, medium 0, large +15, very large +30) plus altitude: ground = −30 flat; very low = size−20; low = size−10; high = size; very high = size−10.
  - **Airborne crafts:** radar range default 672 nm, chance 100 → automatic inside range.
- **Already-detected UFO** stays detected while inside **any** radar range (no roll). Lost when outside all of them → UfoLostState if a craft was following.
- **Facility numbers:** small radar **1695 nm / 10%**; large radar **2577 nm / 20%**.

### 4.5 Alien strategy (monthly) and missions

- **`determineAlienMissions()`.** For each `missionScript` command:
  - Filters: firstMonth ≤ month ≤ lastMonth (−1 = ∞); maxRuns; minDifficulty; researchTriggers; conditionals on other commands' labels (positive = must have succeeded, negative = must have failed); `executionOdds`.
  - `processCommand`: choose the mission type (`missionWeights[month]`, or the region's `missionWeights` table); choose the region (`targetBaseOdds` → a region with an X-COM base; else `regionWeights` or the region's `regionWeight`); choose the race (`raceWeights[month]`); `startDelay` in minutes.
- **xcom1 scripts:**

| Script | When | Mission | Details |
|---|---|---|---|
| gameStart | month 0 only | Alien Research | Sectoid 100%, targets the base region, delay 120 min |
| recurringTerror | every month | Terror | delay 150 |
| recon | from month 1 | regional table | |
| invasion | from month 6 | regional table | |
| researchRetaliation | when The Martian Solution is researched | Retaliation | |
| difficulty-based retaliation | Beginner 14 / Experienced 13 / Veteran 12 / Genius 11 | Retaliation | labels chained so only one fires |

- **`alienMissions`** record: `type`, `points`, `raceWeights{month: {race: w}}`, `waves[{ufo, count, trajectory, timer(min)}]`, objective (score / infiltration / base / site / retaliation / supply), `spawnZone`, `siteType`, `retaliationOdds`.
- **Wave countdown** = `(T/2 + rnd(0,T))` in 30-minute units, i.e. 50%–150% of `timer`. Example: Alien Research waves are small scout (P0, 9000 min), medium scout (P2, 7800), 2× large scout (P4, 9000).
- **UFO trajectory** waypoints `[zone, altitude 0..4, speed% of max]`.
  - Altitudes: GROUND, VERY_LOW, LOW, HIGH, VERY_HIGH.
  - Zone indexes into the region's `missionZones` (lists of rectangles; zone 3 = cities, e.g. NEW_YORK). Zone 5 is the entry/exit zone; UFOs there never detect bases.
  - Altitude 0 = land: on land, sits `groundTimer×5` seconds (P0 3000 → 15,000 s ≈ 4.2 h); over water, 5 s.
  - After the last waypoint the UFO silently leaves (DESTROYED, no score).
- **Shot down** (crashed or destroyed): the next wave is delayed by `30×(48 + rnd(0,400))` min (1 to ~9.3 days). Crash site lasts `rnd(24,96)` h. Crash at > maxDamage/2, destroyed at ≥ maxDamage.
- **Terror and site missions:** at the objective waypoint the UFO is replaced by a `MissionSite` (deployment from `siteType` or the texture). Duration `rnd(durationMin, durationMax)` h. Points accrue each 30 min while it exists.
- **Infiltration:** after the last wave, a country in the region with no pact gets `newPact`, and an **alien base** spawns in the zone (land). The base gives daily points and supply missions.
- **Retaliation:**
  - **Trigger:** each UFO shot down rolls `retaliationOdds` (default `4 + 4×difficultyCoef` %, i.e. 4–20%). A retaliation mission spawns in that region unless one already exists.
  - **Targeting:** retaliation UFOs (or all UFOs with the `aggressiveRetaliation` option) within UFO `sightRange` (default 268 nm) roll the base's detection chance every 10 min. Excluded: trajectory point ≤1, zone 5, crashed, assault-run UFOs. Only the last-detected base per region is marked `retaliationTarget`.
  - **Attack:** a battleship on trajectory `__RETALIATION_ASSAULT_RUN` flies to the base. Missile/laser/plasma defences fire (BaseDefenseState: `defense` power, `hitRatio`). If it survives → **base defence battle**. Otherwise the wave restarts after `30×(rnd(0,400)+48)` min.

### 4.6 Dogfight (`DogfightState`)
- **Distances** (units; ×8 = weapon range units):
  - Start 640.
  - **Standoff 560**.
  - **Cautious** = longest weapon range ×8.
  - **Standard** = shortest weapon range ×8.
  - **Aggressive** = 64.
  - **Disengage** = 800.
- Timer 30 ms.
- **Craft weapons** fire when the countdown is 0, distance ≤ range×8, ammo > 0, and mode is not standoff or disengage.
  - Reload ticks: cautious / standard / aggressive (Stingray 64/48/32, cannon 4).
  - **Hit chance = (acc·(100 + 300/(5 − ufoSize)) + 100)/200 %**, ufoSize 0 (very small) … 4 (very large). Stingray 70 vs very small = 56.5%; ≥100% vs very large.
  - Damage `rnd(dmg/2, dmg)`.
- **UFO weapon** (if `range > 0` and distance ≤ range×8): hits `percent(accuracy)`, damage `rnd(0, ufo.power)`. In cautious mode the craft retreats to standoff once damage ≥ 50%.
- UFO breaks off after `breakOffTime`. Craft destroyed → soldiers aboard die.
- Base defence (BaseDefenseState) fires facility weapons at the incoming retaliation UFO before the ground battle.

### 4.7 Base and facilities
- **Grid:** 6×6. Size 1 or 2 (hangar 2×2). Every facility must connect to the access lift. Built in days; costs and monthly upkeep below.
- **Monthly upkeep** = facility `monthlyCost` + craft rent (`costRent`) + salaries (soldier 20,000; engineer 25,000; scientist 30,000).

| Facility | Build cost | Days | Monthly | Effect |
|---|---|---|---|---|
| Access Lift | 300,000 | 1 | 4,000 | lift, map XBASE_00 |
| Living Quarters | 400,000 | 16 | 10,000 | personnel 50 |
| Laboratory | 750,000 | 26 | 30,000 | lab space 50 |
| Workshop | 800,000 | 32 | 35,000 | workshop space 50 |
| Small Radar | 500,000 | 12 | 10,000 | 1695 nm, 10% |
| Large Radar | 800,000 | 25 | 15,000 | 2577 nm, 20% |
| Missile Defenses | 200,000 | 16 | 5,000 | defense 500, hitRatio 50 |
| General Stores | 150,000 | 10 | 5,000 | storage 50 |
| Alien Containment | 400,000 | 18 | 15,000 | aliens 10 |
| Hangar (2×2) | 200,000 | 25 | 25,000 | crafts 1 |

- **Starting base:**
  - Facilities: lift (2,2); hangars (2,0), (0,4), (4,4); quarters (3,2); stores (2,3); lab (3,3); workshop (4,3); small radar (1,3).
  - Personnel: 8 random soldiers, 10 scientists, 10 engineers.
  - Skyranger with 8 grenades, 6 rifles + 12 clips, 3 pistols + 5 clips, heavy cannon + 2 AP + 2 HE.
  - 2 Interceptors, each with Stingray (6) + Cannon (200).
  - Base stores (verified): 1 autocannon + 6 AP rounds, 1 heavy cannon + 6 AP rounds, 1 rocket launcher + 4 small rockets, 2 rifles + 8 clips, 2 pistols + 8 clips, 5 grenades, 5 smoke grenades, plus spare craft weapons and ammo.

### 4.8 Research and manufacture
- **Research:**
  - Project cost = rule `cost × rnd(50,150)/100`, fixed when started.
  - Each day `spent += assignedScientists`; done when `spent ≥ cost`. So cost is in **scientist-days**.
  - Labs give 50 scientist slots each.
  - Progress label (none / unknown / poor / average / good / excellent) depends on assigned/cost.
  - **On completion:** add the topic plus its `lookup`; a random `getOneFree`; `unlocks`; ufopaedia popup; new available research and manufacture popups.
  - `needItem` (requires the item in stores), `destroyItem` (consumes it: interrogation and corpses), `dependencies` (prerequisites).
  - Examples: Laser Weapons 50; Laser Rifle 300 (deps Laser Pistol); Plasma Rifle 700 (needItem); Sectoid Soldier 192 points 50 (lookup STR_SECTOID, unlocks Alien Origins); Alien Origins 300; The Martian Solution 500; Cydonia or Bust 600.
- **Manufacture:**
  - Each hour `timeSpent += engineers`. Items produced = `timeSpent/time`; **time is in engineer-hours per unit**.
  - Each new unit checks money and materials. A crafted craft goes to the hangar in REFUELLING. "Sell" mode credits `sellCost`. Workshop space per project = `space`.
  - Example: Laser Rifle — space 3, 400 h, $20,000.

### 4.9 Monthly evaluation
- **Funds:** `funds += Σ country funding − maintenance` (graphs keep the last 12 months).
- **Rating** = xcomTotal − alienTotal (month's region and country activity + research points).
  - **Threshold = defeatScore(−900) + 100·difficultyCoef.**
  - Terrible ≤ thr−300 < Poor ≤ thr < OK ≤ 0 < Good ≤ 500 < Excellent.
  - **Game over** if two consecutive months ≤ threshold, or funds ≤ −1,000,000 at a second consecutive check (warning first).
- **Country `newMonth`:**
  - `good = xcomTotal/10 + countryXcomActivity`, `bad = alienTotal/20 + countryAlienActivity`, `delta = (funding/1000 · rnd(5,20)/100)·1000`.
  - **Increase** if `good > bad+30` and `rnd(0,good) > bad`, capped at `fundingCap·1000`.
  - **Decrease** if `bad > good+30` and `rnd(0,bad) > good`, not below 0.
  - **Pact** → funding 0, plus the infiltration points.
  - Initial country funding = `rnd(fundingBase, 2·fundingBase)·1000` (USA base 600, cap 10,000).

---

## 5. Ufopaedia
- **`ArticleDefinition` records:** `id`, `type_id`, `section` (STR_XCOM_CRAFT_ARMAMENT, STR_HEAVY_WEAPONS_PLATFORMS, STR_WEAPONS_AND_EQUIPMENT, STR_ALIEN_ARTIFACTS, STR_BASE_FACILITIES, STR_ALIEN_LIFE_FORMS, STR_ALIEN_RESEARCH_UC, STR_UFO_COMPONENTS, STR_UFOS), `requires` (research), `text`, `image_id`, `listOrder`.
- **type_id:** 1 CRAFT, 2 CRAFT_WEAPON, 3 VEHICLE, 4 ITEM (auto-shows weapon stats table), 5 ARMOR, 6 BASE_FACILITY, 7 TEXTIMAGE, 8 TEXT, 9 UFO (10–17 TFTD).
- **Flow:** UfopaediaStartState (sections) → UfopaediaSelectState (researched articles) → ArticleState* with prev/next. `Ufopaedia::openArticle(id)` is used by the research-complete popup.
- **For our build:** articles as JSON keyed by research id; stats tables are generated from rules so they never drift.

---

## 6. Savegame: what must be serialized

### 6.1 Campaign (`SavedGame`) — verified keys
- **Header ("brief"):** name, version, build, time, mission, turn, mods, ironman.
- **Root:**
  - Settings and clock: difficulty, monthsPassed, time, rng (seed), ids (per-type counters for "Skyranger-3" naming), warned, end.
  - Finance history: funds[], maintenance[], incomes[], expenditures[], researchScores[].
  - Globe view: globeLon, globeLat, globeZoom.
  - World lists: countries, regions, bases, waypoints, missionSites, alienBases, ufos, alienMissions.
  - Strategy and progress: alienStrategy (weights tables + missionsRun, missionLocations for avoidRepeats), discovered (research names), poppedResearch, deadSoldiers, missionStatistics.
  - battleGame: present when saved mid-battle.
- **Base:** name/lon/lat, facilities [{type, x, y, buildTime}], crafts, items (map), soldiers, scientists, engineers, research [{project, assigned, spent, cost}], productions [{item, assigned, spent, amount, infinite, sell}], transfers, retaliationTarget, inBattlescape.
- **Craft:** type, id, lon, lat, dest, speed, fuel, damage, status (STR_READY / OUT / REFUELLING / REARMING / REPAIRS), weapons [{type, ammo, rearming}], items, vehicles, lowFuel, mission, interceptionOrder, takeoff, inBattlescape.
- **Ufo:** type, id, lon, lat, dest, speed, altitude, status, damage, detected, hyperDetected, mission (uniqueID), trajectory, trajectoryPoint, secondsRemaining, landId, crashId, fireCountdown, escapeCountdown, direction.
- **AlienMission:** type, region, race, nextWave, nextUfoCounter, spawnCountdown, liveUfos, uniqueID, missionSiteZone, alienBase.
- **Country:** type, funding[], activityXcom[], activityAlien[], pact, newPact. **Region:** type, activity arrays.
- **Soldier:** type, id, name, gender, look, rank, craft, initialStats, currentStats, armor, missions, kills, recovery (days), psiTraining, improvement, equipmentLayout, death, diary.

### 6.2 Battle (`SavedBattleGame`) — verified keys
- **Map:** width, length, height, mapdatasets[] (names, so tile ids resolve), tiles (binary blob `binTiles` with per-field byte sizes, or YAML per tile), nodes.
- **Turn and side:** missionType, globalshade, turn, selectedUnit, tuReserved, kneelReserved.
- **Objectives and recovery:** objectiveType, objectivesDestroyed, objectivesNeeded, moduleMap, recoverGuaranteed, recoverConditional.
- **Rules and presentation:** turnLimit, chronoTrigger, cheatTurn, depth, music, ambience.
- **Contents:** units, items.
- **Tile:** position, mapDataID[4], mapDataSetID[4], smoke, fire, discovered[3], openDoorWest, openDoorNorth (UFO door frame state).
- **BattleUnit:**
  - Identity and faction: id, genUnitType, genUnitArmor, faction, originalFaction, killedBy, rankInt, turretType.
  - Position and stance: position, direction, directionTurret, kneeled, floating, visible, dontReselect.
  - Live stats: tu, health, stunlevel, energy, morale, armor[5], fatalWounds[6], fire, status, turnsSinceSpotted.
  - Experience: exp* (7), kills, motionPoints, moraleRestored.
  - AI state: AI {AIMode, fromNode, toNode, wasHitBy}.
  - Death and control records: respawn, spawnUnit, activeHand, mindControllerID, murdererId, murdererWeapon, murdererWeaponAmmo, fatalShotSide, fatalShotBodyPart, recolor, tempUnitStatistics.
- **BattleItem:** id, type, owner, previousOwner, unit (for corpses/stunned bodies), inventoryslot, inventoryX/Y, position (if on the ground), ammoqty, ammoItem, fuseTimer, painKiller/heal/stimulant (medikit charges), XCOMProperty, droppedOnAlienTurn.
- **Node:** id, position, segment, type, rank, flags, reserved, priority, allocated, links, dummy.

### 6.3 Recommendation for JS (localStorage limit is about 5 MB)
- **Campaign:** one JSON doc with the same shapes, references by string id (`craftId`, `ufoId`, `missionId`). Keep `rngState` for determinism.
- **Battle:** do **not** store the whole map. Store:
  - `{deploymentType, terrain, blockLayout[] (block ids + positions + UFO/craft position), seed}` to regenerate the base map;
  - plus a **delta list** of changed tile parts `[{i, part, mapDataId|-1}]`;
  - sparse arrays for smoke/fire/discovered (bit-packed, base64);
  - units, items, nodes (allocated flags), and side/turn/reserve settings.

---

## 7. Data shapes to borrow (JSON; values = xcom1 originals)

```json
// items.json
{ "type": "STR_RIFLE", "battleType": "firearm", "twoHanded": true, "weight": 8, "size": 0.2,
  "costBuy": 3000, "costSell": 2250, "invWidth": 1, "invHeight": 3,
  "compatibleAmmo": ["STR_RIFLE_CLIP"],
  "accuracy": { "auto": 35, "snap": 60, "aimed": 110 },
  "tu":       { "auto": 35, "snap": 25, "aimed": 80 },   // % of unit max TU (flatRate:false)
  "autoShots": 3, "ranges": { "max": 200, "aim": 200, "snap": 15, "auto": 7, "min": 0, "dropoff": 2 },
  "sprites": { "big": 1, "floor": 1, "hand": 0, "bullet": 2 }, "sounds": { "fire": 4 } }
{ "type": "STR_RIFLE_CLIP", "battleType": "ammo", "power": 30, "damageType": "AP", "clipSize": 20,
  "weight": 3, "costBuy": 200, "costSell": 150, "hitAnimation": 26, "hitSound": 22 }
{ "type": "STR_GRENADE", "battleType": "grenade", "power": 50, "damageType": "HE", "blastRadius": 5,
  "weight": 3, "costBuy": 300, "costSell": 240 }      // prime 50% TU, throw 25% TU
{ "type": "STR_PLASMA_PISTOL", "battleType": "firearm", "requires": ["STR_PLASMA_PISTOL"],
  "accuracy": {"auto":50,"snap":65,"aimed":85}, "tu": {"auto":30,"snap":30,"aimed":60},
  "compatibleAmmo": ["STR_PLASMA_PISTOL_CLIP"], "weight": 3, "costSell": 84000, "recoveryPoints": 3, "armor": 45 }
{ "type": "STR_PLASMA_PISTOL_CLIP", "battleType": "ammo", "power": 52, "damageType": "PLASMA", "clipSize": 26 }
{ "type": "STR_SECTOID_CORPSE", "battleType": "corpse", "weight": 30, "costSell": 20000, "recoveryPoints": 5, "armor": 26 }
```

```json
// armors.json  (damageModifier order: NONE, AP, IN, HE, LASER, PLASMA, STUN, MELEE, ACID, SMOKE)
{ "type": "STR_NONE_UC", "front": 12, "side": 8, "rear": 5, "under": 2,
  "damageModifier": [1,1,1,1,1,1,1,1.2,1.6,1.0], "corpseBattle": ["STR_CORPSE"], "loftempsSet": [3] }
{ "type": "STR_PERSONAL_ARMOR_UC", "front": 50, "side": 40, "rear": 30, "under": 30,
  "damageModifier": [1,1,0.8,1,1,1,0.9,1,1.1,1], "storeItem": "STR_PERSONAL_ARMOR" }
{ "type": "SECTOID_ARMOR0", "front": 4, "side": 3, "rear": 2, "under": 2,
  "damageModifier": [1,1,1,1,1,1,1,1.2,1.6,0.0], "corpseBattle": ["STR_SECTOID_CORPSE"], "loftempsSet": [2] }
```

```json
// units.json
{ "type": "STR_SECTOID_SOLDIER", "race": "STR_SECTOID", "rank": "STR_LIVE_SOLDIER",
  "stats": { "tu": 54, "stamina": 90, "health": 30, "bravery": 80, "reactions": 63, "firing": 52,
             "throwing": 58, "strength": 30, "psiStrength": 40, "psiSkill": 0, "melee": 76 },
  "armor": "SECTOID_ARMOR0", "standHeight": 16, "kneelHeight": 12, "value": 10,
  "intelligence": 3, "aggression": 2, "energyRecovery": 30, "deathSound": 10 }
// alienRaces.json: { "id": "STR_SECTOID", "members": ["STR_SECTOID_COMMANDER","STR_SECTOID_LEADER",
//   "STR_SECTOID_ENGINEER","STR_SECTOID_MEDIC","STR_SECTOID_NAVIGATOR","STR_SECTOID_SOLDIER",
//   "STR_CYBERDISC_TERRORIST","STR_CYBERDISC_TERRORIST"] }   // index = alienRank
// soldiers.json: { "type":"STR_SOLDIER", "costBuy":40000, "costSalary":20000, "value":20,
//   "minStats":{"tu":50,"stamina":40,"health":25,"bravery":10,"reactions":30,"firing":40,"throwing":50,"strength":20,"psiStrength":0,"psiSkill":0,"melee":20},
//   "maxStats":{"tu":60,"stamina":70,"health":40,"bravery":60,"reactions":60,"firing":70,"throwing":80,"strength":40,"psiStrength":100,"psiSkill":16,"melee":40},
//   "statCaps":{"tu":80,"stamina":100,"health":60,"bravery":100,"reactions":100,"firing":120,"throwing":120,"strength":70,"psiStrength":100,"psiSkill":100,"melee":120},
//   "armor":"STR_NONE_UC", "standHeight":22, "kneelHeight":14, "femaleFrequency":25 }
```

```json
// ufos.json
{ "type": "STR_SMALL_SCOUT", "size": "STR_VERY_SMALL", "damageMax": 50, "speedMax": 2200,
  "weapon": { "power": 0, "range": 0, "reload": 56 }, "breakOffTime": 200, "score": 50,
  "sightRange": 268, "missionScore": 1,
  "battlescape": { "mapDataSets": ["BLANKS","UFO1"], "block": { "name": "UFO1A", "w": 10, "l": 10 } } }
{ "type": "STR_MEDIUM_SCOUT", "size": "STR_SMALL", "damageMax": 200, "speedMax": 2400,
  "weapon": { "power": 20, "range": 15, "reload": 56 }, "breakOffTime": 250, "score": 75 }
// alienDeployments.json
{ "type": "STR_SMALL_SCOUT", "width": 40, "length": 40, "height": 4,
  "data": [ { "alienRank": 5, "lowQty": 1, "highQty": 1, "dQty": 0, "percentageOutsideUfo": 50,
              "itemSets": [["STR_PLASMA_PISTOL","STR_PLASMA_PISTOL_CLIP","STR_PLASMA_PISTOL_CLIP","STR_MIND_PROBE"],
                           ["STR_PLASMA_RIFLE","STR_PLASMA_RIFLE_CLIP","STR_PLASMA_RIFLE_CLIP","STR_MIND_PROBE"],
                           ["STR_HEAVY_PLASMA","STR_HEAVY_PLASMA_CLIP","STR_MIND_PROBE"]] } ] }
// alienItemLevels.json: rows = month 0..9, 10 entries each, e.g. month0 [0,0,0,0,0,0,0,1,1,2] ... month9 [2 x10]
```

```json
// crafts.json
{ "type": "STR_INTERCEPTOR", "fuelMax": 1000, "damageMax": 100, "speedMax": 2100, "accel": 3,
  "weapons": 2, "soldiers": 0, "costBuy": 600000, "costRent": 600000, "refuelRate": 50, "repairRate": 1,
  "radarRange": 672, "radarChance": 100, "sightRange": 1696, "transferTime": 96, "score": 250 }
{ "type": "STR_SKYRANGER", "fuelMax": 1500, "damageMax": 150, "speedMax": 760, "accel": 2,
  "soldiers": 14, "vehicles": 3, "costBuy": 500000, "costRent": 500000, "refuelRate": 50, "score": 200,
  "battlescape": { "mapDataSets": ["BLANKS","PLANE"], "block": { "name": "PLANE", "w": 10, "l": 20 } } }
// craftWeapons.json
{ "type": "STR_STINGRAY", "damage": 70, "range": 30, "accuracy": 70,
  "reload": { "cautious": 64, "standard": 48, "aggressive": 32 }, "ammoMax": 6,
  "launcher": "STR_STINGRAY_LAUNCHER", "clip": "STR_STINGRAY_MISSILES", "projectileType": "missile", "projectileSpeed": 8 }
{ "type": "STR_CANNON_UC", "damage": 10, "range": 10, "accuracy": 25,
  "reload": { "cautious": 4, "standard": 4, "aggressive": 4 }, "ammoMax": 200, "rearmRate": 100 }
```

```json
// facilities.json
{ "type": "STR_SMALL_RADAR_SYSTEM", "size": 1, "buildCost": 500000, "buildDays": 12, "monthlyCost": 10000,
  "radarRange": 1695, "radarChance": 10, "sprite": { "shape": 2, "facility": 21 }, "baseMapBlock": "XBASE_04" }
{ "type": "STR_HANGAR", "size": 2, "buildCost": 200000, "buildDays": 25, "monthlyCost": 25000, "crafts": 1, "baseMapBlock": "XBASE_16" }
```

```json
// research.json
{ "name": "STR_LASER_RIFLE", "cost": 300, "points": 10, "dependencies": ["STR_LASER_PISTOL"],
  "unlocks": [], "getOneFree": [], "lookup": null, "needItem": false, "destroyItem": false }
{ "name": "STR_SECTOID_SOLDIER", "cost": 192, "points": 50, "lookup": "STR_SECTOID",
  "unlocks": ["STR_ALIEN_ORIGINS"], "needItem": true, "destroyItem": true }
// manufacture.json
{ "name": "STR_LASER_RIFLE", "category": "STR_WEAPON", "requires": ["STR_LASER_RIFLE"],
  "space": 3, "time": 400, "cost": 20000, "producedItems": { "STR_LASER_RIFLE": 1 } }
```

```json
// tileDefs (replaces MCD): one array per terrain set; index = MCD id; part = floor|westWall|northWall|object
{ "set": "CULTIVAT", "defs": [
  { "id": 1, "part": "floor",    "sprite": [12], "tu": {"walk":4,"fly":4,"slide":4}, "armor": 20,
    "flammable": 30, "fuel": 3, "terrainLevel": 0, "footstep": 1, "blockLOS": false, "heBlock": 0,
    "dieId": 0, "altId": 0, "light": 0, "noFloor": false },
  { "id": 9, "part": "westWall", "sprite": [40], "tu": {"walk":255,"fly":255,"slide":255}, "armor": 30,
    "blockLOS": true, "heBlock": 20, "dieId": 10, "loft": "fullWall" },
  { "id": 15, "part": "westWall", "door": "swing", "altId": 16, "tu": {"walk":4,"fly":4,"slide":4},
    "blockLOS": true, "armor": 25 },
  { "id": 30, "part": "object", "bigWall": 0, "tu": {"walk":6,"fly":6,"slide":6}, "height": 12,
    "loft": "lowObject", "armor": 15, "flammable": 10, "fuel": 4, "heBlock": 0 },
  { "id": 44, "part": "object", "terrainLevel": -8, "stairs": true, "tu": {"walk":4,"fly":4,"slide":4} },
  { "id": 50, "part": "floor", "gravLift": true, "tu": {"walk":4,"fly":4,"slide":4}, "armor": 255 },
  { "id": 60, "part": "object", "special": "UFO_POWER_SOURCE", "heStrength": 120, "heType": "HE", "armor": 60 } ] }
```

```json
// mapBlocks.json  (designer-friendly replacement for MAP+RMP; z0 = ground)
{ "name": "CULTA03", "terrain": "CULTA", "w": 10, "l": 10, "h": 1, "groups": [0],
  "legend": { ".": [1,0,0,0], "|": [1,9,0,0], "-": [1,0,9,0], "+": [1,9,9,0], "D": [1,15,0,0], "c": [1,0,0,30] },
  "levels": [ [ "..........", ".+----+...", ".|cc..|...", ".D....|...", ".+----+...", "..........",
                "..........", "...c......", "..........", ".........." ] ],
  "nodes": [ { "id": 0, "pos": [3,2,0], "rank": 2, "flags": 3, "priority": 5, "type": 0, "links": [1, 2, -2] },
             { "id": 1, "pos": [8,8,0], "rank": 0, "flags": 1, "priority": 2, "type": 0, "links": [0, -3] } ],
  "items": { "STR_ELERIUM_115": [] } }
// links: >=0 node id in this block; -1 none; -2 north exit, -3 east, -4 south, -5 west (stitched at generation)
// terrains.json: { "name":"CULTA", "script":"FARM", "mapDataSets":["BLANKS","CULTIVAT","BARN"], "blocks":["CULTA00",...] }
// mapScripts.json: { "type":"FARM", "commands":[{"type":"addUFO"},{"type":"addCraft"},
//   {"type":"fillArea","blocks":[1,2,...,18],"maxUses":[3,...]}] }
```

```json
// geoscape rules
{ "id": "P0", "groundTimer": 3000, "waypoints": [[5,4,100],[0,3,74],[0,1,28],[1,1,47],[5,2,100]] }  // [zone, altitude, speed%]
{ "type": "STR_ALIEN_RESEARCH", "points": 0, "raceWeights": { "0": {"STR_SECTOID":70,"STR_SNAKEMAN":10,"STR_FLOATER":20} },
  "waves": [ {"ufo":"STR_SMALL_SCOUT","count":1,"trajectory":"P0","timer":9000},
             {"ufo":"STR_MEDIUM_SCOUT","count":1,"trajectory":"P2","timer":7800},
             {"ufo":"STR_LARGE_SCOUT","count":2,"trajectory":"P4","timer":9000} ] }
{ "type": "STR_NORTH_AMERICA", "cost": 800000, "regionWeight": 18,
  "areas": [[195,305,-70,-55],[230,305,-55,-30],[240,300,-30,-10]],
  "missionWeights": {"STR_ALIEN_RESEARCH":14,"STR_ALIEN_HARVEST":17,"STR_ALIEN_ABDUCTION":20,"STR_ALIEN_INFILTRATION":20,"STR_ALIEN_BASE":20},
  "missionZones": [ [[200,220,-65,-60]], [[200,225,-63.75,-60.75]], [[236,240,-50,-45]],
                    [[286.125,286.125,-40.75,-40.75,-1,"STR_NEW_YORK"]], [[250,270,-66,-64]], [] ] }
{ "type": "STR_USA", "fundingBase": 600, "fundingCap": 10000, "labelLon": 260, "labelLat": -40,
  "areas": [[235,255,-49,-32],[255,277.5,-49,-29]] }
{ "type": "gameStart", "lastMonth": 0, "missionWeights": {"0": {"STR_ALIEN_RESEARCH":100}},
  "targetBaseOdds": 100, "raceWeights": {"0": {"STR_SECTOID":100}}, "startDelay": 120 }
```

```json
// save skeleton
{ "version": 1, "difficulty": 0, "time": {"y":1999,"mo":1,"d":1,"h":12,"mi":0,"s":0,"wd":6}, "rng": [123,456],
  "funds": [6000000], "maintenance": [0], "incomes": [], "expenditures": [], "researchScores": [0], "monthsPassed": 0,
  "globe": {"lon":0,"lat":0,"zoom":0}, "ids": {"STR_SKYRANGER":2,"STR_UFO":1},
  "countries": [{"type":"STR_USA","funding":[900000],"activityXcom":[0],"activityAlien":[0],"pact":false,"newPact":false}],
  "regions": [{"type":"STR_NORTH_AMERICA","activityXcom":[0],"activityAlien":[0]}],
  "bases": [{"name":"Base 1","lon":5.2,"lat":-0.7,"facilities":[{"type":"STR_ACCESS_LIFT","x":2,"y":2,"buildTime":0}],
             "scientists":10,"engineers":10,"items":{"STR_RIFLE":2},"soldiers":[],"crafts":[],"research":[],"productions":[],"transfers":[],"retaliationTarget":false}],
  "ufos": [], "alienMissions": [], "missionSites": [], "alienBases": [], "waypoints": [],
  "alienStrategy": {"regionWeights":{}, "missionWeights":{}, "missionsRun":{}}, "discovered": [], "deadSoldiers": [],
  "battle": null }
```

---

## 8. Patterns adaptable to JS/Canvas and recommended simplifications

### 8.1 Engine
- **Copy the state stack:** `game.push(state)`, `game.pop()` (deferred), `game.set()`. Each state has `init`, `handle(evt)`, `think(dt)`, `draw(ctx)`, and an `isScreen` flag. Draw from the nearest full-screen state upward. Only the top state thinks, so modal popups pause the world for free.
- **Main loop:** `requestAnimationFrame` with a fixed-step accumulator. Geoscape tick 80 ms; battle "handleState" tick 30–100 ms; animation 100 ms.
- **Logical canvas:** 320×200 (or 640×400) scaled with `imageSmoothingEnabled=false`. Use a 16-level shade table (pre-darkened sprite variants, or `fillRect` black at alpha `shade/16` per tile).
- **Seeded RNG:** e.g. xorshift128+ or mulberry32, with state saved. RNG calls must happen in deterministic order.
- **Rules immutable, saves mutable.** Rules are JSON with `STR_` keys; pt-PT strings live in a separate table.

### 8.2 Battlescape model
- **Keep the 4-part tile** (floor, westWall, northWall, object). Walls on tile edges, swing/sliding doors, diagonal bigWalls and the destructible die/alt chain are what make X-COM maps feel right.
  - Store tiles in typed arrays: `Uint16Array part[4]`, `Int8 smoke/fire`, `Uint8 discovered bits`, `Uint8 light[3]`.
  - `index = z*W*L + y*W + x`.
- **Z levels:** 4 (deployments use height 4; the large UFO interior and farm barns need 2–3). The cheap option: allocate 4, author content mostly on 0–2.
- **LOS/LOF:** replace voxels with **tile-space 3D DDA (Amanatides–Woo) plus sub-tile primitives**.
  - Each part def has an AABB in tile-local units, e.g.:
    - westWall = x∈[0,2], full height 24;
    - northWall = y∈[0,2];
    - object = centred box with `height` (low 8, half 12, full 24) and `footprint` (0.4–1.0);
    - floor = z∈[0,2].
  - Units = a cylinder (r≈5/16, height 22 standing, 14 kneeling, 16/12 for sectoids).
  - Ray-AABB tests per traversed tile give real partial cover with no LOFTEMPS data.
  - **Visibility** = any of 3–5 sample points on the target (head/torso/legs ± lateral 3) is reachable, mirroring `canTargetUnit`.
  - **Terrain discovery** = tile-mode line (cheap), as OpenXcom does.
  - If even cheaper is needed: tile Bresenham, blocking only on `blockLOS` walls/objects, plus a **cover probability** (object height low → 30% intercept, half → 50%, full → blocked) rolled per shot. Worse feel; use only if CPU-bound.
- **Fire and accuracy:** port `applyAccuracy` literally. It works in any continuous coordinate system: voxel units (16/tile horizontal, 24/level) on top of the AABB scene.
- **Pathfinding:** port `getTUCost` with the wall-direction table, the ×1.5 diagonal, the step-height ≤8 rule, stairs (terrainLevel −8/−16), grav lifts (8 TU), A* with heuristic 4·euclid, Bresenham fast-path, and `findReachable`.
  - The AI calls it a lot. Cap per-frame work and cache per unit per turn (Map 40×40×4 = 6,400 nodes, which is fine).
- **Static map blocks:** 10×10 (and 20×20) blocks in JSON with ASCII levels + legend + nodes (format above), stitched by a mini mapScript interpreter (addUFO, addCraft, addBlock size2, addLine roads, fillArea with freqs/maxUses).
  - Maps: 40×40 scouts; 50×50 or 60×60 terror and base.
  - Node exits (−2..−5) stitched like `attachNodeLinks`.
- **Nodes:** keep rank (0 outside / 2 soldier / 3 nav / 4 leader / 5 engineer / 7 medic / 6 terror), priority (spawn), flags (patrol desirability), links, size/fly flags. They drive spawn **and** patrol **and** ambush, which is cheap and gives believable aliens.
- **AI:** port `evaluateAIMode` weights and `selectFireMethod` verbatim, plus:
  - `intelligence` = turns of memory;
  - `aggression` 0/1/2 = TU reserve and mode bias;
  - cheat after turn 20;
  - grenades from turn 3;
  - `wasHitBy` until end of turn;
  - up to 3 actions per alien per turn.
- **Battle states:** implement `BattleAction` and the state queue (pushFront / pushNext / pushBack, null = end turn). Animations (walk 8 phases per tile at ~30 ms, bullet flight, explosion frames) naturally serialize reaction fire and chain explosions.
- **Rendering:**
  - Isometric diamond 32×16 with 24 px per level (sprite 32×40), or scale ×2 for crispness.
  - Painter's loops z → x → y with the per-tile part order in 3.11. bigWall 6–8 objects are drawn after units.
  - Cut-away: draw only z ≤ viewLevel.
  - Pre-render static terrain per level to offscreen canvases; redraw dirty tiles on destruction. Draw units, items and FX each frame; apply fog shade per tile.
- **Lighting:** 3 layers × 16 levels; night battles matter (soldiers see only 9 tiles in the dark, aliens see 20). Flares, fires and the personal light toggle should be kept; it is cheap.

### 8.3 Geoscape
- **Globe:** orthographic canvas with the formulas in 4.2.
  - Simplified land polygons in JSON (a few hundred points), each with a terrain type (farm, forest, jungle, desert, polar, mountain, urban for cities).
  - Draw back-face-culled polygons + day/night terminator + region/country rectangles (hidden, only for hit tests).
- **Time:** 5-sec tick engine with the cascade handlers in 4.1. All mission, detection and score logic can be ported almost 1:1.
  - UFOs, missions and waves are data-driven (trajectories, mission tables), so tuning stays in JSON.
- **Dogfight:** a small state with distance, modes and timers using the formulas in 4.6; very cheap to port.

### 8.4 Gameplay-polish hooks visible in the code (keep them)
- **Geoscape:** every important event calls `timerReset()` (drops to 5-sec speed) and centres the globe.
- **Walking interrupts:**
  - Walking stops instantly when a **new** enemy is spotted, and the unused TU are kept.
  - Path preview shows remaining TU per tile and green/yellow/red against the reserve.
- **Reaction fire:** score = reactions × TU fraction, re-evaluated after every shot; the camera jumps to the shooter.
- **Turn start:** aliens are hidden and FOV recomputed (no stale silhouettes). UFO doors close at end of turn.
- **Fire, smoke and explosions:**
  - Explosions destroy terrain and chain through UFO power sources; smoke blocks vision; fire spreads and burns objects out.
  - Fatal wounds bleed 1 HP/turn per wound; medikits matter.
- **Morale:** panic and berserk tied to bravery, leadership rank and deaths.
- **Progression and campaign pressure:**
  - Experience only from doing things (shots that hit, reactions, throws).
  - Rookies auto-promote to squaddie; base-wide rank quotas.
  - Monthly report with rating, funding changes and pacts; two bad months = game over.

---

## 9. Code-level gotchas worth remembering
- **Direction 0 is "north" = y−1**, which on the isometric screen points up-right. Keep OpenXcom's tables, or every wall check breaks.
- **TU 255 means impassable.** Armour 255 or flammable 255 means indestructible / non-burning. Terrain level −24 means "standing on the next level".
- `getTUCost` returns 0 for a pure fall; the caller treats it as a free move.
- **Diagonal cost is floored** after ×1.5: 4 → 6, 5 → 7.
- **Energy per step = TU/2.** Soldiers regain energy = initial TU/3 per turn.
- Shot TU are **percentages** of max TU. Throw 25%, prime 50%. Kneel 4, stand 8, turn 1 per 45°.
- **Damage spread:** non-HE damage 0–200%, HE 50–150%. Terrain gets 25–75% of power from point hits. Armour wears by power/10+1 per penetrating hit.
- **Explosions** lose 10 power per tile plus 2× the HE block of walls crossed; radius ≤ 11.
- **Geoscape units:** latitude negative = north. Distances in nautical miles = radians·60·180/π.


## KEY NUMBERS
Tile voxel size: 16x16x24; LOFT layers per tile: 12 (2 voxels each) (high)
Sprite size 32x40 px; iso screen: sx=(x-y)*16, sy=(x+y)*8 - z*24 (high)
Direction vectors: 0=N(y-1) clockwise; dx=[0,1,1,1,0,-1,-1,-1], dy=[-1,-1,0,1,1,1,0,-1]; 8=UP 9=DOWN (high)
MCD record = 62 bytes; TU_Walk@39, TU_Slide@40, TU_Fly@41, Armor@42, HE_Block@43, Die_MCD@44, Flammable@45, Alt_MCD@46, T_Level@48 (signed), Light_Source@58, Target_Type@59 (high)
RMP node = 24 bytes: y,x,z(inverted), links at bytes 4,7,10,13,16 (255 none, 251-254 exits), type@19, rank@20, flags@21, priority@23 (high)
MAP file: 3-byte header [sizeY,sizeX,sizeZ] + 4 bytes/tile [floor,west,north,object], top level first (high)
A* heuristic = 4*sqrt(dx^2+dy^2+dz^2); diagonal step cost x1.5 floored; max step height 8 voxels; up/down via gravlift/fly = 8 TU; AI in fire +32 (high)
Energy cost per step = TU/2; kneel 4 TU, stand 8 TU, turn 1 TU per 45 deg; throw 25% TU, prime 50% TU, shots = weapon tu% of max TU (high)
Reaction score = reactions * currentTU / maxTU; reaction = snap shot (melee if adjacent) (high)
FOV: 90 deg wedge, radius 20 tiles; X-COM sees units beyond 9 tiles only if tile shade <= 9; aliens see in the dark (high)
Shade = 15 - max(light layers); sun power = 15 - globalShade, -2 under roof by day; fire/personal light = 15 (high)
Smoke visibility: +smoke/3 voxel-distance per voxel, cutoff 320 voxels (high)
Firing accuracy = firing*weaponAcc/100 *1.15 kneeling *0.8 two-handed with both hands full * max(10, 25*hp/maxHp + 75 - 10*wounds)/100 (high)
Spread: dev = rnd(0,100) - acc*100, +50 if >=0 else +10; dev = max(1, zShift*dev/200) (high)
Unit damage: non-HE 0-200% (damageRange 100), HE 50-150% (explosiveDamageRange 50); terrain point hit 25-75%; armor degrade power/10+1 (high)
Fatal wound if rnd(0,10) < damage -> +1..3 wounds; -1 HP per wound per turn (high)
Explosion: rays every 3 deg yaw x 5 deg pitch; -10 power/tile, -2*HE_Block per wall; radius HE/stun/smoke=power/20, IN=power/30+1, cap 11 (high)
Panic chance per turn = 100 - 2*morale; 33% of panics are berserk (high)
Leader morale modifier: sgt 110, capt 115, col 125, cmdr 150 (high)
AI base odds: escape 15 / ambush 12 / combat 20 / patrol 30 (15 if enemies visible); aggression 0/1/2 multipliers 1.4/0.7, ambush 1.1, combat 1.4/escape 0.7 (high)
AI fire mode: dist<4 auto>snap>aimed; dist>12 aimed (snap if <20); else snap>aimed>auto; 3 actions per alien per turn (high)
Cheat turn = 20 (aliens know positions when turn>20 or turn>10 with <=2 aliens alive) (high)
Ambush score = 100 - TUs + 25 if window adjacent; fast-pass > 80; candidate nodes within 10 tiles (high)
Alien quantity: beginner/exp low+rnd(0,dQty); vet/genius low+(high-low)/2+rnd; superhuman high+rnd (high)
Geoscape tick = 5 game seconds; game timer 80 ms; speeds 1/12/60/360/720/17280 ticks per timer tick (high)
Craft speed: radians per 5s = Nautical(knots)/720; fuel use = speed/100 per 10 min (high)
UFO detection every 30 min (OpenXcom): base chance = sum radarChance x (100+visibility)/100; small radar 1695 nm/10%, large 2577 nm/20%; craft radar 672 nm/100% (high)
UFO visibility: size VS -30, S -15, M 0, L +15, VL +30; altitude ground -30 flat, very low size-20, low size-10, high size, very high size-10 (high)
Dogfight: start 640, standoff 560, aggressive 64, disengage 800; hit% = (acc*(100+300/(5-ufoSize))+100)/200; damage rnd(dmg/2,dmg) (high)
UFO crashes at damage > max/2, destroyed at >= max; crash site lasts 24-96 h (high)
Wave countdown = 50-150% of wave timer (minutes); shot-down delay 30*(48..448) min (high)
Landing time = groundTimer*5 seconds (P0: 15000 s ~ 4.2 h) (high)
Retaliation odds per UFO shot down = 4 + 4*difficultyCoef % (4..20%) (high)
Research cost = rule cost * rnd(50..150)%; progress += scientists per day; Laser Rifle 300, Laser Weapons 50 (high)
Manufacture: timeSpent += engineers per hour; Laser Rifle 400 engineer-hours, space 3, $20,000 (high)
Monthly rating threshold = -900 + 100*difficultyCoef; Excellent > 500; game over 2 consecutive bad months or funds <= -1,000,000 twice (high)
Country funding change = 5-20% of funding; good = xcomTotal/10 + local, bad = alienTotal/20 + local, margin 30 (high)
Promotion quotas: sergeants = N/5, captains = N/11, colonels = N/23, 1 commander if N>=30 (high)
Stat gain per exp: >10: +2..6, >5: +1..4, >2: +1..3, >0: +0..1; bravery +10 if exp > rnd(0,10) (high)
Salaries/month: soldier 20000, engineer 25000, scientist 30000; initialFunding 6000k (high)
Difficulty: aimAndArmorMultipliers [0.5,1,1,1,1]; statGrowth tu4 stam4 react6 firing6 str2 psi4 melee4 per coef (high)
Globe zoom radii = height x [0.45,0.60,0.90,1.40,2.25,3.60] (high)
Soldier stats: TU 50-60 (cap 80), HP 25-40 (cap 60), firing 40-70 (cap 120), reactions 30-60 (cap 100), bravery 10-60; standHeight 22, kneel 14 (high)
Sectoid soldier: TU 54, HP 30, firing 52, reactions 63, armor 4/3/2/2, intelligence 3, aggression 2, value 10 (high)

## UNCERTAIN
UFOpaedia could not be reached (www.ufopaedia.org is blocked: proxy 403 and DNS ENOTFOUND). It must be allowed in the session's network settings before anything can be cross-checked against the original-game documentation. Every fact here comes from OpenXcom master code and rulesets only.
Detection cadence: OpenXcom master rolls UFO radar detection in time30Minutes, not on 10-minute ticks as the task text assumes. In the 10-minute handler only the aliens' detection of X-COM bases runs. I did not verify whether the original DOS game uses 10 or 30 minutes.
Research time unit: OpenXcom steps research once per day, adding the number of assigned scientists, so ruleset cost is effectively in scientist-days. I could not confirm against UFOpaedia whether the original documents this as man-days or man-hours.
Base::getDetectionChance(), the per-base chance that a retaliation UFO discovers an X-COM base, was not read. Hyperwave decoder range and chance values (facility rule) were not extracted.
Exact smoke spread/decay rules beyond averaging and the fire spread loop were only partly read; the tail of SavedBattleGame::prepareNewTurn for smoke was not read.
TileEngine::detonate terrain-damage details (how the stored explosive power is applied to neighbouring wall parts) were only partly read.
Dogfight mode mapping: Cautious = longest weapon range ×8 and Standard = shortest range ×8 is inferred from maximumDistance()/minimumDistance() and is consistent with X-COM, but the button wiring was not traced line by line. The meaning of the 50 − 6×difficulty% roll after a retaliation trigger was not read.
Map-block 'groups' semantics (e.g. FARM blocks 00/07/11 tagged group 1) were not checked in MapScript.cpp. The landing-zone interpretation is a guess.
Usage of turnAIUseGrenade and turnAIUseBlaster (turn ≥ 3 before the AI uses grenades or blasters) was inferred from the variable names, not traced in AIModule::grenadeAction/wayPointAction.
Smoke-grenade, alien-grenade and other item stats beyond the rifle, clip, grenade, plasma pistol and sectoid corpse were not extracted. Hyperwave decoder, laser defenses and psi lab facility records were not extracted.
The starting base stores list in the report omits a few entries that were in the verified data: 1 Avalanche launcher + 10 Avalanche missiles, 1 Stingray launcher + 25 Stingray missiles, 2 craft cannons and 1 cannon-round pack.
LOFTEMPS.DAT voxel shapes were not examined. The suggested AABB heights for objects (low 8, half 12, full 24) are design proposals, not original data.
OXCE (OpenXcom Extended) differences, such as hourly research, more ruleset keys and AI changes, are not covered. This report describes vanilla OpenXcom master only.