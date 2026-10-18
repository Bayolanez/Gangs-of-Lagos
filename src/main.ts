import * as THREE from 'three';
import './style.css';
import { AREA_OFFSET, AreaStreamer } from './area';
import { AreaTraffic } from './areatraffic';
import { Audio } from './audio';
import { CollisionWorld } from './collision';
import { Combat, MAX_HEAT, Officer, UNIT_NAME } from './combat';
import { Craft, CraftEnv, CraftInput, surfaceAt, WATER_Y } from './craft';
import { Cutscene } from './cutscene';
import { loadBlkKing } from './blkking';
import { loadModel, loaded as modelsLoaded } from './models';
import { StreetLights } from './streetlights';
import { TouchControls, TouchContext, wantsTouch } from './touch';
import { CREWS, CrewDef, CrewGroup, CrewId, CrewWorld, crewById, Fighter, Followers, memberLook, Target } from './crews';
import { ArmsShop, CLUB, Club, CrewHouse, GARAGE, KEEP_OUT } from './places';
import { ClubMusic } from './clubmusic';
import { LagosHouse, LH_GARAGE } from './lagoshouse';
import { Dialogue } from './dialogue';
import { AIRFIELD, buildDistrict, HALF, HOSPITAL, isWater, JETTY, MARINA, roadGraph, SHORE, WORKSHOP } from './district';
import { areaName, routeTo, Stamina, WEAPON_ICONS } from './hud';
import { ENV_LABELS, Environment, estimateWeather, fromWeatherCode, lagosHours, sunPosition, TimeMode, WeatherMode } from './environment';
import { HumanLook, HumanRig } from './human';
import { Input } from './input';
import { MapMarker, MarkerKind, Minimap } from './minimap';
import { ChapterDef, FIRST_STORY, loadMissions, MarkerKind as StepMarker, MissionDef, MissionResult, MissionRunner } from './mission';
import { Line, Phone } from './phone';
import { CHAIRMAN_KEEP_OUT, ChairmanWorld, HOTEL, LOOKS, MANSION } from './chairman';
import { EMPIRE, giftById, KIND_LABEL, PENTHOUSE_BED } from './properties';
import { ITEMS, lookFor, Outfit, owns, SHOP_NAMES, Slot, SLOT_NAMES } from './outfits';
import { Resident } from './npc';
import { Player } from './player';
import { rng } from './placeholders';
import { Pursuit } from './pursuit';
import { Radio } from './radio';
import { MEDAL_REWARDS, RANGE, RangeChallenge } from './range';
import { cleanName, SaveStore } from './save';
import { FACILITY, Sites } from './sites';
import { LEVEL_KEYS, LEVEL_NAMES, Tower, TOWER } from './tower';
import { Traffic } from './traffic';
import { DriveInput, Obstacle, PAINTS, Vehicle, setNightLights } from './vehicles';
import { StreetVoices, VoiceKind, voiceText } from './voices';
import { autoQuality, installCelShading, loadQualityChoice, makeSky, skyUniforms, PALETTE, PostFX, Quality, QUALITY_INFO, QualityChoice, skyEnvironment, storeQualityChoice, storeStyle, STYLE, SUN_DIR } from './visual';
import { lineOfSight, MEDALS, Ray, rayCylinder, rayWorld, WEAPON_IDS, WeaponId, WEAPONS, WeaponState, weaponMesh } from './weapons';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BASE = import.meta.env.BASE_URL;
const fmtCash = (n: number) => '₦' + Math.round(n).toLocaleString('en-US');
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const REPAIR_PER_PCT = 20;
const ARMOUR_PRICE = 1500;

type Mode = 'loading' | 'title' | 'play' | 'pause' | 'settings' | 'result' | 'offer' | 'shop' | 'map' | 'wardrobe' | 'armoury' | 'missions' | 'lift' | 'cutscene' | 'phone';
const SCREENS = ['title', 'pause', 'settings', 'result', 'offer', 'shop', 'map', 'wardrobe', 'armoury', 'missions', 'lift'] as const;
type Screen = (typeof SCREENS)[number];

// ---------- Renderer, scene, lighting ----------
// Art style (src/visual.ts): "Clean" daylight (default) or "Lagos dusk" (cel lighting, golden-hour sky, ink outlines, neon glow).
installCelShading();
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = STYLE === 'clean' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; // soft edges in daylight, crisp for cel
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = STYLE === 'clean' ? 0.92 : 0.95;

const scene = new THREE.Scene();
const HAZE = new THREE.Color(PALETTE.haze);
const FOG_NEAR = STYLE === 'clean' ? 150 : 90, FOG_FAR = STYLE === 'clean' ? 720 : 480;
scene.fog = new THREE.Fog(HAZE, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

const skyU = skyUniforms();
const sky = makeSky(skyU);
scene.add(sky);
const hemi = new THREE.HemisphereLight(PALETTE.skyFill, PALETTE.groundFill, 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(PALETTE.sunLight, STYLE === 'clean' ? 2.6 : 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.08; // low dusk sun: extra bias against shadow acne
scene.add(sun, sun.target);
/** Headlights of the car you're driving: a real light on the road and walls ahead after dark (off by day). */
const headSpot = new THREE.SpotLight('#ffe8bc', 0, 60, 0.62, 0.55, 1);
headSpot.target.position.set(0, 0, 0);
scene.add(headSpot, headSpot.target);
/** Lagos time of day and weather (src/environment.ts). */
const env = new Environment(scene, { sky: skyU, sun, sunDir: SUN_DIR, hemi, fog: scene.fog as THREE.Fog, renderer, fogNear: FOG_NEAR, fogFar: FOG_FAR });
let envSeen = -1;
{
  const q = new URLSearchParams(location.search);
  env.liveAllowed = !q.has('debug') || q.has('liveweather');
}

// Graphics quality (device setting, not part of the save): Auto, High, Medium or Low.
const post = new PostFX(renderer, scene, camera);
let skyEnv: THREE.Texture | null = null;
let qualityChoice: QualityChoice = loadQualityChoice();
let quality: Quality = 'high';
function applyQuality(choice: QualityChoice, resizeNow = true): void {
  qualityChoice = choice;
  quality = choice === 'auto' ? autoQuality(renderer) : choice;
  const q = QUALITY_INFO[quality];
  post.configure(quality);
  if (q.env && !skyEnv) skyEnv = skyEnvironment(renderer, skyU);
  scene.environment = q.env ? skyEnv : null;
  scene.environmentIntensity = 0.35;
  hemi.intensity = STYLE === 'clean' ? (q.env ? 1.55 : 1.9) : q.env ? 1.7 : 2.1;
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  pixelRatio = Math.min(window.devicePixelRatio || 1, q.maxRatio);
  renderer.setPixelRatio(pixelRatio);
  if (resizeNow) resize();
}
applyQuality(qualityChoice, false);

// ---------- World ----------
const world = new CollisionWorld();
const info = buildDistrict(scene, world, [...KEEP_OUT, ...CHAIRMAN_KEEP_OUT]);
/** Harbour Heights (enterable tower) and the Night Exit sites (holding centre, safehouse). */
const tower = new Tower(scene, world);
const sites = new Sites(scene, world);
const pursuit = new Pursuit(scene, rng(55));
const save = new SaveStore();
const audio = new Audio();
env.onThunder(() => audio.sfx('crash', 0.35)); // thunder after lightning
const input = new Input(canvas);
/** Phones and tablets: on-screen stick and buttons (touch.ts), landscape layout, fullscreen on Play. */
const touch = wantsTouch() ? new TouchControls(input, $('app')) : null;
input.onGesture = () => audio.start();
const dialogue = new Dialogue();
const voices = new StreetVoices();

const player = new Player(info.playerStart.x, info.playerStart.z, info.playerStart.heading);
scene.add(player.rig.root);
// A placeholder parcel the player carries during the delivery job.
const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: '#c79a5b', roughness: 0.9 }));
parcel.position.set(0.38, 1.05, 0);
parcel.visible = false;
player.rig.root.add(parcel);

/** Vehicles you can drive: your own hatchback and the bus park danfo. */
/** Street lights after dark: halos, light pools on the ground and real lights on the nearest lamps. */
const streetLights = new StreetLights(scene, info.lamps);
const hatch = new Vehicle('hatchback', info.carSpawn.x, info.carSpawn.z, info.carSpawn.heading);
const danfo = new Vehicle('danfo', info.danfoSpawn.x, info.danfoSpawn.z, info.danfoSpawn.heading);
/** Visual style pass: the design-board sedan, parked on the square next to your hatchback. Drivable. */
const saloon = new Vehicle('saloon', -27, -14, Math.PI / 2);
/** The other design-board vehicles, parked on the south side of the square. Any car can be taken. */
const parked = [new Vehicle('minibus', -12, 28, 0), new Vehicle('coupe', -2, 28, 0), new Vehicle('crossover', 8, 28, 0)];
parked.forEach((v) => scene.add(v.group));
/** Every vehicle you can drive: your own, the parked ones, and any you've hijacked (grows and shrinks). */
/** The Royale GT (Bayo's model, models.ts): parked at the end of the row, locked until you win the Coastal Run. */
const royale = new Vehicle('royale', 18, 28, 0);
const royaleOpen = (): boolean => save.data.licences.includes('royale');
const fleet: Vehicle[] = [hatch, danfo, saloon, ...parked, royale];
/** Cars taken from traffic. They vanish for good after burning out; the oldest are tidied away. */
const stolen: Vehicle[] = [];
/** Where the town's own vehicles come back after burning out (your hatchback is rebuilt at Chidi's). */
const HOMES = new Map<Vehicle, { x: number; z: number; heading: number }>();
/** What to call a vehicle in prompts and on the HUD. */
HOMES.set(hatch, WORKSHOP.tow.hatchback);
HOMES.set(danfo, info.danfoSpawn);
HOMES.set(saloon, { x: -27, z: -14, heading: Math.PI / 2 });
for (const v of [...parked, royale]) HOMES.set(v, { x: v.x, z: v.z, heading: v.heading });
const vehicleLabel = (v: Vehicle): string => (v === hatch ? 'car' : v === danfo ? 'danfo' : v === saloon ? 'sedan' : v.spec.name.toLowerCase());
fleet.forEach((v) => scene.add(v.group));
let bridgeOpen = save.data.chaptersDone.includes(1);
if (bridgeOpen) info.openBridge();
const traffic = new Traffic(scene, 10, rng(9), roadGraph(bridgeOpen));
let trafficBase = 10;
/** Dapo's car (Marina Showdown rival). Parked at Marina Gardens unless he's racing. PLACEHOLDER body. */
const rivalCar = new Vehicle('sedan', info.rivalParking.x, info.rivalParking.z, info.rivalParking.heading, '#5b2a86');
scene.add(rivalCar.group);
/** Residents who run clothes shops (talk to them to open the wardrobe). */
const SHOPKEEPERS: Record<string, 'ngozi' | 'funmi'> = { Ngozi: 'ngozi', Funmi: 'funmi' };

const rand = rng(77);
const residents = info.residents.map((d) => new Resident(d, rand));
/** Crews phase: crews walking their turf, the crew house, Afterglow and EKO Arms (crews.ts, places.ts). */
/** One group per turf, run by whichever crew holds it (turf wars change hands; save.turfs). */
const turfOf = new Map<CrewGroup, CrewId>();
function crewForTurf(turf: CrewDef, i: number): CrewGroup {
  const owner = crewById(save.data.turfs[turf.id]) ?? turf;
  const g = new CrewGroup(scene, owner, i * 0.37, { turf: turf.turf, leaderName: owner.id === turf.id ? owner.leader : owner.lieutenant });
  turfOf.set(g, turf.id);
  return g;
}
const crews = CREWS.map((c, i) => crewForTurf(c, i));
const house = new CrewHouse(scene, world);
const club = new Club(scene, world);
const armsShop = new ArmsShop(scene, world);
/** The crew house as Bayo's Modern Lagos House once its model loads (lagoshouse.ts); the code-built house until then. */
const lagosHouse = new LagosHouse(scene);
/** The crew house or the club, if you're inside one. */
const room = (): CrewHouse | Club | null => (house.inside ? house : club.inside ? club : null);
/** Your crew's colours: the house and your bandana. */
function applyCrew(): void {
  const crew = crewById(save.data.crew);
  house.setCrew(crew);
  lagosHouse.setCrew(crew);
  player.rig.setBandana(crew ? crew.colour : null);
}
applyCrew();
residents.forEach((r) => scene.add(r.rig.root));
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), world);
minimap.setBridgeOpen(bridgeOpen);
player.rig.dress(lookFor(save.data.outfit));

// ---------- Phase 6: aircraft, boat and radio ----------
const craftEnv: CraftEnv = { world, isWater };
const plane = new Craft('plane', { x: AIRFIELD.plane.x, y: 0, z: AIRFIELD.plane.z, heading: AIRFIELD.plane.heading });
const heli = new Craft('heli', { x: AIRFIELD.pad.x, y: 0, z: AIRFIELD.pad.z, heading: Math.PI });
const boat = new Craft('boat', { x: JETTY.boat.x, y: WATER_Y, z: JETTY.boat.z, heading: JETTY.boat.heading });
const crafts = [plane, heli, boat];
crafts.forEach((c) => scene.add(c.group));
/** The aircraft or boat you are in, if any (cars use `current`). */
let flying: Craft | null = null;
const craftRespawn = new Map<Craft, number>();
const CRAFT_NAMES = { plane: 'light plane', heli: 'helicopter', boat: 'speedboat' } as const;
const radio = new Radio(audio);
/** Afterglow's own music (clubmusic.ts). */
const clubMusic = new ClubMusic(audio);

// ---------- Phase 4: weapons, combat, range ----------
const weapons = new WeaponState(() => save.data.weapons);
const rangeRun = new RangeChallenge(scene, rng(4242));
/** Inside the Harbour Bend Range block, where firing is legal. */
const inRangeBlock = (x: number, z: number) => x > -114 && x < -46 && z > -34 && z < 34;
const canSpawnAt = (x: number, z: number) =>
  (area?.contains(x, z, -4) ?? false) || (x > -HALF + 4 && x < SHORE - 4 && z > -HALF + 4 && z < HALF - 4) || (bridgeOpen && x > MARINA.minX + 2 && x < MARINA.maxX - 2 && z > MARINA.minZ + 2 && z < MARINA.maxZ - 2);
const combat = new Combat(scene, world, rng(31), {
  onOfficerShot(o, hit, tx, tz) {
    const me = current ?? player;
    audio.sfx('shot2', Math.max(0.15, 1 - Math.hypot(o.x - me.x, o.z - me.z) / 70));
    const miss = hit ? 0 : 1.2 + rand() * 1.5;
    const a = rand() * Math.PI * 2;
    tracer(o.x + Math.cos(o.heading) * 0.5, 1.45, o.z + Math.sin(o.heading) * 0.5, tx + Math.cos(a) * miss, 1.2, tz + Math.sin(a) * miss, '#ffd27a');
    if (!hit) return;
    hurtFlash = 0.35;
    audio.sfx('hurt');
    if (current) {
      current.damage(5);
      if (combat.hurtPlayer(3)) goDown();
    } else if (combat.hurtPlayer(7 + combat.heat)) goDown();
  },
  onHeatChange(level, prev) {
    if (recovering) return;
    if (level > prev) {
      audio.sfx('siren');
      notice(`Heat ${level}: the ${UNIT_NAME} is after you`, 2.5);
    } else if (level === 0 && prev > 0) {
      save.data.stats.escapes++;
      notice('You lost the patrol. Heat gone.', 3);
    } else notice(`Heat down to ${level}. Stay out of sight.`, 2);
  },
}, canSpawnAt);
let recovering = false;
let hurtFlash = 0;
/** Seconds the aim pose lingers after a shot. */
let aimHold = 0;
/** Look-dev camera set by the ?debug lookAt hook: [eye xyz, target xyz]. */
let debugCam: number[] | null = null;
// HUD (src/hud.ts): sprint stamina, weapon wheel, route line, "new job nearby" ping. The clock is Lagos time (environment.ts).
const stamina = new Stamina();
stamina.fitness = save.data.fitness;
let wheelOpen = false;
/** Seconds the horn keeps sounding (held while H is down). */
let hornHeld = 0;
let wheelPick: WeaponId | null = null;
const wheelVec = { x: 0, y: 0 };
let pingTimer = 0;
let lastGiver: string | null = null;
let routeCache: { key: string; pts: [number, number][]; t: number } = { key: '', pts: [], t: 0 };
let shownWeapon: WeaponId | null = null;
/** Test hook: aim at this point instead of the screen centre. */
let debugAim: { x: number; y: number; z: number } | null = null;
let lastVoice: { name: string; kind: VoiceKind; lang: string; text: string } | null = null;
let lastShot: { kind: string; name?: string } | null = null;
let crossHit = 0;

/** Short-lived effects: tracers, muzzle flashes and impact puffs (PLACEHOLDER visuals). */
const fx: { obj: THREE.Object3D; life: number; max: number }[] = [];
function tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color = '#fff2b0'): void {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  fx.push({ obj: line, life: 0.08, max: 0.08 });
}
function puff(x: number, y: number, z: number, color = '#cfc6b0', size = 0.25): void {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  m.position.set(x, y, z);
  scene.add(m);
  fx.push({ obj: m, life: 0.35, max: 0.35 });
}
function updateFx(dt: number): void {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    const mtl = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
    mtl.opacity = Math.max(0, f.life / f.max);
    if (f.obj instanceof THREE.Mesh) f.obj.scale.setScalar(1 + (1 - f.life / f.max) * 1.5);
    if (f.life <= 0) {
      f.obj.removeFromParent();
      (f.obj as THREE.Mesh).geometry.dispose();
      mtl.dispose();
      fx.splice(i, 1);
    }
  }
}

let mode: Mode = 'loading';
let current: Vehicle | null = null;
let runner: MissionRunner | null = null;
let started = false;
let shopArmed = true;
let mapReturn: Mode = 'play';
const cam = { yaw: info.playerStart.heading, pitch: 0.28, dist: 4.8, lookHold: 0, lookOffset: 0 };

