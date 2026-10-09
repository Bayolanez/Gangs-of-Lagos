import * as THREE from 'three';
import './style.css';
import { Audio } from './audio';
import { CollisionWorld } from './collision';
import { Dialogue } from './dialogue';
import { buildDistrict, roadGraph, WORKSHOP } from './district';
import { Input } from './input';
import { MapMarker, MarkerKind, Minimap } from './minimap';
import { ChapterDef, loadMissions, MarkerKind as StepMarker, MissionDef, MissionResult, MissionRunner } from './mission';
import { ITEMS, lookFor, Outfit, owns, SHOP_NAMES, Slot, SLOT_NAMES } from './outfits';
import { Resident } from './npc';
import { Player } from './player';
import { rng } from './placeholders';
import { SaveStore } from './save';
import { Traffic } from './traffic';
import { DriveInput, Obstacle, PAINTS, Vehicle } from './vehicles';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BASE = import.meta.env.BASE_URL;
const fmtCash = (n: number) => '₦' + Math.round(n).toLocaleString('en-US');
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const TOW_FEE = 500;
const REPAIR_PER_PCT = 20;

type Mode = 'loading' | 'title' | 'play' | 'pause' | 'settings' | 'result' | 'offer' | 'shop' | 'map' | 'wardrobe';
const SCREENS = ['title', 'pause', 'settings', 'result', 'offer', 'shop', 'map', 'wardrobe'] as const;
type Screen = (typeof SCREENS)[number];

// ---------- Renderer, scene, lighting ----------
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const HAZE = new THREE.Color('#d9c9ae');
scene.fog = new THREE.Fog(HAZE, 70, 430);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color('#5d8fc4') }, hor: { value: HAZE.clone() }, sun: { value: new THREE.Vector3(0.5, 0.55, 0.4).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sun; varying vec3 vD;
      void main(){ float h = clamp(vD.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
        float s = max(dot(normalize(vD), sun), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
  }),
);
scene.add(sky);
scene.add(new THREE.HemisphereLight('#cfe0f0', '#6b5a45', 1.1));
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
const SUN_DIR = new THREE.Vector3(0.5, 0.55, 0.4).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---------- World ----------
const world = new CollisionWorld();
const info = buildDistrict(scene, world);
const save = new SaveStore();
const audio = new Audio();
const input = new Input(canvas);
input.onGesture = () => audio.start();
const dialogue = new Dialogue();

const player = new Player(info.playerStart.x, info.playerStart.z, info.playerStart.heading);
scene.add(player.rig.root);
// A placeholder parcel the player carries during the delivery job.
const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: '#c79a5b', roughness: 0.9 }));
parcel.position.set(0.38, 1.05, 0);
parcel.visible = false;
player.rig.root.add(parcel);

/** Vehicles you can drive: your own hatchback and the bus park danfo. */
const hatch = new Vehicle('hatchback', info.carSpawn.x, info.carSpawn.z, info.carSpawn.heading);
const danfo = new Vehicle('danfo', info.danfoSpawn.x, info.danfoSpawn.z, info.danfoSpawn.heading);
const fleet = [hatch, danfo];
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
residents.forEach((r) => scene.add(r.rig.root));
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), world);
minimap.setBridgeOpen(bridgeOpen);
player.rig.dress(lookFor(save.data.outfit));

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
    $('reset-note').textContent = '';
    resetArmed = false;
    $('btn-reset').textContent = 'Reset progress';
    showScreen('settings');
  }
  if (next === 'offer' || next === 'shop' || next === 'map' || next === 'result' || next === 'wardrobe') showScreen(next);
}

function resume(): void {
  setMode('play');
  input.requestLock();
}

