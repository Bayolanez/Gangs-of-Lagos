# Gangs of Lagos: browser prototype (Milestone 2, "Harbour Bend Hustle")

A small, original third-person game set in **Harbour Bend**, a fictional district inspired by Lagos street life. It runs in modern desktop browsers and is single-player and local only: no accounts, multiplayer, chat or network services.

Built with **TypeScript 5.6, Vite 5.4 and Three.js 0.169** (versions pinned in `package.json`). Milestone 2 keeps the same stack and engine as Milestone 1; nothing was migrated.

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

You can only get out of a vehicle below 20 km/h.

## How to play Milestone 2

1. Press **Play**. The orange arrow at the top points to whoever has work for you; they have an orange **!** over their head and on the map.
2. **Harbour Bend Sprint** (Kunle, bus park). Get in your car, line up at the start on the west road, then hit six checkpoints in 80 seconds. Pays ₦5,000 and the Danfo yellow paint.
3. **Market Run** (Mama Titi, market). Collect a fragile parcel from her stall on foot, get in a vehicle and deliver it to the Harbour Road flats. Every hard knock damages the parcel and cuts your pay; at 0% the job fails.
4. **Danfo Shift** (Emeka, bus park). Take the yellow danfo minibus round five bus stops, stopping fully at each shelter for two seconds. Each stop pays ₦300 in fares.
5. Finish all three for the finale: a ₦10,000 bonus and the Eko gold paint.
6. Crashes damage whatever you drive. Below 40% it smokes, below 30% it loses power, and at 0% it is towed to **Chidi's Workshop** (east of the square) for ₦500. Stop in the yellow bay there to repair (₦20 per 1%) or buy and apply paint.

Every job can be replayed for a smaller "repeat" payment. Talk to the giver again to replay.

## What is implemented (and verified in a browser)

Each item below was exercised in headless Chromium against the production build (`npm run build && npm run preview`) by a scripted playthrough (`m2test.py`, see *Testing hook*). It plays the three jobs, the finale, the workshop, a wreck and tow, the map, the horn, traffic and save migration.

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

Not yet checked: frame rate on a real GPU. The test browser here renders in software (about 0.5 frames per second), so all checks step the simulation directly. Please report how it runs on your machine, especially with traffic.

## Placeholder or not yet built

- **All art is placeholder.** Buildings, people and vehicles are boxes, cylinders and spheres in flat colours. The traffic cars, keke, danfo and workshop are generic shapes, not modelled on any real product or franchise.
- **Audio** is original synthesized blips, horns and an engine hum. **There is no music.** A radio will only ever play original or properly licensed tracks. "Lagos Boys" by Olamide stays out until it is licensed.
- **Not included:**
  - character customization or outfits;
  - more districts, and the bridge stays closed;
  - police, weapons, story or heist missions;
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
src/
  main.ts               boot, game loop, camera, interaction, jobs/workshop/map UI wiring
  district.ts           Harbour Bend layout, workshop, bus stops, residents
  vehicles.ts           shared arcade vehicle model, specs, damage, paints, placeholder bodies
  traffic.ts            AI traffic on the road grid
  mission.ts            step-based job runner, rewards, finale
  collision.ts          2D boxes + circles collision on the ground plane
  player.ts  human.ts   on-foot player and the placeholder person rig
  npc.ts  dialogue.ts   residents (wander, greet, dodge, flee) and greeting data
  minimap.ts            rotating minimap and the full north-up map
  save.ts               versioned localStorage save (v2, migrates v1)
  audio.ts              Web Audio synth sounds (no music)
  input.ts              keyboard, mouse and pointer lock
  placeholders.ts       shape and instancing helpers (all placeholder art)
  style.css             HUD and menus
```

Coordinates: 1 unit = 1 metre. x runs west to east, with the lagoon on the east at x = 140. z runs across the grid (negative z is north on the map), with roads at ±40 m and ±120 m.

### Adding or editing a job

Add an entry to `public/data/missions.json`:
- `giver`: a resident's name from `district.ts`.
- `requires`: optional, the id of the job that must be done first.
- `timeLimit` and `timerStartsAtStep`.
- `failOnExit`: optional.
- `reward`: `cash`, `repeatCash` and an optional `paint`.
- `steps`: a list of steps of these kinds:
  - `{"kind":"enter","vehicle":"any"|"danfo"}`;
  - `{"kind":"countdown","seconds":3}`;
  - `{"kind":"goto","x":..,"z":..,"radius":..}` with any of: `maxSpeed`, `hold` (seconds), `onFoot`, `inVehicle`, `vehicle`, `marker` (`start`, `checkpoint`, `pickup`, `dropoff` or `stop`), `label`, `fare`, `givesCargo`.

### Testing hook

Opening the game with `?debug` exposes `window.__gol` for automated checks:
- state;
- the vehicles and residents;
- teleports;
- `approach(name)`;
- a `simulate(seconds)` stepper.

It does nothing unless that parameter is present.

## Roadmap: later phases

Each phase should end, like this one, with a playable build where every visible button works.

1. **Character and city.** Add character customization (body, outfits and accessories bought with in-game cash, all original designs) and a wardrobe at home. Then add two or three more fictional districts, for example a busy commercial island and a residential mainland, joined by the reopened bridge. Districts would load as data-driven chunks so the browser only keeps what is near the player. Expect to replace placeholder art with commissioned or properly licensed models at this stage.
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

All names, places, dialogue and designs are original or generic. There are no assets, logos or distinctive designs from GTA, Call of Duty: Mobile, racing games or other franchises. Harbour Bend, its residents, Chidi's Workshop and the bus stops are fictional. No real officials, real businesses or real private residences appear, and no real person is a target. Fonts load from Google Fonts (Bowlby One and Barlow Condensed, both under the SIL Open Font License), with system fallbacks.