// ---------- UI helpers ----------
const labels = $('labels');
const projV = new THREE.Vector3();
function placeLabel(el: HTMLElement, x: number, y: number, z: number): boolean {
  projV.set(x, y, z).project(camera);
  const visible = projV.z < 1 && Math.abs(projV.x) < 1.1 && Math.abs(projV.y) < 1.1;
  el.style.display = visible ? '' : 'none';
  if (visible) el.style.transform = `translate(${(projV.x * 0.5 + 0.5) * innerWidth}px, ${(-projV.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
  return visible;
}
function worldLabel(cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `wl ${cls}`;
  el.style.display = 'none';
  labels.append(el);
  return el;
}
const bubbles = new Map<Resident, HTMLElement>();
const objLabel = worldLabel('obj');
const jobLabels = new Map<Resident, HTMLElement>();

let noticeTimer = 0;
function notice(text: string, seconds = 2): void {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
  noticeTimer = seconds;
}
let subtitleTimer = 0;
let introTimer = 0;
function toast(head: string, text: string, seconds = 7): void {
  $('i-giver').textContent = head;
  $('i-text').textContent = text;
  $('intro').hidden = false;
  introTimer = seconds;
}

function showScreen(id: Screen | null): void {
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id) {
    // Transient messages would show through the menu overlays; clear them.
    for (const el of ['intro', 'subtitle', 'notice']) $(el).hidden = true;
    introTimer = subtitleTimer = noticeTimer = 0;
  }
  $('hud').hidden = id === 'title' || mode === 'loading';
}

function persist(): boolean {
  save.data.carHealth = Math.round(hatch.healthPct * 100);
  save.data.armour = Math.round(combat.armour);
  return save.save();
}

function refreshCash(): void {
  $('cash').textContent = fmtCash(save.data.cash);
  const total = runner?.missions.length ?? 0;
  const done = runner ? runner.missions.filter((m) => runner!.status(m) === 'done').length : 0;
  $('unlocks').textContent = total ? `Jobs ${done}/${total}${bridgeOpen ? ' · bridge open' : ''}` : '';
}

function applyPaint(): void {
  hatch.setPaint(save.data.paints.active);
}

function setMode(next: Mode): void {
  mode = next;
  if (next === 'play') {
    showScreen(null);
    canvas.focus();
  } else {
    input.releaseLock();
  }
  if (next === 'title') {
    showScreen('title');
    $('btn-play').textContent = started ? 'Continue' : 'Play';
  }
  if (next === 'pause') {
    renderPause();
    showScreen('pause');
  }
  if (next === 'settings') {
    const s = save.data.settings;
    $<HTMLInputElement>('set-volume').value = String(s.masterVolume);
    $<HTMLInputElement>('set-sens').value = String(s.lookSensitivity);
    $<HTMLInputElement>('set-invert').checked = s.invertY;
    $<HTMLSelectElement>('set-quality').value = qualityChoice;
    qualityNote();
    $('reset-note').textContent = '';
    resetArmed = false;
    $('btn-reset').textContent = 'Reset progress';
    showScreen('settings');
  }
  if (next === 'offer' || next === 'shop' || next === 'map' || next === 'result' || next === 'wardrobe' || next === 'armoury' || next === 'missions' || next === 'lift') showScreen(next);
  if (next === 'cutscene') {
    // Introduction: no HUD or controls, letterbox bars and subtitles instead.
    showScreen(null);
    $('hud').hidden = true;
    for (const el of ['intro', 'subtitle', 'notice']) $(el).hidden = true;
    introTimer = subtitleTimer = noticeTimer = 0;
    $('cutscene').hidden = false;
    $('labels').hidden = true;
  } else {
    $('cutscene').hidden = true;
    $('labels').hidden = false;
  }
  if (next !== 'play') {
    input.consumeLook();
    player.faceYaw = null;
  }
}

function resume(): void {
  setMode('play');
  input.requestLock();
}

let settingsReturn: Mode = 'title';
let resetArmed = false;
$('btn-play').addEventListener('click', () => {
  audio.start();
  if (touch) goLandscape();
  if (!started) {
    started = true;
    $('banner').hidden = false;
    setTimeout(() => ($('banner').hidden = true), 6500);
  }
  if (!save.data.lookChosen) return openWardrobe('creator');
  if (firstToast) welcomeToast();
  resume();
});
$('btn-settings').addEventListener('click', () => { settingsReturn = 'title'; setMode('settings'); });
$('btn-settings2').addEventListener('click', () => { settingsReturn = 'pause'; setMode('settings'); });
$('btn-resume').addEventListener('click', resume);
$('btn-title').addEventListener('click', () => { persist(); setMode('title'); });
$('btn-map2').addEventListener('click', () => openMap('pause'));
$('btn-leavearea').addEventListener('click', () => {
  leaveArea();
  resume();
});
$('btn-gotoarea').addEventListener('click', async () => {
  const a = areaIndex[0];
  if (a && (await enterArea(`${BASE}areas/${a.manifest}`))) resume();
});
$('btn-area').addEventListener('click', async () => {
  const a = areaIndex[0];
  if (!a) return;
  audio.start();
  started = true;
  if (await enterArea(`${BASE}areas/${a.manifest}`)) {
    if (!save.data.lookChosen) openWardrobe('creator');
    else resume();
  }
});
$('btn-abandon').addEventListener('click', () => runner?.abandon());
$('btn-back').addEventListener('click', () => {
  const ok = persist();
  if (!ok) $('reset-note').textContent = 'This browser is blocking storage; settings apply for this session only.';
  setMode(settingsReturn);
});
$('btn-reset').addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Click again to confirm reset';
    $('reset-note').textContent = 'This clears cash, jobs, best times, paint jobs and car damage. Settings are kept.';
    return;
  }
  // Reset everything (including the reopened bridge and your look) by reloading into a fresh save.
  save.reset();
  $('reset-note').textContent = 'Progress reset. Reloading…';
  location.reload();
});
$<HTMLInputElement>('set-volume').addEventListener('input', (e) => {
  save.data.settings.masterVolume = Number((e.target as HTMLInputElement).value);
  audio.setVolume(save.data.settings.masterVolume);
});
$<HTMLInputElement>('set-sens').addEventListener('input', (e) => (save.data.settings.lookSensitivity = Number((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('set-invert').addEventListener('change', (e) => (save.data.settings.invertY = (e.target as HTMLInputElement).checked));
// Time of day and weather: live Lagos by default, or held as chosen (stored on this device).
for (const [id, labels, value] of [['set-time', ENV_LABELS.time, env.timeMode], ['set-weather', ENV_LABELS.weather, env.weatherMode]] as const) {
  const sel = $<HTMLSelectElement>(id);
  sel.innerHTML = '';
  for (const [v, label] of Object.entries(labels)) sel.append(new Option(label, v));
  sel.value = value;
}
$<HTMLSelectElement>('set-time').addEventListener('change', (e) => env.setTimeMode((e.target as HTMLSelectElement).value as TimeMode));
$<HTMLSelectElement>('set-weather').addEventListener('change', (e) => env.setWeatherMode((e.target as HTMLSelectElement).value as WeatherMode));
// Art style: rebuilds the world's materials, so it saves and reloads the page.
$<HTMLSelectElement>('set-style').value = STYLE;
$<HTMLSelectElement>('set-style').addEventListener('change', (e) => {
  storeStyle((e.target as HTMLSelectElement).value === 'dusk' ? 'dusk' : 'clean');
  persist();
  location.reload();
});
$<HTMLSelectElement>('set-quality').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value as QualityChoice;
  storeQualityChoice(v);
  applyQuality(v);
  qualityNote();
});
function qualityNote(): void {
  $('quality-note').textContent = `${qualityChoice === 'auto' ? `Auto picked ${quality}. ` : ''}${QUALITY_INFO[quality].label}.`;
}
canvas.addEventListener('click', () => { if (mode === 'play') input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
  // Esc releases pointer lock in the browser; treat that as "pause".
  // The game releases the mouse itself when a menu opens; that release arrives later and must not pause.
  if (!document.pointerLockElement && mode === 'play' && lockWasHeld && !input.selfRelease) setMode('pause');
  if (!document.pointerLockElement) input.selfRelease = false;
  lockWasHeld = !!document.pointerLockElement;
});
let lockWasHeld = false;

// ---------- Pause: jobs list ----------
function renderPause(): void {
  const done = runner ? runner.missions.filter((m) => runner!.status(m) === 'done').length : 0;
  const total = runner?.missions.length ?? 0;
  $('pause-stats').textContent = `${fmtCash(save.data.cash)} · ${done} of ${total} jobs done · your car ${Math.round(hatch.healthPct * 100)}%${save.data.licences.length ? ` · licences: ${save.data.licences.join(', ')}` : ''}${save.persistent ? '' : ' · storage blocked, progress is kept only for this session'}`;
  const list = $('pause-jobs');
  list.innerHTML = '';
  for (const def of runner?.missions ?? []) {
    const st = runner!.status(def);
    const active = runner!.state === 'active' && runner!.def === def;
    const li = document.createElement('li');
    li.className = active ? 'active' : st;
    const b = document.createElement('b');
    b.textContent = def.contact ? `${def.name} · ${def.contact}` : def.name;
    let text: string;
    if (active) text = `In progress: ${runner!.objectiveText()}`;
    else if (st === 'done') {
      const best = def.type === 'race' && save.data.bestTimes[def.id] !== undefined ? `best time ${fmtTime(save.data.bestTimes[def.id])}` : `best pay ${fmtCash(save.data.bestPay[def.id] ?? 0)}`;
      text = `Done · ${best} · replay pays ${fmtCash(def.reward.repeatCash)}${def.type === 'shift' ? ' plus fares' : ''}`;
    } else if (st === 'available') text = `${def.summary} ${def.crew ? 'Plan it at the crew house table.' : def.id === FIRST_STORY ? 'Answer your phone.' : `Comes by phone from ${def.contact ?? 'Tunde'} (C).`}`;
    else text = def.id !== FIRST_STORY && !summonsDone() && !def.crew ? "Locked: wait for the Chairman's call (The Chairman's Summons)." : `Locked: finish ${runner!.byId(def.requires ?? '')?.name ?? 'the previous job'} first.`;
    li.append(b, document.createTextNode(text));
    list.append(li);
  }
  for (const ch of runner?.chapters ?? []) {
    if (!save.data.chaptersDone.includes(ch.id)) continue;
    const li = document.createElement('li');
    li.className = 'done';
    li.textContent = `Chapter complete: ${ch.name}.`;
    list.append(li);
  }
  const s = save.data.stats;
  const li = document.createElement('li');
  li.textContent = `Races ${s.races} · deliveries ${s.deliveries} · shifts ${s.shifts} · fares ${fmtCash(s.fares)} · tows ${s.tows} · repairs ${s.repairs}`;
  list.append(li);
  const rg = save.data.range;
  const li2 = document.createElement('li');
  li2.className = rg.medal ? 'done' : 'available';
  const b2 = document.createElement('b');
  b2.textContent = 'Range Day · Coach Kola';
  li2.append(b2, document.createTextNode(`${rg.medal ? `${MEDALS[rg.medal]} medal, best ${rg.best} hits` : 'No medal yet. Talk to Coach Kola at the Harbour Bend Range.'} · shots fired ${s.shots} · hospital visits ${s.hospital} · patrols escaped ${s.escapes}`));
  list.append(li2);
  $('btn-abandon').hidden = runner?.state !== 'active';
  $('btn-leavearea').hidden = !area;
  const ga = $('btn-gotoarea');
  ga.hidden = !!area || !areaIndex.length;
  (ga as HTMLButtonElement).disabled = runner?.state === 'active';
  if (areaIndex.length) ga.textContent = runner?.state === 'active' ? `Go to ${areaIndex[0].name} (finish your job first)` : `Go to ${areaIndex[0].name} (real map preview)`;
}

// ---------- Jobs ----------
let lastResultDef: MissionDef | null = null;
let offerDef: MissionDef | null = null;
/** Set when the offer card is for something other than a job (Range Day). */
let offerAction: (() => void) | null = null;

/** Start points for missions without a resident giver: a glowing pad and a label (E there starts the intro). */
const startPads = new Map<MissionDef, { pad: THREE.Mesh; label: HTMLElement }>();
const PAD_MAT = new THREE.MeshBasicMaterial({ color: '#ff4fa3', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
/** Tall beam over the start of the mission you picked in the list. */
const trackBeam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
trackBeam.visible = false;
scene.add(trackBeam);

function setupMissions(defs: MissionDef[], chapters: ChapterDef[]): void {
  for (const def of defs) {
    if (!def.location || def.giver || def.crew || def.id === FIRST_STORY) continue; // crew jobs start at the house planning table; the Summons by phone
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 32, 1, true), PAD_MAT);
    pad.position.set(def.location.x, 1.1, def.location.z);
    scene.add(pad);
    const label = worldLabel('mstart');
    label.textContent = `★ ${def.name}`;
    startPads.set(def, { pad, label });
  }
  runner = new MissionRunner(scene, defs, chapters, save, {
    onStart(def) {
      if (def.id !== FIRST_STORY) toast(def.contact ? `${def.name} · for ${def.contact}` : def.name, def.summary, 6);
    },
    onCountdown(n) {
      const el = $('countdown');
      el.hidden = false;
      el.textContent = n > 0 ? String(n) : 'GO!';
      if (n > 0) audio.sfx('count');
      else {
        audio.sfx('go');
        setTimeout(() => (el.hidden = true), 700);
      }
    },
    onStepDone(def, step, index) {
      const next = def.steps[index + 1];
      if (step.marker === 'checkpoint') {
        audio.sfx('checkpoint');
        if (next) notice(runner!.objectiveText().replace('Checkpoint', 'Next: checkpoint'), 1.2);
      } else if (step.fare) {
        audio.sfx('cash');
        notice(`Fares +${fmtCash(step.fare)}`, 1.6);
      } else if (step.givesCargo) {
        audio.sfx('pickup');
        notice('Parcel collected. Handle with care!', 2.2);
      } else if (step.kind === 'goto') {
        audio.sfx('checkpoint');
      }
      if (next?.kind === 'countdown') $('countdown').hidden = true;
      // Night Exit: the world reacts to what you just did.
      if (step.effect === 'lightsOff') {
        sites.setPower(false);
        audio.sfx('crash');
        notice('Floodlights out. The side door is open: go!', 3);
      }
      if (step.effect === 'alarm') {
        sites.setAlarm(true);
        audio.sfx('fail');
      }
      if (step.companion === 'join') {
        spawnCompanion(step.x! + 0.8, step.z! + 0.8);
        say0('Sola', 'You came! Let\'s move before they wake up.');
      }
      if (def.id === FIRST_STORY) summonsStep(def, index);
      if (step.pursuit === 'start') {
        const me = current ?? player;
        pursuit.start(def.pursuit?.cars ?? 3, { x: me.x, z: me.z, heading: me.heading, speed: 0, inVehicle: !!current }, roadGraph(bridgeOpen));
        notice('The Harbour Patrol is on you. Lose them, then get to the safehouse!', 4);
        audio.sfx('horn2');
      }
    },
    onResult(def, r) {
      lastResultDef = def;
      cleanupMission();
      if (def.id === FIRST_STORY) summonsResult(r);
      else if (r.success) jobRing = 45;
      showResult(def, r);
    },
  });
}

/** What the result card is showing: a job, a Range Day score, or a hospital stay. */
let resultKind: 'job' | 'range' | 'hospital' = 'job';

function showResult(def: MissionDef, r: MissionResult): void {
  resultKind = 'job';
  $('btn-retry').hidden = false;
  audio.sfx(r.success ? 'win' : 'fail');
  $('countdown').hidden = true;
  $('r-mission').textContent = def.contact ? `${def.name} · for ${def.contact}` : def.name;
  const titles = { race: def.rival ? `YOU BEAT ${def.rival.name.toUpperCase()}` : 'RACE COMPLETE', delivery: 'DELIVERED', shift: 'SHIFT DONE', errand: 'ALL DROPS DONE', lesson: 'LICENCE EARNED', story: def.id === FIRST_STORY ? 'MISSION COMPLETE' : 'ESCAPE COMPLETE' };
  $('r-title').textContent = r.success ? titles[def.type] : 'JOB FAILED';
  const parts: string[] = [];
  if (r.success) {
    if (def.type === 'race') parts.push(`Time ${fmtTime(r.time)}${r.best !== undefined ? ` · best ${fmtTime(r.best)}` : ''}.`);
    if (r.cargo !== null) parts.push(`Parcel condition ${Math.round(r.cargo)}%.`);
    if (r.fares) parts.push(`${def.type === 'errand' ? 'Drop pay' : 'Fares'} ${fmtCash(r.fares)}.`);
    parts.push(`Paid ${fmtCash(r.cash)}${r.firstClear ? '' : ' (repeat rate)'}.`);
    if (r.paintName) parts.push(`Unlocked: ${r.paintName} paint, now on your car.`);
    if (r.licence === 'plane') parts.push("You now hold a pilot's licence: the light plane at Lagoon Point Airfield is yours to fly.");
    if (r.licence === 'heli') parts.push('You now hold a helicopter licence: fly the airfield helicopter any time.');
    if (r.licence === 'boat') parts.push('The speedboat at Marina Jetty is yours to use.');
    if (r.licence === 'royale') parts.push('The Royale GT on Harbour Bend Square is yours to drive.');
    for (const id of r.gifts) {
      const g = giftById(id);
      if (g) parts.push(`A gift from the Chairman: ${g.note}`);
    }
    if (r.firstClear && def.reward.contact) parts.push(`New contact: ${def.reward.contact}.`);
    if (r.firstClear && def.reward.phone) parts.push('Unlocked: the mission phone (C) for calls, messages, job offers and payments. New locations: Crown Ridge and Afterglow, the Chairman\'s club.');
    if (r.firstClear) parts.push(standing() + '.');
    const next = runner?.nextJob;
    if (r.firstClear && next && def.id !== FIRST_STORY) parts.push("The Chairman's people will call with more work.");
  } else {
    parts.push(`${r.reason}. No pay this time.`);
  }
  $('r-body').textContent = parts.join(' ');
  const fin = $('r-finale');
  fin.hidden = !r.chapter;
  if (r.chapter) {
    fin.textContent = `${r.chapter.name.toUpperCase()} COMPLETE. ${r.chapter.text}`;
    if (r.chapter.id === 1) openBridgeNow();
  }
  $('btn-retry').textContent = r.success ? 'Do it again' : 'Try again';
  $('btn-retry').hidden = r.success && def.replay === false;
  parcel.visible = false;
  refreshCash();
  applyPaint();
  setMode('result');
  $('hud').hidden = false;
}

$('btn-continue').addEventListener('click', () => {
  if (resultKind === 'job') {
    runner?.dismiss();
    releaseMissionCar();
  }
  resume();
});
$('btn-retry').addEventListener('click', () => {
  if (resultKind === 'range') {
    startRange();
    resume();
    return;
  }
  if (resultKind !== 'job') return resume();
  if (!runner || !lastResultDef) return;
  const def = lastResultDef;
  runner.dismiss();
  if (def.id === FIRST_STORY) {
    releaseMissionCar();
    resume();
    startSummons(def, summonsReached >= 3 ? 3 : 0);
    return;
  }
  const rt = def.retry;
  const first = def.steps[0];
  if (def.cutscene && first?.kind === 'goto' && first.onFoot) {
    // Missions that begin on foot at their own start point (Night Exit) start there again, with a fresh car.
    if (current) leaveVehicle(true);
    player.x = def.cutscene.player.x;
    player.z = def.cutscene.player.z;
    player.heading = def.cutscene.player.heading;
    player.y = 0;
    player.sync();
    cam.yaw = player.heading;
    startMission(def);
    resume();
    return;
  }
  if (rt && current && !current.wrecked && (rt.vehicle !== 'danfo' || current.kind === 'danfo')) {
    current.place(rt.x, rt.z, rt.heading);
    cam.yaw = rt.heading;
  }
  // Still in the mission's car: carry on in it (the retry put it back at the start).
  startMission(def, !!current && current === missionCar);
  resume();
});

function openOffer(def: MissionDef): void {
  offerDef = def;
  offerAction = null;
  $('btn-accept').textContent = def.giver ? 'Take the job' : 'Start mission';
  $('btn-decline').textContent = def.giver ? 'Not now' : 'Cancel';
  const done = runner!.status(def) === 'done';
  $('o-giver').textContent = def.giver ? `${def.giver} has a job` : `Mission briefing · ${locationOf(def).name}`;
  $('o-name').textContent = def.name.toUpperCase();
  $('o-intro').textContent = def.intro;
  const extras: string[] = [];
  if (def.type === 'delivery') extras.push('less if the parcel gets damaged');
  if (def.type === 'shift') extras.push('plus fares at every stop');
  if (def.reward.licence) extras.push(`earns your ${def.reward.licence === 'plane' ? "pilot's" : 'helicopter'} licence`);
  if (def.reward.unlock === 'boat') extras.push('and the speedboat is yours');
  if (def.reward.unlock === 'royale') extras.push('and the Royale GT is yours');
  if (def.type === 'errand') {
    const per = def.steps.find((k) => k.fare)?.fare ?? 0;
    extras.push(`plus ${fmtCash(per)} for every drop`);
  }
  const pay = `${fmtCash(done ? def.reward.repeatCash : def.reward.cash)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  const paint = !done && def.reward.paint ? ` Unlocks ${PAINTS[def.reward.paint]?.name ?? def.reward.paint} paint.` : '';
  const best = done && def.type === 'race' && save.data.bestTimes[def.id] !== undefined ? ` Your best: ${fmtTime(save.data.bestTimes[def.id])}.` : '';
  const rival = def.rival ? ` Beat ${def.rival.name} to the finish; if he crosses first, you lose.` : '';
  $('o-terms').textContent = `${done ? 'Done before. Replay pays' : 'Pays'} ${pay}.${paint}${rival} Time limit ${fmtTime(def.timeLimit)} once you set off.${best}`;
  showOffer();
}
/** What the second button does on a custom offer (crew talk); null for the usual "not now". */
let offerDecline: (() => void) | null = null;
function showOffer(decline: (() => void) | null = null): void {
  offerDecline = decline;
  setMode('offer');
}
$('btn-accept').addEventListener('click', () => {
  offerDecline = null;
  if (offerAction) {
    const act = offerAction;
    offerAction = null;
    resume();
    act();
    return;
  }
  if (!runner || !offerDef) return;
  const def = offerDef;
  offerDef = null;
  startMission(def);
  resume();
});
$('btn-decline').addEventListener('click', () => {
  const after = offerDecline;
  offerDecline = null;
  offerDef = null;
  offerAction = null;
  cancelIntro();
  resume();
  after?.();
});

// ---------- Mission list (J), introductions, mission cars, the crew member ----------
type HubStatus = 'available' | 'active' | 'completed' | 'locked';
/** Mission picked in the list: its start is marked on the map and the compass points to it. */
let tracked: MissionDef | null = null;
let hubSel: MissionDef | null = null;
/** Where you were before an introduction moved you (Cancel puts you back). */
let introReturn: { x: number; z: number; heading: number } | null = null;
let cut: Cutscene | null = null;
let cutDef: MissionDef | null = null;
/** Last introduction played (for tests): which mission, whether it was skipped, how far it got. */
let lastIntro: { id: string; skipped: boolean; t: number; length: number } | null = null;
/** The car a mission parked for you (getaway car, race car). */
let missionCar: Vehicle | null = null;
/** Sola, the crew member you free in Night Exit: follows you on foot, rides beside you. */
let companion: { rig: HumanRig; x: number; z: number; heading: number; speed: number; boarding: boolean } | null = null;

function hubStatus(def: MissionDef): HubStatus {
  if (runner?.state === 'active' && runner.def === def) return 'active';
  const st = runner!.status(def);
  return st === 'done' ? 'completed' : st;
}
const HUB_LABEL: Record<HubStatus, string> = { available: 'Available', active: 'Active', completed: 'Completed', locked: 'Locked' };

/** Where a mission starts: its own location, else the resident who offers it, else its first marker. */
function locationOf(def: MissionDef): { name: string; x: number; z: number } {
  if (def.location) return def.location;
  const r = residents.find((k) => k.name === def.giver);
  const near = r ? areaName(r.x, r.z, null) : '';
  if (r) return { name: `${def.giver}, ${near}`, x: r.x, z: r.z };
  const g = def.steps.find((k) => k.kind === 'goto');
  return { name: g ? areaName(g.x!, g.z!, null) : 'Harbour Bend', x: g?.x ?? 0, z: g?.z ?? 0 };
}

function rewardText(def: MissionDef): string {
  const extra = def.reward.paint ? ` + ${PAINTS[def.reward.paint]?.name ?? def.reward.paint} paint` : def.reward.licence ? ` + ${def.reward.licence === 'plane' ? "pilot's" : 'helicopter'} licence` : def.reward.unlock === 'boat' ? ' + the speedboat' : def.reward.unlock === 'royale' ? ' + the Royale GT' : '';
  return `${fmtCash(def.reward.cash)}${extra} (replays ${fmtCash(def.reward.repeatCash)})`;
}

/** The mission list shows every job, or (from the crew house planning table) only crew jobs. */
let hubFilter: 'all' | 'crew' = 'all';
const hubMissions = (): MissionDef[] => (runner ? runner.missions.filter((m) => hubFilter === 'all' || m.crew) : []);
function openHub(filter: 'all' | 'crew' = 'all'): void {
  if (!runner) return;
  hubFilter = filter;
  const list = hubMissions();
  if (filter === 'crew' || (hubSel && !list.includes(hubSel))) hubSel = null;
  hubSel = hubSel ?? (runner.state === 'active' && list.includes(runner.def!) ? runner.def : tracked && list.includes(tracked) ? tracked : null) ?? list.find((m) => hubStatus(m) === 'available') ?? list[0];
  setMode('missions');
  renderHub();
}

function renderHub(note = ''): void {
  if (!runner) return;
  const list = $('hub-list');
  list.innerHTML = '';
  for (const def of hubMissions()) {
    const st = hubStatus(def);
    const li = document.createElement('li');
    li.className = st;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.mission = def.id;
    btn.className = def === hubSel ? 'sel' : '';
    const b = document.createElement('b');
    b.textContent = def.name;
    const small = document.createElement('small');
    small.textContent = `${locationOf(def).name} · ${fmtCash(st === 'completed' ? def.reward.repeatCash : def.reward.cash)}`;
    const badge = document.createElement('span');
    badge.className = `st ${st}`;
    badge.textContent = HUB_LABEL[st];
    btn.append(b, badge, small);
    btn.addEventListener('click', () => selectMission(def));
    li.append(btn);
    list.append(li);
  }
  const d = $('hub-detail');
  d.innerHTML = '';
  const def = hubSel;
  if (!def) return;
  const st = hubStatus(def);
  const h = document.createElement('h2');
  h.textContent = def.name.toUpperCase();
  const badge = document.createElement('span');
  badge.className = `st ${st}`;
  badge.textContent = HUB_LABEL[st];
  const p = document.createElement('p');
  p.textContent = def.summary;
  const dl = document.createElement('dl');
  const row = (k: string, v: string) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  };
  const loc = locationOf(def);
  row('Location', `${loc.name} (${fmtDist(Math.hypot(loc.x - (current ?? player).x, loc.z - (current ?? player).z))} away)`);
  row('Reward', rewardText(def));
  if (def.contact) row('Contact', `${def.contact} (by phone)`);
  if (def.site) row('On site', def.site);
  row('Time limit', `${fmtTime(def.timeLimit)} once the clock starts`);
  if (def.cutscene) row('Intro', `Animated briefing, about ${Math.round(def.cutscene.shots.reduce((a, k) => a + k.t, 0))} s (skippable)`);
  if (st === 'completed' && def.type === 'race' && save.data.bestTimes[def.id] !== undefined) row('Best', fmtTime(save.data.bestTimes[def.id]));
  if (st === 'locked') row('Locked', def.id !== FIRST_STORY && !def.crew && !summonsDone() ? "Wait for the Chairman's call: finish The Chairman's Summons first" : def.requires ? `Finish ${runner.byId(def.requires)?.name ?? 'the previous job'} first` : def.requiresChapter ? `Finish chapter ${def.requiresChapter} first` : 'Not yet');
  if (st === 'active') row('Now', runner.objectiveText());
  const acts = document.createElement('div');
  acts.className = 'actions';
  const btn = (label: string, cls: string, fn: () => void, id: string, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.id = id;
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', fn);
    acts.append(b);
  };
  const busy = runner.state !== 'idle' || rangeRun.state !== 'idle';
  if (def.crew && (st === 'available' || st === 'completed')) btn(st === 'completed' ? 'Replay: intro and start' : def.cutscene ? 'Watch intro and start' : 'Briefing and start', 'go', () => beginIntro(def), 'btn-hubstart', busy);
  else if (def.id === FIRST_STORY && st === 'available') btn('Call Tunde back', 'go', () => { ringSummons(def); phone.answer(); setMode('phone'); }, 'btn-hubstart', busy || phone.busy);
  else if (st === 'available' || (st === 'completed' && def.replay !== false)) btn(st === 'completed' ? `Call ${def.contact ?? 'Tunde'} to do it again` : `Call ${def.contact ?? 'Tunde'} about it`, 'go', () => jobCall(def, true), 'btn-hubstart', busy || phone.busy);
  btn(tracked === def ? 'Marked on map ✓' : 'Mark on map', 'chip', () => { tracked = tracked === def ? null : def; renderHub(); }, 'btn-hubtrack', st === 'locked' || st === 'active');
  if (st === 'active') btn('Abandon this mission', 'chip danger', () => { runner?.abandon(); }, 'btn-hubabandon');
  const n = document.createElement('p');
  n.className = 'note';
  n.textContent = note || (busy && st !== 'active' ? 'Finish (or abandon) the mission you are on first.' : st === 'locked' ? '' : 'Selecting a mission marks its start on the minimap and map; walk there and press E, or start it from here.');
  d.append(h, badge, p, dl, acts, n);
}

function selectMission(def: MissionDef): void {
  hubSel = def;
  const st = hubStatus(def);
  if (st === 'available' || st === 'completed') tracked = def;
  renderHub();
}

/** Start a mission's introduction: the animated briefing if it has one, then the start card. */
function beginIntro(def: MissionDef): void {
  if (!runner || runner.state !== 'idle') return notice('Finish the mission you are on first', 2);
  if (rangeRun.state !== 'idle') return notice('Finish Range Day first', 1.5);
  if (runner.status(def) === 'locked') return notice('That mission is locked', 1.5);
  if (flying) return notice('Land and get out first', 2);
  if (current) {
    current.speed = 0;
    leaveVehicle(true);
  }
  if (tower.inside) tower.exit(player);
  weapons.draw(null);
  introReturn = def.cutscene ? { x: player.x, z: player.z, heading: player.heading } : null;
  tracked = def;
  if (def.cutscene) startCutscene(def);
  else openOffer(def);
}

function startCutscene(def: MissionDef, cs = def.cutscene!): void {
  cutDef = def;
  cut = new Cutscene(scene, cs, player);
  cut.begin();
  lastIntro = { id: def.id, skipped: false, t: 0, length: cut.length };
  $('cut-title').textContent = def.name.toUpperCase();
  $('btn-skip').innerHTML = '<kbd>Space</kbd> Skip intro';
  setMode('cutscene');
  updateCutsceneText();
}

function updateCutsceneText(): void {
  const l = cut?.line;
  $('cut-who').textContent = l ? (l.who === 'You' ? save.data.playerName : l.who) : '';
  $('cut-text').textContent = l ? fmtName(l.text) : '';
  $('cut-line').classList.toggle('none', !l);
}

/** End the introduction (finished or skipped): put the camera and controls back, then the start card. */
function endCutscene(skipped: boolean): void {
  if (!cut || !cutDef) return;
  if (lastIntro) {
    lastIntro.skipped = skipped;
    lastIntro.t = cut.t;
  }
  cut.end();
  cut = null;
  const def = cutDef;
  cutDef = null;
  $('cutscene').hidden = true;
  camera.fov = 62;
  camera.updateProjectionMatrix();
  cam.yaw = player.heading;
  cam.pitch = 0.28;
  cam.dist = 4.8;
  player.faceYaw = null;
  const story = storyScene;
  storyScene = null;
  if (story) {
    resume();
    story.onEnd();
    return;
  }
  if (acceptedJobs.has(def.id)) {
    // Taken on the phone already: straight into the job.
    acceptedJobs.delete(def.id);
    startMission(def);
    resume();
    return;
  }
  openOffer(def);
}

/** Cancel at the start card: back to where you were. */
function cancelIntro(): void {
  if (!introReturn) return;
  player.x = introReturn.x;
  player.z = introReturn.z;
  player.heading = introReturn.heading;
  player.y = 0;
  player.sync();
  cam.yaw = player.heading;
  introReturn = null;
}

/** Park the mission's car (once per run) and start the mission. keepCar: reuse the one you are in. */
function startMission(def: MissionDef, keepCar = false, from = 0): void {
  if (!runner) return;
  introReturn = null;
  if (!keepCar) releaseMissionCar();
  const mv = def.vehicle;
  if (mv && !(keepCar && missionCar)) {
    missionCar = new Vehicle(mv.kind, mv.x, mv.z, mv.heading, mv.colour);
    scene.add(missionCar.group);
    fleet.push(missionCar);
  }
  if (tracked === def) tracked = null;
  acceptedJobs.delete(def.id);
  runner.start(def, from);
}

/** The mission car leaves with the mission, unless you are still driving it (then it is yours for now). */
function releaseMissionCar(): void {
  const v = missionCar;
  missionCar = null;
  if (!v) return;
  if (current === v) {
    stolen.push(v);
    return;
  }
  if (fires.has(v)) return; // burning: it goes when the fire is out (and isn't rebuilt)
  const i = fleet.indexOf(v);
  if (i >= 0) fleet.splice(i, 1);
  rebuilds.delete(v);
  v.group.removeFromParent();
}