let settingsReturn: Mode = 'title';
let resetArmed = false;
$('btn-play').addEventListener('click', () => {
  audio.start();
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
canvas.addEventListener('click', () => { if (mode === 'play') input.requestLock(); });
document.addEventListener('pointerlockchange', () => {
  // Esc releases pointer lock in the browser; treat that as "pause".
  if (!document.pointerLockElement && mode === 'play' && lockWasHeld) setMode('pause');
  lockWasHeld = !!document.pointerLockElement;
});
let lockWasHeld = false;

// ---------- Pause: jobs list ----------
function renderPause(): void {
  const done = runner ? runner.missions.filter((m) => runner!.status(m) === 'done').length : 0;
  const total = runner?.missions.length ?? 0;
  $('pause-stats').textContent = `${fmtCash(save.data.cash)} · ${done} of ${total} jobs done · your car ${Math.round(hatch.healthPct * 100)}%${save.persistent ? '' : ' · storage blocked, progress is kept only for this session'}`;
  const list = $('pause-jobs');
  list.innerHTML = '';
  for (const def of runner?.missions ?? []) {
    const st = runner!.status(def);
    const active = runner!.state === 'active' && runner!.def === def;
    const li = document.createElement('li');
    li.className = active ? 'active' : st;
    const b = document.createElement('b');
    b.textContent = `${def.name} · ${def.giver}`;
    let text: string;
    if (active) text = `In progress: ${runner!.objectiveText()}`;
    else if (st === 'done') {
      const best = def.type === 'race' && save.data.bestTimes[def.id] !== undefined ? `best time ${fmtTime(save.data.bestTimes[def.id])}` : `best pay ${fmtCash(save.data.bestPay[def.id] ?? 0)}`;
      text = `Done · ${best} · replay pays ${fmtCash(def.reward.repeatCash)}${def.type === 'shift' ? ' plus fares' : ''}`;
    } else if (st === 'available') text = `${def.summary} Talk to ${def.giver}.`;
    else text = `Locked: finish ${runner!.byId(def.requires ?? '')?.name ?? 'the previous job'} first.`;
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
  $('btn-abandon').hidden = runner?.state !== 'active';
}

// ---------- Jobs ----------
let lastResultDef: MissionDef | null = null;
let offerDef: MissionDef | null = null;

function setupMissions(defs: MissionDef[], chapters: ChapterDef[]): void {
  runner = new MissionRunner(scene, defs, chapters, save, {
    onStart(def) {
      toast(`${def.name} · ${def.giver}`, def.summary, 6);
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
    },
    onResult(def, r) {
      lastResultDef = def;
      showResult(def, r);
    },
  });
}

function showResult(def: MissionDef, r: MissionResult): void {
  audio.sfx(r.success ? 'win' : 'fail');
  $('countdown').hidden = true;
  $('r-mission').textContent = `${def.name} · ${def.giver}`;
  const titles = { race: def.rival ? `YOU BEAT ${def.rival.name.toUpperCase()}` : 'RACE COMPLETE', delivery: 'DELIVERED', shift: 'SHIFT DONE', errand: 'ALL DROPS DONE' };
  $('r-title').textContent = r.success ? titles[def.type] : 'JOB FAILED';
  const parts: string[] = [];
  if (r.success) {
    if (def.type === 'race') parts.push(`Time ${fmtTime(r.time)}${r.best !== undefined ? ` · best ${fmtTime(r.best)}` : ''}.`);
    if (r.cargo !== null) parts.push(`Parcel condition ${Math.round(r.cargo)}%.`);
    if (r.fares) parts.push(`${def.type === 'errand' ? 'Drop pay' : 'Fares'} ${fmtCash(r.fares)}.`);
    parts.push(`Paid ${fmtCash(r.cash)}${r.firstClear ? '' : ' (repeat rate)'}.`);
    if (r.paintName) parts.push(`Unlocked: ${r.paintName} paint, now on your car.`);
    const next = runner?.nextJob;
    if (r.firstClear && next) parts.push(`${next.giver} has work for you now.`);
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
  parcel.visible = false;
  refreshCash();
  applyPaint();
  setMode('result');
  $('hud').hidden = false;
}

$('btn-continue').addEventListener('click', () => {
  runner?.dismiss();
  resume();
});
$('btn-retry').addEventListener('click', () => {
  if (!runner || !lastResultDef) return;
  const def = lastResultDef;
  runner.dismiss();
  const rt = def.retry;
  if (rt && current && !current.wrecked && (rt.vehicle !== 'danfo' || current.kind === 'danfo')) {
    current.place(rt.x, rt.z, rt.heading);
    cam.yaw = rt.heading;
  }
  runner.start(def);
  resume();
});

function openOffer(def: MissionDef): void {
  offerDef = def;
  const done = runner!.status(def) === 'done';
  $('o-giver').textContent = `${def.giver} has a job`;
  $('o-name').textContent = def.name.toUpperCase();
  $('o-intro').textContent = def.intro;
  const extras: string[] = [];
  if (def.type === 'delivery') extras.push('less if the parcel gets damaged');
  if (def.type === 'shift') extras.push('plus fares at every stop');
  if (def.type === 'errand') {
    const per = def.steps.find((k) => k.fare)?.fare ?? 0;
    extras.push(`plus ${fmtCash(per)} for every drop`);
  }
  const pay = `${fmtCash(done ? def.reward.repeatCash : def.reward.cash)}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  const paint = !done && def.reward.paint ? ` Unlocks ${PAINTS[def.reward.paint]?.name ?? def.reward.paint} paint.` : '';
  const best = done && def.type === 'race' && save.data.bestTimes[def.id] !== undefined ? ` Your best: ${fmtTime(save.data.bestTimes[def.id])}.` : '';
  const rival = def.rival ? ` Beat ${def.rival.name} to the finish; if he crosses first, you lose.` : '';
  $('o-terms').textContent = `${done ? 'Done before. Replay pays' : 'Pays'} ${pay}.${paint}${rival} Time limit ${fmtTime(def.timeLimit)} once you set off.${best}`;
  setMode('offer');
}
$('btn-accept').addEventListener('click', () => {
  if (!runner || !offerDef) return;
  runner.start(offerDef);
  offerDef = null;
  resume();
});
$('btn-decline').addEventListener('click', () => {
  offerDef = null;
  resume();
});

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
  const job = runner?.nextJob;
  if (job) toast(bridgeOpen && job.chapter === 2 ? 'Marina Point' : 'Harbour Bend', `${job.giver} has work for you. Follow the orange arrow and press E to talk.`, 9);
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

function openWardrobe(kind: WardrobeKind): void {
  if (current) return;
  wardrobeKind = kind;
  frameWardrobe();
  renderWardrobe();
  setMode('wardrobe');
}

function closeWardrobe(): void {
  const wasCreator = wardrobeKind === 'creator';
  save.data.lookChosen = true;
  persist();
  cam.yaw = player.heading;
  resume();
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

// ---------- Interaction ----------
type Focus = { kind: 'vehicle'; v: Vehicle } | { kind: 'npc'; r: Resident } | null;
function findFocus(): Focus {
  if (current) return null;
  let best: Focus = null;
  let bestScore = Infinity;
  const f = player.facing();
  for (const v of fleet) {
    if (v.wrecked || !v.contains(player.x, player.z, 1.4)) continue;
    const score = Math.hypot(v.x - player.x, v.z - player.z) - 2;
    if (score < bestScore) {
      bestScore = score;
      best = { kind: 'vehicle', v };
    }
  }
  for (const r of residents) {
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
  current = v;
  v.hasDriver = true;
  player.visible = false;
  cam.yaw = v.heading;
  cam.lookOffset = 0;
  audio.sfx('door');
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
      current = null;
      v.hasDriver = false;
      cam.yaw = v.heading;
      audio.sfx('door');
      return true;
    }
  }
  notice('No room to get out here');
  return false;
}

function say(r: Resident, line: string): void {
  r.greet(line, player.x, player.z);
  audio.sfx('greet');
  $('subtitle').textContent = `${r.name}: ${line}`;
  $('subtitle').hidden = false;
  subtitleTimer = 5;
}

function interact(): void {
  if (current) {
    leaveVehicle();
    return;
  }
  const f = findFocus();
  if (!f) return;
  if (f.kind === 'vehicle') return enterVehicle(f.v);
  const shop = SHOPKEEPERS[f.r.name];
  if (shop) {
    f.r.greet('', player.x, player.z);
    return openWardrobe(shop);
  }
  const job = runner?.offerFor(f.r.name);
  if (job && runner!.state === 'idle') {
    const st = runner!.status(job);
    if (st === 'locked') return say(f.r, job.lockedLine);
    f.r.greet('', player.x, player.z);
    return openOffer(job);
  }
  say(f.r, dialogue.pick(f.r.def.voice));
}

function tow(v: Vehicle): void {
  if (current === v) leaveVehicle(true);
  const spot = v.kind === 'danfo' ? WORKSHOP.tow.danfo : WORKSHOP.tow.hatchback;
  const fee = Math.min(TOW_FEE, save.data.cash);
  save.data.cash -= fee;
  save.data.stats.tows++;
  v.repair();
  v.health = v.spec.health * 0.25;
  v.place(spot.x, spot.z, spot.heading);
  if (player.visible && Math.hypot(player.x - v.x, player.z - v.z) > 30 && !current) {
    // You rode along with the tow truck.
    player.x = spot.x;
    player.z = spot.z + (spot.z < 0 ? -3.5 : 3.5);
    player.heading = spot.heading;
    player.sync();
    cam.yaw = spot.heading;
  }
  persist();
  refreshCash();
  notice(`Wrecked! Towed to Chidi's Workshop · fee ${fmtCash(fee)}`, 4);
}

// ---------- Camera ----------
function updateCamera(dt: number): void {
  const look = input.consumeLook();
  const s = save.data.settings;
  const k = 0.0024 * s.lookSensitivity;
  if (look.x !== 0 || look.y !== 0) {
    cam.yaw += look.x * k;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + look.y * k * (s.invertY ? -1 : 1), -0.15, 1.15);
    if (current) {
      cam.lookOffset += look.x * k;
      cam.lookHold = 1.4;
    }
  }
  let tx: number, ty: number, tz: number, dist: number, side: number;
  if (current) {
    cam.lookHold -= dt;
    if (cam.lookHold <= 0) cam.lookOffset *= Math.max(0, 1 - dt * 2.5);
    const target = current.heading + cam.lookOffset;
    let diff = target - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cam.yaw += diff * Math.min(1, dt * 4);
    tx = current.x; ty = current.spec.camHeight; tz = current.z;
    dist = current.spec.camDist + Math.abs(current.speed) * 0.08;
    side = 0;
  } else {
    tx = player.x; ty = player.y + 1.55; tz = player.z;
    dist = 4.6;
    side = 0.5;
  }
  const pitch = current ? Math.max(0.12, cam.pitch * 0.7) : cam.pitch;
  const fx = Math.cos(cam.yaw), fz = Math.sin(cam.yaw);
  const rx = Math.cos(cam.yaw + Math.PI / 2), rz = Math.sin(cam.yaw + Math.PI / 2);
  const ox = tx + rx * side, oz = tz + rz * side;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let d = dist;
  for (let t = 0.4; t <= dist; t += 0.25) {
    if (world.blocksPoint(ox - fx * cp * t, ty + sp * t, oz - fz * cp * t)) {
      d = Math.max(0.8, t - 0.4);
      break;
    }
  }
  cam.dist += (d - cam.dist) * Math.min(1, dt * (d < cam.dist ? 20 : 4));
  camera.position.set(ox - fx * cp * cam.dist, Math.max(0.4, ty + sp * cam.dist), oz - fz * cp * cam.dist);
  camera.lookAt(ox + fx * 2, ty + 0.1, oz + fz * 2);
  const fov = current ? 62 + Math.min(1, Math.abs(current.speed) / current.spec.maxSpeed) * 10 : 62;
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
      startle(r, v.x, v.z);
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
  if (mode === 'play') {
    if (input.hit('KeyP', 'Escape')) setMode('pause');
    else if (input.hit('KeyM')) openMap('play');
    else if (input.hit('KeyE')) interact();
    if (input.hit('KeyH') && current) {
      audio.sfx('horn');
      horn = true;
    }
  } else if (mode === 'map') {
    if (input.hit('KeyM', 'Escape')) closeMap();
  } else if (mode === 'wardrobe') {
    if (input.hit('Escape')) closeWardrobe();
  } else if (mode === 'offer' || mode === 'shop') {
    if (input.hit('Escape')) {
      offerDef = null;
      resume();
    }
  }

  if (mode === 'play') {
    const move = { x: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), y: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) };
    const people = residents.map((r) => ({ x: r.x, z: r.z }));
    const residentObs: Obstacle[] = residents.map((r) => ({ x: r.x, z: r.z, r: 0.4, ref: r }));
    traffic.target = runner?.state === 'active' && runner.def?.rival ? 0 : trafficBase; // roads closed for the showdown
    const rp = runner?.state === 'active' ? runner.rivalPose() : null;
    if (rp) rivalCar.drive(rp.x, rp.z, rp.heading, runner!.rivalSpeed, false, dt);
    else if (rivalCar.x !== info.rivalParking.x || rivalCar.z !== info.rivalParking.z) rivalCar.place(info.rivalParking.x, info.rivalParking.z, info.rivalParking.heading);
    const trafficObs = [...traffic.obstacles(), ...rivalCar.circles()];
    if (!current) player.update(dt, move, input.down('ShiftLeft', 'ShiftRight'), input.hit('Space'), cam.yaw, world, [...fleet, ...traffic.vehicles(), rivalCar], people);

    const drive: DriveInput | null = current ? { throttle: move.y, steer: move.x, handbrake: input.down('Space') } : null;
    for (const v of fleet) {
      v.frozen = v === current && !!runner?.freezeVehicle;
      const others: Obstacle[] = [...residentObs, ...trafficObs];
      for (const o of fleet) if (o !== v) others.push(...o.circles());
      if (!current) others.push({ x: player.x, z: player.z, r: player.radius, ref: player });
      const parkedAndClear = v !== current && v.speed === 0 && !others.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < v.spec.len / 2 + o.r + 1.2);
      if (parkedAndClear) continue; // nothing touching a parked vehicle: skip its physics
      const impact = v.update(dt, v === current ? drive : null, world, others, elapsed);
      if (!impact) continue;
      if (traffic.owns(impact.hit)) traffic.hit(impact.hit);
      if (impact.hit instanceof Vehicle && fleet.includes(impact.hit) && impact.speed > 4) impact.hit.damage((impact.speed - 4) * 2);
      if (impact.hit instanceof Resident) impact.hit.flee(impact.hit.x - v.x, impact.hit.z - v.z, 1.2);
      if (v === current) {
        if (impact.speed > 6) audio.sfx('crash');
        if (runner?.boundVehicle === v.id) runner.cargoHit(impact.speed);
      }
    }
    audio.engine(current ? current.speed : null, drive?.throttle ?? 0);
    if (current) residentReactions(current, horn);

    const focus = current ?? player;
    const forTraffic: Obstacle[] = [...residentObs];
    for (const v of [...fleet, rivalCar]) forTraffic.push(...v.circles());
    if (!current) forTraffic.push({ x: player.x, z: player.z, r: player.radius });
    traffic.update(dt, focus, forTraffic, (x, z) => {
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < 60) audio.sfx('horn2', 1 - d / 60);
    });

    const blockers = [{ x: player.x, z: player.z, r: current ? 0 : player.radius }];
    const pushers = [...fleet, ...traffic.vehicles(), rivalCar];
    for (const r of residents) {
      r.update(dt, world, blockers);
      for (const v of pushers) v.pushOut(r, r.radius);
    }

    runner?.update(dt, {
      inVehicle: !!current,
      vehicleKind: current?.kind ?? null,
      vehicleId: current?.id ?? null,
      vehicleWrecked: !!current?.wrecked,
      x: focus.x,
      z: focus.z,
      speed: current ? current.speed : player.speed,
    }, elapsed);
    parcel.visible = !current && runner?.state === 'active' && runner.cargo !== null;

    for (const v of fleet) if (v.wrecked) tow(v);
    save.data.carHealth = Math.round(hatch.healthPct * 100);

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

  if (mode === 'title' || mode === 'loading') {
    const a = elapsed * 0.04;
    camera.position.set(Math.cos(a) * 90, 60, 20 + Math.sin(a) * 90);
    camera.lookAt(0, 6, 20);
    sky.position.copy(camera.position);
  } else if (mode === 'wardrobe') wardrobeCamera(dt);
  else updateCamera(dt);

  // Sun and shadows follow whatever the camera is looking at.
  const fx = mode === 'title' ? 0 : current ? current.x : player.x;
  const fz = mode === 'title' ? 20 : current ? current.z : player.z;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + SUN_DIR.x * 200, SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
  input.endFrame();
}

