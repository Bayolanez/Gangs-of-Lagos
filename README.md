# Gangs of Lagos: browser prototype (Milestone 1)

A small, original third-person game set in **Harbour Bend**, a fictional district inspired by Lagos street life. It runs in modern desktop browsers and is single-player and local only: no accounts, multiplayer, chat or network services.

Built with **TypeScript 5.6, Vite 5.4 and Three.js 0.169** (versions pinned in `package.json`).

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
| Greet someone, get in or out of the car | E |
| Horn | H |
| Pause | P or Esc (Esc first releases the mouse, which also pauses) |

You can only get out of the car below 20 km/h.

## What is implemented (and verified in a browser)

Each item below was exercised in headless Chromium against the production build (`npm run build && npm run preview`), using a scripted playthrough:

- **Title, pause and settings menus.** Master volume, look sensitivity, invert look, and reset progress with an in-page confirm.
- **Third-person player.** Camera-relative walking, sprint and jump. The orbit camera pulls in rather than clipping into buildings. Collision with buildings, walls, the car and residents: a 40-second random walk never ended inside a building.
- **One drivable car** (an arcade model ported from the Unreal reference):
  - accelerate, brake, reverse and handbrake;
  - steering that needs speed and reverses when backing up;
  - slides along walls and stops for people; five full-throttle runs into blocks never ended inside a building;
  - brake lights, spinning wheels and a speed readout.
- **8 residents** who wander, pause and greet you on **E**, with a speech bubble and a subtitle. Lines come from `public/data/greetings.json`.
- **One mission, *Harbour Bend Sprint*.** A checkpoint race defined in `public/data/missions.json`:
  - drive into the yellow marker on the road beside your starting point to begin;
  - intro card, then a 3-2-1 countdown, then 6 checkpoints against an 80-second limit.
  - It **fails** if time runs out or you leave the car.
  - It **completes** after the last checkpoint and grants ₦5,000 plus the *Danfo yellow paint* unlock (the car is repainted). Replays pay ₦500 and track your best time.
  - A result card offers *Race again* or *Continue*.
- **Local save.** A versioned record in `localStorage` holding cash, completed missions, unlocks, best times and settings. Checked: it reloads correctly after a page refresh. If the browser blocks storage, the game runs in memory and says so.
- **Minimap (top left).** It rotates with the camera so up is always the way you're looking, and has a north marker. It shows:
  - roads, buildings, the lagoon and the bridge, with Market, Bus park, Square, Harbour Rd and Lagoon labelled;
  - you (white arrow), the car (blue) when you're on foot, and residents (small dots);
  - the race start (yellow), or the current checkpoint (green) and the next one (faint green) during the race;
  - the start, checkpoint and car stick to the map edge when they're out of range.

  It zooms out while you drive.
- **Adaptive quality.** On slow machines it lowers resolution and then turns shadows off.

Not yet checked: frame rate on a real GPU. The test browser here renders in software, which is far slower than any real machine. Please report how it runs on yours.

## Placeholder or not yet built

- **All art is placeholder.** Buildings, people, the car, minibuses and palms are boxes, cylinders and spheres in flat colours. People have a simple leg and arm swing, with no skeletal animation.
- **Audio** is original synthesized blips plus an engine hum. **There is no music.** A radio or station selector will only ever play original or properly licensed tracks. "Lagos Boys" by Olamide stays out until it is licensed.
- **One mission type (race).** The heist and escape missions from the original brief are not built yet.
- **Not included:** traffic, police, weapons, a full-screen map, mobile/touch controls, and day/night.
- **Dialogue** is plain English and marked `"reviewed": false`. Pidgin, Yoruba, Igbo or Hausa lines should come from native-speaking writers.

## Project layout

```
index.html              page shell: canvas, HUD, menus
public/data/
  greetings.json        resident lines by voice (edit freely)
  missions.json         mission definitions (positions in metres)
src/
  main.ts               boot, game loop, camera, interaction, UI wiring
  district.ts           Harbour Bend layout (ported from the Unreal GOLDistrict)
  collision.ts          2D boxes + circles collision on the ground plane
  player.ts  human.ts   on-foot player and the placeholder person rig
  car.ts                arcade car (ported from GOLCar)
  npc.ts  dialogue.ts   residents and greeting data
  mission.ts            data-driven race runner, rewards
  minimap.ts            rotating top-left minimap
  save.ts               versioned localStorage save
  audio.ts              Web Audio synth sounds (no music)
  input.ts              keyboard, mouse and pointer lock
  placeholders.ts       shape and instancing helpers (all placeholder art)
  style.css             HUD and menus
```

Coordinates: 1 unit = 1 metre. x runs west to east, with the lagoon on the east at x = 140. z runs across the grid, with roads at ±40 m and ±120 m.

### Adding or editing a mission

Add an entry to `public/data/missions.json` with `type: "race"`, a `start` point on a road, `checkpoints` as `[x, z]` pairs, `timeLimit` and `reward`. Only the first mission's start marker is shown in this milestone.

### Testing hook

Opening the game with `?debug` exposes `window.__gol` (state, teleports, and a `simulate(seconds)` stepper) for automated checks. It does nothing unless that parameter is present.

## Relationship to the Unreal reference

The earlier Unreal C++ project was not used as runtime code. These carried over as design:
- the district layout and its local details;
- the car tuning;
- the interaction rule (nearest usable thing in front, one E key);
- the residents and `greetings.json`;
- the save fields and versioning;
- the menu flow and the rights rules.

## Rights

All names, places, dialogue and designs are original or generic. There are no assets, logos or distinctive designs from GTA, Call of Duty: Mobile, racing games or other franchises. Harbour Bend and its residents are fictional, and no real officials or real private residences appear. Fonts load from Google Fonts (Bowlby One and Barlow Condensed, both under the SIL Open Font License), with system fallbacks.