/** A passenger: Sola (Night Exit) or the Chairman's guest. boarding: walks to your car and gets in (the car waits). */
function spawnCompanion(x: number, z: number, look: HumanLook = { shirt: '#9aa0a6', pants: '#2b2b2b', top: 'tee', skin: '#5a3a26' }, name = 'companion-sola', boarding = false): void {
  removeCompanion();
  const rig = new HumanRig(look);
  rig.root.name = name;
  scene.add(rig.root);
  companion = { rig, x, z, heading: 0, speed: 0, boarding };
}

function removeCompanion(): void {
  companion?.rig.root.removeFromParent();
  companion = null;
}

/** Sola keeps up with you on foot and sits beside you in a car. */
function updateCompanion(dt: number): void {
  const c = companion;
  if (!c) return;
  if (c.boarding && current) {
    // Walk round to the passenger door, then get in.
    const [sx, , sz] = current.seat;
    const co = Math.cos(current.heading), si = Math.sin(current.heading);
    const side = -sz < 0 ? -1 : 1;
    const tx = current.x + sx * co + (sz + side * 1.3) * si, tz = current.z + sx * si - (sz + side * 1.3) * co;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d < 0.5 || d > 40) c.boarding = false;
    else {
      const sp = Math.min(2.2, d * 2);
      c.x += (dx / d) * sp * dt;
      c.z += (dz / d) * sp * dt;
      c.heading = Math.atan2(dz, dx);
      c.rig.seated = false;
      c.rig.root.position.set(c.x, 0, c.z);
      c.rig.root.rotation.y = -c.heading;
      c.rig.animate(dt, sp);
      return;
    }
  }
  if (current) {
    const [sx, sy, sz] = current.seat;
    const co = Math.cos(current.heading), si = Math.sin(current.heading);
    c.x = current.x + sx * co + sz * si;
    c.z = current.z + sx * si - sz * co;
    c.rig.seated = true;
    c.rig.root.position.set(c.x, sy + 0.1 - 0.92, c.z);
    c.rig.root.rotation.y = -current.heading;
    c.rig.animate(dt, 0);
    return;
  }
  c.rig.seated = false;
  const tx = player.x - Math.cos(player.heading) * 1.4, tz = player.z - Math.sin(player.heading) * 1.4;
  const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
  if (d > 25) {
    // Left far behind (you drove off without him): he catches up.
    c.x = tx;
    c.z = tz;
  } else if (d > 0.6) {
    const sp = Math.min(7, d * 2.2);
    c.x += (dx / d) * sp * dt;
    c.z += (dz / d) * sp * dt;
    c.heading = Math.atan2(dz, dx);
    c.speed = sp;
  } else c.speed = 0;
  world.resolveCircle(c, 0.3);
  c.rig.root.position.set(c.x, 0, c.z);
  c.rig.root.rotation.y = -c.heading;
  c.rig.animate(dt, c.speed);
}

/** Put the world back after a mission ends (lights, alarm, pursuit, crew member, mission car). */
function cleanupMission(): void {
  pursuit.stop();
  sites.reset();
  removeCompanion();
}

// ---------- The Chairman: the phone, Crown Ridge, the story and jobs by phone ----------
const chairman = new ChairmanWorld(scene, world);
const fmtName = (t: string) => t.replace(/\{name\}/g, save.data.playerName);
const fmtLines = (ls: Line[]): Line[] => ls.map((l) => ({ ...l, who: fmtName(l.who), text: fmtName(l.text) }));
const ROLES: Record<string, string> = { Tunde: "The Chairman's fixer: plans, jobs and pay", 'The Chairman': 'Chief Akinwale: he calls when he needs you', Musa: 'Head of security at Crown Ridge' };
/** Jobs you said yes to on the phone that start at a ★ start point (walk there, press E). */
const acceptedJobs = new Set<string>();
/** Seconds until the phone rings: the Summons (before it's done), then job offers. */
let storyRing = 4;
let jobRing = 25;
/** When you took the Summons (its 8 PM clock runs from 18:47) and whether you got to the gate late. */
let storyStart = 0;
let arrivedLate = false;
/** Furthest step of the Summons reached this session (a retry after the meeting starts at the car). */
let summonsReached = 0;
/** Texts waiting to arrive (seconds of play until each one). */
const textQueue: { from: string; text: string; t: number }[] = [];
/** The guest's lines on the drive. */
let guestTalk: { lines: Line[]; t: number } | null = null;
/** A story cutscene in progress (its end carries the mission on). */
let storyScene: { onEnd: () => void } | null = null;
let chairmanSuv: Vehicle | null = null;
/** The step whose text has been queued (each step's text is sent once). */
let sentFor = '';
const summonsDef = (): MissionDef | null => runner?.byId(FIRST_STORY) ?? null;
const summonsDone = () => save.data.completedMissions.includes(FIRST_STORY);
const summonsActive = () => runner?.state === 'active' && runner.def?.id === FIRST_STORY;
/** Story clock for the Summons: 18:47 when you take the call, a game minute every 1.2 s. */
const storyMinutes = () => 18 * 60 + 47 + (elapsed - storyStart) / 1.2;
const fmtClock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const MUSA_PATH = [{ x: -162, z: -134 }, { x: -167.5, z: -140 }, { x: -167.5, z: -154 }, { x: -163.4, z: -156.6 }];
const RETRY_CALL: Line[] = [{ who: 'Tunde', text: "{name}. Oga heard what happened. He doesn't give second chances, but tonight he's giving you one." }, { who: 'Tunde', text: "The car is in the forecourt at Crown Ridge. Get Mr Kalu to Afterglow. Don't make me call you again." }];

function standing(): string {
  const r = save.data.rep;
  const label = r >= 60 ? 'Right hand' : r >= 30 ? 'Inner circle' : r >= 10 ? 'Trusted runner' : 'New face';
  return `Standing with the Chairman: ${label} (${r})`;
}

function addMessage(from: string, text: string): void {
  save.data.messages.push({ from, text });
  save.data.messages = save.data.messages.slice(-40);
  persist();
  phone.notify(from, text);
}

/** A text arrives after this many seconds of play (not during cutscenes or calls). */
function queueText(from: string, text: string, delay = 0): void {
  textQueue.push({ from, text: fmtName(text), t: delay });
}

const phone = new Phone({
  name: () => save.data.playerName,
  standing,
  cash: () => fmtCash(save.data.cash),
  messages: () => save.data.messages,
  contacts: () => save.data.contacts.map((c) => ({ name: c, role: ROLES[c] ?? '' })),
  jobs: () => {
    if (!runner) return [];
    return runner.missions.filter((m) => !m.crew).map((m) => {
      const st = hubStatus(m);
      const status = st === 'completed' ? 'done' : st;
      const canCall = runner!.state === 'idle' && m.id !== FIRST_STORY && (st === 'available' || (st === 'completed' && m.replay !== false));
      const note = st === 'active' ? 'on it now' : st === 'locked' ? (m.id !== FIRST_STORY && !summonsDone() ? "after the Chairman's Summons" : m.requires ? `after ${runner!.byId(m.requires)?.name ?? 'the last job'}` : m.requiresChapter ? `after chapter ${m.requiresChapter}` : 'not yet') : st === 'completed' ? (m.replay === false ? 'done' : 'done · can repeat') : locationOf(m).name;
      return { id: m.id, name: m.name, contact: m.contact ?? 'Tunde', pay: fmtCash(st === 'completed' && m.replay !== false ? m.reward.repeatCash : m.reward.cash), status, note, canCall };
    });
  },
  properties: () => [
    ...save.data.gifts.map((id) => giftById(id)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => ({ name: g.name, kind: KIND_LABEL[g.kind], where: g.where, mine: true })),
    ...EMPIRE.map((p) => ({ name: p.name, kind: KIND_LABEL[p.kind], where: p.where, mine: false })),
  ],
  payments: () => save.data.payments.map((p) => ({ from: p.from, what: p.what, amount: fmtCash(p.amount) })),
  callAbout(jobId, contact) {
    if (!runner) return;
    const def = jobId ? runner.byId(jobId) : runner.missions.find((m) => !m.crew && m.id !== FIRST_STORY && runner!.status(m) === 'available' && (m.contact ?? 'Tunde') === contact) ?? null;
    phone.close();
    if (def) return jobCall(def, true);
    phone.ring({ caller: contact, lines: fmtLines([{ who: contact, text: contact === 'The Chairman' ? 'Not now, {name}. When I need you, I call you.' : 'Nothing right now. Oga will call when he needs you.' }]), onEnd: () => afterCall() });
    phone.answer();
    setMode('phone');
  },
  sfx: (n) => audio.sfx(n),
});

/** C: answer a ringing phone, or open (and put away) the phone once it is unlocked. */
function usePhone(): void {
  if (phone.state === 'ringing') {
    phone.answer();
    setMode('phone');
  } else if (save.data.phone) {
    phone.openApps();
    setMode('phone');
  } else notice('No apps on your phone yet. Wait for a call.', 2);
}

/** Next to your penthouse bed (Harbour Heights, top floor), once the Chairman has given it to you. */
function nearPenthouseBed(): boolean {
  return tower.inside && save.data.gifts.includes('heights-penthouse') && Math.abs(player.y - PENTHOUSE_BED.y) < 1.5 && Math.hypot(player.x - PENTHOUSE_BED.x, player.z - PENTHOUSE_BED.z) < 2.2;
}

function afterCall(): void {
  if (mode === 'phone') resume();
}

/** A job offered by phone: the contact explains the plan; take it or leave it. dial: you called them. */
function jobCall(def: MissionDef, dial: boolean): void {
  if (!runner) return;
  if (runner.state !== 'idle') return notice('Finish the job you are on first', 2);
  const who = def.contact ?? 'Tunde';
  const done = runner.status(def) === 'done';
  const lines = done ? [{ who, text: `${def.name} again? Same as before. ${def.summary}` }] : def.call?.length ? def.call : [{ who, text: def.intro }];
  phone.ring({
    caller: who,
    number: who === 'The Chairman' ? 'Chief Akinwale' : 'Mobile',
    lines: fmtLines(lines),
    choices: [{ id: 'accept', label: done ? 'Do it again' : 'Take the job' }, { id: 'decline', label: 'Not now' }],
    onEnd: (r) => {
      if (!save.data.contacts.includes(who)) {
        save.data.contacts.push(who);
        persist();
      }
      afterCall();
      if (r === 'accept') return acceptJob(def);
      jobRing = r === 'missed' ? 60 : 120;
      if (r === 'missed') notice(`Missed call: ${who}`, 2.5);
    },
  });
  if (dial) {
    phone.answer();
    setMode('phone');
  }
}

/** Yes on the phone: jobs with a ★ start point are marked for you; the rest start at once. */
function acceptJob(def: MissionDef): void {
  if (!runner || runner.state !== 'idle') return notice('Finish the job you are on first', 2);
  if (def.location) {
    acceptedJobs.add(def.id);
    tracked = def;
    toast(def.name, `Go to the ★ start: ${def.location.name}. Press E there.`, 7);
    return;
  }
  startMission(def);
}

/** The Summons: Tunde calls from an unknown number (or, after a failure, to give you another go). */
function ringSummons(def: MissionDef): void {
  const failed = save.data.story[def.id] === 'failed';
  save.data.story[def.id] = 'offered';
  persist();
  phone.ring({
    caller: failed ? 'Tunde' : 'Unknown number',
    number: failed ? 'Mobile' : 'No caller ID',
    lines: fmtLines(failed && summonsReached >= 3 ? RETRY_CALL : def.call ?? []),
    onEnd: (r) => {
      afterCall();
      if (r === 'declined' || r === 'missed') {
        storyRing = 40;
        return notice(`Missed call: ${failed ? 'Tunde' : 'Unknown number'}`, 3);
      }
      save.data.story[def.id] = 'accepted';
      persist();
      startSummons(def, failed && summonsReached >= 3 ? 3 : 0);
    },
  });
}

function startSummons(def: MissionDef, from: number): void {
  if (!runner || runner.state !== 'idle') return;
  storyStart = elapsed;
  arrivedLate = false;
  if (from >= 3) {
    // Straight back to the car in the forecourt.
    if (current) leaveVehicle(true);
    player.x = -158.5;
    player.z = -147.5;
    player.y = 0;
    player.heading = 0;
    player.sync();
    cam.yaw = 0;
  } else {
    say0(save.data.playerName, 'Wetin I enter now?');
    subtitleTimer = 3.5;
  }
  startMission(def, false, from);
  save.data.story[def.id] = 'in_progress';
  persist();
  toast(def.name.toUpperCase(), from >= 3 ? 'Pick up Mr Kalu at the Palmyra Grand Hotel' : 'Report to Crown Ridge before 8 PM', 7);
}

/** Play one of a mission's scenes (a missing scene is skipped with a warning, the mission carries on). */
function playScene(def: MissionDef, key: string, onEnd: () => void): void {
  const sc = def.scenes?.[key];
  if (!sc) {
    console.warn(`${def.name}: scene "${key}" is missing; carrying on without it.`);
    notice('(Scene unavailable: carrying on)', 2);
    onEnd();
    return;
  }
  if (current) leaveVehicle(true);
  weapons.draw(null);
  storyScene = { onEnd };
  startCutscene(def, sc);
  $('btn-skip').innerHTML = '<kbd>Space</kbd> Skip scene';
}

/** What the Summons does as each step is done. */
function summonsStep(def: MissionDef, index: number): void {
  summonsReached = Math.max(summonsReached, index + 1);
  if (index === 0) {
    arrivedLate = storyMinutes() > 20 * 60;
    if (arrivedLate) save.data.rep = Math.max(0, save.data.rep - 2);
    chairmanSuv ??= new Vehicle('crossover', 0, 0, 0, '#0c0d10');
    chairman.suvArrives(chairmanSuv.group);
    notice(arrivedLate ? `It's ${fmtClock(storyMinutes())}: you're late. Walk up to the gate.` : 'You made it. Walk up to the gate.', 3);
  } else if (index === 1) {
    chairman.musa.root.visible = false;
    playScene(def, arrivedLate ? 'gateLate' : 'gate', () => {
      chairman.musa.root.visible = true;
      player.x = -162.2;
      player.z = -128.6;
      player.heading = -Math.PI / 2;
      player.sync();
      cam.yaw = player.heading;
      chairman.walk(chairman.musa, MUSA_PATH, 1.5, { lead: () => ({ x: player.x, z: player.z }) });
      notice('Follow Musa to the house', 2.5);
    });
  } else if (index === 2) {
    chairman.officeLights(true);
    playScene(def, 'office', () => {
      chairman.officeLights(false);
      chairman.resetMusa();
      playScene(def, 'assignment', () => {
        player.x = -160;
        player.z = -150;
        player.heading = 0.63;
        player.sync();
        cam.yaw = player.heading;
        queueText('Tunde', "Guest: Mr Kalu. Pickup: the Palmyra Grand Hotel, south-west Harbour Bend. Drop: Afterglow, North Crescent. He doesn't like waiting.", 1);
      });
    });
  } else if (index === 4) {
    spawnCompanion(HOTEL.door.x, HOTEL.door.z - 5, LOOKS.guest, 'guest-kalu', true);
    guestTalk = { lines: [{ who: 'Mr Kalu', text: 'You work for Akinwale?' }, { who: '{name}', text: "I'm handling your ride tonight." }, { who: 'Mr Kalu', text: "Then let's hope you're better at driving than his last guy." }, { who: 'Mr Kalu', text: 'Lagos traffic. Every time I come, it is worse.' }], t: -1 };
  }
}

/** The Summons is over: the guest goes in, Tunde texts, the phone unlocks (on a first clear). */
function summonsResult(r: MissionResult): void {
  chairman.resetMusa();
  guestTalk = null;
  if (!r.success) {
    storyRing = 30;
    return;
  }
  const v = current;
  if (v) {
    const rig = new HumanRig(LOOKS.guest);
    rig.root.position.set(v.x + Math.sin(v.heading) * 1.4, 0, v.z - Math.cos(v.heading) * 1.4);
    rig.root.name = 'guest-walking';
    chairman.root.add(rig.root);
    chairman.walk(rig, [{ x: CLUB.door.x, z: CLUB.door.z + 1.2 }, { x: CLUB.door.x, z: CLUB.door.z - 0.5 }], 1.5, { done: () => rig.root.removeFromParent() });
  }
  if (r.firstClear) {
    queueText('Tunde', "Good work. Oga has been informed. Go home. You'll hear from us.", 1.5);
    queueText('Phone', 'Mission phone unlocked: press C for messages, contacts, jobs, properties and your bank.', 4);
    jobRing = 30;
  }
}

/** The phone in play: the Summons call, job calls, texts, the 8 PM clock and the gate. */
function updateStory(dt: number): void {
  const def = summonsDef();
  if (!runner || !def) return;
  const free = mode === 'play' && runner.state === 'idle' && !phone.busy && !area && !flying && !tower.inside && !room() && rangeRun.state === 'idle' && !clubRun;
  if (!summonsDone()) {
    if (free && (storyRing -= dt) <= 0) ringSummons(def);
  } else if (free && !tracked && !acceptedJobs.size && (jobRing -= dt) <= 0) {
    const next = runner.missions.find((m) => !m.crew && m.id !== FIRST_STORY && runner!.status(m) === 'available');
    if (next) jobCall(next, false);
    else jobRing = 120;
  }
  if (mode === 'play' && textQueue.length && (textQueue[0].t -= dt) <= 0) {
    const t = textQueue.shift()!;
    addMessage(t.from, t.text);
  }
  // The guest's lines once he is in the car.
  if (guestTalk && companion && !companion.boarding && current && mode === 'play') {
    if ((guestTalk.t -= dt) <= 0) {
      const l = guestTalk.lines.shift();
      if (l) say0(fmtName(l.who), fmtName(l.text));
      guestTalk.t = 3.4;
      if (!guestTalk.lines.length) guestTalk = null;
    }
  }
  // Steps that send a text when they start.
  const s = runner.state === 'active' ? runner.step : null;
  if (s?.message && runner.def && sentFor !== `${runner.def.id}:${runner.index}`) {
    sentFor = `${runner.def.id}:${runner.index}`;
    queueText(s.message.from, s.message.text, s.message.delay ?? 0);
  }
  if (runner.state !== 'active') sentFor = '';
  // The gate opens for you during the Summons (after Musa lets you in) and, once you're in, whenever you come up to it.
  const me = current ?? player;
  const atGate = Math.hypot(me.x - MANSION.gate.x, me.z - MANSION.gate.z) < 14;
  chairman.gateWanted = (summonsActive() && runner.index >= 2 && runner.index <= 4) || (summonsDone() && atGate && !summonsActive());
}

$('btn-hubclose').addEventListener('click', () => resume());
$('btn-missions').addEventListener('click', () => openHub());
$('btn-skip').addEventListener('click', () => endCutscene(true));

// ---------- Harbour Heights: entering, leaving, the lift ----------
function enterTower(): void {
  tower.enter(player);
  cam.yaw = player.heading;
  cam.dist = 3.2;
  audio.sfx('door');
  notice(`${TOWER.name} · ${LEVEL_NAMES[0]}. Stairs on the left, lift at the back right.`, 3.5);
}

function exitTower(): void {
  tower.exit(player);
  cam.yaw = player.heading;
  audio.sfx('door');
  notice('Back on Harbour Bend Square', 2);
}

function openLift(): void {
  const here = tower.levelOf(player.y);
  const box = $('lift-buttons');
  box.innerHTML = '';
  LEVEL_KEYS.forEach((k, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${i === here ? ' here' : ''}`;
    b.dataset.level = String(i);
    b.textContent = `${i + 1} · ${k} · ${LEVEL_NAMES[i]}${i === here ? ' (here)' : ''}`;
    b.addEventListener('click', () => rideLift(i));
    box.append(b);
  });
  setMode('lift');
}

function rideLift(level: number): void {
  const from = tower.levelOf(player.y);
  resume();
  if (level === from) return;
  tower.liftTo(player, level);
  cam.yaw = Math.PI; // facing the doors
  player.heading = Math.PI;
  player.sync();
  audio.sfx('door');
  notice(`Lift: ${LEVEL_KEYS[level]} · ${LEVEL_NAMES[level]}`, 2);
}
$('btn-liftclose').addEventListener('click', () => resume());

// ---------- Workshop ----------
function repairCost(v: Vehicle): number {
  return Math.ceil((1 - v.healthPct) * 100 - 1e-6) * REPAIR_PER_PCT;
}

function renderShop(note = ''): void {
  const v = current ?? hatch;
  const cost = repairCost(v);
  $('shop-vehicle').textContent = `${v === hatch ? 'Your hatchback' : 'The bus park danfo'} · condition ${Math.round(v.healthPct * 100)}% · you have ${fmtCash(save.data.cash)}`;
  const btn = $<HTMLButtonElement>('btn-repair');
  btn.textContent = cost === 0 ? 'No repairs needed' : `Repair for ${fmtCash(cost)}`;
  btn.disabled = cost === 0 || save.data.cash < cost;
  $('shop-note').textContent = note || (cost > 0 && save.data.cash < cost ? `You need ${fmtCash(cost - save.data.cash)} more. Jobs pay; come back later.` : '');
  const box = $('paints');
  box.innerHTML = '';
  if (v !== hatch) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Paint jobs are for your own car. The danfo keeps its bus park yellow.';
    box.append(p);
    return;
  }
  for (const [id, p] of Object.entries(PAINTS)) {
    const owned = save.data.paints.owned.includes(id);
    const active = save.data.paints.active === id;
    const row = document.createElement('div');
    row.className = 'paint';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = p.stripes ? `linear-gradient(${p.color} 0 35%, #111 35% 45%, ${p.color} 45% 55%, #111 55% 65%, ${p.color} 65%)` : p.color;
    const name = document.createElement('b');
    name.textContent = p.name;
    row.append(sw, name);
    if (active || owned) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = active ? 'In use' : 'Apply';
      b.disabled = active;
      b.dataset.paint = id;
      b.addEventListener('click', () => {
        save.data.paints.active = id;
        applyPaint();
        persist();
        audio.sfx('door');
        renderShop(`${p.name} applied.`);
      });
      row.append(b);
    } else if (p.price !== null) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `Buy ${fmtCash(p.price)}`;
      b.disabled = save.data.cash < p.price;
      b.dataset.paint = id;
      b.addEventListener('click', () => {
        if (save.data.cash < p.price!) return;
        save.data.cash -= p.price!;
        save.data.paints.owned.push(id);
        save.data.paints.active = id;
        applyPaint();
        persist();
        audio.sfx('cash');
        refreshCash();
        renderShop(`${p.name} bought and applied.`);
      });
      row.append(b);
    } else {
      const s = document.createElement('small');
      s.textContent = `Earn it: ${p.earnedBy ?? 'not available yet'}`;
      row.append(s);
    }
    box.append(row);
  }
}
$('btn-repair').addEventListener('click', () => {
  const v = current ?? hatch;
  const cost = repairCost(v);
  if (cost === 0 || save.data.cash < cost) return;
  save.data.cash -= cost;
  v.repair();
  save.data.stats.repairs++;
  persist();
  audio.sfx('repair');
  refreshCash();
  renderShop(`Fixed for ${fmtCash(cost)}. Good as new.`);
});
$('btn-leave').addEventListener('click', resume);

// ---------- Full map ----------
function openMap(from: Mode): void {
  mapReturn = from;
  $('map-title').textContent = area ? `${area.manifest.name} · north is up · map data © OpenStreetMap contributors` : 'Harbour Bend · north is up';
  setMode('map');
  const me = current ?? player;
  minimap.drawFull($<HTMLCanvasElement>('bigmap'), me.x, me.z, current ? current.heading : player.heading, mapMarkers(true));
}
$('btn-mapclose').addEventListener('click', () => closeMap());
function closeMap(): void {
  if (mapReturn === 'pause') setMode('pause');
  else resume();
}

// ---------- Wardrobe (Milestone 3) ----------
type WardrobeKind = 'creator' | 'ngozi' | 'funmi';
let wardrobeKind: WardrobeKind = 'creator';
let firstToast = true;
const wcam = { px: 0, pz: 0, tx: 0, tz: 0 };

function welcomeToast(): void {
  firstToast = false;
  if (!summonsDone()) toast('Harbour Bend', 'Keep your phone close: when it rings, answer with C.', 8);
  else if (runner?.nextJob) toast('The Chairman', 'Work comes by phone: wait for the call, or press C and call Tunde.', 8);
}

/** Put the camera in front of the player, on a side with clear space, for a live preview. */
function frameWardrobe(): void {
  let chosen = player.heading;
  for (let k = 0; k < 8; k++) {
    const a = player.heading + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
    const dx = Math.cos(a), dz = Math.sin(a);
    let clear = true;
    for (let t = 0.6; t <= 3.6 && clear; t += 0.3) if (world.blocksPoint(player.x + dx * t, 1.5, player.z + dz * t)) clear = false;
    // Nobody standing between the camera and the player (e.g. the shopkeeper).
    for (const r of residents) {
      const rx = r.x - player.x, rz = r.z - player.z, along = rx * dx + rz * dz;
      if (along > 0.3 && along < 3.8 && Math.abs(rx * dz - rz * dx) < 0.9) clear = false;
    }
    if (clear) {
      chosen = a;
      break;
    }
  }
  player.heading = chosen;
  player.sync();
  const dx = Math.cos(chosen), dz = Math.sin(chosen);
  // Screen-right for a camera looking back at the player is (dz, -dx); aim left of them so they stand right of the menu.
  wcam.px = player.x + dx * 3.4;
  wcam.pz = player.z + dz * 3.4;
  wcam.tx = player.x - dz * 0.95;
  wcam.tz = player.z + dx * 0.95;
}