// Adaptive quality: if the machine struggles, lower resolution, then turn shadows off and thin traffic.
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
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
  if (fps < 40 && pixelRatio > 1) {
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
  renderer.render(scene, camera);
}

// ---------- HUD ----------
const STEP_TO_MAP: Record<StepMarker, MarkerKind> = { start: 'start', checkpoint: 'checkpoint', pickup: 'pickup', dropoff: 'dropoff', stop: 'start' };

/** The resident who offers the next job (shown with "!"), if no job is running. */
function jobGiver(): Resident | null {
  if (!runner || runner.state !== 'idle') return null;
  const job = runner.nextJob;
  return job ? residents.find((r) => r.name === job.giver) ?? null : null;
}

function mapMarkers(full: boolean): MapMarker[] {
  const markers: MapMarker[] = [];
  const giver = jobGiver();
  if (!full) {
    for (const r of residents) if (r !== giver) markers.push({ x: r.x, z: r.z, kind: 'person' });
    for (const v of traffic.vehicles()) markers.push({ x: v.x, z: v.z, kind: 'traffic' });
  }
  for (const v of fleet) if (v !== current) markers.push({ x: v.x, z: v.z, kind: v === hatch ? 'car' : 'danfo' });
  if (runner?.state === 'active' && runner.def?.rival) markers.push({ x: rivalCar.x, z: rivalCar.z, kind: 'rival' });
  if (full) for (const r of residents) if (SHOPKEEPERS[r.name]) markers.push({ x: r.x, z: r.z, kind: 'shop' });
  if (giver) markers.push({ x: giver.x, z: giver.z, kind: 'giver' });
  const step = runner?.step;
  if (step?.kind === 'goto') {
    const next = runner!.nextPos();
    if (next) markers.push({ x: next.x, z: next.z, kind: 'next' });
    markers.push({ x: step.x!, z: step.z!, kind: STEP_TO_MAP[step.marker ?? 'checkpoint'] });
  }
  return markers;
}

