import * as THREE from 'three';
import './style.css';
import { Audio } from './audio';
import { Car, CAR_WID, CAR_LEN } from './car';
import { CollisionWorld } from './collision';
import { Dialogue } from './dialogue';
import { buildDistrict } from './district';
import { Input } from './input';
import { MapMarker, Minimap } from './minimap';
import { loadMissions, MissionDef, MissionResult, MissionRunner } from './mission';
import { Resident } from './npc';
import { Player } from './player';
import { rng } from './placeholders';
import { SaveStore } from './save';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BASE = import.meta.env.BASE_URL;
const fmtCash = (n: number) => '₦' + Math.round(n).toLocaleString('en-US');
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

type Mode = 'loading' | 'title' | 'play' | 'pause' | 'settings' | 'result';

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
const car = new Car(info.carSpawn.x, info.carSpawn.z, info.carSpawn.heading);
scene.add(car.group);
const rand = rng(77);
const residents = info.residents.map((d) => new Resident(d, rand));
residents.forEach((r) => scene.add(r.rig.root));
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), world);

let mode: Mode = 'loading';
let inCar = false;
let runner: MissionRunner | null = null;
let started = false;
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
const bubbles = new Map<Resident, HTMLElement>();
const startLabel = document.createElement('div');
startLabel.className = 'wl';
labels.append(startLabel);

let noticeTimer = 0;
function notice(text: string, seconds = 2): void {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
  noticeTimer = seconds;
}
let subtitleTimer = 0;
let introTimer = 0;

function showScreen(id: 'title' | 'pause' | 'settings' | 'result' | null): void {
  for (const s of ['title', 'pause', 'settings', 'result']) $(s).hidden = s !== id;
  $('hud').hidden = id === 'title' || mode === 'loading';
}

function refreshCash(): void {
  $('cash').textContent = fmtCash(save.data.cash);
  $('unlocks').textContent = save.data.unlocks.includes('paint-danfo') ? 'Danfo paint unlocked' : '';
}

function applyUnlocks(): void {
  car.setPaint(save.data.unlocks.includes('paint-danfo') ? 'danfo' : 'default');
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
    const done = save.data.completedMissions.length;
    $('pause-stats').textContent = `${fmtCash(save.data.cash)} saved · ${done} of ${runner?.missions.length ?? 1} missions done${save.persistent ? '' : ' · storage blocked, progress is kept only for this session'}`;
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
  setMode('play');
  input.requestLock();
});
$('btn-settings').addEventListener('click', () => { settingsReturn = 'title'; setMode('settings'); });
$('btn-settings2').addEventListener('click', () => { settingsReturn = 'pause'; setMode('settings'); });
$('btn-resume').addEventListener('click', () => { setMode('play'); input.requestLock(); });
$('btn-title').addEventListener('click', () => { save.save(); setMode('title'); });
$('btn-back').addEventListener('click', () => {
  const ok = save.save();
  if (!ok) $('reset-note').textContent = 'This browser is blocking storage; settings apply for this session only.';
  setMode(settingsReturn);
});
$('btn-reset').addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Click again to confirm reset';
    $('reset-note').textContent = 'This clears cash, completed missions, best times and unlocks. Settings are kept.';
    return;
  }
  save.reset();
  applyUnlocks();
  refreshCash();
  resetArmed = false;
  $('btn-reset').textContent = 'Reset progress';
  $('reset-note').textContent = 'Progress reset.';
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