function wardrobeCamera(dt: number): void {
  camera.position.set(wcam.px, 1.5, wcam.pz);
  camera.lookAt(wcam.tx, 1.15, wcam.tz);
  camera.fov += (50 - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
}

let outfitAtOpen = '';
function openWardrobe(kind: WardrobeKind): void {
  if (current) return;
  wardrobeKind = kind;
  outfitAtOpen = JSON.stringify(save.data.outfit);
  frameWardrobe();
  renderWardrobe();
  setMode('wardrobe');
}

function closeWardrobe(): void {
  const wasCreator = wardrobeKind === 'creator';
  if (wasCreator) save.data.playerName = cleanName($<HTMLInputElement>('w-name').value);
  save.data.lookChosen = true;
  // A change of clothes while no officer is watching shakes off the patrol.
  const changed = JSON.stringify(save.data.outfit) !== outfitAtOpen;
  const lostThem = changed && combat.heat > 0 && combat.hidden;
  if (lostThem) combat.setHeat(0);
  persist();
  cam.yaw = player.heading;
  resume();
  if (lostThem) notice('New look. The patrol has lost you.', 3);
  if (wasCreator && firstToast) welcomeToast();
}

function ownsItem(id: string): boolean {
  return owns(id, save.data.clothes, save.data.completedMissions, save.data.chaptersDone);
}

function equip(slot: Slot, id: string): void {
  if (!ownsItem(id)) return;
  (save.data.outfit as Outfit)[slot] = id;
  player.rig.dress(lookFor(save.data.outfit));
  persist();
}

function renderWardrobe(note = ''): void {
  const creator = wardrobeKind === 'creator';
  $('w-namefield').hidden = !creator;
  if (creator && document.activeElement !== $('w-name')) $<HTMLInputElement>('w-name').value = save.data.playerName;
  $('w-eyebrow').textContent = creator ? 'New game · free basics' : SHOP_NAMES[wardrobeKind as 'ngozi' | 'funmi'];
  $('w-title').textContent = creator ? 'CHOOSE YOUR LOOK' : 'WARDROBE';
  $('w-cash').textContent = creator
    ? 'Pick your basics. Tailors in the market and across the bridge sell more, and some pieces are earned on the job.'
    : `You have ${fmtCash(save.data.cash)}. Change into anything you own, or buy something new here.`;
  const box = $('w-slots');
  box.innerHTML = '';
  for (const slot of Object.keys(SLOT_NAMES) as Slot[]) {
    const group = document.createElement('div');
    group.className = 'wslot';
    const h = document.createElement('b');
    h.textContent = SLOT_NAMES[slot];
    const row = document.createElement('div');
    row.className = 'wrow';
    for (const it of ITEMS.filter((i) => i.slot === slot)) {
      const owned = ownsItem(it.id);
      if (creator && !owned) continue;
      const worn = save.data.outfit[slot] === it.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip witem' + (worn ? ' worn' : '');
      btn.dataset.item = it.id;
      btn.setAttribute('aria-pressed', String(worn));
      if (it.value) {
        const sw = document.createElement('span');
        sw.className = 'wsw' + (it.value === 'print' ? ' print' : '');
        if (it.value !== 'print') sw.style.background = it.value;
        btn.append(sw);
      }
      let label = it.name;
      if (owned) {
        btn.addEventListener('click', () => {
          equip(slot, it.id);
          renderWardrobe();
        });
      } else if (it.shop === wardrobeKind) {
        label += ` · ${fmtCash(it.price)}`;
        btn.disabled = save.data.cash < it.price;
        btn.addEventListener('click', () => {
          if (save.data.cash < it.price) return;
          save.data.cash -= it.price;
          save.data.clothes.push(it.id);
          audio.sfx('cash');
          equip(slot, it.id);
          refreshCash();
          renderWardrobe(`Bought ${it.name}.`);
        });
      } else {
        btn.disabled = true;
        label += it.shop === 'earned' ? ` · earn it: ${it.earn?.text ?? ''}` : ` · sold at ${it.shop === 'ngozi' ? "Ngozi's" : 'Marina Threads'}`;
      }
      btn.append(document.createTextNode(label));
      row.append(btn);
    }
    group.append(h, row);
    box.append(group);
  }
  $('w-note').textContent = note;
  $('btn-wdone').textContent = creator ? 'Start playing' : 'Done';
}
$('btn-wdone').addEventListener('click', closeWardrobe);

function openBridgeNow(): void {
  if (bridgeOpen) return;
  bridgeOpen = true;
  info.openBridge();
  traffic.setGraph(roadGraph(true));
  minimap.setBridgeOpen(true);
}

// ---------- Real Lagos map areas (Phase 5) ----------
/** The streamed map area you are in, if any, and its traffic (cars on ordinary roads, buses in BRT lanes). */
let area: AreaStreamer | null = null;
let areaTraffic: AreaTraffic | null = null;
let brtTraffic: AreaTraffic | null = null;
/** Areas listed in public/areas/index.json (made by tools/osm-import). */
let areaIndex: { id: string; name: string; manifest: string }[] = [];
let brtTime = 0;
let fineCd = 0;
let fines = 0;
let camShake = 0;
const potholeCd = new Map<string, number>();
const AREA_CAR_KINDS = ['sedan', 'sedan', 'hatchback', 'keke', 'danfo', 'sedan', 'keke', 'hatchback'] as const;
const AREA_COLOURS = ['#d8d8d2', '#2a2d33', '#8a1f1a', '#2e5e8c', '#9aa0a6', '#5a6b3a', '#c9b48a', '#1d1d1f'];
const BRT_FINE = 2000;

/** Every AI vehicle on the road, wherever you are. */
const roadTraffic = {
  vehicles: (): Vehicle[] => [...traffic.vehicles(), ...(areaTraffic?.vehicles() ?? []), ...(brtTraffic?.vehicles() ?? [])],
  obstacles: (): Obstacle[] => [...traffic.obstacles(), ...(areaTraffic?.obstacles() ?? []), ...(brtTraffic?.obstacles() ?? [])],
  owns: (v: unknown): boolean => traffic.owns(v) || !!areaTraffic?.owns(v) || !!brtTraffic?.owns(v),
  release(v: unknown): boolean {
    return traffic.release(v) || !!areaTraffic?.release(v) || !!brtTraffic?.release(v);
  },
  hit(v: unknown): void {
    traffic.hit(v);
    areaTraffic?.hit(v);
    brtTraffic?.hit(v);
  },
};

async function enterArea(url: string): Promise<boolean> {
  if (area || flying || runner?.state === 'active' || rangeRun.state !== 'idle') return false;
  let a: AreaStreamer;
  try {
    a = await AreaStreamer.load(url, scene, world, null);
  } catch (err) {
    console.warn(err);
    notice('That map area could not be loaded', 3);
    return false;
  }
  area = a;
  if (current) leaveVehicle(true);
  weapons.draw(null);
  recovering = true;
  combat.setHeat(0);
  recovering = false;
  combat.clearOfficers();
  const sp = a.spawn;
  player.x = sp.x;
  player.z = sp.z;
  player.y = 0;
  player.heading = sp.heading;
  player.sync();
  cam.yaw = sp.heading;
  // Your car comes with you, parked just ahead on the pavement.
  hatch.place(sp.x + Math.cos(sp.heading) * 6, sp.z + Math.sin(sp.heading) * 6, sp.heading);
  danfo.place(info.danfoSpawn.x, info.danfoSpawn.z, info.danfoSpawn.heading);
  traffic.target = 0;
  areaTraffic = new AreaTraffic(scene, 10, rng(5), a.graph, AREA_OFFSET.x, AREA_OFFSET.z, (e) => e.type !== 'brt', [...AREA_CAR_KINDS], AREA_COLOURS);
  brtTraffic = new AreaTraffic(scene, 3, rng(6), a.graph, AREA_OFFSET.x, AREA_OFFSET.z, (e) => e.type === 'brt', ['brt'], []);
  const [x0, z0, x1, z1] = a.manifest.bounds;
  minimap.setArea(x0 + AREA_OFFSET.x, z0 + AREA_OFFSET.z, x1 + AREA_OFFSET.x, z1 + AREA_OFFSET.z, a.graph.edges, AREA_OFFSET.x, AREA_OFFSET.z, a.manifest.name);
  a.onTile = (t) => minimap.paintTile(t.buildings, t.areas, AREA_OFFSET.x, AREA_OFFSET.z);
  await a.settle(sp.x, sp.z);
  areaTraffic.populate(sp);
  brtTraffic.populate(sp);
  const attrib = $('attrib');
  attrib.textContent = `${a.manifest.name} · Map data ${a.manifest.attribution} (ODbL)${a.manifest.fixture ? ' · synthetic test data, not a real place' : ''}`;
  attrib.hidden = false;
  const hasBrt = a.graph.edges.some((e) => e.type === 'brt');
  toast(a.manifest.name, `Real road layout from OpenStreetMap. Buildings and businesses are fictional placeholders.${hasBrt ? ' Stay out of the BRT lanes.' : ''}`, 8);
  return true;
}

function leaveArea(): void {
  if (!area) return;
  if (current) leaveVehicle(true);
  area.dispose();
  area = null;
  areaTraffic?.dispose();
  brtTraffic?.dispose();
  areaTraffic = brtTraffic = null;
  traffic.target = trafficBase;
  minimap.clearArea();
  $('attrib').hidden = true;
  const st = info.playerStart;
  player.x = st.x;
  player.z = st.z;
  player.heading = st.heading;
  player.sync();
  cam.yaw = st.heading;
  hatch.place(info.carSpawn.x, info.carSpawn.z, info.carSpawn.heading);
  hatch.speedCap = null;
  traffic.populate(st);
}

/** Road effects in a map area: crowded market roads, BRT lane fines and potholes. */
function areaRoadEffects(dt: number): void {
  fineCd = Math.max(0, fineCd - dt);
  for (const [k, t] of potholeCd) {
    if (t - dt <= 0) potholeCd.delete(k);
    else potholeCd.set(k, t - dt);
  }
  if (!area || !current) {
    brtTime = 0;
    return;
  }
  const v = current;
  const on = area.roadAt(v.x, v.z);
  v.speedCap = on?.road.type === 'market' ? 4.5 : null;
  // BRT corridor: lane wardens fine drivers they see in it.
  if (on?.road.type === 'brt' && Math.abs(v.speed) > 2) brtTime += dt;
  else brtTime = Math.max(0, brtTime - dt * 2);
  if (brtTime > 1 && fineCd === 0 && area.posts().some((p) => Math.hypot(p.x - v.x, p.z - v.z) < 45)) {
    const fee = Math.min(BRT_FINE, save.data.cash);
    save.data.cash -= fee;
    fines++;
    fineCd = 25;
    audio.sfx('siren');
    notice(`Lane warden: fined ${fmtCash(fee)} for driving in the BRT lane`, 3.5);
    persist();
    refreshCash();
  }
  // Potholes jolt the camera, damage the vehicle and can burst a tyre at speed.
  const speed = Math.abs(v.speed);
  if (speed < 5) return;
  for (const p of area.potholes()) {
    const key = `${p.x},${p.z}`;
    if (potholeCd.has(key)) continue;
    if (!v.circles().some((c) => Math.hypot(c.x - p.x, c.z - p.z) < p.r + 0.6)) continue;
    potholeCd.set(key, 2);
    camShake = 0.35;
    v.damage((speed - 5) * 1.2);
    audio.sfx('crash');
    if (speed > 13 && !v.tyreBurst && rand() < 0.35) {
      v.tyreBurst = true;
      notice('Burst tyre! It pulls to one side until you get it fixed.', 3);
    } else notice('Pothole!', 1);
  }
}

// ---------- Flying and boating (Phase 6) ----------
/** Why you can't use this craft yet, or null if you can (licence, an active lesson, or the boat unlocked). */
function craftBlocked(c: Craft): string | null {
  const job = runner?.state === 'active' ? runner.def : null;
  if (job?.steps.some((st) => st.vehicle === c.kind)) return null;
  if (save.data.licences.includes(c.kind)) return null;
  if (c.kind === 'boat') return "Ebi's speedboat. Win his Lagoon Run and it's yours to use.";
  return c.kind === 'plane'
    ? "You need a pilot's licence. Captain Ade runs Flight School at Lagoon Point Airfield."
    : 'You need a helicopter licence. Finish the helicopter lesson with Captain Ade.';
}

function enterCraft(c: Craft): void {
  if (current || flying || c.wrecked) return;
  const why = craftBlocked(c);
  if (why) return notice(why, 3.5);
  weapons.draw(null);
  aimHold = 0;
  flying = c;
  c.hasDriver = true;
  player.visible = false;
  cam.yaw = c.heading;
  audio.sfx('door');
  const help = { plane: 'W/S throttle · A/D bank · Arrow Up/Down nose up/down · lets go to level out', heli: 'Space climb · Shift descend · W/S lean forward/back · A/D turn', boat: 'W/S throttle · A/D steer · T radio' }[c.kind];
  toast(`The ${CRAFT_NAMES[c.kind]}`, help, 7);
}

/** A spot on dry land next to the craft where you can stand, or null. */
function landingSpot(c: Craft): { x: number; z: number } | null {
  const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
  for (const d of [3.5, 5, 6.5, 8]) {
    for (const [ox, oz] of [[fz, -fx], [-fz, fx], [-fx, -fz], [fx, fz]]) {
      const x = c.x + ox * d, z = c.z + oz * d;
      if (isWater(x, z) || surfaceAt(craftEnv, x, z) > 0.5 || world.overlapsCircle(x, z, player.radius + 0.1)) continue;
      return { x, z };
    }
  }
  return null;
}

function exitCraft(force = false, at?: { x: number; z: number }): boolean {
  const c = flying;
  if (!c) return false;
  if (!force) {
    if (c.kind !== 'boat' && !c.grounded) return notice('Land first', 1.5), false;
    if (c.kind === 'plane' && c.speed > 4) return notice('Slow down to get out', 1.5), false;
    if (c.kind !== 'boat' && surfaceAt(craftEnv, c.x, c.z) > 0.5) return notice("You can't get out on a rooftop", 2), false;
    if (c.kind === 'boat' && Math.abs(c.speed) > 3) return notice('Slow down to get out', 1.5), false;
  }
  const spot = at ?? landingSpot(c);
  if (!spot) return notice(c.kind === 'boat' ? 'Pull up beside the jetty or the shore to get out' : 'No room to get out here', 2), false;
  player.x = spot.x;
  player.z = spot.z;
  player.y = 0;
  player.heading = c.heading;
  player.visible = true;
  player.sync();
  c.hasDriver = false;
  flying = null;
  cam.yaw = c.heading;
  audio.sfx('door');
  return true;
}

function craftCrash(c: Craft): void {
  audio.sfx('crash');
  puff(c.x, c.y + 1, c.z, '#555049', 1.6);
  const mine = flying === c;
  craftRespawn.set(c, 4);
  if (!mine) return;
  const safe = c.kind === 'boat' ? { x: 210, z: -60 } : { x: 690, z: 45 };
  exitCraft(true, safe);
  if (runner?.state === 'active') runner.fail(c.kind === 'boat' ? 'The boat sank' : 'You crashed');
  notice(c.kind === 'boat' ? "The boat went down. Ebi's crew fished you out." : 'Crashed! The airfield crew pulled you out.', 4);
  if (combat.hurtPlayer(25)) goDown();
}

function craftInput(): CraftInput {
  const k = (...codes: string[]) => (input.down(...codes) ? 1 : 0);
  return {
    throttle: k('KeyW') - k('KeyS'),
    steer: k('KeyD') - k('KeyA'),
    pitch: k('ArrowUp') - k('ArrowDown'),
    lift: Math.max(k('Space'), k('ArrowUp')) - Math.max(k('ShiftLeft', 'ShiftRight'), k('ArrowDown')),
  };
}

/** Advance every aircraft and boat; returns nothing. Called from the play loop. */
function updateCrafts(dt: number): void {
  for (const c of crafts) {
    const t = craftRespawn.get(c);
    if (t !== undefined) {
      if (t - dt <= 0) {
        craftRespawn.delete(c);
        c.reset();
      } else craftRespawn.set(c, t - dt);
      continue;
    }
    const frozen = c === flying && runner?.freezeVehicle;
    const inp = c === flying && !frozen ? craftInput() : c === flying ? { throttle: 0, steer: 0, pitch: 0, lift: 0 } : null;
    if (frozen) c.speed = 0;
    if (c !== flying && c.grounded && !c.hasDriver && c.kind !== 'boat') continue; // parked: nothing to do
    const ev = c.update(dt, inp, craftEnv);
    if (ev === 'crash') craftCrash(c);
    else if (ev === 'hard' && c === flying) notice('Hard landing!', 1.5);
  }
  if (flying) {
    player.x = flying.x;
    player.z = flying.z;
    player.heading = flying.heading;
  }
}

// ---------- Weapons and shooting (Phase 4) ----------
type ShotHit =
  | { t: number; kind: 'crew'; g: CrewGroup; m: Fighter }
  | { t: number; kind: 'world' }
  | { t: number; kind: 'target'; index: number }
  | { t: number; kind: 'resident'; r: Resident }
  | { t: number; kind: 'officer'; o: Officer }
  | { t: number; kind: 'vehicle'; v: Vehicle };

/** Nearest thing along the ray within maxT: walls and ground, range targets, people and vehicles. */
function castShot(ray: Ray, maxT: number, minT = 0): ShotHit {
  let best: ShotHit = { t: rayWorld(ray, world, maxT), kind: 'world' };
  const consider = (t: number | null, h: ShotHit extends infer U ? (U extends unknown ? Omit<U, 't'> : never) : never) => {
    if (t !== null && t >= minT && t < best.t) best = { ...h, t } as ShotHit;
  };
  const tg = rangeRun.rayHit(ray, maxT);
  if (tg) consider(tg.t, { kind: 'target', index: tg.index });
  for (const r of residents) consider(rayCylinder(ray, r.x, r.z, 0.35, 0, 1.9), { kind: 'resident', r });
  for (const o of combat.officers) if (!o.down) consider(rayCylinder(ray, o.x, o.z, 0.35, 0, 1.9), { kind: 'officer', o });
  for (const g of crews) for (const m of g.members) if (!m.down) consider(rayCylinder(ray, m.x, m.z, 0.35, 0, 1.9), { kind: 'crew', g, m });
  for (const v of [...fleet, ...roadTraffic.vehicles(), rivalCar]) {
    const top = v.kind === 'danfo' || v.kind === 'minibus' ? 2.3 : v.kind === 'crossover' ? 1.8 : 1.6;
    for (const c of v.circles()) consider(rayCylinder(ray, c.x, c.z, c.r, 0, top), { kind: 'vehicle', v });
  }
  return best;
}

/** Residents nearby run from gunfire; officers or witnesses make it a crime outside the range. */
function gunfireHeard(): void {
  if (inRangeBlock(player.x, player.z)) return;
  let witnesses = combat.officers.some((o) => !o.down);
  for (const r of residents) {
    const dx = r.x - player.x, dz = r.z - player.z, d = Math.hypot(dx, dz);
    if (d > 40) continue;
    witnesses = true;
    if (d < 25) {
      r.flee(dx, dz, 2.5);
      if (rand() < 0.3) streetLine(r, 'complaint');
    }
  }
  if (witnesses) combat.crime('shots');
  // Crews nearby scatter from gunfire (the ones you're fighting keep fighting).
  for (const g of crews) if (g.members.some((m) => Math.hypot(m.x - player.x, m.z - player.z) < 30)) g.hear(player.x, player.z);
}

function applyHit(h: ShotHit, damage: number): void {
  lastShot = { kind: h.kind, name: h.kind === 'resident' ? h.r.name : undefined };
  switch (h.kind) {
    case 'crew': {
      crossHit = 0.15;
      if (h.g.def.id === save.data.crew) {
        notice(`${h.g.def.name}: "Watch it! We're on your side."`, 2);
        break;
      }
      audio.sfx('hit');
      combat.crime('assault');
      const wasFighting = h.g.hostile;
      const down = h.g.hit(h.m, damage);
      if (!wasFighting) startCrewFight(h.g);
      if (down) notice(`${h.g.def.name} member down`, 1.5);
      break;
    }
    case 'target':
      if (rangeRun.state === 'live') {
        rangeRun.hitTarget(h.index);
        audio.sfx('hit');
        crossHit = 0.15;
      }
      break;
    case 'resident':
      // Residents can't be hurt: they duck and run, and it counts as an assault.
      h.r.flee(h.r.x - player.x, h.r.z - player.z, 3);
      streetLine(h.r, 'complaint', true);
      combat.crime('assault');
      crossHit = 0.15;
      break;
    case 'officer':
      if (h.o.hurt(damage)) {
        crossHit = 0.15;
        audio.sfx('hit');
        if (h.o.down) notice('Officer down', 1.5);
        combat.crime('officer');
      }
      break;
    case 'vehicle':
      if (fleet.includes(h.v)) h.v.damage(damage * 0.3);
      else if (roadTraffic.owns(h.v)) roadTraffic.hit(h.v);
      break;
  }
}

function meleeSwing(damage: number, reach: number): void {
  player.rig.swing = 0.3;
  audio.sfx('swing');
  const f = player.facing();
  let best: { d: number; r?: Resident; o?: Officer } | null = null;
  const consider = (x: number, z: number, who: { r?: Resident; o?: Officer }) => {
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    if (d > reach + 0.35 || (f.x * dx + f.y * dz) / (d || 1) < 0.5) return;
    if (!best || d < best.d) best = { d, ...who };
  };
  for (const r of residents) consider(r.x, r.z, { r });
  for (const o of combat.officers) if (!o.down) consider(o.x, o.z, { o });
  const hit = best as { d: number; r?: Resident; o?: Officer } | null;
  if (!hit) return;
  if (hit.r) applyHit({ t: hit.d, kind: 'resident', r: hit.r }, damage);
  else if (hit.o) applyHit({ t: hit.d, kind: 'officer', o: hit.o }, damage);
}

const camDir = new THREE.Vector3();
function fireWeapon(): void {
  const d = weapons.def;
  if (!d || current || flying || mode !== 'play') return;
  const res = weapons.trigger();
  if (res === 'empty') {
    audio.sfx('empty');
    if (weapons.reserve(d.id) <= 0) notice(`Out of rounds for the ${d.name}. Sade sells more at the range.`, 2);
    return;
  }
  if (res !== 'fired') return;
  aimHold = 1.2;
  player.faceYaw = cam.yaw;
  player.heading = cam.yaw;
  player.sync();
  if (d.cls === 'melee') return meleeSwing(d.damage, d.range);
  audio.sfx('shot');
  save.data.stats.shots++;
  if (rangeRun.state === 'live') rangeRun.shots++;
  const mx = player.x + Math.cos(player.heading) * 0.55, my = player.y + 1.45, mz = player.z + Math.sin(player.heading) * 0.55;
  // Aim point: where the screen centre (or the test hook) points, past the player.
  let aim: THREE.Vector3;
  if (debugAim) aim = new THREE.Vector3(debugAim.x, debugAim.y, debugAim.z);
  else {
    camera.getWorldDirection(camDir);
    const cp = camera.position;
    const camRay: Ray = { ox: cp.x, oy: cp.y, oz: cp.z, dx: camDir.x, dy: camDir.y, dz: camDir.z };
    const skip = Math.max(0, (player.x - cp.x) * camDir.x + (player.y + 1.4 - cp.y) * camDir.y + (player.z - cp.z) * camDir.z) + 0.6;
    const h = castShot(camRay, skip + d.range, skip);
    aim = new THREE.Vector3(cp.x + camDir.x * h.t, cp.y + camDir.y * h.t, cp.z + camDir.z * h.t);
  }
  const moving = player.speed > 0.5;
  const spread = d.spread * (moving ? 1.8 : 1) * (input.mouse(2) ? 0.6 : 1);
  puff(mx, my, mz, '#ffd27a', 0.08);
  for (let i = 0; i < d.pellets; i++) {
    let dx = aim.x - mx, dy = aim.y - my, dz = aim.z - mz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx = dx / len + (rand() - 0.5) * 2 * spread;
    dy = dy / len + (rand() - 0.5) * 2 * spread;
    dz = dz / len + (rand() - 0.5) * 2 * spread;
    const l2 = Math.hypot(dx, dy, dz);
    const ray: Ray = { ox: mx, oy: my, oz: mz, dx: dx / l2, dy: dy / l2, dz: dz / l2 };
    const h = castShot(ray, d.range);
    const ex = mx + ray.dx * h.t, ey = my + ray.dy * h.t, ez = mz + ray.dz * h.t;
    tracer(mx, my, mz, ex, ey, ez);
    if (h.kind === 'world' && h.t < d.range) puff(ex, ey, ez);
    applyHit(h, d.damage);
  }
  gunfireHeard();
}

/** Draw a weapon by number key (1 to 6). */
function drawByKey(key: number): void {
  const id = WEAPON_IDS.find((w) => WEAPONS[w].key === key);
  if (!id) return;
  if (rangeRun.state !== 'idle' && id !== 'egret') return notice('Range Day uses the loaner Egret pistol', 1.5);
  if (!weapons.loaner && !weapons.owns(id)) return notice(`You don't have the ${WEAPONS[id].name}. Medals from Coach Kola and the arms counter at Harbour Bend Range.`, 3);
  weapons.draw(weapons.drawn === id ? null : id);
}

/** Weapon wheel slots, clockwise from the top: one per weapon, by its number key. */
const WHEEL_ORDER: WeaponId[] = [...WEAPON_IDS].sort((a, b) => WEAPONS[a].key - WEAPONS[b].key);
function closeWheel(equip: boolean): void {
  wheelOpen = false;
  if (!equip) return;
  if (wheelPick === null) {
    if (weapons.drawn) weapons.draw(null);
  } else if (wheelPick !== weapons.drawn) drawByKey(WEAPONS[wheelPick].key);
}

/** Point the wheel with mouse movement: far enough from the centre picks the slot in that direction. */
function steerWheel(dx: number, dy: number): void {
  wheelVec.x = THREE.MathUtils.clamp(wheelVec.x + dx, -120, 120);
  wheelVec.y = THREE.MathUtils.clamp(wheelVec.y + dy, -120, 120);
  if (Math.hypot(wheelVec.x, wheelVec.y) < 40) return;
  const a = (Math.atan2(wheelVec.x, -wheelVec.y) + Math.PI * 2) % (Math.PI * 2); // 0 = up, clockwise
  wheelPick = WHEEL_ORDER[Math.round(a / ((Math.PI * 2) / WHEEL_ORDER.length)) % WHEEL_ORDER.length];
}

function toggleHolster(): void {
  if (weapons.drawn) weapons.draw(null);
  else {
    const back = weapons.last && (weapons.loaner || weapons.owns(weapons.last)) ? weapons.last : (WEAPON_IDS.find((w) => weapons.owns(w)) ?? null);
    if (back) weapons.draw(back);
    else notice('No weapons yet. Try Range Day at the Harbour Bend Range.', 2.5);
  }
}

// Touch: tapping the interaction prompt does what E does.
if (touch) $('prompt').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.press('KeyE', true);
  requestAnimationFrame(() => requestAnimationFrame(() => input.press('KeyE', false)));
});

