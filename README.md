# Gangs of Lagos: browser prototype (Phase 5, "Real Lagos, area 1")

A small, original third-person game set in two fictional districts inspired by Lagos street life: **Harbour Bend** and, across the Old Ferry Bridge, **Marina Point**. It runs in modern desktop browsers and is single-player and local only: no accounts, multiplayer, chat or network services.

Built with **TypeScript 5.6, Vite 5.4 and Three.js 0.169** (versions pinned in `package.json`). Every milestone and phase keeps the same stack and engine as Milestone 1; nothing was migrated.

Phase 4 adds original placeholder weapons, a shooting range with medals, an arms counter, health and armour, a 1 to 5 heat level with a fictional patrol unit, a fictional hospital, and street voices in five languages. See *New in Phase 4* below.

Phase 5 adds the map pipeline. `tools/osm-import` turns an OpenStreetMap extract into streamed 400 m tiles. The game streams those tiles, runs traffic and BRT buses on the imported roads, fines drivers in BRT lanes, slows cars on market roads and has potholes. The first real area is **Lagos Island**: the waterfront business district around Marina and Broad Street, a box about 2.2 × 1.4 km (`6.447,3.385` to `6.460,3.405`). It is in 23 tiles, with 426 roads under their real names and 2,907 anonymous placeholder buildings. Play it from the title screen (*Lagos Island (real map preview)*) or the pause menu.

## Run it

You need Node.js 18 or newer (tested on 22).

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
```

Production build:

```bash
npm run build      # type-checks, then writes static files to dist/
npm run preview    # serves dist/ at http://localhost:4173
```

To put the game on a host that only serves standard web file types (for example a claude.ai Artifact), run `node tools/web-bundle.mjs <out-dir>` after the build. It inlines the CSS and JS into one page and wraps each map tile's `.glb` mesh in a `.json` file; the game loads either form.

`dist/` is plain static files (`base: './'`), so it can be hosted on any static host or in a sub-folder. It must be served over HTTP, not opened as a `file://` page, because the game fetches its data files.

Browsers: recent Chrome, Edge, Firefox or Safari on a desktop or laptop with WebGL 2. There are no touch controls yet.

## Controls

| Action | Key |
|---|---|
| Walk / drive and steer | WASD or arrow keys |
| Look | Mouse. Click the game to capture the mouse, or hold the right button and drag if capture isn't available |
| Sprint | Shift |
| Jump / handbrake | Space |
| Talk, take a job, get in or out | E |
| Horn (people nearby get out of the way) | H |
| Full map | M |
| Pause (jobs list, map, settings) | P or Esc (Esc first releases the mouse, which also pauses) |
| Draw a weapon you own | 1 pipe · 2 pistol · 3 SMG · 4 shotgun · 5 rifle · 6 marksman rifle (press again to put it away) |
| Holster / draw the last weapon | Q |
| Fire or swing | Left click once the mouse is captured, or F. Hold for the SMG and rifle |
| Aim over the shoulder (and zoom) | Hold the right mouse button while the mouse is captured |
| Reload | R (it also reloads by itself when the magazine runs dry) |

You can only get out of a vehicle below 20 km/h. Weapons are put away when you get in a vehicle.

## How to play

1. Press **Play** and choose your look from the free basics: skin tone, top, colour and trousers.
2. The orange arrow at the top points to whoever has work for you; they have an orange **!** over their head and on the map.
3. **Harbour Bend Sprint** (Kunle, bus park). Get in your car, line up at the start on the west road, then hit six checkpoints in 80 seconds. Pays ₦5,000 and the Danfo yellow paint.
4. **Market Run** (Mama Titi, market). Collect a fragile parcel from her stall on foot, get in a vehicle and deliver it to the Harbour Road flats. Every hard knock damages the parcel and cuts your pay; at 0% the job fails.
5. **Danfo Shift** (Emeka, bus park). Take the yellow danfo minibus round five bus stops, stopping fully at each shelter for two seconds. Each stop pays ₦300 in fares.
6. Finish all three to complete **chapter 1, Harbour Bend Hustle**. That pays a ₦10,000 bonus, unlocks the Eko gold paint and **reopens the Old Ferry Bridge** to Marina Point.
7. **Diesel Run** (Mr Femi, Lagoon Fuel in Marina Point). Load jerrycans between the pumps, then stop at three drop-offs, the last one back across the bridge. Each drop pays ₦600 on top of the base pay.
8. **Marina Showdown** (Dapo, Marina Gardens). A one-lap, six-turn race on closed roads against Dapo, who drives the route himself. The HUD shows how far ahead or behind you are. If he crosses the line first, you lose.
9. Finish both Marina jobs to complete **chapter 2, Marina Point**: a ₦15,000 bonus and the gold Champion jacket.

