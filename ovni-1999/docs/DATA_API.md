# API de dados (OV.Data) — referência para os módulos de simulação e apresentação

Gerado a partir da auditoria de integração da onda 1. Fonte de verdade: o código em `js/data/`.

**Data API for the next wave (battle engine engineers)**

All tables are keyed by id. Every record has `.id` and `nameKey`. Everything is frozen after `OV.Data.finalize()`, so clone with `OV.U.clone` before mutating. Difficulty is always the index 0..2.

*Battle rules (`items.js`, `units.js`)*
- **Damage types:** `damageTypes`, `DMG_IDS`, `damageMods(sparse)`.
- **Items:** fields as in the A report.
  - Firearms have `modes`, `modeList`, `ammo`, or `power`/`dmg` when they have no clip.
  - Ammo and grenades have `power`, `dmg`, `radius`, `rounds`, `prime`, `fuseMax`, `proximity`.
  - Melee has `strengthPower`; the chryssalid weapon has `zombify`.
  - Medikit has `charges`, `healHP`, …; flare has `light`.
  - Craft items use `kind` 'craft_weapon' or 'craft_ammo' and size 0.
- **Armours:** `{front, side, rear, under, mods, flight, storeItem, corpse}`.
- **Inventory:** `invSlots` R, L, belt, pack, ground.
- **Item helpers:** `itemSize`, `isTwoHanded`, `weaponModes`, `throwRange(str, wt)`, `invMoveTU(from, to)`, `fitsSlot(item, slot, contents)`, `armourArray(armour, pct)` → `[F, L, R, Rear, U]`, `soldierArmour(id)`.
- **Units:** `{side, race, rank, sprite, stats{tu,sta,hp,brav,react,fire,thr,str,melee,psiStr,psiSkill}, armour, size, height, kneel, float, move, corpse, weapon, explodeOnDeath, spawnOnDeath, capturable, …}`.
- **Races and deployments:** `races[r].members[rank]`; `deployments[dep]` = `{kind, ufo, race, terrain, map, civilians, objective, rows[{rank, qty[diff], outside, unit}], totals, artefacts?}`.
  - `artefacts?` = `{itemId: n}` (ours, only `dep_alien_base`: `{alien_food:2, alien_entertainment:2, alien_surgery:1, examination_room:1, alien_reproduction:1}`). On a win, `Battle.debrief` recovers them in proportion to the alien DEVICE tiles still intact (rounded half up). `strategy.validate` rejects unknown item ids.
- **Unit helpers:**
  - Deployment: `raceUnit`, `rowUnit(dep, row, race, pick)`, `rowQty(row, diff)`, `deploymentRange(dep, diff, month?)` (the month picks the early-months crew table; for a revisited site `OV.Battle.crewRange(mission)` returns the exact garrison size instead).
  - Alien equipment and stats: `rollItemTier(month, rng)`, `alienLoadout(unitId, depId, tier, rng)`, `alienStats(unitId, diff)`, `alienArmour(unitId, diff)`.
  - Soldiers: `ranks`, `soldierGen`, `pickNationality`, `soldierName(rng, natId, female, taken?)`, `soldierNamesTaken(soldiers, extra?)`, `rollSoldierStats`, `soldierRank`.
    - `soldierName`: without `taken` it draws exactly as before (2 numbers). With `taken(name) → bool`, a name already in use is drawn again (up to 8 times, 2 numbers each); if it still collides, it gets the suffix « II», « III», …
    - `soldierNamesTaken(soldiers, extra?)` → `(name) → bool`: `soldiers` is a `{id: soldier}` map or an array; `extra` is an optional list of more names. Used by `Soldiers.generate`, `Campaign.makeSoldier` and the Quick Battle squad, so a recruit never gets the name of a living soldier.
  - Other tables: `alienItemTiers`, `alienGrowth`.

*Maps (`tiles.js`, `blocks_*.js`)*
- **Tile definitions:**
  - `tileDefs[id]`: id 0 is null.
  - Fields: `{key, set, role, part, tu, armour, die, alt, door, window, blockLOS, heBlock, smokeBlock, flammable, fuel, height, fullBlock, diagonal, stairs, gravlift, light, explosive, mat, open, pair, mirror, upper/lower}`.
  - Lookups: `tileDefByKey`, `tileId(key)`, `tileKeys`.
- **Tilesets and legend:** `tilesets[T].roles/ids/palette`; `legend`; `TERRAIN_LEGEND`; `NODE_RANKS`, `NODE_RANK`, `NODE_RANK_PREFS`; `MAX_LEVELS` 3.
- **Blocks:**
  - `blocks[id]` is the source and carries `rotate` and `arms`.
  - `compiled[id]` = `{w, h, d, parts: Uint16Array(w·h·d·4) [floor, west, north, object], mask, nodes[{x,y,z,rank,prio}], startTiles, craftTiles, specials{POWER_SOURCE, NAVIGATION, DEVICE, OBJECTIVE, START, CRAFT}, ufoDoors, gravlifts, stairs, ufo, craft, rot}`.
  - Functions: `compileBlock`, `getCompiled(id, tileset)`, `rotateCompiled(c, q)` (returns a copy), `levelRows`, `parseLevels`, `addTerrainBlock`.