/** Phones: fill the screen and hold it in landscape where the browser allows (Android; iPhones ignore it). */
function goLandscape(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), undefined);
    Promise.resolve(p)
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  } catch {
    /* not allowed here (an iframe, or iOS): the layout still works */
  }
}

/** Touch: the next weapon you own, then holstered, then round again. */
function cycleWeapon(): void {
  const owned = WHEEL_ORDER.filter((w) => weapons.loaner ? w === 'egret' : weapons.owns(w));
  if (!owned.length) return notice('No weapons yet. Try Range Day at the Harbour Bend Range.', 2.5);
  const i = weapons.drawn ? owned.indexOf(weapons.drawn) : -1;
  weapons.draw(i + 1 < owned.length ? owned[i + 1] : null);
}

let heldMesh: THREE.Object3D | null = null;
/** How far the headlights are on (0 day .. 1 night). */
let headK = 0;
/** True once every kit model has loaded or failed (tests wait for it). */
let kitDone = false;
let wasReloading = false;
/** Keep the weapon in the player's hand and the pose in step with what is drawn. */
function syncWeaponVisual(aiming: boolean, dt = 0): void {
  if (weapons.drawn !== shownWeapon) {
    shownWeapon = weapons.drawn;
    heldMesh = shownWeapon ? weaponMesh(shownWeapon) : null;
    player.rig.hold(heldMesh);
  }
  // Model weapons (the EKO K7) animate their own reload: the magazine drops out and goes back in.
  const reloading = weapons.reloading > 0;
  if (reloading && !wasReloading && weapons.def) heldMesh?.userData.startReload?.(weapons.def.reload);
  wasReloading = reloading;
  heldMesh?.userData.update?.(dt);
  const d = weapons.def;
  const raised = !!d && !current && (aiming || aimHold > 0) && d.cls !== 'melee';
  player.rig.aim = raised ? (d!.cls === 'pistol' ? 1 : 2) : 0;
  player.faceYaw = !!d && !current && (aiming || aimHold > 0) ? cam.yaw : null;
}

// ---------- Crew Life: crew fights, followers, turf wars (crews.ts) ----------
/** Two of your crew walking with you (null when you're on your own). */
let followers: Followers | null = null;
/** A fight with a rival crew on its turf: put all five down to take it. */
let turfWar: { group: CrewGroup; turf: CrewId } | null = null;

function crewWorld(): CrewWorld {
  const me = current ?? player;
  const targets: Target[] = [{ x: me.x, z: me.z, who: 'player' }];
  if (followers && !current && !flying && !room()) for (const f of followers.members) if (!f.down) targets.push({ x: f.x, z: f.z, who: f });
  return {
    world,
    px: me.x,
    pz: me.z,
    playerOut: !!room() || tower.inside || !!flying || lagosHouse.indoors(player.x, player.z, player.y),
    targets,
    canSee: (ax, az, bx, bz) => lineOfSight(world, ax, 1.5, az, bx, 1.4, bz),
    shoot: crewShot,
    gun: () => weaponMesh('egret'),
    rand,
  };
}

/** A crew member (or one of yours) fires: sound, tracer, and the hit lands on whoever it was aimed at. */
const crewShots = { crew: 0, followers: 0 };
function crewShot(from: Fighter, at: Target, hit: boolean): void {
  const me = current ?? player;
  if (followers?.members.includes(from)) crewShots.followers++;
  else crewShots.crew++;
  audio.sfx('shot2', Math.max(0.12, 1 - Math.hypot(from.x - me.x, from.z - me.z) / 60));
  const miss = hit ? 0 : 1 + rand() * 1.5, a = rand() * Math.PI * 2;
  tracer(from.x + Math.cos(from.heading) * 0.5, 1.45, from.z + Math.sin(from.heading) * 0.5, at.x + Math.cos(a) * miss, 1.2, at.z + Math.sin(a) * miss, '#ffd27a');
  if (!hit) return;
  if (at.who === 'player') {
    hurtFlash = 0.35;
    audio.sfx('hurt');
    if (current) {
      current.damage(4);
      if (combat.hurtPlayer(3)) goDown();
    } else if (combat.hurtPlayer(8)) goDown();
    return;
  }
  const f = at.who;
  if (followers?.members.includes(f)) {
    if (f.hurt(25, 20)) notice('One of your crew is down. They will be back on their feet soon.', 2.5);
    return;
  }
  const g = crews.find((k) => k.members.includes(f));
  if (g && g.hit(f, 34)) notice(`${g.def.name} member down`, 1.2);
}

function updateCrewLife(dt: number): void {
  const cw = crewWorld();
  for (const c of crews) c.update(dt, cw);
  const enemies = crews.filter((g) => g.hostile).flatMap((g) => g.members);
  followers?.update(dt, cw, player.heading, current ? { x: current.x, z: current.z, heading: current.heading, seat: current.seat } : null, !!flying || !!room() || tower.inside || (lagosHouse.contains(player.x, player.z) && player.y > 0.5), enemies);
  if (turfWar) {
    if (turfWar.group.beaten) winTurfWar();
    else if (!turfWar.group.hostile) {
      notice(`You walked away from the turf war with ${turfWar.group.def.name}.`, 3);
      turfWar = null;
    }
  }
}

/** A crew was attacked: they fight back. If you're in a rival crew, it's a turf war. */
function startCrewFight(g: CrewGroup): void {
  g.provoke(crewWorld());
  const mine = crewById(save.data.crew);
  if (mine && g.def.id !== mine.id) {
    if (turfWar) return;
    turfWar = { group: g, turf: turfOf.get(g)! };
    const turf = crewById(turfWar.turf)!;
    if (!followers) callFollowers(mine, true);
    notice(`Turf war with ${g.def.name}! Put all five down to take ${turf.turfName} for ${mine.name}.`, 4.5);
  } else if (!mine) notice(`${g.def.name} fights back!`, 2.5);
}

function winTurfWar(): void {
  const war = turfWar!;
  turfWar = null;
  const mine = crewById(save.data.crew);
  if (!mine) return;
  const turf = crewById(war.turf)!;
  save.data.turfs[war.turf] = mine.id;
  save.data.cash += 5000;
  persist();
  audio.sfx('win');
  // The beaten crew moves out; a group of yours walks that turf from now on.
  const i = crews.indexOf(war.group);
  war.group.remove();
  turfOf.delete(war.group);
  crews[i] = crewForTurf(turf, i);
  notice(`${mine.name} takes ${turf.turfName}! The crew pays you ₦5,000. ${war.group.def.name} has moved out.`, 5);
}

/** Two of your crew walk with you (they come running from behind). */
function callFollowers(crew: CrewDef, rushing = false): void {
  followers?.remove();
  const me = current ?? player;
  followers = new Followers(scene, crew, me.x - Math.cos(player.heading) * 4, me.z - Math.sin(player.heading) * 4);
  if (rushing) notice(`Two of ${crew.name} come running to back you up.`, 3);
}

function dismissFollowers(): void {
  followers?.remove();
  followers = null;
}

// ---------- Crews: talking, joining, the crew house, the club run (crews.ts, places.ts) ----------
/** The crew whose leader you're standing next to. */
function crewToTalk(): CrewGroup | null {
  for (const c of crews) if (c.canTalk && Math.hypot(c.leader.x - player.x, c.leader.z - player.z) < 2.8) return c;
  return null;
}
let crewTalking: CrewGroup | null = null;
const COLOUR_NAMES: Record<string, string> = { blue: 'blue', red: 'red', yellow: 'yellow' };

/** What E does outside one of the Crews places (or null). */
function placePrompt(): string | null {
  const crew = crewById(save.data.crew);
  const hs = lagosHouse.spotAt(player.x, player.z, player.y);
  if (hs) return hs.label;
  if (house.nearDoorOutside(player.x, player.z)) return crew ? `Enter the ${crew.name} house` : 'Crew house (members only)';
  if (club.nearDoorOutside(player.x, player.z)) return 'Enter Afterglow';
  if (armsShop.near(player.x, player.z)) return 'Buy weapons at EKO Arms';
  const g = crewToTalk();
  if (g) return `Talk to ${g.leaderName} (${g.def.name})`;
  return null;
}

/** Hear a crew out: join, say no, or (if you're in) carry on or leave. */
function openCrewTalk(g: CrewGroup): void {
  const crew = g.def, mine = crewById(save.data.crew);
  crewTalking = null;
  g.talk(true);
  offerDef = null;
  const who = g.leaderName;
  $('o-giver').textContent = `${who} · ${crew.name}`;
  $('o-name').textContent = crew.name.toUpperCase();
  let decline: (() => void) | null = null;
  if (!mine) {
    $('o-intro').textContent = `${who}: "${crew.pitch}"`;
    $('o-terms').textContent = `Turf: ${crew.turfName}. Colours: a ${COLOUR_NAMES[crew.id]} bandana. Joining opens the crew house north of the square: your own room, a bathroom and gym, crew jobs at the planning table and nights out at Afterglow. You can run with one crew at a time.`;
    $('btn-accept').textContent = `Join ${crew.name}`;
    $('btn-decline').textContent = 'Not now';
    offerAction = () => joinCrew(crew);
    decline = () => notice(`${who}: "Your call. We walk this way every day."`, 3);
  } else if (mine.id === crew.id) {
    $('o-intro').textContent = `${who}: "${followers ? 'Your people are with you. Say the word and they head home.' : crew.member}"`;
    $('o-terms').textContent = `You run with ${crew.name}. Two of the crew can walk with you: they follow you on foot, ride along in your car and fight on your side.`;
    $('btn-accept').textContent = followers ? 'Send them home' : 'Walk with me';
    $('btn-decline').textContent = 'Leave the crew';
    offerAction = () => (followers ? (dismissFollowers(), notice('Your crew heads back to the house.', 2.5)) : (callFollowers(crew), notice(`Two of ${crew.name} walk with you now.`, 2.5)));
    decline = leaveCrew;
  } else {
    $('o-intro').textContent = `${who}: "${crew.rival}"`;
    $('o-terms').textContent = `You run with ${mine.name}. ${crew.name} won't take you while you wear ${mine.name} colours. Or fight them for this turf: put all five down and it's ${mine.name}'s.`;
    $('btn-accept').textContent = 'Walk on';
    $('btn-decline').textContent = 'Start a turf war';
    offerAction = () => undefined;
    decline = () => startCrewFight(g);
  }
  // Talking stops when the screen closes (the play loop resets the pose).
  setTimeout(() => (crewTalking = g), 0);
  showOffer(decline);
}

function joinCrew(crew: CrewDef): void {
  save.data.crew = crew.id;
  persist();
  applyCrew();
  audio.sfx('win');
  notice(`You joined ${crew.name}. ${crew.welcome}`, 5);
}

function leaveCrew(): void {
  const was = crewById(save.data.crew);
  dismissFollowers();
  if (turfWar) {
    turfWar.group.calm();
    turfWar = null;
  }
  if (house.inside) exitHouse();
  save.data.crew = '';
  persist();
  applyCrew();
  notice(`You left ${was?.name ?? 'the crew'}. The bandana comes off.`, 3.5);
}

function enterHouse(): void {
  const crew = crewById(save.data.crew);
  if (!crew) return notice('Crew house. Members only: join a crew first. Look for groups wearing matching bandanas.', 4);
  house.enter(player);
  cam.yaw = -Math.PI / 2;
  audio.sfx('door');
  notice(`${crew.name} house. Your room, the bathroom and the gym are at the back. The planning table is in the middle, the garage on the right.`, 4.5);
}

function exitHouse(): void {
  house.exit(player);
  cam.yaw = Math.PI / 2;
  audio.sfx('door');
}

function enterClub(): void {
  club.enter(player);
  cam.yaw = -Math.PI / 2;
  audio.sfx('door');
  notice('Afterglow. The music is loud and the floor is full.', 3);
}

function exitClub(): void {
  const withCrew = !!clubRun?.arrived;
  club.setCrewDancing(null);
  club.exit(player);
  cam.yaw = Math.PI / 2;
  audio.sfx('door');
  if (withCrew) {
    endClubRun();
    notice('The crew stays to dance. The minibus is parked outside.', 3.5);
  }
}

/** A short black-out (sleep, bathroom). */
function fadeOut(seconds: number): void {
  const f = $('fade');
  f.hidden = false;
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
  f.style.animationDuration = `${seconds}s`;
  setTimeout(() => (f.hidden = true), seconds * 1000);
}

let gymRest = 0;
let sleeps = 0;
function useSpot(id: string): void {
  if (id === 'exit') return house.inside ? exitHouse() : exitClub();
  if (id === 'door') return notice('Crew house. Members only: join a crew first. Look for groups wearing matching bandanas.', 4);
  if (id === 'roof-up' || id === 'roof-down') {
    const to = lagosHouse.stairTo(id);
    player.x = to.x;
    player.z = to.z;
    player.y = to.y;
    player.vy = 0;
    player.sync();
    return notice(id === 'roof-up' ? 'Up the spiral stair to the roof: the gym and the lounge.' : 'Down to the upper floor.', 2);
  }
  if (id === 'bed') {
    fadeOut(1.6);
    combat.health = 100;
    stamina.value = 100;
    sleeps++;
    const morning = env.wakeAt(7);
    persist();
    return notice(`You sleep it off. Health back to full, game saved.${morning ? " It's morning." : ' (Live Lagos time keeps real time: set a fast day in Settings to sleep till morning.)'}`, 4.5);
  }
  if (id === 'bath') {
    fadeOut(1);
    stamina.value = 100;
    return notice('You freshen up. Feeling sharp.', 2.5);
  }
  if (id === 'gym') {
    if (gymRest > 0) return notice('Catch your breath first.', 1.5);
    gymRest = 8;
    stamina.value = Math.min(stamina.value, 35);
    if (save.data.fitness < 10) save.data.fitness++;
    stamina.fitness = save.data.fitness;
    persist();
    player.rig.pose = 'crossed';
    setTimeout(() => (player.rig.pose = 'none'), 1500);
    return notice(`Bench press, bag work, done. Fitness ${save.data.fitness}/10: your sprint lasts longer.`, 3.5);
  }
  if (id === 'plan') return openHub('crew');
  if (id === 'club') return startClubRun();
}

/** Club run: the crew piles into a minibus and you drive everyone to Afterglow. */
let clubRun: { bus: Vehicle; riders: HumanRig[]; crew: CrewDef; arrived: boolean } | null = null;
function startClubRun(): void {
  const crew = crewById(save.data.crew);
  if (!crew) return;
  if (clubRun) return notice('The crew is already waiting in the minibus outside.', 2.5);
  if (house.inside) house.exit(player);
  const at = lagosHouse.active ? LH_GARAGE : GARAGE;
  const bus = new Vehicle('minibus', at.x, at.z, at.heading, crew.colour);
  scene.add(bus.group);
  fleet.push(bus);
  stolen.push(bus); // tidied away later like any car you've taken
  const seats: [number, number, number][] = [[1.45, 0.55, 0.42], [0.5, 0.62, -0.5], [0.5, 0.62, 0.5], [-0.4, 0.62, 0]];
  const riders = seats.map(([x, y, z], i) => {
    const r = new HumanRig(memberLook(crew, i));
    r.seated = true;
    r.root.position.set(x, y + 0.1 - 0.92, z);
    r.root.name = `club-rider-${i}`;
    bus.group.add(r.root);
    r.animate(0.1, 0);
    return r;
  });
  enterVehicle(bus);
  clubRun = { bus, riders, crew, arrived: false };
  notice(`${crew.name} piles into the minibus. Drive to Afterglow: follow the arrow.`, 4);
}

function updateClubRun(dt: number): void {
  if (!clubRun || clubRun.arrived) return;
  for (const r of clubRun.riders) r.animate(dt, 0);
  const bus = clubRun.bus;
  if (bus.wrecked || !bus.group.visible) {
    notice('The minibus is wrecked. Club night is off.', 3);
    return endClubRun();
  }
  const d = Math.hypot(bus.x - CLUB.door.x, bus.z - (CLUB.door.z + 7));
  if (current === bus && d < 12 && Math.abs(bus.speed) < 2) {
    leaveVehicle(true);
    for (const r of clubRun.riders) r.root.removeFromParent();
    clubRun.riders = [];
    clubRun.arrived = true;
    club.enter(player);
    club.setCrewDancing(clubRun.crew);
    cam.yaw = -Math.PI / 2;
    audio.sfx('door');
    notice(`${clubRun.crew.name} hits the dance floor at Afterglow.`, 4);
  }
}

function endClubRun(): void {
  if (!clubRun) return;
  for (const r of clubRun.riders) r.root.removeFromParent();
  clubRun = null;
}

// ---------- Going down and the hospital ----------
function goDown(cause?: string): void {
  if (turfWar) {
    notice(`You lost the turf war with ${turfWar.group.def.name}.`, 4);
    turfWar = null;
  }
  for (const g of crews) g.calm();
  if (flying) exitCraft(true);
  if (current) leaveVehicle(true);
  if (area) leaveArea();
  if (rangeRun.state !== 'idle') stopRange();
  const fee = Math.min(HOSPITAL.fee, save.data.cash);
  save.data.cash -= fee;
  save.data.stats.hospital++;
  recovering = true;
  combat.recover();
  recovering = false;
  combat.armour = 0;
  weapons.draw(null);
  aimHold = 0;
  const w = HOSPITAL.wake;
  player.x = w.x;
  player.z = w.z;
  player.y = 0;
  player.heading = w.heading;
  player.sync();
  cam.yaw = w.heading;
  persist();
  refreshCash();
  audio.sfx('fail');
  const text = `You woke up at ${HOSPITAL.name} (fictional). Treatment fee ${fmtCash(fee)}. Your heat is gone.`;
  if (runner?.state === 'active') {
    runner.fail(`You went down and woke up in hospital (fee ${fmtCash(fee)})`);
    return;
  }
  resultKind = 'hospital';
  $('r-mission').textContent = HOSPITAL.name;
  $('r-title').textContent = 'PATCHED UP';
  $('r-body').textContent = `${cause ?? 'You went down.'} ${text}`;
  $('r-finale').hidden = true;
  $('btn-retry').hidden = true;
  setMode('result');
  $('hud').hidden = false;
}

// ---------- Range Day (Phase 4) ----------
let rangePrevWeapon: WeaponId | null = null;
let rangeCount = 0;

function offerRange(): void {
  const best = save.data.range;
  offerDef = null;
  offerAction = startRange;
  $('o-giver').textContent = 'Coach Kola · Harbour Bend Range';
  $('o-name').textContent = 'RANGE DAY';
  $('o-intro').textContent = `Targets pop up down the lanes for ${RANGE.duration} seconds. Hit as many as you can with the range's loaner Egret pistol. Stay behind the yellow rail.`;
  const [b, sv, g] = RANGE.medals;
  $('o-terms').textContent = `Bronze ${b} hits (the Egret pistol is yours), silver ${sv} (SMG and shotgun go on sale), gold ${g} (rifle and marksman rifle go on sale). Free to enter. Your best: ${best.best} hits${best.medal ? `, ${MEDALS[best.medal]} medal` : ''}.`;
  $('btn-accept').textContent = 'Step up to the line';
  showOffer();
}

function startRange(): void {
  if (current) return;
  rangePrevWeapon = weapons.loaner ? rangePrevWeapon : weapons.drawn;
  weapons.loaner = true;
  weapons.inMag.egret = WEAPONS.egret.mag;
  weapons.draw('egret');
  const st = RANGE.stand;
  player.x = st.x;
  player.z = st.z;
  player.heading = st.heading;
  player.sync();
  cam.yaw = st.heading;
  cam.pitch = 0.08;
  rangeRun.start();
  rangeCount = 4;
}

/** Leave Range Day without a result (e.g. you went down). */
function stopRange(): void {
  rangeRun.stop();
  weapons.loaner = false;
  delete weapons.inMag.egret;
  weapons.draw(rangePrevWeapon && weapons.owns(rangePrevWeapon) ? rangePrevWeapon : null);
  $('countdown').hidden = true;
}

function endRange(reason?: string): void {
  const hits = rangeRun.hits, shots = rangeRun.shots, medal = reason ? 0 : rangeRun.medal;
  stopRange();
  const r = save.data.range;
  const unlocked: string[] = [];
  for (let m = r.medal + 1; m <= medal; m++) {
    unlocked.push(MEDAL_REWARDS[m]);
    if (m === 1 && !save.data.weapons.owned.includes('egret')) {
      save.data.weapons.owned.push('egret');
      save.data.weapons.ammo.egret = (save.data.weapons.ammo.egret ?? 0) + WEAPONS.egret.ammoPack;
    }
  }
  const newBest = !reason && hits > r.best;
  if (!reason) {
    r.best = Math.max(r.best, hits);
    r.medal = Math.max(r.medal, medal);
  }
  persist();
  resultKind = 'range';
  audio.sfx(medal ? 'win' : 'fail');
  $('r-mission').textContent = 'Range Day · Coach Kola';
  $('r-title').textContent = reason ? 'RANGE DAY OVER' : medal ? `${MEDALS[medal].toUpperCase()} MEDAL` : 'NO MEDAL';
  const acc = shots ? Math.round((hits / shots) * 100) : 0;
  const parts = reason ? [`${reason}.`] : [`${hits} hits from ${shots} shots (${acc}% accuracy).${newBest ? ' New best!' : ''}`];
  const next = RANGE.medals.find((n) => n > hits);
  if (!reason && next) parts.push(`${next - hits} more for the next medal.`);
  parts.push(...unlocked);
  $('r-body').textContent = parts.join(' ');
  $('r-finale').hidden = true;
  $('btn-retry').hidden = false;
  $('btn-retry').textContent = 'Go again';
  setMode('result');
  $('hud').hidden = false;
}

// ---------- Arms counter (Phase 4) ----------
/** Which counter is open: Sade's at the range (medals unlock weapons) or EKO Arms in town (everything for sale). */
let armouryShop: 'range' | 'eko' = 'range';
function openArmoury(note = '', shop: 'range' | 'eko' = 'range'): void {
  armouryShop = shop;
  $('ar-eyebrow').textContent = shop === 'eko' ? 'EKO Arms · licensed dealer north of the square (fictional)' : "Harbour Bend Range · Sade's arms counter (fictional)";
  $('ar-title').textContent = shop === 'eko' ? 'EKO ARMS' : 'ARMS COUNTER';
  renderArmoury(note);
  setMode('armoury');
}

function buyButton(label: string, price: number, onBuy: () => string, data: [string, string]): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = `${label} ${fmtCash(price)}`;
  b.disabled = save.data.cash < price;
  b.dataset[data[0]] = data[1];
  b.addEventListener('click', () => {
    if (save.data.cash < price) return;
    save.data.cash -= price;
    const msg = onBuy();
    persist();
    audio.sfx('cash');
    refreshCash();
    renderArmoury(msg);
  });
  return b;
}

function renderArmoury(note = ''): void {
  $('ar-cash').textContent = `You have ${fmtCash(save.data.cash)} · Range Day best: ${save.data.range.medal ? `${MEDALS[save.data.range.medal]} medal` : 'no medal yet'}`;
  const box = $('ar-list');
  box.innerHTML = '';
  const row = (name: string, sub: string, ...actions: HTMLElement[]) => {
    const el = document.createElement('div');
    el.className = 'paint';
    const sw = document.createElement('span');
    sw.className = 'sw';
    const b = document.createElement('b');
    b.textContent = name;
    const small = document.createElement('small');
    small.textContent = sub;
    el.append(sw, b, small, ...actions);
    box.append(el);
    return sw;
  };
  for (const id of WEAPON_IDS) {
    const d = WEAPONS[id];
    const owned = weapons.owns(id);
    const cls = d.cls === 'smg' ? 'SMG' : d.cls === 'marksman' ? 'marksman rifle' : d.cls;
    let sw: HTMLElement;
    if (owned) {
      const sub = d.cls === 'melee' ? `Owned · key ${d.key}` : `Owned · key ${d.key} · ${save.data.weapons.ammo[id] ?? 0} rounds`;
      const acts = d.cls === 'melee' ? [] : [buyButton(`${d.ammoPack} rounds`, d.ammoPrice, () => {
        save.data.weapons.ammo[id] = (save.data.weapons.ammo[id] ?? 0) + d.ammoPack;
        return `${d.ammoPack} rounds for the ${d.name}.`;
      }, ['ammo', id])];
      sw = row(d.name, sub, ...acts);
    } else if (armouryShop === 'eko' || save.data.range.medal >= d.medal) {
      sw = row(d.name, `${cls} · ${d.ammoPack ? `comes with ${d.ammoPack} rounds` : 'no rounds needed'}`, buyButton('Buy', d.price, () => {
        save.data.weapons.owned.push(id);
        if (d.ammoPack) save.data.weapons.ammo[id] = (save.data.weapons.ammo[id] ?? 0) + d.ammoPack;
        return `${d.name} bought. Press ${d.key} to draw it.`;
      }, ['buy', id]));
    } else {
      sw = row(d.name, `${cls} · locked: earn a ${MEDALS[d.medal]} medal at Range Day (Coach Kola)`);
    }
    sw.style.background = d.colour;
  }
  const armour = Math.round(combat.armour);
  const sw = row('Body armour (placeholder vest)', `Soaks up damage before your health · now ${armour}%`, ...(armour >= 100 ? [] : [buyButton('Fit armour', ARMOUR_PRICE, () => {
    combat.armour = 100;
    return 'Armour fitted: 100%.';
  }, ['armour', '1'])]));
  sw.style.background = '#4bb3ff';
  $('ar-note').textContent = note;
}
$('btn-arleave').addEventListener('click', resume);