function updateMinimap(): void {
  const me = current ?? player;
  const span = current ? 150 + Math.min(1, Math.abs(current.speed) / current.spec.maxSpeed) * 90 : 110;
  minimap.draw(me.x, me.z, current ? current.heading : player.heading, cam.yaw, span, mapMarkers(false));
}

/** Where the compass should point: the objective, the vehicle you need, or the next job. */
function compassTarget(): { x: number; z: number; start: boolean } | null {
  if (runner?.state === 'active') {
    const p = runner.objectivePos();
    if (p) return { ...p, start: false };
    const s = runner.step;
    if (s?.kind === 'enter' && !current) {
      if (s.vehicle === 'danfo') return { x: danfo.x, z: danfo.z, start: false };
      const me = player;
      const v = fleet.filter((k) => !k.wrecked).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
      return v ? { x: v.x, z: v.z, start: false } : null;
    }
    return null;
  }
  const g = jobGiver();
  return g ? { x: g.x, z: g.z, start: true } : null;
}

function updateHud(_dt: number): void {
  if (mode === 'title' || mode === 'loading') return;
  updateMinimap();
  // Interaction prompt
  const focus = mode === 'play' ? findFocus() : null;
  const prompt = $('prompt');
  if (current && mode === 'play') {
    prompt.innerHTML = `<kbd>E</kbd>Get out`;
    prompt.hidden = current.kmh > 20;
  } else if (focus) {
    if (focus.kind === 'vehicle') prompt.innerHTML = `<kbd>E</kbd>Drive the ${focus.v === hatch ? 'car' : 'danfo'}`;
    else {
      const job = runner?.offerFor(focus.r.name);
      const offer = job && runner!.state === 'idle' && runner!.status(job) !== 'locked';
      prompt.innerHTML = `<kbd>E</kbd>${offer ? 'Talk to' : 'Greet'} `;
      prompt.append(document.createTextNode(`${focus.r.name}${offer ? ' about a job' : ''}`));
    }
    prompt.hidden = false;
  } else prompt.hidden = true;

  $('speed').hidden = !current;
  $('vhealth').hidden = !current;
  if (current) {
    $('speed').innerHTML = `${Math.round(current.kmh)}<small>km/h</small>`;
    $('vh-name').textContent = current === hatch ? 'Car' : 'Danfo';
    const pct = current.healthPct;
    const bar = $('vh-bar');
    bar.style.width = `${Math.round(pct * 100)}%`;
    bar.className = pct < 0.3 ? 'bad' : pct < 0.6 ? 'warn' : '';
  }

  // Job panel + compass
  const m = $('mission');
  const compass = $('compass');
  if (runner && runner.def && runner.state === 'active') {
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
  } else m.hidden = true;
  const target = compassTarget();
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
  const [, loaded] = await Promise.all([dialogue.load(`${BASE}data/greetings.json`), loadMissions(`${BASE}data/missions.json`)]);
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
        player, hatch, danfo, fleet, traffic, residents, rivalCar, runner: () => runner,
        get bridgeOpen() { return bridgeOpen; },
        openWardrobe, equip, closeWardrobe,
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
          return { player: world.overlapsCircle(player.x, player.z, player.radius * 0.8), hatch: world.overlapsCircle(hatch.x, hatch.z, 0.6), danfo: world.overlapsCircle(danfo.x, danfo.z, 0.6) };
        },
        /** Advance game time without rendering (for slow, software-rendered test browsers). */
        simulate(seconds: number) { for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30); updateHud(0); },
      },
    });
  }
})();