- **Map scripts:** `mapScripts[T]` = `{tileset, sizes, ceiling, blocks, civilians, commands[addCraft | addUFO | addRoads | addBlock | fill]}`. The command meaning is documented at the top of `blocks_farm.js`; `simulate()` in `data_terrain_blocks.test.js` is a reference implementation. Also `ROAD_PROFILE` and `MAP_SIZES_UFO`.

*Strategy (`ufos.js`, `crafts.js`, `base.js`, `research.js`)*
- **UFOs:** `ufos`, `ufoRules`, `ufoRecovery(ufoId, {crashed, powerSources, navigation})`.
- **Craft:** `crafts`, `craftWeapons`, `craftRules`, `dogfight`, `dogfightHitChance`, `craftFuelPer10Min`.
- **Base:** `facilities`, `startingBase`, `BASE_GRID`, `facilityCells`, `gridConnected`, `monthlyUpkeep`.
- **Research and manufacture:**
  - Tables: `research` (skip `template`), `manufacture`, `sellPrices`, `researchRules`, `researchFlags` (an array).
  - Functions: `researchAvailable`, `researchTopic`, `researchEffects`, `researchConsumable`, `manufactureAvailable`, `progressLabelKey`, `interrogationId`, `unitRankRace`, `interrogableUnits`, `validateStrategy`, `researchCycle`.
  - Constants: `ALIEN_RANKS`, `TERROR_UNITS`, `AUTOPSY_RACES`.

*Geography (`geo.js`, `world.js`)*
- **Places:** `regions`, `countries`, `cities`, `citiesById`.
- **Rectangle lookups** (use these for scoring and funding): `inAreas`, `regionAt`, `countryAt`.
- **Terrain:** `terrainBoxes`, `terrainAt(lon, lat, hash)`.
- **Missions:** `trajectories`, `altitudes`, `alienMissions`, `missionScripts`, `scriptsForMonth(month, diff, researched)`, `raceSchedule`, `raceWeights`, `missionRules` (`countdown`, `shootDownDelayMin`).
- **Constants and scoring:** `geoConst`, `scoring`, `ratingKey`.
- **World map** (for display): `world.{land, countries, countryIds, isLand(lon, lat), countryAt(lon, lat, reach)}`.

*Finalize order*
- Finalizers are registered with `OV.Data.onFinalize(name, fn, order)`: 10 ids/defaults, 50 compile, 90 validate.
- `world.freeze` runs at 95; the other files freeze at 99. Any new finalizer that writes to records must run at order ≤ 94.

## Pendentes conhecidos (onda 1)
- Win-path risk: the Muton race has no commander or leader, same as the original game. A Muton Battleship or alien base gives no commander to capture, and the commanderInterrogated flag needs a commander from another race. My test checks commanders only for sectoid, floater, snakeman and ethereal. missions.js could bias alien_base and Battleship race picks away from Muton; otherwise this is accepted as faithful to the original.
- UFO spawn nodes are fewer than the worst-case crew inside. Small scout: 1 node for up to 2 aliens on «Super-humano». Medium scout: 3 nodes for up to 6. The others have enough. The deployment code (bunits/mapgen) must apply the DESIGN §9.x fallback: rank preference, then other ranks, then outside (rank-0) nodes, so no alien is dropped.
- Alien bases have d=2 with only z0 authored and `ceiling:true`. path.js, los.js and the renderer must not allow flying or seeing above z0 there.
- Five coastal cities (havana, buenos_aires, lagos, hong_kong, perth) fall in sea cells of world.isLand. Do not land-check terror city points. Use world.countryAt(lon, lat, 2..3) or OV.Data.countryAt (rectangles) for funding attribution.
- Deployments have no nameKey. Briefing and debrief titles («Local de Terror», «Base Alienígena», «Cidónia», «OVNI Despenhado») have to come from pt-PT.battle.js, which is still a placeholder owned by the battle UI engineer. «Cidónia» on its own does not exist in OV.STR yet; only research.cydonia «Cidónia ou Desastre» does.
- Research `article` ids point to Ufopédia entries. pt-PT.ufopaedia.js is still a placeholder, so this audit does not check them.
- DESIGN.md (not in my scope) should record the wave-1 template fixes reported by E1 and E2: Large Scout row 4, Abductor row 4, ALIEN_BASE_COMMAND row 1, the rule that ramps have no roof, the terrorist node order, and the extra legend characters J Z y q p 0 7 8 9.
- Several data files carry their own onFinalize stand-in, because finalize.js loads last. All of them share OV.Data.finalizers. Moving the registry into tuning.js would remove the duplication, but it works as it is.
- UnitSprites KEYS is checked only when OV.UnitSprites is loaded. tools/load.js does not load gfx, so in a normal run that check is skipped, and sprites_units.test.js covers the keys.