// ---------- Street voices (Phase 4) ----------
/** A resident says a street-voice line (greeting, complaint or excuse me) in their language. */
function streetLine(r: Resident, kind: VoiceKind, force = false): void {
  if (!force && r.barkCooldown > 0) return;
  const line = voices.pick(r.name, kind, rand);
  if (!line) return;
  r.barkCooldown = 8;
  lastVoice = { name: r.name, kind, lang: line.lang, text: line.text };
  say(r, voiceText(line));
}

// ---------- Interaction ----------
type Focus = { kind: 'vehicle'; v: Vehicle } | { kind: 'hijack'; v: Vehicle } | { kind: 'npc'; r: Resident } | { kind: 'craft'; c: Craft } | null;
function findFocus(): Focus {
  if (current || flying) return null;
  let best: Focus = null;
  let bestScore = Infinity;
  const f = player.facing();
  for (const c of crafts) {
    if (c.wrecked || craftRespawn.has(c)) continue;
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if (d < c.reach && d - 2 < bestScore) {
      bestScore = d - 2;
      best = { kind: 'craft', c };
    }
  }
  for (const v of fleet) {
    if (v.wrecked || !v.group.visible || !v.contains(player.x, player.z, 1.4)) continue;
    const score = Math.hypot(v.x - player.x, v.z - player.z) - 2;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'vehicle', v };
    }
  }
  // Any car on the road can be hijacked.
  for (const v of roadTraffic.vehicles()) {
    if (!v.contains(player.x, player.z, 1.4)) continue;
    const score = Math.hypot(v.x - player.x, v.z - player.z) - 2;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'hijack', v };
    }
  }
  for (const r of residents) {
    if (r.isDown) continue;
    const dx = r.x - player.x, dz = r.z - player.z, d = Math.hypot(dx, dz);
    if (d > 2.6) continue;
    const score = d - ((f.x * dx + f.y * dz) / (d || 1)) * 0.8;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'npc', r };
    }
  }
  return best;
}

function enterVehicle(v: Vehicle): void {
  if (rangeRun.state !== 'idle') return notice('Finish Range Day first', 1.5);
  weapons.draw(null);
  aimHold = 0;
  current = v;
  v.hasDriver = true;
  // The player stays visible, seated at the wheel (see seatDriver).
  player.visible = true;
  player.rig.seated = true;
  seatDriver(v, 0.2);
  cam.yaw = v.heading;
  cam.lookOffset = 0;
  audio.sfx('door');
}

/** Put the player's figure in the driver's seat (left-hand drive) and hold the sitting pose. */
function seatDriver(v: Vehicle, dt: number): void {
  const [sx, sy, sz] = v.seat;
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  player.rig.root.position.set(v.x + sx * c - sz * s, sy + 0.1 - 0.92, v.z + sx * s + sz * c);
  player.rig.root.rotation.y = -v.heading;
  player.rig.animate(dt, 0);
}

/** Puts the player beside the vehicle; returns false if there is no room. */
function leaveVehicle(force = false): boolean {
  const v = current;
  if (!v) return false;
  if (!force && v.kmh > 20) {
    notice('Slow down to get out');
    return false;
  }
  const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
  const lx = fz, lz = -fx; // left of the vehicle
  const side = v.spec.wid / 2 + 0.75, end = v.spec.len / 2 + 0.8;
  const spots = [[lx * side, lz * side], [-lx * side, -lz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
  for (const [ox, oz] of spots) {
    const x = v.x + ox, z = v.z + oz;
    if (force || !world.overlapsCircle(x, z, player.radius + 0.05)) {
      player.x = x;
      player.z = z;
      player.heading = v.heading;
      player.y = 0;
      player.sync();
      player.visible = true;
      player.rig.seated = false;
      current = null;
      v.hasDriver = false;
      v.speedCap = null;
      cam.yaw = v.heading;
      audio.sfx('door');
      return true;
    }
  }
  notice('No room to get out here');
  return false;
}

/** A subtitle line from someone who isn't a street resident (mission characters). */
function say0(name: string, line: string): void {
  $('subtitle').textContent = `${name}: ${line}`;
  $('subtitle').hidden = false;
  subtitleTimer = 4;
}

function say(r: Resident, line: string): void {
  r.greet(line, player.x, player.z);
  audio.sfx('greet');
  $('subtitle').textContent = `${r.name}: ${line}`;
  $('subtitle').hidden = false;
  subtitleTimer = 5;
}

/** A mission without a resident giver whose start point you are standing on (E starts its intro). */
function missionStartHere(): MissionDef | null {
  if (!runner || runner.state !== 'idle' || area || current || flying) return null;
  const here = runner.missions.filter((m) => m.location && acceptedJobs.has(m.id) && Math.hypot(m.location.x - player.x, m.location.z - player.z) < 3.5);
  return here.find((m) => m === tracked) ?? here[0] ?? null;
}

function interact(): void {
  if (flying) {
    exitCraft();
    return;
  }
  if (current) {
    leaveVehicle();
    return;
  }
  // The running mission wants E here (cut the power, open the cell, lift the cooler).
  if (runner?.state === 'active' && runner.pressHere(player.x, player.z, false)) return;
  // Crews: inside the house or club, E uses what you're next to; outside, the doors, the gun shop and crew leaders.
  const inRoom = room();
  if (inRoom) {
    const spot = inRoom.spotAt(player.x, player.z);
    if (spot) useSpot(spot.id);
    return;
  }
  const hs = lagosHouse.spotAt(player.x, player.z, player.y);
  if (hs) return useSpot(hs.id);
  if (house.nearDoorOutside(player.x, player.z)) return enterHouse();
  if (club.nearDoorOutside(player.x, player.z)) return enterClub();
  if (armsShop.near(player.x, player.z)) return openArmoury('', 'eko');
  const crewNear = crewToTalk();
  if (crewNear) return openCrewTalk(crewNear);
  if (tower.inside) {
    if (nearPenthouseBed()) return useSpot('bed');
    if (tower.nearExit(player.x, player.z, player.y)) return exitTower();
    if (tower.inLift(player.x, player.z)) return openLift();
    return;
  }
  if (tower.nearDoorOutside(player.x, player.z)) return enterTower();
  const start = missionStartHere();
  if (start) return beginIntro(start);
  const f = findFocus();
  if (!f) return;
  if (rangeRun.state !== 'idle') return notice('Finish Range Day first', 1.5);
  if (f.kind === 'vehicle' && f.v === royale && !royaleOpen()) return notice("The Royale GT is the Chairman's car. Win the Coastal Run for him and it's yours.", 3.5);
  if (f.kind === 'vehicle') return enterVehicle(f.v);
  if (f.kind === 'hijack') return hijack(f.v);
  if (f.kind === 'craft') return enterCraft(f.c);
  if (f.r.name === 'Coach Kola') {
    if (runner?.state === 'active') return say(f.r, 'Finish your job first, then come and shoot.');
    f.r.greet('', player.x, player.z);
    return offerRange();
  }
  if (f.r.name === 'Sade') {
    f.r.greet('', player.x, player.z);
    return openArmoury();
  }
  const shop = SHOPKEEPERS[f.r.name];
  if (shop) {
    f.r.greet('', player.x, player.z);
    return openWardrobe(shop);
  }
  // Residents no longer hand out work (The Chairman): jobs come from the Chairman's people by phone.
  say(f.r, dialogue.pick(f.r.def.voice));
}

// ---------- Running people over, smashed street furniture ----------
/** Dark red pools left where someone was hit (they spread, then fade away). */
const stains: { mesh: THREE.Mesh; t: number }[] = [];
const STAIN_GEO = new THREE.CircleGeometry(1, 20);
function addStain(x: number, z: number): void {
  const m = new THREE.Mesh(STAIN_GEO, new THREE.MeshBasicMaterial({ color: '#6a0b0b', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.035, z);
  m.scale.setScalar(0.1);
  scene.add(m);
  stains.push({ mesh: m, t: 0 });
}
function updateStains(dt: number): void {
  for (let i = stains.length - 1; i >= 0; i--) {
    const st = stains[i];
    st.t += dt;
    st.mesh.scale.setScalar(Math.min(1.1, 0.1 + st.t * 0.9));
    const mat = st.mesh.material as THREE.MeshBasicMaterial;
    if (st.t > 10) mat.opacity = Math.max(0, 0.85 * (1 - (st.t - 10) / 5));
    if (st.t > 15) {
      st.mesh.removeFromParent();
      mat.dispose();
      stains.splice(i, 1);
    }
  }
}

/** Any car of yours going faster than a jog knocks people down instead of stopping for them. */
function runOverPeople(): void {
  for (const v of fleet) {
    if (!v.group.visible || Math.abs(v.speed) < 3 || !v.hasDriver) continue;
    for (const r of residents) {
      if (r.isDown || !v.contains(r.x, r.z, 0.3)) continue;
      r.knockDown(v.x, v.z);
      addStain(r.x, r.z);
      audio.sfx('hit');
      v.speed *= 0.85;
      if (v === current) combat.crime('assault');
    }
    for (const o of combat.officers) {
      if (o.down || !v.contains(o.x, o.z, 0.3)) continue;
      o.hurt(9999);
      addStain(o.x, o.z);
      audio.sfx('hit');
      v.speed *= 0.85;
      if (v === current) combat.crime('officer');
    }
  }
}

// A car smashing street furniture: debris puff and a crunch. Props come back once you're well away.
info.propEvents.onBreak = (p) => {
  puff(p.x, 1.0, p.z, '#8a7f72', 0.9);
  puff(p.x, 2.2, p.z, '#5b5550', 0.6);
  audio.sfx('crash', 0.45);
};
function restoreFarProps(): void {
  const me = current ?? player;
  const now = performance.now();
  for (const p of info.props) if (p.broken && now - p.brokenAt > 120000 && Math.hypot(p.x - me.x, p.z - me.z) > 70) info.restoreProp(p);
}

// ---------- Car fires and hijacking ----------
/** Burning vehicles (seconds of fire left) and burnt-out ones waiting to come back (seconds). */
const fires = new Map<Vehicle, number>();
const rebuilds = new Map<Vehicle, number>();
const FIRE_SECONDS = 7;
const REBUILD_SECONDS = 30;

/**
 * A car at zero health catches fire. Get out: when the fire burns out the car is gone (the town's
 * own cars come back later; hijacked ones don't). Still inside when it goes up, and you go down.
 */
function updateFires(dt: number): void {
  for (const v of fleet) {
    if (!v.wrecked || fires.has(v) || rebuilds.has(v) || !v.group.visible) continue;
    fires.set(v, FIRE_SECONDS);
    v.setBurning(true);
    audio.sfx('crash');
    if (current === v) notice(`The ${vehicleLabel(v)} is on fire! Get out now (E)`, 4);
  }
  for (const [v, t] of fires) {
    const left = t - dt;
    v.animateFire(dt, left);
    if (left > 0) {
      fires.set(v, left);
      continue;
    }
    fires.delete(v);
    burnOut(v);
  }
  for (const [v, t] of rebuilds) {
    if (t - dt > 0) {
      rebuilds.set(v, t - dt);
      continue;
    }
    rebuilds.delete(v);
    const home = HOMES.get(v)!;
    v.repair();
    v.place(home.x, home.z, home.heading);
    v.group.visible = true;
    if (v === hatch) notice("Your car has been rebuilt at Chidi's Workshop", 3);
  }
}

function burnOut(v: Vehicle): void {
  const inside = current === v;
  puff(v.x, 1.5, v.z, '#ff8a3c', 2.2);
  puff(v.x, 2.5, v.z, '#2a2420', 2.6);
  audio.sfx('crash');
  v.setBurning(false);
  if (inside) leaveVehicle(true);
  // Burnt out: gone from the street.
  v.group.visible = false;
  v.hasDriver = false;
  v.place(100000 + v.id * 20, 100000, 0);
  const si = stolen.indexOf(v);
  if (si >= 0 || !HOMES.has(v)) {
    // Hijacked and mission cars are gone for good; only the town's own cars are rebuilt.
    if (si >= 0) stolen.splice(si, 1);
    fleet.splice(fleet.indexOf(v), 1);
    v.group.removeFromParent();
    if (v === missionCar) missionCar = null;
  } else rebuilds.set(v, REBUILD_SECONDS);
  if (!inside && runner?.state === 'active' && runner.boundVehicle === v.id) notice('Find another car: walk up to one on the road and press E to take it', 4);
  if (inside) {
    combat.hurtPlayer(9999);
    goDown('You were still inside when the car went up in flames.');
  }
}

/** Drivers pulled out of hijacked cars run off and disappear after a few seconds. */
const fleeing: { rig: HumanRig; x: number; z: number; heading: number; t: number }[] = [];
const DRIVER_SHIRTS = ['#c0392b', '#2e86c1', '#16a085', '#e67e22', '#f0efe9', '#8e44ad', '#2b2d31'];
function ejectDriver(v: Vehicle): void {
  const lx = Math.sin(v.heading), lz = -Math.cos(v.heading); // driver's door (left side)
  const x = v.x + lx * (v.spec.wid / 2 + 0.7), z = v.z + lz * (v.spec.wid / 2 + 0.7);
  const rig = new HumanRig({ shirt: DRIVER_SHIRTS[Math.floor(rand() * DRIVER_SHIRTS.length)], pants: '#2b2b2b' });
  scene.add(rig.root);
  const away = Math.atan2(z - player.z, x - player.x);
  fleeing.push({ rig, x, z, heading: away, t: 5 });
  const line = voices.pick('Driver', 'complaint');
  if (line) {
    $('subtitle').textContent = `Driver: ${voiceText(line)}`;
    $('subtitle').hidden = false;
    subtitleTimer = 3.5;
  }
}
function updateFleeing(dt: number): void {
  for (let i = fleeing.length - 1; i >= 0; i--) {
    const f = fleeing[i];
    f.t -= dt;
    const nx = f.x + Math.cos(f.heading) * 4.8 * dt, nz = f.z + Math.sin(f.heading) * 4.8 * dt;
    if (!world.overlapsCircle(nx, nz, 0.3)) {
      f.x = nx;
      f.z = nz;
    } else f.heading += 1.2; // round the obstacle
    f.rig.root.position.set(f.x, 0, f.z);
    f.rig.root.rotation.y = -f.heading;
    f.rig.animate(dt, 4.8);
    if (f.t <= 0) {
      f.rig.root.removeFromParent();
      fleeing.splice(i, 1);
    }
  }
}

/** Take a car from traffic: pull the driver out and drive off in it. */
function hijack(v: Vehicle): void {
  if (rangeRun.state !== 'idle') return notice('Finish Range Day first', 1.5);
  if (!roadTraffic.release(v)) return;
  v.speed = 0;
  v.hasDriver = false;
  fleet.push(v);
  stolen.push(v);
  ejectDriver(v);
  // Keep a handful of stolen cars around; tidy away the oldest ones you've left behind.
  while (stolen.length > 4) {
    const old = stolen.find((k) => k !== v && k !== current && !fires.has(k));
    if (!old) break;
    stolen.splice(stolen.indexOf(old), 1);
    fleet.splice(fleet.indexOf(old), 1);
    old.group.removeFromParent();
  }
  enterVehicle(v);
  notice(`You took the ${vehicleLabel(v)}`, 2);
}

// ---------- Camera ----------
function updateCamera(dt: number): void {
  const look = input.consumeLook();
  if (wheelOpen) {
    steerWheel(look.x, look.y);
    look.x = look.y = 0;
  }
  const s = save.data.settings;
  const k = 0.0024 * s.lookSensitivity;
  if (look.x !== 0 || look.y !== 0) {
    cam.yaw += look.x * k;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + look.y * k * (s.invertY ? -1 : 1), weapons.drawn && !current ? -0.6 : -0.15, 1.15);
    if (current) {
      cam.lookOffset += look.x * k;
      cam.lookHold = 1.4;
    }
  }
  let tx: number, ty: number, tz: number, dist: number, side: number;
  if (flying) {
    // Chase camera behind the aircraft or boat.
    let diff = flying.heading + cam.lookOffset - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cam.yaw += diff * Math.min(1, dt * 3);
    tx = flying.x; ty = flying.y + (flying.kind === 'boat' ? 2.2 : 3); tz = flying.z;
    dist = flying.kind === 'plane' ? 15 : flying.kind === 'heli' ? 13 : 9;
    side = 0;
  } else if (current) {
    cam.lookHold -= dt;
    if (cam.lookHold <= 0) cam.lookOffset *= Math.max(0, 1 - dt * 2.5);
    const target = current.heading + cam.lookOffset;
    let diff = target - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cam.yaw += diff * Math.min(1, dt * 4);
    tx = current.x; ty = current.spec.camHeight; tz = current.z;
    dist = current.spec.camDist + Math.abs(current.speed) * 0.08;
    side = 0;
  } else if (weapons.drawn && (aimHold > 0 || (input.mouse(2) && input.locked))) {
    // Over-the-shoulder aim (Phase 4)
    tx = player.x; ty = player.y + 1.6; tz = player.z;
    dist = 2.9;
    side = 0.75;
  } else {
    tx = player.x; ty = player.y + 1.55; tz = player.z;
    dist = tower.inside || room() ? 3.4 : 4.6;
    side = weapons.drawn ? 0.65 : 0.5;
  }
  const pitch = current || flying ? Math.max(0.12, cam.pitch * 0.7) : cam.pitch;
  const fx = Math.cos(cam.yaw), fz = Math.sin(cam.yaw);
  const rx = Math.cos(cam.yaw + Math.PI / 2), rz = Math.sin(cam.yaw + Math.PI / 2);
  const ox = tx + rx * side, oz = tz + rz * side;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let d = dist;
  // Indoors (the tower, the crew house, the club) the building keeps the camera inside instead (clampCamera below).
  // The crew house and the club test their own walls and tall furniture, so the camera doesn't see through them.
  const camWalls = room() ?? (lagosHouse.indoors(player.x, player.z, player.y) && !current ? lagosHouse : null);
  for (let t = 0.4; t <= dist && !tower.inside; t += 0.25) {
    const bx = ox - fx * cp * t, by = ty + sp * t, bz = oz - fz * cp * t;
    if (camWalls ? camWalls.blocksPoint(bx, by, bz) : world.blocksPoint(bx, by, bz)) {
      d = Math.max(0.8, t - 0.4);
      break;
    }
  }
  cam.dist += (d - cam.dist) * Math.min(1, dt * (d < cam.dist ? 20 : 4));
  camera.position.set(ox - fx * cp * cam.dist, Math.max(0.4, ty + sp * cam.dist), oz - fz * cp * cam.dist);
  if (tower.inside && !current) tower.clampCamera(camera.position, player.y);
  const camRoom = room();
  if (camRoom && !current) camRoom.clampCamera(camera.position, player.y);
  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt);
    const k = camShake * 0.6;
    camera.position.x += (rand() - 0.5) * k;
    camera.position.y += (rand() - 0.5) * k;
    camera.position.z += (rand() - 0.5) * k;
  }
  camera.lookAt(ox + fx * 2, ty + 0.1, oz + fz * 2);
  const zoom = !current && weapons.def && input.mouse(2) && input.locked ? weapons.def.aimFov : 62;
  const fov = current ? 62 + Math.min(1, Math.abs(current.speed) / current.spec.maxSpeed) * 10 : zoom;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 2);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
}

// ---------- Simulation ----------
let last = performance.now();
let elapsed = 0;

function startle(r: Resident, fromX: number, fromZ: number): void {
  if (r.barkCooldown > 0) return;
  r.barkCooldown = 8;
  if (rand() < 0.6) r.greet(dialogue.pick('startled'), fromX, fromZ);
}

/** Residents get out of the way of fast cars in front of them, and scatter when you honk. */
function residentReactions(v: Vehicle, horn: boolean): void {
  const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
  for (const r of residents) {
    const dx = r.x - v.x, dz = r.z - v.z;
    const ahead = dx * fx + dz * fz;
    const lat = -dx * fz + dz * fx; // + means right of the vehicle
    if (horn && Math.hypot(dx, dz) < 16) {
      r.flee(dx, dz, 1.6);
      if (rand() < 0.6) streetLine(r, 'complaint');
    } else if (Math.abs(v.speed) > 6 && ahead > 0 && ahead < 10 + Math.abs(v.speed) * 0.6 && Math.abs(lat) < 3) {
      const s = lat >= 0 ? 1 : -1;
      r.flee(-fz * s, fx * s, 1.1);
      startle(r, v.x, v.z);
    }
  }
}