// ---------- Missions ----------
let lastResultDef: MissionDef | null = null;
function setupMissions(defs: MissionDef[]): void {
  runner = new MissionRunner(scene, defs, save, {
    onIntro(def) {
      $('i-giver').textContent = `${def.name} · ${def.giver}`;
      $('i-text').textContent = def.intro;
      $('intro').hidden = false;
      introTimer = 7;
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
    onCheckpoint(i, total) {
      audio.sfx('checkpoint');
      if (i < total) notice(`Checkpoint ${i} of ${total}`, 1.2);
    },
    onResult(def, r) {
      lastResultDef = def;
      showResult(def, r);
    },
  });
}

function showResult(def: MissionDef, r: MissionResult): void {
  audio.sfx(r.success ? 'win' : 'fail');
  $('r-mission').textContent = def.name;
  $('r-title').textContent = r.success ? 'RACE COMPLETE' : 'RACE FAILED';
  const parts: string[] = [];
  if (r.success) {
    parts.push(`Time ${fmtTime(r.time)}${r.best !== undefined ? ` · best ${fmtTime(r.best)}` : ''}.`);
    parts.push(`Reward ${fmtCash(r.cash)}${r.firstClear ? '' : ' (repeat reward)'}.`);
    if (r.unlockName) parts.push(`Unlocked: ${r.unlockName}. Your car has been repainted.`);
  } else {
    parts.push(`${r.reason}. No reward this time.`);
  }
  $('r-body').textContent = parts.join(' ');
  refreshCash();
  applyUnlocks();
  mode = 'result';
  input.releaseLock();
  showScreen('result');
  $('hud').hidden = false;
}

$('btn-continue').addEventListener('click', () => {
  runner?.dismiss();
  setMode('play');
  input.requestLock();
});
$('btn-retry').addEventListener('click', () => {
  if (!runner || !lastResultDef) return;
  runner.dismiss();
  const s = lastResultDef.start;
  if (!inCar) enterCar();
  car.x = s.x;
  car.z = s.z;
  car.heading = Math.PI / 2;
  car.speed = 0;
  car.sync();
  cam.yaw = car.heading;
  runner.start(lastResultDef);
  setMode('play');
  input.requestLock();
});

// ---------- Interaction ----------
type Focus = { kind: 'car' } | { kind: 'npc'; r: Resident } | null;
function findFocus(): Focus {
  if (inCar) return null;
  let best: Focus = null;
  let bestScore = Infinity;
  const f = player.facing();
  if (car.contains(player.x, player.z, 1.4)) {
    best = { kind: 'car' };
    bestScore = Math.hypot(car.x - player.x, car.z - player.z) - 2;
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

function enterCar(): void {
  inCar = true;
  car.hasDriver = true;
  player.visible = false;
  cam.yaw = car.heading;
  cam.lookOffset = 0;
  audio.sfx('door');
}

function exitCar(): void {
  if (car.kmh > 20) return notice('Slow down to get out');
  const fx = Math.cos(car.heading), fz = Math.sin(car.heading);
  const lx = fz, lz = -fx; // left of the car
  const side = CAR_WID / 2 + 0.75, end = CAR_LEN / 2 + 0.8;
  const spots = [[lx * side, lz * side], [-lx * side, -lz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
  for (const [ox, oz] of spots) {
    const x = car.x + ox, z = car.z + oz;
    if (!world.overlapsCircle(x, z, player.radius + 0.05)) {
      player.x = x;
      player.z = z;
      player.heading = car.heading;
      player.y = 0;
      player.sync();
      player.visible = true;
      inCar = false;
      car.hasDriver = false;
      cam.yaw = car.heading;
      audio.sfx('door');
      return;
    }
  }
  notice('No room to get out here');
}

function interact(): void {
  if (inCar) return exitCar();
  const f = findFocus();
  if (!f) return;
  if (f.kind === 'car') return enterCar();
  const line = dialogue.pick(f.r.def.voice);
  f.r.greet(line, player.x, player.z);
  audio.sfx('greet');
  $('subtitle').textContent = `${f.r.name}: ${line}`;
  $('subtitle').hidden = false;
  subtitleTimer = 4.5;
}

// ---------- Camera ----------
function updateCamera(dt: number): void {
  const look = input.consumeLook();
  const s = save.data.settings;
  const k = 0.0024 * s.lookSensitivity;
  if (look.x !== 0 || look.y !== 0) {
    cam.yaw += look.x * k;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + look.y * k * (s.invertY ? -1 : 1), -0.15, 1.15);
    if (inCar) {
      cam.lookOffset += look.x * k;
      cam.lookHold = 1.4;
    }
  }
  let tx: number, ty: number, tz: number, dist: number, side: number;
  if (inCar) {
    cam.lookHold -= dt;
    if (cam.lookHold <= 0) cam.lookOffset *= Math.max(0, 1 - dt * 2.5);
    const target = car.heading + cam.lookOffset;
    let diff = target - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cam.yaw += diff * Math.min(1, dt * 4);
    tx = car.x; ty = 1.7; tz = car.z;
    dist = 7.5 + Math.abs(car.speed) * 0.08;
    side = 0;
  } else {
    tx = player.x; ty = player.y + 1.55; tz = player.z;
    dist = 4.6;
    side = 0.5;
  }
  const pitch = inCar ? Math.max(0.12, cam.pitch * 0.7) : cam.pitch;
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
  const fov = inCar ? 62 + Math.min(1, Math.abs(car.speed) / car.maxSpeed) * 10 : 62;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 2);
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
}

// ---------- Frame ----------
let last = performance.now();
let elapsed = 0;

/** Advances the game by dt seconds (input, actors, mission, camera). Rendering happens separately. */
function step(dt: number): void {
  elapsed += dt;
  if (mode === 'play') {
    if (input.hit('KeyP', 'Escape')) setMode('pause');
    if (input.hit('KeyE')) interact();
    if (input.hit('KeyH') && inCar) audio.sfx('horn');
  }

  if (mode === 'play') {
    const move = { x: input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), y: input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) };
    const people = residents.map((r) => ({ x: r.x, z: r.z }));
    if (!inCar) {
      player.update(dt, move, input.down('ShiftLeft', 'ShiftRight'), input.hit('Space'), cam.yaw, world, car, people);
    }
    car.frozen = !!runner?.freezeCar;
    const drive = inCar ? { throttle: move.y, steer: move.x, handbrake: input.down('Space') } : null;
    const impact = car.update(dt, drive, world, people, elapsed);
    if (impact > 6 && inCar) audio.sfx('crash');
    audio.engine(inCar ? car.speed : null, drive?.throttle ?? 0);
    const blockers = [{ x: player.x, z: player.z, r: inCar ? 0 : player.radius }];
    for (const r of residents) {
      r.update(dt, world, blockers);
      car.pushOut(r, r.radius);
    }
    runner?.update(dt, { inCar, carX: car.x, carZ: car.z, carSpeed: car.speed }, elapsed);
  } else {
    audio.engine(null, 0);
  }

  if (mode === 'title' || mode === 'loading') {
    const a = elapsed * 0.04;
    camera.position.set(Math.cos(a) * 90, 60, 20 + Math.sin(a) * 90);
    camera.lookAt(0, 6, 20);
    sky.position.copy(camera.position);
  } else updateCamera(dt);

  // Sun and shadows follow whatever the camera is looking at.
  const fx = mode === 'title' ? 0 : inCar ? car.x : player.x;
  const fz = mode === 'title' ? 20 : inCar ? car.z : player.z;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + SUN_DIR.x * 200, SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
  input.endFrame();
}

// Adaptive quality: if the machine struggles, lower resolution first, then turn shadows off.
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
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    console.info('Low frame rate: shadows turned off.');
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

function updateMinimap(): void {
  const markers: MapMarker[] = [];
  for (const r of residents) markers.push({ x: r.x, z: r.z, kind: 'person' });
  if (!inCar) markers.push({ x: car.x, z: car.z, kind: 'car' });
  if (runner?.def && runner.state === 'active') {
    const cps = runner.def.checkpoints;
    const next = cps[runner.index + 1];
    if (next) markers.push({ x: next[0], z: next[1], kind: 'next' });
    const cur = cps[runner.index];
    if (cur) markers.push({ x: cur[0], z: cur[1], kind: 'checkpoint' });
  } else if (runner?.state === 'idle' && runner.available) {
    markers.push({ x: runner.available.start.x, z: runner.available.start.z, kind: 'start' });
  }
  const x = inCar ? car.x : player.x;
  const z = inCar ? car.z : player.z;
  const span = inCar ? 150 + Math.min(1, Math.abs(car.speed) / car.maxSpeed) * 90 : 110;
  minimap.draw(x, z, inCar ? car.heading : player.heading, cam.yaw, span, markers);
}

function updateHud(dt: number): void {
  if (mode === 'title' || mode === 'loading') return;
  updateMinimap();
  // Interaction prompt
  const focus = mode === 'play' ? findFocus() : null;
  const prompt = $('prompt');
  if (inCar && mode === 'play') {
    prompt.innerHTML = `<kbd>E</kbd>Get out`;
    prompt.hidden = car.kmh > 20;
  } else if (focus) {
    prompt.innerHTML = focus.kind === 'car' ? '<kbd>E</kbd>Drive' : `<kbd>E</kbd>Greet ${focus.r.name}`;
    prompt.hidden = false;
  } else prompt.hidden = true;

  $('speed').hidden = !inCar;
  if (inCar) $('speed').innerHTML = `${Math.round(car.kmh)}<small>km/h</small>`;

  // Mission panel + compass
  const m = $('mission');
  const compass = $('compass');
  let target: { x: number; z: number } | null = null;
  if (runner && runner.def && (runner.state === 'countdown' || runner.state === 'active')) {
    m.hidden = false;
    $('m-name').textContent = runner.def.name;
    $('m-obj').textContent = runner.objectiveText();
    const t = runner.state === 'active' ? runner.timeLeft : runner.def.timeLimit;
    $('m-time').textContent = fmtTime(t);
    $('m-time').classList.toggle('low', runner.state === 'active' && t < 15);
    target = runner.objectivePos();
    compass.classList.remove('start');
  } else {
    m.hidden = true;
    if (runner?.state === 'idle' && runner.available) {
      target = runner.available.start;
      compass.classList.add('start');
    }
  }
  if (target) {
    const sx = inCar ? car.x : player.x, sz = inCar ? car.z : player.z;
    const rel = Math.atan2(target.z - sz, target.x - sx) - cam.yaw;
    $('c-arrow').style.transform = `rotate(${rel}rad)`;
    $('c-dist').textContent = `${Math.round(Math.hypot(target.x - sx, target.z - sz))} m`;
    compass.hidden = false;
  } else compass.hidden = true;

  // World labels
  if (runner?.state === 'idle' && runner.available) {
    const a = runner.available;
    startLabel.textContent = `Race · ${a.name}${inCar ? '' : ' (needs the car)'}`;
    placeLabel(startLabel, a.start.x, 8.6, a.start.z);
  } else startLabel.style.display = 'none';

  for (const r of residents) {
    let el = bubbles.get(r);
    if (r.talkTimer > 0) {
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

  if (noticeTimer > 0 && (noticeTimer -= dt) <= 0) $('notice').hidden = true;
  if (subtitleTimer > 0 && (subtitleTimer -= dt) <= 0) $('subtitle').hidden = true;
  if (introTimer > 0 && (introTimer -= dt) <= 0) $('intro').hidden = true;
  $('lockhint').hidden = !(mode === 'play' && !input.locked && elapsed > 1 && !lockHintDismissed);
  refreshCash();
}
let lockHintDismissed = false;
canvas.addEventListener('mousedown', (e) => { if (e.button === 2) lockHintDismissed = true; });

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// ---------- Boot ----------
(async () => {
  const [, missions] = await Promise.all([dialogue.load(`${BASE}data/greetings.json`), loadMissions(`${BASE}data/missions.json`)]);
  setupMissions(missions);
  audio.setVolume(save.data.settings.masterVolume);
  applyUnlocks();
  refreshCash();
  if (!save.persistent) $('save-note').textContent = 'This browser is blocking storage, so progress will only last for this session.';
  else if (save.data.completedMissions.length) $('save-note').textContent = `Saved progress: ${fmtCash(save.data.cash)} · ${save.data.completedMissions.length} mission done.`;
  if (!missions.length) $('save-note').textContent = 'Mission data could not be loaded; free roam only.';
  const play = $<HTMLButtonElement>('btn-play');
  play.disabled = false;
  play.textContent = 'Play';
  setMode('title');
  console.info(`Harbour Bend: ${info.instances} placeholder shapes, ${world.boxes.length} colliders, ${residents.length} residents, ${missions.length} mission(s).`);

  // Test hook for automated checks only: open the page with ?debug to expose it.
  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      __gol: {
        get mode() { return mode; },
        get inCar() { return inCar; },
        get mission() { return runner ? { state: runner.state, index: runner.index, timeLeft: runner.timeLeft } : null; },
        get save() { return save.data; },
        player, car, residents,
        interact, enterCar,
        teleportCar(x: number, z: number, heading = car.heading) { car.x = x; car.z = z; car.heading = heading; car.speed = 0; car.sync(); },
        teleportPlayer(x: number, z: number) { player.x = x; player.z = z; player.sync(); },
        /** Advance game time without rendering (for slow, software-rendered test browsers). */
        /** True if the player or car footprint overlaps a building or wall (should never happen). */
        overlapping() { return { player: world.overlapsCircle(player.x, player.z, player.radius * 0.8), car: world.overlapsCircle(car.x, car.z, 0.6) }; },
        simulate(seconds: number) { for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30); updateHud(0); },
      },
    });
  }
})();