Any time:
- **Clothes.** Talk to **Ngozi** (tailoring kiosk at the back of the market) or **Funmi** (Marina Threads, on the Marina boulevard) to open the wardrobe. You can change into anything you own and buy that shop's items. Items sold elsewhere or earned by playing are listed with where to get them.
- **Damage.** Crashes damage whatever you drive. Below 40% it smokes, below 30% it loses power, and at 0% it is towed to **Chidi's Workshop** (east of the square) for ₦500. Stop in the yellow bay there to repair (₦20 per 1%) or buy and apply paint.

Every job can be replayed for a smaller "repeat" payment. Talk to the giver again to replay.

**Street Kit (Phase 4), any time:**
- **Range Day.** Coach Kola at the **Harbour Bend Range** (west of the square, *R* on the map) runs a 40-second pop-up target challenge with a loaner Egret pistol. Stay behind the yellow rail. Bronze is 10 hits and gives you the Egret pistol with 24 rounds. Silver is 18 hits and puts the Kingfisher SMG and Breakwater shotgun on sale. Gold is 26 hits and puts the Harmattan rifle and Heron marksman rifle on sale. Leaving the firing line ends the round.
- **Arms counter.** Sade, behind the counter at the range, sells the weapons your medals have unlocked (each comes with one pack of rounds), more rounds, and body armour (₦1,500, soaks up damage before your health). The iron pipe is always on sale.
- **Heat.** Firing on the street where people can hear it gives you heat 1. Hitting a resident (they duck and run; residents can't be hurt) raises it to at least 2, and hitting an officer raises it to at least 3, up to 5. Officers from the fictional **Harbour Patrol Unit** arrive near where you were last seen. There are 2 at heat 1 and up to 8 at heat 5. They chase you and shoot when they can see you. Firing on the range never gives heat.
- **Losing them.** Stay out of sight: heat drops one level after 10 s unseen, plus 3 s for each level. A change of clothes at a wardrobe while no officer can see you clears your heat at once. The HUD shows your heat and whether you are *seen* or *hiding*.
- **Health.** It comes back slowly after 6 s without damage: to full when you have no heat, to half while you are wanted. If you go down you wake at **Harbour Bend General Hospital** (fictional, *H* on the map). Treatment costs ₦1,000 (or what you have), your heat is cleared, your armour is gone, and a running job fails.
- **Street voices.** Residents say short lines in English, Pidgin, Yoruba, Igbo or Hausa when you bump into them, stand in their way, honk at them, or walk past. The subtitle shows the line with its English meaning.

## What is implemented (and verified in a browser)

Each item below was exercised in headless Chromium against the production build (`npm run build && npm run preview`) by the scripted playthroughs in `tests/` (see *Testing*). It plays the three jobs, the finale, the workshop, a wreck and tow, the map, the horn, traffic and save migration. Milestone 3 adds `tests/m3_playthrough.py`, which covers the new content end to end. The Milestone 2 checks were re-run against the Milestone 3 build.

**Carried over from Milestone 1:** title, pause and settings menus; third-person walking with sprint and jump; an orbit camera that avoids clipping into buildings; collision; residents who greet you; the rotating minimap; local saving; adaptive quality.

**New in Milestone 2:**
- **Jobs offered by residents.** Talking to a job giver opens a job card with the pay, time limit and unlocks, with *Take the job* or *Not now*. Jobs unlock in a chain (race, then delivery, then shift), and locked givers tell you who to see first. One step-based job runner (`src/mission.ts`) drives all three job types from `public/data/missions.json`.
- **Three kinds of job:**
  - a checkpoint race;
  - a fragile delivery with a parcel-condition meter that scales the pay;
  - a bus route with held stops and fares.
- **Failure states:**
  - time up;
  - leaving the vehicle (race and shift);
  - the vehicle wrecked;
  - the parcel ruined;
  - abandoning from the pause menu.
- **The result card** shows time or parcel condition, fares, pay, unlocks and who to see next, with *Try again* / *Do it again* and *Continue*.
- **A second drivable vehicle**, the bus park danfo. It is slower, heavier and tougher, with its own camera distance. Vehicles share one tuned arcade model (`src/vehicles.ts`).
- **Vehicle damage.** Impacts cost health. The vehicle smokes when damaged, loses power when badly damaged, and is wrecked and towed at zero. A health bar shows while you drive, and your car's condition is saved.
- **Chidi's Workshop** (fictional), a new yard with a service bay:
  - repairs for the vehicle you drove in;
  - paint jobs for your own car: buy blue or red for ₦2,500, or apply the earned danfo and gold paints;
  - buttons are disabled with a reason when you can't afford something.
- **AI traffic.** About 10 placeholder cars, keke and danfos drive the road grid in the right-hand lane. They pick random turns, slow for corners and give way at junctions, stop for people and vehicles in front, and honk if you block them. If you hit one it stalls briefly. They cannot be entered. On slow machines the count drops to 6.
- **Five bus stop shelters** in the world and on both maps.
- **Resident reactions.** People step out of the way of fast cars ahead of them, scatter when you honk, and sometimes shout a line at you. They come back to wandering afterwards.
- **Full map (M or from the pause menu).** North-up, with a legend showing you, your car, the danfo, the job on offer, the current objective and the bus stops.
- **HUD:**
  - job panel with timer, parcel condition or fares;
  - compass to the objective, the vehicle you need, or the next job giver;
  - world labels over objectives;
  - job count next to cash.
- **Pause menu jobs list.** Status, best time or best pay, and replay pay for each job, plus totals (races, deliveries, shifts, fares, tows, repairs).
- **Save format v2** with automatic migration. A Milestone 1 save (`version: 1`) loads with its cash, the completed race and best time intact, and its `paint-danfo` unlock becomes the owned and active Danfo yellow paint. The title screen says the save was upgraded.

**New in Milestone 3:**
- **Character customization.**
  - *Choose your look* on a new game, or once after upgrading an older save.
  - Five slots: skin tone (4), top (5 styles), colour (8, including the original procedural *Harbour print* pattern), headwear (5) and trousers (4).
  - Wardrobes at two fictional shops, with a live preview: the camera turns to face your character while you browse.
  - Items are free, bought, or earned. The Danfo driver cap is for finishing the Danfo Shift; the Champion jacket is for finishing chapter 2.
  - Your outfit and bought clothes are saved.
- **Marina Point**, a second fictional district (about 140 × 300 m) across the reopened bridge:
  - office towers around a fountain plaza;
  - a roadside strip with four kiosks and the Marina Threads boutique;
  - the Lagoon Fuel station (fictional brand) and Marina Gardens;
  - flats, a waterfront promenade and quay;
  - Marina Boulevard, which has a planted median, so you can only cross it at junctions.
  - Five new residents with their own lines.
- **Bridge progression.** The bridge stays closed (barrier, colliders, and a red bar on the map) until chapter 1 is done, then opens immediately.
- **Traffic** now runs on a general road graph. Cars reach Marina Point over the bridge once it opens.
- **Two new job types:**
  - a multi-drop errand that pays per drop;
  - a head-to-head race against a rival who drives his lane round the route. He slows for corners, won't drive through your car, and everyday traffic is cleared for the race.
  - In testing, Dapo's lap took 40.3 s. A simple scripted driver using the normal keyboard controls beat him in 29.9 s, bumping walls along the way, so the race is winnable with ordinary driving.
- **Chapters.** Chapter bonuses are data-driven (`chapters` in `missions.json`).
- **Maps.** Both maps now include Marina Point, its place names, clothes shops and the rival's position.
- **Faces.** People now have simple eyes and mouths, so you can see which way they face.
- **Driving fixes.**
  - Crashes into other vehicles now hurt by closing speed, so tapping a car you're following costs little and a head-on costs a lot.
  - Your car now starts parked off the traffic lane.
  - AI cars breaking a junction standoff no longer drive through the car queued in front of them.
- **Save format v3.**
  - Adds your outfit, bought clothes, the "look chosen" flag and finished chapters.
  - Version 1 and 2 saves migrate step by step. A v2 save that finished Harbour Bend opens the bridge straight away.
- **Reset progress** now reloads into a fresh save, which also closes the bridge and resets your look.

**New in Phase 5 (Real Lagos, area 1):** the importer and the streaming are tested on `tools/osm-import/fixtures/fixture-town.osm`. That is **synthetic test data, not a real place**, and it never ships.
- **Importer** (`tools/osm-import`, see its README): OSM XML or Overpass JSON goes in; UTM 31N metres and 400 m tiles come out. Each tile is a GLB mesh plus a JSON sidecar (roads, building footprints, ground areas, potholes, lane-warden posts), and there is a road graph and a manifest with the OpenStreetMap attribution and licence note. Roads become expressway, BRT corridor, service lane, inner street or market road. Road names are kept; business, shop, brand, market and church names are dropped. Potholes go on rough surfaces, plus seeded random ones on inner streets, and imports are deterministic (`m5_osm_import.py`).
- **Streaming** (`src/area.ts`): tiles load within about 600 m and unload beyond 700 m. Map buildings are solid, using polygon colliders that work for walking, driving, cameras and bullets.
- **Traffic** (`src/areatraffic.ts`): cars follow the imported road graph (right-hand half of two-way roads, one-way streets respected), and placeholder BRT buses run only in BRT lanes.
- **Road rules:**
  - drive in a BRT lane near a lane-warden post (fictional) and you are fined ₦2,000;
  - market roads cap you at walking-plus pace;
  - potholes jolt the camera and damage the car, and at speed can burst a tyre, which slows you and pulls to one side until a repair or tow.
- **In game:** "© OpenStreetMap contributors" shows on screen and on the full map whenever you are in an area. The title screen and pause menu offer the first imported area, and the pause menu has *Back to Harbour Bend* (`m5_area.py`). Harbour Bend and Marina Point are unchanged.

**Lagos Island** comes from an OpenStreetMap extract downloaded on 10 October 2026, kept in `data/osm/lagos-island.osm` so it can be re-imported:
`node tools/osm-import/import.mjs --in data/osm/lagos-island.osm --id lagos-island --name "Lagos Island" --bbox 6.447,3.385,6.460,3.405`.
- The OpenStreetMap data has **no BRT lanes inside this box** (the BRT corridor ends just east of it), so this area has no BRT buses or lane wardens.
- It has no tagged lagoon edge, so the water around the island isn't drawn.
- It still needs the manual check described in the importer README before it ships.

To add another area: get an extract for it, run `node tools/osm-import/import.mjs --in area.osm --id <id> --name "<name>"`, then `npm run build`. The buttons only appear once an area is listed in `public/areas/index.json`, so there are no dead buttons before then.

Not yet checked: frame rate on a real GPU. The test browser here renders in software (about 0.5 frames per second), so all checks step the simulation directly. Please report how it runs on your machine, especially with traffic.

**New in Phase 4 (Street Kit):** each item below is exercised in headless Chromium by the new scripts in `tests/` (`m4_*.py`), and the Milestone 2 and 3 scripts were re-run against the Phase 4 build.
- **Weapons** (`src/weapons.ts`): six original placeholder weapons with invented names. They are the Iron pipe (melee), Egret pistol, Kingfisher SMG, Breakwater shotgun, Harmattan rifle and Heron marksman rifle. Each has its own damage, fire rate, magazine, reload time, range and spread, and the shotgun fires eight pellets. Third-person aiming: shots go where the crosshair points, then travel from the gun so walls block them. Tracers, muzzle flashes and impact puffs are simple placeholder effects. Semi-automatic weapons fire once per press, automatics while held. Magazines reload by themselves when empty, or with R. Holster with Q.
  - *Tested:* drawing, firing, rounds spent, automatic and manual reloads, running dry, shotgun pellets damaging a car, holstering, no weapons in vehicles, the pipe hitting a resident, knocking an officer down (`m4_weapons.py`).
- **Harbour Bend Range** (`src/range.ts`, new block in `district.ts`): firing line, lanes, a berm, pop-up targets, Coach Kola's Range Day with bronze, silver and gold, and Sade's arms counter (`m4_range_shop.py`).
- **Health, armour and heat** (`src/combat.ts`): heat 1 to 5, the fictional patrol unit with simple chase-and-search AI, armour soaking damage, cooling off out of sight, losing them with a change of clothes, the hospital and its fee, a job failing when you go down, and slow regeneration (`m4_heat.py`).
- **Street voices** (`public/data/street_voices.json`, `src/voices.ts`): greetings, complaints and "excuse me" in five languages. They trigger on bumping, blocking, honking and walking past. Every non-English line is marked `"reviewed": false` (`m4_voices.py`).
- **Save format v4**: adds weapons, rounds, the drawn weapon, armour, Range Day best and medal, and shots, hospital and escape counts. Version 1, 2 and 3 saves migrate step by step, and bad data is cleaned on load (`m4_save.py`).
- **Map**: the range (*R*), the hospital (*H*) and patrol officers on both maps.

The Range Day thresholds were tuned against a scripted shooter with perfect aim, which reaches 26 hits in well under the 40 seconds. They have not been tried by people yet, so they may need adjusting.

## Placeholder or not yet built

- **All art is placeholder.** Buildings, people and vehicles are boxes, cylinders and spheres in flat colours. The traffic cars, keke, danfo and workshop are generic shapes, not modelled on any real product or franchise.
- **Phase 4 placeholders:**
  - the weapons are a few boxes and cylinders each, with invented names, and are not modelled on any real firearm or on any game's weapons;
  - officers are box people in an invented uniform;
  - the range, hospital and arms counter are grey-box buildings, with "Fictional · placeholder" signs in game;
  - the hospital sign is a blue *H*, not a red cross (a protected emblem);
  - gunshots are synthesized noise;
  - there are no hit reactions beyond falling over, and no blood.
- **Street voices are text only.** There are no recordings yet. The non-English lines are short drafts (the four from the build script plus a few common greetings and complaints), and which resident speaks which language is also a draft in `street_voices.json`. Native-speaking writers need to expand and check them and set `"reviewed": true` before release.
- **Phase 5 gaps:**
  - Lagos Island is the only real area, and it hasn't had its manual data check yet;
  - tiles are uncompressed GLB, with no Draco or meshopt yet;
  - bridges sit at ground level;
  - the coastline isn't drawn;
  - there is no hand-fix pass on the data;
  - buildings are plain extruded blocks with no props, markets with stalls, traders, okadas or rush-hour go-slow yet;
  - map areas have no jobs, residents or workshop yet (a wreck is towed back to the area's start);
  - BRT buses and lane-warden booths are placeholder shapes, and the lane wardens are fictional.
- **Patrol AI is simple.** Officers run straight at you or your last known position and side-step when stuck. There are no patrol cars yet. They don't drive, and they don't stop you driving away. Drive-by shooting is not in.
- **Audio** is original synthesized blips, horns and an engine hum. **There is no music.** A radio will only ever play original or properly licensed tracks. "Lagos Boys" by Olamide stays out until it is licensed.
- **Not included:**
  - body shapes, hairstyles and faces beyond simple placeholder eyes;
  - more than two districts;
  - story or heist missions;
  - pedestrians crossing between blocks, and traffic lights;
  - day/night;
  - mobile or touch controls.
- **Not interactive yet:** traffic cars can't be entered, and residents aren't hurt by cars (vehicles stop against people).
- **Dialogue** is plain English and marked `"reviewed": false`. Pidgin, Yoruba, Igbo or Hausa lines should come from native-speaking writers.

## Project layout

```
index.html              page shell: canvas, HUD, menus (title, pause, settings, job card, workshop, map, result)
public/data/
  greetings.json        resident lines by voice, including mechanic and "startled" (edit freely)
  missions.json         job definitions: givers, steps, timers, rewards (positions in metres)
  street_voices.json    Phase 4 street voices: lines by kind and language, who speaks what (drafts, reviewed:false)
src/
  main.ts               boot, game loop, camera, interaction, jobs/workshop/map UI wiring
  district.ts           Harbour Bend and Marina Point layouts, bridge gate, workshop, bus stops, residents, road graph
  vehicles.ts           shared arcade vehicle model, specs, damage, paints, placeholder bodies
  outfits.ts            clothing items, shops, prices, earned items, procedural print pattern
  traffic.ts            AI traffic on a road graph
  mission.ts            step-based job runner, rewards, chapters, rival driver
  collision.ts          2D boxes + circles collision on the ground plane
  player.ts  human.ts   on-foot player and the placeholder person rig
  npc.ts  dialogue.ts   residents (wander, greet, dodge, flee) and greeting data
  minimap.ts            rotating minimap and the full north-up map
  save.ts               versioned localStorage save (v4, migrates v1 to v3)
  weapons.ts            Phase 4 weapon data, ray tests, magazines and reloads, placeholder weapon shapes
  combat.ts             Phase 4 health, armour, heat and the fictional patrol unit
  range.ts              Phase 4 Range Day pop-up targets and medals
  voices.ts             Phase 4 street voices loader
  area.ts               Phase 5 map-area tile streaming, building colliders, potholes, BRT posts
  areatraffic.ts        Phase 5 traffic and BRT buses on an imported road graph
public/areas/            Phase 5 imported map areas: index.json plus lagos-island/ (tiles, graph, manifest)
data/osm/               Phase 5 OpenStreetMap source extracts (ODbL), kept for re-importing
tools/osm-import/       Phase 5 OpenStreetMap importer (see its README) and the synthetic test fixture
  audio.ts              Web Audio synth sounds (no music)
  input.ts              keyboard, mouse and pointer lock
  placeholders.ts       shape and instancing helpers (all placeholder art)
  style.css             HUD and menus
```

Coordinates: 1 unit = 1 metre. x runs west to east, with the lagoon on the east at x = 140. z runs across the grid (negative z is north on the map), with roads at ±40 m and ±120 m.

### Adding or editing a job

Add an entry to `public/data/missions.json`:
- `giver`: a resident's name from `district.ts`.
- `chapter`: the story chapter it belongs to.
- `requires` / `requiresChapter`: optional, the job id or chapter that must be done first.
- `rival`: optional, for a head-to-head race (name, speeds, centre-line `path`).
- `timeLimit` and `timerStartsAtStep`.
- `failOnExit`: optional.
- `reward`: `cash`, `repeatCash` and an optional `paint`.
- `steps`: a list of steps of these kinds:
  - `{"kind":"enter","vehicle":"any"|"danfo"}`;
  - `{"kind":"countdown","seconds":3}`;
  - `{"kind":"goto","x":..,"z":..,"radius":..}` with any of: `maxSpeed`, `hold` (seconds), `onFoot`, `inVehicle`, `vehicle`, `marker` (`start`, `checkpoint`, `pickup`, `dropoff` or `stop`), `label`, `fare`, `givesCargo`.

### Testing

`tests/` holds the browser playthroughs used for the claims in this README. They use Python 3 with Playwright (`pip install playwright`) and need a running build (`npm run build && npm run preview`). Set `GOL_URL` if the server isn't at `http://localhost:4173/?debug`. Each script prints PASS or FAIL lines.

- `m2_jobs.py`, `m2_systems.py`, `m2_driving.py`: Milestone 2 regression.
- `m3_playthrough.py`: Milestone 3 content.
- `m3_bot_race.py`: a keyboard-driven bot that tries to beat Dapo.
- `m4_weapons.py`, `m4_range_shop.py`, `m4_heat.py`, `m4_voices.py`, `m4_save.py`: Phase 4. They share `gol.py` (browser setup, save builder, PASS/FAIL) and exit non-zero on any failure.
- `m5_osm_import.py` (no browser; needs Node) and `m5_area.py`: Phase 5. `m5_area.py` imports the synthetic fixture into `dist/test-areas/` first, so run it after `npm run build`.

Playwright for Python must match the installed browser build; with a pre-installed Chromium you may need a specific version (for example `pip install playwright==1.56.0` for Chromium build 1194).

### Testing hook

Opening the game with `?debug` exposes `window.__gol` for automated checks:
- state;
- the vehicles and residents;
- teleports;
- `approach(name)`;
- a `simulate(seconds)` stepper;
- Phase 4: `weapons`, `combat`, `rangeRun`, `voices`, `setAim(point)` to aim at a world point, `setCamYaw`, `lastShot`, `lastVoice` and `goDown()`.

It does nothing unless that parameter is present.

## Roadmap: later phases

The current plan is the build script's phases 5 to 9. Phase 5 is *Real Lagos, area 1*: the pipeline is built, and importing and hand-fixing the first real area is what remains. Phase 6 is *Wings and Water* (aircraft, boats, radio). Phase 7 is *Avatar 2.0 and property*. Phase 8 is *Online foundation* and Phase 9 is *Crews and chat*. The notes below are the earlier roadmap, kept for reference.

Each phase should end, like this one, with a playable build where every visible button works.

1. **Character and city** (started in Milestone 3: outfits, shops and a second district). Next:
   - a fuller character creator with body shapes and hairstyles;
   - more garments by local designers or licensed artists;
   - a home with a wardrobe;
   - one or two more fictional districts, for example a residential mainland reached by a new road. Districts would load as data-driven chunks so the browser only keeps what is near the player. Expect to replace placeholder art with commissioned or properly licensed models at this stage.
2. **More to do.** Add:
   - more story and side jobs, including heist-style and escape jobs with fictional targets only;
   - more vehicles: keke, okada-style bikes, a boat on the lagoon;
   - a street-race series and a time-trial board;
   - social activities such as market haggling, a weekend party or owambe event, and football at the square;
   - a radio with original or licensed music only;
   - day/night and traffic lights.
3. **Online accounts, crews and co-op.** Use a reputable managed backend (for example Supabase, Firebase or PlayFab, chosen at the time) for sign-in and cloud saves. The server is the source of truth for cash, unlocks and job completions; the browser only sends actions, never balances. Add crews and small co-op jobs over a hosted real-time service. Rival crews stay fictional.
4. **Chat, safety and the server economy.** Text chat with:
   - default filters and per-player mute and block;
   - report buttons that capture context for moderators;
   - rate limits;
   - moderator tools: review queue, warnings, temporary and permanent bans;
   - age-appropriate defaults.

   A server-validated economy covers prices, payouts, anti-cheat checks on job timings, and audit logs. Any real-money purchases would need separate legal, platform and age-rating review before they are considered.

## Relationship to the Unreal reference

The earlier Unreal C++ project was not used as runtime code. These carried over as design:
- the district layout and local details;
- the car tuning;
- the interaction rule (nearest usable thing in front, one E key);
- the residents and `greetings.json`;
- the save fields and versioning;
- the menu flow and the rights rules.

## Rights

All names, places, dialogue and designs are original or generic. There are no assets, logos or distinctive designs from GTA, Call of Duty: Mobile, racing games or other franchises. Weapon names (Egret, Kingfisher, Breakwater, Harmattan, Heron) and shapes are invented for this game. The Harbour Patrol Unit, Harbour Bend Range and Harbour Bend General Hospital are fictional, and no real police force, agency or hospital is depicted. Harbour Bend, its residents, Chidi's Workshop and the bus stops are fictional. No real officials, real businesses or real private residences appear, and no real person is a target. Fonts load from Google Fonts (Bowlby One and Barlow Condensed, both under the SIL Open Font License), with system fallbacks.