/** Advances the game by dt seconds (input, actors, jobs, camera). Rendering happens separately. */
function step(dt: number): void {
  elapsed += dt;
  if (noticeTimer > 0 && (noticeTimer -= dt) <= 0) $('notice').hidden = true;
  if (subtitleTimer > 0 && (subtitleTimer -= dt) <= 0) $('subtitle').hidden = true;
  if (introTimer > 0 && (introTimer -= dt) <= 0) $('intro').hidden = true;
  let horn = false;
  phone.update(dt);
  updateStory(dt);
  if (mode === 'play') {
    if (input.hit('KeyP', 'Escape')) setMode('pause');
    else if (input.hit('KeyC')) usePhone();
    else if (input.hit('KeyM')) openMap('play');
    else if (input.hit('KeyJ')) openHub();
    else if (input.hit('KeyE')) interact();
    // Horn sounds for as long as H is held (at least a short toot).
    if (input.hit('KeyH') && current) {
      audio.horn(true);
      hornHeld = 0.25;
      horn = true;
    }
    if (hornHeld > 0) {
      hornHeld -= dt;
      if (input.down('KeyH') && current) hornHeld = Math.max(hornHeld, 0.02);
      if (hornHeld <= 0 || !current) {
        hornHeld = 0;
        audio.horn(false);
      }
    }
    if ((current || flying) && input.hit('KeyT')) {
      radio.tune(input.down('ShiftLeft', 'ShiftRight') ? -1 : 1);
      save.data.radio = radio.index;
      persist();
    }
    if (!current && !flying && mode === 'play') {
      for (let k = 1; k <= 6; k++) {
        if (!input.hit(`Digit${k}`)) continue;
        drawByKey(k);
        if (wheelOpen) wheelPick = weapons.drawn;
      }
      if (input.hit('KeyQ', 'KeyX')) toggleHolster();
      if (input.hit('TouchWeapon')) cycleWeapon();
      // Weapon wheel: hold Tab, steer with the mouse (or press 1-6), release to equip.
      if (input.down('Tab') && !wheelOpen && rangeRun.state === 'idle') {
        wheelOpen = true;
        wheelVec.x = wheelVec.y = 0;
        wheelPick = weapons.drawn;
      } else if (!input.down('Tab') && wheelOpen) closeWheel(true);
      if (input.hit('KeyR') && weapons.reload()) audio.sfx('reload');
    }
  } else if (mode === 'phone') {
    if (phone.state === 'call') {
      if (input.hit('Escape', 'KeyK')) phone.skip();
      else if (input.hit('Space', 'Enter')) phone.advance();
      else if (input.hit('Digit1') && phone.call?.choices?.[0]) phone.choose(phone.call.choices[0].id);
      else if (input.hit('Digit2') && phone.call?.choices?.[1]) phone.choose(phone.call.choices[1].id);
    } else if (phone.state === 'apps') {
      if (input.hit('Escape', 'KeyC')) phone.close();
    }
    if (!phone.busy && mode === 'phone') resume();
  } else if (mode === 'missions') {
    if (input.hit('Escape', 'KeyJ')) resume();
  } else if (mode === 'lift') {
    if (input.hit('Escape')) resume();
    else {
      for (let k = 1; k <= LEVEL_KEYS.length; k++) {
        if (!input.hit(`Digit${k}`)) continue;
        rideLift(k - 1);
        break;
      }
    }
  } else if (mode === 'cutscene') {
    // Introductions: everything else waits; Space, Enter or Esc skips.
    if (input.hit('Space', 'Enter', 'Escape', 'KeyK')) endCutscene(true);
    else if (cut && !cut.update(dt, camera)) endCutscene(false);
    else {
      updateCutsceneText();
      if (lastIntro && cut) lastIntro.t = cut.t;
    }
  } else if (mode === 'map') {
    if (input.hit('KeyM', 'Escape')) closeMap();
  } else if (mode === 'wardrobe') {
    if (input.hit('Escape')) closeWardrobe();
  } else if (mode === 'offer' || mode === 'shop' || mode === 'armoury') {
    if (input.hit('Escape')) {
      offerDef = null;
      offerAction = null;
      offerDecline = null;
      resume();
    }
  }

  if (mode === 'play') {
    const move = { x: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), y: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) };
    const aiming = !current && !!weapons.drawn && input.mouse(2) && input.locked;
    if (aiming) {
      move.x *= 0.7;
      move.y *= 0.7;
    }
    runOverPeople();
    const upOfficers = combat.officers.filter((o) => !o.down);
    const upResidents = residents.filter((r) => !r.isDown);
    const people = [...upResidents, ...upOfficers, ...crews.flatMap((c) => c.members.filter((m) => !m.down))].map((r) => ({ x: r.x, z: r.z }));
    const residentObs: Obstacle[] = [...[...upResidents, ...upOfficers].map((r) => ({ x: r.x, z: r.z, r: 0.4, ref: r as unknown })), ...crews.flatMap((c) => c.obstacles())];
    traffic.target = area || (runner?.state === 'active' && runner.def?.rival) ? 0 : trafficBase; // roads closed for the showdown
    const rp = runner?.state === 'active' ? runner.rivalPose() : null;
    if (rp) rivalCar.drive(rp.x, rp.z, rp.heading, runner!.rivalSpeed, false, dt);
    else if (rivalCar.x !== info.rivalParking.x || rivalCar.z !== info.rivalParking.z) rivalCar.place(info.rivalParking.x, info.rivalParking.z, info.rivalParking.heading);
    const trafficObs = [...roadTraffic.obstacles(), ...rivalCar.circles()];
    updateCrafts(dt);
    updateCrewLife(dt);
    if (crewTalking) {
      crewTalking.talk(false);
      crewTalking = null;
    }
    house.update(dt);
    lagosHouse.update(dt, player.x, player.y, player.z, headK);
    chairman.update(dt, env.night);
    gymRest = Math.max(0, gymRest - dt);
    // Afterglow's music: full inside, a muffled thump near the door, silent further away.
    clubMusic.update(club.inside, Math.hypot(player.x - CLUB.door.x, player.z - CLUB.door.z), dt);
    club.beat = clubMusic.time;
    club.update(dt, player.x, player.z);
    armsShop.update(dt, player.x, player.z);
    updateClubRun(dt);
    const sprint = stamina.update(dt, input.down('ShiftLeft', 'ShiftRight') && !aiming && !current && !flying, Math.hypot(move.x, move.y) > 0.1);
    if (!current && !flying) {
      // Inside Harbour Heights the tower's walls, floors and stairs replace the street's.
      const rm = room();
      if (tower.inside) player.update(dt, move, sprint, input.hit('Space'), cam.yaw, tower, [], [], tower.ground);
      else if (rm) player.update(dt, move, sprint, input.hit('Space'), cam.yaw, rm, [], [], rm.ground);
      else if (lagosHouse.contains(player.x, player.z)) player.update(dt, move, sprint, input.hit('Space'), cam.yaw, lagosHouse, [], people, lagosHouse.ground);
      else player.update(dt, move, sprint, input.hit('Space'), cam.yaw, world, [...fleet, ...roadTraffic.vehicles(), rivalCar], people);
    }
    // Moved out of the tower some other way (hospital, a mission): leave its interior mode.
    if (tower.inside && (current || flying || Math.max(Math.abs(player.x - TOWER.cx), Math.abs(player.z - TOWER.cz)) > TOWER.half + 1.5)) tower.reset();
    const rmx = room();
    if (rmx && (current || flying || player.x < rmx.box.x0 - 1.5 || player.x > rmx.box.x1 + 1.5 || player.z < rmx.box.z0 - 1.5 || player.z > rmx.box.z1 + 1.5)) {
      rmx.reset();
      if (rmx === club) club.setCrewDancing(null);
    }

    // Weapons: hold to fire automatics, click for the rest. Mouse fire needs the captured mouse; F always works.
    weapons.update(dt);
    if (!current && weapons.def && mode === 'play') {
      const trig = weapons.def.auto ? (input.mouse(0) && input.locked) || input.down('KeyF') : (input.mouseHit(0) && input.locked) || input.hit('KeyF');
      if (trig) fireWeapon();
    }
    aimHold = Math.max(0, aimHold - dt);

    const drive: DriveInput | null = current ? { throttle: move.y, steer: move.x, handbrake: input.down('Space') } : null;
    for (const v of fleet) {
      v.frozen = v === current && (!!runner?.freezeVehicle || !!companion?.boarding);
      // A fast car doesn't stop for people: it knocks them down (runOverPeople) instead.
      const others: Obstacle[] = [...(v.hasDriver && Math.abs(v.speed) > 3 ? [] : residentObs), ...trafficObs];
      for (const o of fleet) if (o !== v) others.push(...o.circles());
      if (pursuit.active) others.push(...pursuit.obstacles());
      if (!current) others.push({ x: player.x, z: player.z, r: player.radius, ref: player });
      if (!v.group.visible) continue; // burnt out, waiting to come back
      const parkedAndClear = v !== current && v.speed === 0 && !others.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < v.spec.len / 2 + o.r + 1.2);
      if (parkedAndClear) continue; // nothing touching a parked vehicle: skip its physics
      const impact = v.update(dt, v === current ? drive : null, world, others, elapsed);
      if (!impact) continue;
      if (roadTraffic.owns(impact.hit)) roadTraffic.hit(impact.hit);
      if (impact.hit instanceof Vehicle && fleet.includes(impact.hit) && impact.speed > 6) impact.hit.damage((impact.speed - 6) * 0.8);
      if (impact.hit instanceof Resident) impact.hit.flee(impact.hit.x - v.x, impact.hit.z - v.z, 1.2);
      if (v === current) {
        if (impact.speed > 6) audio.sfx('crash');
        if (runner?.boundVehicle === v.id) runner.cargoHit(impact.speed);
      }
    }
    runOverPeople();
    if (current) seatDriver(current, dt);
    // Night Exit: patrol cars chase whatever you are in (or you, on foot).
    if (pursuit.active) {
      const me = current ?? player;
      const patrolObs: Obstacle[] = [...residentObs, ...trafficObs];
      for (const o of fleet) if (o.group.visible) patrolObs.push(...o.circles());
      if (!current) patrolObs.push({ x: player.x, z: player.z, r: player.radius, ref: player });
      pursuit.update(dt, { x: me.x, z: me.z, heading: me.heading, speed: current ? current.speed : player.speed, inVehicle: !!current }, roadGraph(bridgeOpen), world, patrolObs, elapsed);
      for (const c of pursuit.cars) c.pushOut(player, player.radius);
    }
    updateCompanion(dt);
    sites.update(dt);
    tower.update(dt, player.x, player.z, player.y);
    audio.engine(current ? current.speed : flying ? (flying.kind === 'heli' ? 12 + flying.y * 0.05 : flying.speed) : null, drive?.throttle ?? (flying ? Math.abs(craftInput().throttle) : 0));
    radio.setActive(!!current || !!flying);
    // See further from the air.
    const fog = scene.fog as THREE.Fog;
    const air = flying && flying.kind !== 'boat' ? Math.min(1, Math.max(0, flying.y - 8) / 60) : 0;
    fog.near = env.fogNear + air * 120;
    fog.far = env.fogFar + air * 520;
    radio.update(dt);
    pingTimer = Math.max(0, pingTimer - dt);
    if (wheelOpen && (current || flying)) closeWheel(false);
    if (current) residentReactions(current, horn);

    const focus = current ?? player;
    const forTraffic: Obstacle[] = [...residentObs];
    for (const v of [...fleet, rivalCar]) if (v.group.visible) forTraffic.push(...v.circles());
    if (!current) forTraffic.push({ x: player.x, z: player.z, r: player.radius });
    const honk = (x: number, z: number) => {
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < 60) audio.sfx('horn2', 1 - d / 60);
    };
    traffic.update(dt, focus, forTraffic, honk);
    if (area) {
      // Stream map tiles round you, run the area's traffic, and apply BRT lanes and potholes.
      area.update(focus.x, focus.z);
      areaTraffic?.update(dt, focus, forTraffic, honk);
      brtTraffic?.update(dt, focus, forTraffic, honk);
      areaRoadEffects(dt);
    }

    const blockers = [{ x: player.x, z: player.z, r: current ? 0 : player.radius }];
    const pushers = [...fleet, ...roadTraffic.vehicles(), rivalCar];
    for (const r of residents) {
      r.update(dt, world, blockers);
      for (const v of pushers) v.pushOut(r, r.radius);
    }

    // Street voices: bumping into people, standing in their way, or passing close by.
    if (!current) {
      for (const r of residents) {
        if (r.barkCooldown > 0 || r.talkTimer > 0) continue;
        const d = Math.hypot(r.x - player.x, r.z - player.z);
        if (d < player.radius + r.radius + 0.15 && player.speed > 1.5) streetLine(r, player.speed > 5 ? 'complaint' : 'excuse');
        else if (r.blockedTimer > 0.8) {
          r.blockedTimer = 0;
          streetLine(r, 'excuse');
        } else if (d < 3 && player.speed < 3.5 && rand() < dt * 0.15) streetLine(r, 'greeting');
      }
    }

    // Heat and the patrol unit.
    combat.update(dt, { x: focus.x, z: focus.z, vehicleSpeed: current ? current.speed : null, sprinting: !current && player.speed > 5 });
    for (const o of combat.officers) for (const v of pushers) v.pushOut(o, o.radius);

    // Range Day
    if (rangeRun.state !== 'idle') {
      const ev = rangeRun.update(dt);
      if (rangeRun.state === 'countdown') {
        const n = Math.ceil(rangeRun.countdown);
        if (n !== rangeCount) {
          rangeCount = n;
          const el = $('countdown');
          el.hidden = false;
          el.textContent = String(n);
          audio.sfx('count');
        }
      }
      if (ev === 'go') {
        $('countdown').textContent = 'GO!';
        audio.sfx('go');
        setTimeout(() => ($('countdown').hidden = true), 700);
      }
      const a = RANGE.area;
      if (ev === 'done') endRange();
      else if (player.x < a.minX || player.x > a.maxX || player.z < a.minZ || player.z > a.maxZ) endRange('You left the firing line');
    }

    runner?.update(dt, {
      inVehicle: !!current || !!flying,
      vehicleKind: flying?.kind ?? current?.kind ?? null,
      vehicleId: flying?.id ?? current?.id ?? null,
      vehicleWrecked: !!current?.wrecked || !!flying?.wrecked,
      x: focus.x,
      z: focus.z,
      speed: flying ? (flying.kind === 'heli' ? Math.hypot(flying.vx, flying.vz) + Math.abs(flying.vy) : flying.speed) : current ? current.speed : player.speed,
      y: flying ? flying.y : 0,
      grounded: flying ? flying.grounded : true,
      usePressed: input.hit('KeyE'),
      useHeld: input.down('KeyE'),
      pursuerDist: pursuit.active ? pursuit.nearest : null,
      busted: pursuit.active && pursuit.caught >= 1,
    }, elapsed);
    parcel.visible = !current && runner?.state === 'active' && runner.cargo !== null;

    updateFires(dt);
    updateFleeing(dt);
    updateStains(dt);
    if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) restoreFarProps();
    save.data.carHealth = hatch.wrecked || !hatch.group.visible ? 100 : Math.round(hatch.healthPct * 100);

    // Chidi's Workshop: stop in the bay to open the shop.
    if (current && mode === 'play') {
      const b = WORKSHOP.bay;
      const d = Math.hypot(current.x - b.x, current.z - b.z);
      if (d > b.r + 3) shopArmed = true;
      if (d < b.r && Math.abs(current.speed) < 1.5 && shopArmed) {
        shopArmed = false;
        renderShop();
        setMode('shop');
      }
    }
  } else {
    audio.engine(null, 0);
    if (mode === 'title') traffic.update(dt, { x: 0, z: 20 }, [], () => undefined);
  }
  if (touch) {
    const ctx: TouchContext = flying ? flying.kind : current ? 'car' : weapons.drawn ? 'armed' : 'foot';
    touch.update(mode === 'play', ctx);
  }
  syncWeaponVisual(mode === 'play' && !current && !!weapons.drawn && input.mouse(2) && input.locked, dt);
  updateFx(dt);
  hurtFlash = Math.max(0, hurtFlash - dt);
  crossHit = Math.max(0, crossHit - dt);

  if (mode === 'title' || mode === 'loading') {
    const a = elapsed * 0.04;
    camera.position.set(Math.cos(a) * 90, 60, 20 + Math.sin(a) * 90);
    camera.lookAt(0, 6, 20);
    sky.position.copy(camera.position);
  } else if (mode === 'wardrobe') wardrobeCamera(dt);
  else if (mode === 'cutscene') sky.position.copy(camera.position);
  else updateCamera(dt);

  // Debug/look-dev camera (tests and screenshots): held until cleared.
  if (debugCam) {
    camera.position.set(debugCam[0], debugCam[1], debugCam[2]);
    camera.lookAt(debugCam[3], debugCam[4], debugCam[5]);
  }
  // Lagos time of day and weather: sun or moon, sky, fog, rain, lit windows.
  // Indoors (Harbour Heights, the crew house, the club): no rain falling, no street labels through the walls.
  env.indoors = tower.inside || !!room();
  $('labels').style.visibility = room() ? 'hidden' : '';
  env.update(dt, camera.position);
  if (env.envVersion !== envSeen && scene.environment && skyEnv) {
    envSeen = env.envVersion;
    skyEnv.dispose();
    skyEnv = skyEnvironment(renderer, skyU);
    scene.environment = skyEnv;
  }
  const fx0 = mode === 'title' ? 0 : current ? current.x : player.x;
  const fz0 = mode === 'title' ? 20 : current ? current.z : player.z;
  // Headlights after dark: every car's lamps glow and throw a beam; the car you drive lights the road.
  const lampsOn = THREE.MathUtils.smoothstep(env.night, 0.25, 0.7);
  setNightLights(lampsOn);
  headK = lampsOn;
  streetLights.update(lampsOn, fx0, fz0, renderer.domElement.height);
  for (const v of [...fleet, rivalCar]) v.showBeams(lampsOn > 0.01); // parked ones (moving ones switch in sync())
  headSpot.intensity = current && !current.wrecked ? lampsOn * 240 : 0;
  if (current) {
    const c = Math.cos(current.heading), sn = Math.sin(current.heading), f = current.spec.len / 2;
    headSpot.position.set(current.x + c * f, 1.0, current.z + sn * f);
    headSpot.target.position.set(current.x + c * (f + 18), 0, current.z + sn * (f + 18));
  }
  // Sun and shadows follow whatever the camera is looking at.
  const fx = mode === 'title' ? 0 : current ? current.x : player.x;
  const fz = mode === 'title' ? 20 : current ? current.z : player.z;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + SUN_DIR.x * 200, SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
  input.endFrame();
}

// Adaptive quality: if the machine struggles, drop the glow, lower resolution, then turn shadows off and thin traffic.
let fpsFrames = 0;
let fpsTime = 0;
function adaptQuality(dt: number): void {
  if (mode !== 'play') return;
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime < 3) return;
  const fps = fpsFrames / fpsTime;
  fpsFrames = 0;
  fpsTime = 0;
  if (fps < 40 && post.dropBloom()) {
    console.info('Low frame rate: neon glow off.');
  } else if (fps < 40 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.5);
    renderer.setPixelRatio(pixelRatio);
    resize();
  } else if (fps < 28 && renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    trafficBase = Math.min(trafficBase, 6);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    console.info('Low frame rate: shadows off, lighter traffic.');
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw);
  step(dt);
  adaptQuality(Math.min(raw, 1));
  updateHud(dt);
  if (post.enabled) post.render(dt);
  else renderer.render(scene, camera);
}

// ---------- HUD ----------
const STEP_TO_MAP: Record<StepMarker, MarkerKind> = { start: 'start', checkpoint: 'checkpoint', pickup: 'pickup', dropoff: 'dropoff', stop: 'start' };

/** The resident who offers the next job (shown with "!"), if no job is running. */
function jobGiver(): Resident | null {
  // The Chairman: residents no longer offer jobs; the Chairman's people call you instead.
  return null;
}

function mapMarkers(full: boolean): MapMarker[] {
  const markers: MapMarker[] = [];
  const giver = jobGiver();
  if (!full) {
    for (const r of residents) if (r !== giver) markers.push({ x: r.x, z: r.z, kind: 'person' });
    for (const v of roadTraffic.vehicles()) markers.push({ x: v.x, z: v.z, kind: 'traffic' });
  }
  for (const v of fleet) if (v !== current && v.group.visible && !v.wrecked && (v === hatch || v === danfo || v === saloon)) markers.push({ x: v.x, z: v.z, kind: v === danfo ? 'danfo' : 'car' });
  if (runner?.state === 'active' && runner.def?.rival) markers.push({ x: rivalCar.x, z: rivalCar.z, kind: 'rival' });
  if (full) for (const r of residents) if (SHOPKEEPERS[r.name]) markers.push({ x: r.x, z: r.z, kind: 'shop' });
  if (full && !area) {
    markers.push({ x: -80, z: 0, kind: 'range' });
    markers.push({ x: -84, z: -80, kind: 'hospital' });
  }
  if (!area) for (const c of crafts) if (c !== flying && !c.wrecked) markers.push({ x: c.x, z: c.z, kind: 'craft' });
  for (const o of combat.officers) if (!o.down) markers.push({ x: o.x, z: o.z, kind: 'officer' });
  if (giver) markers.push({ x: giver.x, z: giver.z, kind: 'giver' });
  if (!area && (summonsDone() || summonsActive())) {
    markers.push({ x: MANSION.gate.x, z: MANSION.gate.z - 20, kind: 'boss' });
    if (full) markers.push({ x: HOTEL.door.x, z: HOTEL.door.z + 6, kind: 'hotel' });
  }
  if (!area) markers.push({ x: TOWER.cx, z: TOWER.cz, kind: 'tower' });
  if (!area) {
    // Crews: the house (yours once you join), the club, the gun shop, and each crew on its turf (full map).
    markers.push({ x: -15, z: -61, kind: 'crewhouse' }, { x: CLUB.door.x, z: -62, kind: 'club' }, { x: 14, z: -57, kind: 'gunshop' });
    if (full) for (const c of crews) markers.push({ x: c.leader.x, z: c.leader.z, kind: `crew-${c.def.id}` as MarkerKind });
  }
  if (runner?.state === 'idle' && !area) {
    for (const def of startPads.keys()) if (def !== tracked && acceptedJobs.has(def.id) && full) markers.push({ x: def.location!.x, z: def.location!.z, kind: 'mission' });
    if (tracked) {
      const loc = locationOf(tracked);
      markers.push({ x: loc.x, z: loc.z, kind: 'mission' });
    }
  }
  for (const c of pursuit.cars) markers.push({ x: c.x, z: c.z, kind: 'patrol' });
  const step = runner?.step;
  if (step?.kind === 'goto') {
    const next = runner!.nextPos();
    if (next) markers.push({ x: next.x, z: next.z, kind: 'next' });
    markers.push({ x: step.x!, z: step.z!, kind: STEP_TO_MAP[step.marker ?? 'checkpoint'] });
  }
  return markers;
}

/** Route line to the current target along Harbour Bend and Marina Point roads (recomputed twice a second). */
function minimapRoute(me: { x: number; z: number }): [number, number][] {
  const t = compassTarget();
  if (!t || area) return [];
  const key = `${Math.round(t.x)},${Math.round(t.z)}`;
  const now = performance.now();
  if (key !== routeCache.key || now - routeCache.t > 500) routeCache = { key, pts: routeTo(roadGraph(bridgeOpen), me, t), t: now };
  routeCache.pts[0] = [me.x, me.z];
  return routeCache.pts;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Context key hints along the bottom (they change on foot, with a weapon, driving and flying). */
let lastHints = '';
function updateKeyHints(): void {
  const k = (key: string, what: string) => `<span><kbd>${key}</kbd>${what}</span>`;
  let l: string, r: string;
  if (flying) {
    l = flying.kind === 'plane' ? k('W/S', 'Throttle') + k('A/D', 'Bank') + k('↑/↓', 'Nose') : flying.kind === 'heli' ? k('Space/Shift', 'Up/Down') + k('W/S', 'Lean') + k('A/D', 'Turn') : k('W/S', 'Throttle') + k('A/D', 'Steer');
    r = k('E', 'Get out') + k('T', 'Radio') + k('M', 'Map');
  } else if (current) {
    l = k('W/S', 'Drive') + k('A/D', 'Steer') + k('Space', 'Handbrake');
    r = k('E', 'Get out') + k('H', 'Horn') + k('T', 'Radio') + k('C', 'Phone') + k('M', 'Map');
  } else if (wheelOpen) {
    l = k('Mouse', 'Select') + k('1–6', 'Pick');
    r = k('Release Tab', 'Equip');
  } else if (weapons.drawn) {
    l = k('Right click', 'Aim') + k('Left click', 'Fire') + k('R', 'Reload');
    r = k('Q/X', 'Holster') + k('Tab', 'Weapons') + k('E', 'Interact');
  } else {
    l = k('WASD', 'Move') + k('Shift', 'Sprint') + k('Space', 'Jump');
    r = k('E', 'Interact / Enter car') + k('Tab', 'Weapons') + k('C', 'Phone') + k('J', 'Missions') + k('M', 'Map');
  }
  const html = l + '|' + r;
  if (html === lastHints) return;
  lastHints = html;
  $('keys-l').innerHTML = l;
  $('keys-r').innerHTML = r;
}

/** Draw the weapon wheel: six slots round a hub, the picked one highlighted. */
function updateWheel(): void {
  const w = $('wheel');
  w.hidden = !wheelOpen || mode !== 'play';
  if (w.hidden) return;
  const ring = $('wheel-ring');
  if (ring.childElementCount !== WHEEL_ORDER.length) {
    ring.innerHTML = '';
    WHEEL_ORDER.forEach((id, i) => {
      const a = (i / WHEEL_ORDER.length) * Math.PI * 2;
      const el = document.createElement('div');
      el.className = 'wseg';
      el.dataset.weapon = id;
      el.style.left = `${50 + Math.sin(a) * 32}%`;
      el.style.top = `${50 - Math.cos(a) * 32}%`;
      el.innerHTML = `<svg viewBox="0 0 64 32" aria-hidden="true"><path d="${WEAPON_ICONS[WEAPONS[id].cls]}"/></svg><b></b><small></small>`;
      el.addEventListener('mouseenter', () => (wheelPick = id));
      ring.append(el);
    });
  }
  for (const el of [...ring.children] as HTMLElement[]) {
    const id = el.dataset.weapon as WeaponId;
    const d = WEAPONS[id];
    const have = weapons.owns(id) || (weapons.loaner && id === 'egret');
    el.classList.toggle('locked', !have);
    el.classList.toggle('sel', wheelPick === id);
    el.querySelector('b')!.textContent = `${d.key} · ${d.name.split(' ')[0]}`;
    const res = weapons.reserve(id);
    el.querySelector('small')!.textContent = !have ? 'Locked' : d.cls === 'melee' ? 'Melee' : `${weapons.mag(id)} / ${res === Infinity ? '∞' : res}`;
  }
  $('wheel-name').textContent = wheelPick ? WEAPONS[wheelPick].name : 'Holster';
}

function updateMinimap(): void {
  const me = flying ?? current ?? player;
  const span = flying ? 260 + Math.min(1, Math.abs(flying.speed) / 60) * 200 : current ? 150 + Math.min(1, Math.abs(current.speed) / current.spec.maxSpeed) * 90 : 110;
  minimap.draw(me.x, me.z, me.heading, cam.yaw, span, mapMarkers(false), minimapRoute(me));
}

/** Where the compass should point: the objective, the vehicle you need, or the next job. */
function compassTarget(): { x: number; z: number; start: boolean } | null {
  if (clubRun && !clubRun.arrived) return current === clubRun.bus ? { x: CLUB.door.x, z: CLUB.door.z + 7, start: false } : { x: clubRun.bus.x, z: clubRun.bus.z, start: false };
  if (runner?.state === 'active') {
    const p = runner.objectivePos();
    if (p) return { ...p, start: false };
    const s = runner.step;
    if (s?.kind === 'enter' && !current) {
      if (s.vehicle === 'danfo') return { x: danfo.x, z: danfo.z, start: false };
      const craft = crafts.find((c) => c.kind === s.vehicle);
      if (craft) return flying === craft ? null : { x: craft.x, z: craft.z, start: false };
      const me = player;
      if (missionCar && !missionCar.wrecked && missionCar.group.visible) return { x: missionCar.x, z: missionCar.z, start: false };
      const v = fleet.filter((k) => !k.wrecked).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
      return v ? { x: v.x, z: v.z, start: false } : null;
    }
    return null;
  }
  if (tracked && runner?.state === 'idle') {
    const loc = locationOf(tracked);
    return { x: loc.x, z: loc.z, start: true };
  }
  const g = jobGiver();
  return g ? { x: g.x, z: g.z, start: true } : null;
}

function updateHud(_dt: number): void {
  if (mode === 'title' || mode === 'loading') return;
  updateMinimap();
  // Interaction prompt
  const focus = mode === 'play' && !tower.inside && !room() ? findFocus() : null;
  const prompt = $('prompt');
  const startHere = mode === 'play' ? missionStartHere() : null;
  const pressStep = mode === 'play' && runner?.state === 'active' && runner.pressHere(player.x, player.z, !!current) ? runner.step : null;
  if (pressStep) {
    prompt.innerHTML = `<kbd>E</kbd>${pressStep.hold ? 'Hold ' : ''}`;
    prompt.append(document.createTextNode(`${pressStep.hold ? 'E: ' : ''}${pressStep.label ?? 'Use'}${runner!.holdTime > 0 && pressStep.hold ? ` ${Math.round((runner!.holdTime / pressStep.hold) * 100)}%` : ''}`));
    prompt.hidden = false;
  } else if (mode === 'play' && tower.inside && !current) {
    const exit = tower.nearExit(player.x, player.z, player.y), lift = tower.inLift(player.x, player.z), bed = nearPenthouseBed();
    prompt.innerHTML = bed ? '<kbd>E</kbd>Sleep in your penthouse' : exit ? '<kbd>E</kbd>Exit to Harbour Bend Square' : lift ? `<kbd>E</kbd>Use the lift (you are on ${LEVEL_KEYS[tower.levelOf(player.y)]})` : '';
    prompt.hidden = !exit && !lift && !bed;
  } else if (mode === 'play' && room() && !current) {
    const sp = room()!.spotAt(player.x, player.z);
    prompt.innerHTML = sp ? '<kbd>E</kbd>' : '';
    if (sp) prompt.append(document.createTextNode(sp.label));
    prompt.hidden = !sp;
  } else if (mode === 'play' && !current && !flying && placePrompt()) {
    prompt.innerHTML = '<kbd>E</kbd>';
    prompt.append(document.createTextNode(placePrompt()!));
    prompt.hidden = false;
  } else if (mode === 'play' && !current && !flying && tower.nearDoorOutside(player.x, player.z)) {
    prompt.innerHTML = `<kbd>E</kbd>Enter ${TOWER.name}`;
    prompt.hidden = false;
  } else if (startHere) {
    prompt.innerHTML = '<kbd>E</kbd>';
    prompt.append(document.createTextNode(`${startHere.name}: ${startHere.cutscene ? 'watch the briefing' : 'start'}`));
    prompt.hidden = false;
  } else if (flying && mode === 'play') {
    prompt.innerHTML = `<kbd>E</kbd>Get out`;
    prompt.hidden = flying.kind === 'boat' ? Math.abs(flying.speed) > 3 : !flying.grounded || flying.speed > 4 || surfaceAt(craftEnv, flying.x, flying.z) > 0.5;
  } else if (current && mode === 'play') {
    prompt.innerHTML = current.wrecked ? `<kbd>E</kbd>Get out, it's on fire!` : `<kbd>E</kbd>Get out`;
    prompt.hidden = current.kmh > 20 && !current.wrecked;
  } else if (focus) {
    if (focus.kind === 'vehicle') prompt.innerHTML = `<kbd>E</kbd>Drive the ${focus.v === royale ? 'Royale GT' : vehicleLabel(focus.v)}${focus.v === royale && !royaleOpen() ? ' (locked)' : ''}`;
    else if (focus.kind === 'hijack') prompt.innerHTML = `<kbd>E</kbd>Hijack the ${vehicleLabel(focus.v)}`;
    else if (focus.kind === 'craft') prompt.innerHTML = `<kbd>E</kbd>${focus.c.kind === 'boat' ? 'Drive' : 'Fly'} the ${CRAFT_NAMES[focus.c.kind]}${craftBlocked(focus.c) ? ' (locked)' : ''}`;
    else {
      const job = runner?.offerFor(focus.r.name);
      const offer = job && runner!.state === 'idle' && runner!.status(job) !== 'locked';
      const special = focus.r.name === 'Coach Kola' ? ' about Range Day' : focus.r.name === 'Sade' ? ' at the arms counter' : '';
      prompt.innerHTML = `<kbd>E</kbd>${offer || special ? 'Talk to' : 'Greet'} `;
      prompt.append(document.createTextNode(`${focus.r.name}${offer ? ' about a job' : special}`));
    }
    prompt.hidden = false;
  } else prompt.hidden = true;

  // Phase 4: health, armour, heat, weapon, crosshair
  const hp = $('hp-bar');
  hp.style.width = `${Math.round(combat.health)}%`;
  hp.className = combat.health < 30 ? 'bad' : '';
  $('armour-row').hidden = combat.armour <= 0;
  $('ar-bar').style.width = `${Math.round(combat.armour)}%`;
  const heat = $('heat');
  heat.hidden = combat.heat === 0;
  if (combat.heat > 0) {
    const stars = $('heat-stars');
    if (stars.childElementCount !== MAX_HEAT) stars.innerHTML = '<i></i>'.repeat(MAX_HEAT);
    [...stars.children].forEach((el, i) => el.classList.toggle('on', i < combat.heat));
    $('heat-note').textContent = combat.hidden ? `hiding ${Math.max(0, Math.ceil(combat.cooldownNeeded - combat.unseen))}s` : 'seen';
  }
  const wd = weapons.def;
  const onFoot = !current && mode === 'play';
  $('weapon').hidden = !wd || !!current;
  if (wd) {
    $('wp-name').textContent = weapons.loaner ? `${wd.name} (range loaner)` : wd.name;
    const res = weapons.reserve(wd.id);
    $('wp-ammo').textContent = wd.cls === 'melee' ? '—' : weapons.reloading > 0 ? 'Reloading…' : `${weapons.mag(wd.id)} / ${res === Infinity ? '∞' : res}`;
  }
  const ch = $('crosshair');
  ch.hidden = !(onFoot && wd && wd.cls !== 'melee');
  ch.classList.toggle('hit', crossHit > 0);
  $('hurt').hidden = hurtFlash <= 0;

  $('speed').hidden = !current && !flying;
  $('vhealth').hidden = !current && !flying;
  if (flying) {
    const alt = flying.kind === 'boat' ? '' : ` <small>ALT ${Math.round(Math.max(0, flying.y - surfaceAt(craftEnv, flying.x, flying.z)))} m</small>`;
    $('speed').innerHTML = `${flying.kmh}<small>km/h</small>${alt}`;
    $('vh-name').textContent = flying.kind === 'plane' ? 'Plane' : flying.kind === 'heli' ? 'Heli' : 'Boat';
    const bar = $('vh-bar');
    bar.style.width = `${Math.round(flying.health)}%`;
    bar.className = flying.health < 30 ? 'bad' : flying.health < 60 ? 'warn' : '';
  }
  // Radio dial (Phase 6)
  const rd = $('radio');
  rd.hidden = !(current || flying) || mode !== 'play';
  if (!rd.hidden) {
    $('radio-dial').textContent = radio.label;
    const cap = $('radio-cap');
    cap.hidden = radio.captionTimer <= 0 || !radio.station;
    cap.textContent = radio.caption;
  }
  if (current) {
    $('speed').innerHTML = `${Math.round(current.kmh)}<small>km/h</small>`;
    $('vh-name').textContent = vehicleLabel(current).replace(/^./, (c) => c.toUpperCase());
    const pct = current.healthPct;
    const bar = $('vh-bar');
    bar.style.width = `${Math.round(pct * 100)}%`;
    bar.className = pct < 0.3 ? 'bad' : pct < 0.6 ? 'warn' : '';
  }

  // Lagos-dusk HUD: area name, clock, stamina, "new job nearby" ping, key hints, weapon wheel.
  const here = flying ?? current ?? player;
  $('area-name').textContent = tower.inside ? `${TOWER.name} · ${LEVEL_NAMES[tower.levelOf(player.y)]}` : house.inside || lagosHouse.contains(here.x, here.z) ? `${(lagosHouse.active ? lagosHouse.owner : house.owner)?.name ?? 'Crew'} house` : club.inside ? 'Afterglow' : areaName(here.x, here.z, area ? area.manifest.name : null);
  $('clock').textContent = env.clockText;
  $('weather').textContent = env.weatherText;
  $('weather').dataset.kind = env.weather.kind;
  const st = $('st-bar');
  st.style.width = `${Math.round(stamina.value)}%`;
  st.classList.toggle('tired', stamina.exhausted);
  const nextGiver = jobGiver();
  if (nextGiver && nextGiver.name !== lastGiver && mode === 'play') {
    if (Math.hypot(nextGiver.x - here.x, nextGiver.z - here.z) < 160) pingTimer = 4.5;
    $('ping').textContent = `New job nearby: ${nextGiver.name}`;
  }
  lastGiver = nextGiver?.name ?? null;
  $('ping').hidden = pingTimer <= 0 || mode !== 'play';
  updateKeyHints();
  updateWheel();

  // Job panel + compass
  const m = $('mission');
  const compass = $('compass');
  if (clubRun && !clubRun.arrived && runner?.state !== 'active') {
    m.hidden = false;
    $('m-name').textContent = 'Club run';
    $('m-obj').textContent = current === clubRun.bus ? `Drive ${clubRun.crew.name} to Afterglow` : 'Get back in the minibus: the crew is waiting';
    $('m-time').textContent = '';
    $('m-extra').hidden = true;
  } else if (runner && runner.def && runner.state === 'active') {
    const def = runner.def;
    m.hidden = false;
    $('m-name').textContent = def.name;
    $('m-obj').textContent = runner.objectiveText();
    const t = runner.timerOn ? runner.timeLeft : def.timeLimit;
    $('m-time').textContent = fmtTime(t);
    $('m-time').classList.toggle('low', runner.timerOn && t < 15);
    const extra = $('m-extra');
    if (runner.cargo !== null) {
      extra.hidden = false;
      extra.textContent = `Parcel condition ${Math.round(runner.cargo)}%`;
      extra.className = runner.cargo < 30 ? 'bad' : runner.cargo < 60 ? 'warn' : '';
    } else if (def.type === 'shift' || def.type === 'errand') {
      extra.hidden = false;
      extra.textContent = `${def.type === 'shift' ? 'Fares collected' : 'Paid for drops'} ${fmtCash(runner.fares)}`;
      extra.className = '';
    } else if (def.rival) {
      const me = current ?? player;
      const lead = runner.timerOn ? runner.rivalLead(me.x, me.z) : null;
      extra.hidden = false;
      if (lead === null) {
        extra.textContent = `${def.rival.name} is lined up beside you`;
        extra.className = 'warn';
      } else {
        extra.textContent = lead > 0 ? `${def.rival.name} is ${Math.round(lead)} m ahead` : `You lead ${def.rival.name} by ${Math.round(-lead)} m`;
        extra.className = lead > 0 ? 'bad' : '';
      }
    } else extra.hidden = true;
  } else if (tracked && runner?.state === 'idle' && mode === 'play') {
    // A mission picked in the list: the card and compass lead you to its start.
    const loc = locationOf(tracked);
    m.hidden = false;
    $('m-name').textContent = `Selected: ${tracked.name}`;
    $('m-obj').textContent = tracked.giver ? `Talk to ${tracked.giver} (${loc.name})` : `Go to the start: ${loc.name}. Press E there.`;
    $('m-time').textContent = '';
    $('m-extra').hidden = true;
  } else if (rangeRun.state !== 'idle') {
    m.hidden = false;
    $('m-name').textContent = 'Range Day';
    $('m-obj').textContent = rangeRun.state === 'countdown' ? 'Get ready: targets pop up down the lanes' : 'Hit the targets';
    $('m-time').textContent = fmtTime(rangeRun.timeLeft);
    $('m-time').classList.toggle('low', rangeRun.state === 'live' && rangeRun.timeLeft < 10);
    const extra = $('m-extra');
    extra.hidden = false;
    const nm = rangeRun.nextMedal;
    extra.textContent = `Hits ${rangeRun.hits}${nm ? ` · ${MEDALS[nm.medal]} in ${nm.need}` : ' · gold!'}`;
    extra.className = rangeRun.medal ? '' : 'warn';
  } else if (mode === 'play' && runner?.state === 'idle' && !area && (phone.state === 'ringing' || (summonsDone() && runner.missions.some((j) => !j.crew && runner!.status(j) === 'available')))) {
    // No job running: the card says how work arrives (by phone).
    m.hidden = false;
    $('m-name').textContent = phone.state === 'ringing' ? 'Your phone is ringing' : 'The Chairman';
    $('m-obj').textContent = phone.state === 'ringing' ? 'Press C to answer' : 'Wait for his call, or press C and call Tunde for work';
    $('m-time').textContent = '';
    $('m-extra').hidden = true;
  } else m.hidden = true;
  // The Summons: the 8 PM clock until you reach the gate.
  const sc = $('story-clock');
  sc.hidden = !(summonsActive() && runner!.index <= 1 && mode === 'play');
  if (!sc.hidden) {
    const mins = runner!.index === 0 ? storyMinutes() : storyMinutes();
    sc.textContent = `${fmtClock(mins)} · be there by 20:00`;
    sc.classList.toggle('late', mins > 20 * 60 || arrivedLate);
  }
  // Pursuit meter (Night Exit): how many patrol cars, how close, and how near you are to being caught.
  const pu = $('pursuit');
  pu.hidden = !pursuit.active || m.hidden;
  if (pursuit.active) {
    const need = runner?.step?.clearOf ?? 30;
    const lost = pursuit.nearest >= need;
    pu.classList.toggle('lost', lost);
    pu.querySelector('b')!.textContent = pursuit.caught > 0.05 ? `Patrol pursuit · being caught ${Math.round(pursuit.caught * 100)}%` : lost ? 'Patrol pursuit · far enough to hide' : 'Patrol pursuit · shake them off';
    $('pu-text').textContent = `${pursuit.cars.length} patrol cars · nearest ${Number.isFinite(pursuit.nearest) ? Math.round(pursuit.nearest) : '—'} m (need ${need} m at the safehouse)`;
    $('pu-caught').style.width = `${Math.round(pursuit.caught * 100)}%`;
  }
  const target = compassTarget();
  const mdist = $('m-dist');
  mdist.hidden = !target || m.hidden;
  if (target) mdist.textContent = fmtDist(Math.hypot(target.x - here.x, target.z - here.z));
  if (target) {
    const me = current ?? player;
    const rel = Math.atan2(target.z - me.z, target.x - me.x) - cam.yaw;
    $('c-arrow').style.transform = `rotate(${rel}rad)`;
    $('c-dist').textContent = `${Math.round(Math.hypot(target.x - me.x, target.z - me.z))} m`;
    compass.classList.toggle('start', target.start);
    compass.hidden = false;
  } else compass.hidden = true;

  // World labels: objective, job givers, speech bubbles
  const step = runner?.step;
  if (step?.kind === 'goto' && step.label) {
    objLabel.textContent = step.label;
    placeLabel(objLabel, step.x!, step.onFoot ? 3.6 : 7.5, step.z!);
  } else objLabel.style.display = 'none';

  const idle = runner?.state === 'idle' && !area && mode !== 'cutscene';
  for (const [def, sp] of startPads) {
    const show = idle && runner!.status(def) !== 'locked' && acceptedJobs.has(def.id);
    sp.pad.visible = show;
    sp.label.classList.toggle('tracked', def === tracked);
    if (show) placeLabel(sp.label, def.location!.x, 3.4, def.location!.z);
    else sp.label.style.display = 'none';
  }
  trackBeam.visible = !!tracked && idle;
  if (tracked) {
    const loc = locationOf(tracked);
    trackBeam.position.set(loc.x, 30, loc.z);
  }

  const giver = jobGiver();
  for (const r of residents) {
    let el = jobLabels.get(r);
    if (r === giver) {
      if (!el) {
        el = worldLabel('job');
        el.textContent = '!';
        jobLabels.set(r, el);
      }
      placeLabel(el, r.x, r.talkTimer > 0 ? 3.4 : 2.6, r.z);
    } else if (el) el.style.display = 'none';
  }

  for (const r of residents) {
    let el = bubbles.get(r);
    if (r.talkTimer > 0 && r.line) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'bubble';
        labels.append(el);
        bubbles.set(r, el);
      }
      el.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = r.name;
      el.append(b, document.createTextNode(r.line));
      placeLabel(el, r.x, 2.3, r.z);
    } else if (el) {
      el.remove();
      bubbles.delete(r);
    }
  }

  $('lockhint').hidden = !(mode === 'play' && !input.locked && elapsed > 1 && !lockHintDismissed);
  refreshCash();
}
let lockHintDismissed = false;
canvas.addEventListener('mousedown', (e) => { if (e.button === 2) lockHintDismissed = true; });

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight, pixelRatio);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
  if (mode === 'map') {
    const me = current ?? player;
    minimap.drawFull($<HTMLCanvasElement>('bigmap'), me.x, me.z, current ? current.heading : player.heading, mapMarkers(true));
  }
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// ---------- Boot ----------
(async () => {
  // BLK KNG, the main player: load his model alongside the data (the code-built hero stands in meanwhile, or if it fails).
  // BLK KNG first and on his own (slow hosts: the kit models must not hold him up). Boot waits up to 20 s;
  // if he is still coming then, the code-built hero stands in until he arrives.
  const blkLoad = loadBlkKing(BASE);
  blkLoad.then((m) => player.rig.attachModel(m)).catch((e) => player.rig.attachModel(null, e));
  const model = Promise.race([blkLoad, new Promise<void>((ok) => setTimeout(ok, 20000))]).catch(() => undefined);
  // The rest of Bayo's kit (models.ts) loads after him, in the background; each piece swaps in when it
  // arrives and falls back to what the game drew before if it can't load.
  const kit = blkLoad.catch(() => undefined).then(() => Promise.allSettled([
    loadModel(BASE, 'green-suit').then((m) => player.rig.attachGreen(m)).catch((e) => { player.rig.attachGreen(null, e); throw e; }),
    loadModel(BASE, 'royale-gt').then((m) => royale.attachModel(m)),
    loadModel(BASE, 'eko-k7').then(() => (shownWeapon = null)), // redraw the rifle in hand as the EKO K7
    loadModel(BASE, 'eko-twin').then(() => (shownWeapon = null)), // and the shotgun as the EKO Twin
    loadModel(BASE, 'lagos-house').then((m) => {
      lagosHouse.attach(m, world);
      if (house.inside) exitHouse();
      house.retire();
    }),
  ])).then((r) => {
    for (const x of r) if (x.status === 'rejected') console.warn('Model kit:', x.reason);
    kitDone = true;
  });
  const [, loaded] = await Promise.all([dialogue.load(`${BASE}data/greetings.json`), loadMissions(`${BASE}data/missions.json`), voices.load(`${BASE}data/street_voices.json`), radio.load(`${BASE}data/radio.json`), audio.loadSounds(`${BASE}data/sounds.json`)]);
  await model;
  void kit;
  radio.index = Math.min(save.data.radio, radio.stations.length);
  combat.armour = save.data.armour;
  // Map areas made by tools/osm-import (none ship until a real extract has been imported).
  try {
    const r = await fetch(`${BASE}areas/index.json`);
    if (r.ok) areaIndex = ((await r.json()) as { areas?: typeof areaIndex }).areas ?? [];
  } catch {
    areaIndex = [];
  }
  if (areaIndex.length) {
    $('btn-area').hidden = false;
    $('btn-area').textContent = `${areaIndex[0].name} (real map preview)`;
  }
  const eq = save.data.weapons.equipped;
  if (eq && (WEAPON_IDS as string[]).includes(eq)) weapons.draw(eq as WeaponId);
  const missions = loaded.missions;
  setupMissions(missions, loaded.chapters);
  audio.setVolume(save.data.settings.masterVolume);
  hatch.health = hatch.spec.health * (save.data.carHealth / 100);
  applyPaint();
  traffic.populate(info.playerStart);
  refreshCash();
  const done = save.data.completedMissions.length;
  if (!save.persistent) $('save-note').textContent = 'This browser is blocking storage, so progress will only last for this session.';
  else if (save.migratedFrom !== null) $('save-note').textContent = `Your save from an earlier version was upgraded: ${fmtCash(save.data.cash)}, ${done} job${done === 1 ? '' : 's'} done.`;
  else if (done) $('save-note').textContent = `Saved progress: ${fmtCash(save.data.cash)} · ${done} of ${missions.length} jobs done.`;
  if (!missions.length) $('save-note').textContent = 'Job data could not be loaded; free roam only.';
  const play = $<HTMLButtonElement>('btn-play');
  play.disabled = false;
  play.textContent = 'Play';
  setMode('title');
  console.info(`Harbour Bend: ${info.instances} placeholder shapes, ${world.boxes.length} colliders, ${residents.length} residents, ${traffic.cars.length} traffic cars, ${missions.length} job(s).`);

  // Test hook for automated checks only: open the page with ?debug to expose it.
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      __gol: {
        get mode() { return mode; },
        get inVehicle() { return current ? current.kind : null; },
        get mission() {
          return runner ? { state: runner.state, id: runner.def?.id ?? null, index: runner.index, step: runner.step?.kind ?? null, timerOn: runner.timerOn, timeLeft: runner.timeLeft, cargo: runner.cargo, fares: runner.fares } : null;
        },
        get save() { return save.data; },
        /** Bayo's model kit: what loaded, the Royale GT and the mesh in your hand. */
        /** The Chairman: the phone, Crown Ridge and the story. */
        phone, chairman, ringSummons, startSummons, jobCall, acceptJob, get acceptedJobs() { return [...acceptedJobs]; }, get storyClock() { return fmtClock(storyMinutes()); }, get arrivedLate() { return arrivedLate; }, setStoryStart(t: number) { storyStart = t; },
        get guest() { return companion ? { boarding: companion.boarding, seated: companion.rig.seated, name: companion.rig.root.name } : null; },
        get storyRing() { return storyRing; }, set storyRing(v: number) { storyRing = v; }, get jobRing() { return jobRing; }, set jobRing(v: number) { jobRing = v; },
        crews, house, lagosHouse, club, armsShop, clubMusic, crewWorld, startCrewFight, callFollowers, dismissFollowers, get followers() { return followers; }, crewShots, get camPos() { return [camera.position.x, camera.position.y, camera.position.z]; }, get turfWar() { return turfWar ? { crew: turfWar.group.def.id, turf: turfWar.turf } : null; }, useSpot, startClubRun, openCrewTalk, enterHouse, exitHouse, enterClub, exitClub, openArmoury, stamina,
        get clubRun() { return clubRun ? { arrived: clubRun.arrived, riders: clubRun.riders.length } : null; },
        get clubBus() { return clubRun ? clubRun.bus : null; },
        get room() { return house.inside ? 'house' : club.inside ? 'club' : null; },
        touch, headlights: { spot: headSpot, get k() { return headK; } }, streetLights,
        models: { get loaded() { return [...modelsLoaded.keys()]; }, get done() { return kitDone; }, get held() { return heldMesh; } }, royale,
        world, player, hatch, danfo, saloon, parked, fleet, stolen, hijack, fires, rebuilds, props: info.props,
        get stainCount() { return stains.length; },
        get hornHeld() { return hornHeld; },
        audio,
        get fleeingCount() { return fleeing.length; }, traffic, residents, rivalCar, runner: () => runner,
        get bridgeOpen() { return bridgeOpen; },
        weapons, combat, rangeRun, voices,
        /** Three.js itself, for look-dev measurements (hero height). */
        THREE,
        get lastVoice() { return lastVoice; },
        get lastShot() { return lastShot; },
        /** Aim shots at a world point instead of the screen centre (null to go back). */
        setAim(p: { x: number; y: number; z: number } | null) { debugAim = p; },
        fire: fireWeapon, goDown, startRange, endRange,
        get heatHidden() { return combat.hidden; },
        /** Visual style pass: graphics quality and which post effects are running. */
        postfx: post,
        env, envLib: { sunPosition: (iso: string, h: number) => sunPosition(new Date(iso), h), lagosHours: (iso: string) => lagosHours(new Date(iso)), estimateWeather: (iso: string, h: number) => estimateWeather(new Date(iso), h), fromWeatherCode },
        hud: { stamina, get wheelOpen() { return wheelOpen; }, get wheelPick() { return wheelPick; }, steerWheel, get route() { return routeCache.pts; } },
        signs: info.signs,
        graphics: { style: STYLE, get choice() { return qualityChoice; }, get quality() { return quality; }, get post() { return post.state; }, get environment() { return !!scene.environment; }, set: (q: QualityChoice) => applyQuality(q) },
        /** Phase 6: aircraft, boat and radio. */
        plane, heli, boat, radio, enterCraft, exitCraft, craftInput, surfaceAt: (x: number, z: number) => surfaceAt(craftEnv, x, z),
        get flying() { return flying ? flying.kind : null; },
        setCamYaw(y: number) { cam.yaw = y; },
        get camYaw() { return cam.yaw; },
        /** Look-dev: point the camera at a spot for a frame (screenshots of characters). */
        lookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number) { debugCam = [px, py, pz, tx, ty, tz]; camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); camera.fov = 35; camera.updateProjectionMatrix(); if (post.enabled) post.render(0); else renderer.render(scene, camera); },
        /** Back to the game camera after lookAt. */
        freeCam() { debugCam = null; camera.fov = 62; camera.updateProjectionMatrix(); },
        /** Phase 5: load a map area by manifest URL (tests use a fixture imported into dist/). */
        enterArea, leaveArea,
        get area() { return area; },
        get areaTraffic() { return areaTraffic; },
        get brtTraffic() { return brtTraffic; },
        get fines() { return fines; },
        get camShake() { return camShake; },
        openWardrobe, equip, closeWardrobe,
        /** Missions update: mission list, introductions, Night Exit, Harbour Heights. */
        tower, sites, pursuit, FACILITY, openHub, selectMission, beginIntro, startMission, endCutscene, openLift, rideLift, enterTower, exitTower,
        get hubSel() { return hubSel?.id ?? null; },
        get tracked() { return tracked?.id ?? null; },
        get cutscene() { return cut; },
        get lastIntro() { return lastIntro; },
        get missionCar() { return missionCar; },
        get companion() { return companion; },
        get introReturn() { return introReturn; },
        hubStatus: (id: string) => { const d = runner?.byId(id); return d ? hubStatus(d) : null; },
        /** Set how many AI cars to keep on the road (tests use 0 for deterministic driving checks). */
        setTraffic(n: number) { trafficBase = n; },
        interact, enterVehicle, leaveVehicle,
        teleportVehicle(v: Vehicle, x: number, z: number, heading = v.heading) { v.place(x, z, heading); },
        teleportPlayer(x: number, z: number) { player.x = x; player.z = z; player.sync(); },
        /** Stand next to a resident, facing them. */
        approach(name: string) {
          const r = residents.find((k) => k.name === name);
          if (!r) return false;
          player.x = r.x - 1.2;
          player.z = r.z;
          player.heading = 0;
          player.sync();
          return true;
        },
        /** True if the player or a vehicle footprint overlaps a building or wall (should never happen). */
        overlapping() {
          return { player: world.overlapsCircle(player.x, player.z, player.radius * 0.8), hatch: world.overlapsCircle(hatch.x, hatch.z, 0.6), danfo: world.overlapsCircle(danfo.x, danfo.z, 0.6), saloon: saloon.circles().some((c) => world.overlapsCircle(c.x, c.z, c.r * 0.8)), parked: parked.some((v) => v.circles().some((c) => world.overlapsCircle(c.x, c.z, c.r * 0.8))) };
        },
        /** Advance game time without rendering (for slow, software-rendered test browsers). */
        simulate(seconds: number) { for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30); updateHud(0); },
      },
    });
  }
})();
