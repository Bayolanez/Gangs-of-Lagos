import * as THREE from 'three';
import type { SaveStore } from './save';
import { PAINTS } from './vehicles';
import type { CutsceneDef } from './cutscene';

/**
 * Data-driven jobs (public/data/missions.json). Milestone 2 makes every job a list of steps so one
 * runner handles races, deliveries and the danfo shift:
 *  - enter:     get into a vehicle (any, or a specific kind)
 *  - goto:      reach a point (optionally on foot, slowly, or holding still for a few seconds)
 *  - countdown: 3-2-1 with the vehicle held still
 * Jobs are offered by residents; finishing one can unlock the next. Rewards are saved locally.
 */
export type StepKind = 'enter' | 'goto' | 'countdown';
export type MarkerKind = 'start' | 'checkpoint' | 'pickup' | 'dropoff' | 'stop';

export interface StepDef {
  kind: StepKind;
  text: string;
  /** enter: which vehicle; goto: must be driving this kind (if inVehicle). */
  vehicle?: 'any' | 'danfo' | 'plane' | 'heli' | 'boat';
  x?: number;
  /** Phase 6 goto: altitude window (metres) for air checkpoints; `y` places the ring in the sky. */
  y?: number;
  minY?: number;
  maxY?: number;
  /** Phase 6 goto: must have landed (aircraft on the ground or a roof). */
  onGround?: boolean;
  z?: number;
  radius?: number;
  /** goto: seconds you must stay inside, slow, before it counts (bus stops). */
  hold?: number;
  /** goto: must be below this speed (m/s) inside the marker. */
  maxSpeed?: number;
  /** goto: must be on foot (pickups). */
  onFoot?: boolean;
  /** goto: must be in a vehicle. */
  inVehicle?: boolean;
  marker?: MarkerKind;
  /** World label shown above the marker. */
  label?: string;
  /** Cash added when this step completes (bus fares). */
  fare?: number;
  /** goto: completing this step gives you the parcel. */
  givesCargo?: boolean;
  seconds?: number;
  /** goto: on foot, you must press E inside the marker (with `hold`, hold E that many seconds). */
  press?: boolean;
  /** A crew member joins you when this step is done (Night Exit). */
  companion?: 'join';
  /** A patrol pursuit starts when this step is done. */
  pursuit?: 'start';
  /** goto: no patrol car may be within this many metres (lose them before the safehouse). */
  clearOf?: number;
  /** Named world change when this step is done (the game handles it, e.g. 'lightsOff', 'alarm'). */
  effect?: string;
}

/** Where a mission starts, shown in the mission list and marked on the map when selected. */
export interface MissionLocation {
  name: string;
  x: number;
  z: number;
}

/** A vehicle the mission parks for you at the start (getaway car, race car). */
export interface MissionVehicle {
  kind: 'hatchback' | 'sedan' | 'saloon' | 'coupe' | 'crossover';
  x: number;
  z: number;
  heading: number;
  colour?: string;
}

export interface MissionDef {
  id: string;
  type: 'race' | 'delivery' | 'shift' | 'errand' | 'lesson' | 'story';
  /** Story chapter: 1 = Harbour Bend, 2 = Marina Point. */
  chapter: number;
  /** Locked until this chapter is finished. */
  requiresChapter?: number;
  /** Head-to-head race: a rival drives the route and you must beat them to the line. */
  rival?: RivalDef;
  name: string;
  /** Resident who offers the job (must match a resident name). */
  giver: string;
  summary: string;
  intro: string;
  lockedLine: string;
  requires?: string;
  timeLimit: number;
  /** The clock starts when this step becomes current. */
  timerStartsAtStep: number;
  /** Fail if you leave the vehicle once the clock is running. */
  failOnExit?: boolean;
  steps: StepDef[];
  reward: { cash: number; repeatCash: number; paint?: string; licence?: 'plane' | 'heli'; unlock?: 'boat' };
  /** Where "Try again" puts your vehicle (only if you're in a suitable one). */
  retry?: { x: number; z: number; heading: number; vehicle?: 'any' | 'danfo' };
  /** Mission list: where it starts (defaults to the giver or the first marker). */
  location?: MissionLocation;
  /** Short animated introduction (see cutscene.ts) played before the start card. */
  cutscene?: CutsceneDef;
  /** A car parked for the mission. */
  vehicle?: MissionVehicle;
  /** Fail as soon as the car you are using is disabled (wrecked). */
  failOnWreck?: boolean;
  /** Patrol pursuit settings for steps with `pursuit: 'start'`. */
  pursuit?: { cars: number };
}

export interface RivalDef {
  name: string;
  /** Top speed on straights and through corners (m/s). */
  speed: number;
  cornerSpeed: number;
  /** Road centre-line route: start, then every turn, ending at the finish. The rival drives 3 m to the left of it. */
  path: [number, number][];
}

/** A chapter's reward, paid once when all of its jobs are done. */
export interface ChapterDef {
  id: number;
  name: string;
  bonus: number;
  paint?: string;
  outfitName?: string;
  text: string;
}

export type MissionState = 'idle' | 'active' | 'result';
export type OfferStatus = 'locked' | 'available' | 'done';

export interface MissionResult {
  success: boolean;
  reason: string;
  time: number;
  cash: number;
  base: number;
  fares: number;
  cargo: number | null;
  firstClear: boolean;
  best?: number;
  paintName?: string;
  /** Phase 6: a pilot's licence or a vehicle earned on first clear. */
  licence?: string;
  /** Set when this job finished a chapter for the first time. */
  chapter: ChapterDef | null;
}

export interface MissionContext {
  inVehicle: boolean;
  vehicleKind: string | null;
  vehicleId: number | null;
  vehicleWrecked: boolean;
  x: number;
  z: number;
  speed: number;
  /** Phase 6: altitude and whether an aircraft has landed (on foot and cars: 0 and true). */
  y?: number;
  grounded?: boolean;
  /** E pressed this frame / held down (on-foot actions). */
  usePressed?: boolean;
  useHeld?: boolean;
  /** Distance to the nearest patrol car (null when there is no pursuit). */
  pursuerDist?: number | null;
  /** The patrol has caught you. */
  busted?: boolean;
}

export interface MissionEvents {
  onStart(def: MissionDef): void;
  onCountdown(n: number): void;
  onStepDone(def: MissionDef, step: StepDef, index: number): void;
  onResult(def: MissionDef, result: MissionResult): void;
}

export async function loadMissions(url: string): Promise<{ missions: MissionDef[]; chapters: ChapterDef[] }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { missions?: MissionDef[]; chapters?: ChapterDef[] };
    const missions = (data.missions ?? []).filter((m) => Array.isArray(m.steps) && m.steps.length > 0 && m.steps.every(validStep)).map((m) => ({ ...m, chapter: m.chapter ?? 1 }));
    return { missions, chapters: data.chapters ?? [] };
  } catch (err) {
    console.warn('Missions could not be loaded.', err);
    return { missions: [], chapters: [] };
  }
}

function validStep(s: StepDef): boolean {
  if (s.kind === 'goto') return Number.isFinite(s.x) && Number.isFinite(s.z);
  return s.kind === 'enter' || s.kind === 'countdown';
}

const MARKER_COLOURS: Record<MarkerKind, string> = { start: '#f5c518', checkpoint: '#63d681', pickup: '#ff9a3c', dropoff: '#4bb3ff', stop: '#f5c518' };

export class MissionRunner {
  state: MissionState = 'idle';
  def: MissionDef | null = null;
  index = 0;
  elapsed = 0;
  timerOn = false;
  cargo: number | null = null;
  fares = 0;
  holdTime = 0;
  boundVehicle: number | null = null;
  /** Kind of the vehicle the job is using (cars can be swapped; aircraft and boats can't). */
  boundKind: string | null = null;
  private countdown = 0;
  private lastCount = 0;
  /** Last reported distance to the nearest patrol car (null: no pursuit). */
  pursuerDist: number | null = null;
  private readonly ring: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly nextBeam: THREE.Mesh;
  private readonly pad: THREE.Mesh;

  // Rival (head-to-head races)
  rivalDist = 0;
  rivalSpeed = 0;
  private rivalLine: { x: number; z: number }[] = [];
  private rivalCum: number[] = [];
  private routeCum: number[] = [];

  constructor(scene: THREE.Scene, readonly missions: MissionDef[], readonly chapters: ChapterDef[], private save: SaveStore, private events: MissionEvents) {
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.35, 10, 48), new THREE.MeshBasicMaterial({ color: '#63d681' }));
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#63d681', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.nextBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#63d681', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    // Ground marker for start / pickup / drop-off / bus stop: a glowing open cylinder.
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 40, 1, true),
      new THREE.MeshBasicMaterial({ color: '#f5c518', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    scene.add(this.ring, this.beam, this.nextBeam, this.pad);
    this.hideMarkers();
  }

  // ---------- Offers ----------
  byId(id: string): MissionDef | undefined {
    return this.missions.find((m) => m.id === id);
  }

  status(def: MissionDef): OfferStatus {
    if (this.save.data.completedMissions.includes(def.id)) return 'done';
    if (def.requires && !this.save.data.completedMissions.includes(def.requires)) return 'locked';
    if (def.requiresChapter && !this.save.data.chaptersDone.includes(def.requiresChapter)) return 'locked';
    return 'available';
  }

  /** The job this resident offers: their next available one, else a locked one (to say why), else a done one to replay. */
  offerFor(giver: string): MissionDef | null {
    const mine = this.missions.filter((m) => m.giver === giver);
    return mine.find((m) => this.status(m) === 'available') ?? mine.find((m) => this.status(m) === 'locked') ?? mine[0] ?? null;
  }

  /** The job the story points you to next (first one not done and not locked). */
  get nextJob(): MissionDef | null {
    return this.missions.find((m) => this.status(m) === 'available') ?? null;
  }

  chapterComplete(id: number): boolean {
    const jobs = this.missions.filter((m) => m.chapter === id);
    return jobs.length > 0 && jobs.every((m) => this.status(m) === 'done');
  }

  // ---------- Rival ----------
  private setupRival(r: RivalDef): void {
    const P = r.path.map(([x, z]) => ({ x, z }));
    const dirs = P.slice(1).map((q, i) => {
      const l = Math.hypot(q.x - P[i].x, q.z - P[i].z) || 1;
      return { x: (q.x - P[i].x) / l, z: (q.z - P[i].z) / l };
    });
    // Left of travel is (dz, -dx) in this coordinate system; corners use both segments' offsets.
    const left = (d: { x: number; z: number }) => ({ x: d.z, z: -d.x });
    const L = 3;
    this.rivalLine = P.map((p, i) => {
      const a = dirs[Math.max(0, i - 1)], b = dirs[Math.min(dirs.length - 1, i)];
      const la = left(a), lb = left(b);
      const same = Math.abs(a.x * b.x + a.z * b.z) > 0.9;
      return same ? { x: p.x + la.x * L, z: p.z + la.z * L } : { x: p.x + (la.x + lb.x) * L, z: p.z + (la.z + lb.z) * L };
    });
    const cum = (pts: { x: number; z: number }[]) => pts.reduce<number[]>((acc, p, i) => (i === 0 ? [0] : [...acc, acc[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z)]), []);
    this.rivalCum = cum(this.rivalLine);
    this.routeCum = cum(P);
    this.rivalDist = 0;
    this.rivalSpeed = 0;
  }

  /** Where the rival car is now (null if this job has no rival). */
  rivalPose(): { x: number; z: number; heading: number } | null {
    if (!this.def?.rival || !this.rivalLine.length) return null;
    const d = Math.min(this.rivalDist, this.rivalCum[this.rivalCum.length - 1]);
    let i = 1;
    while (i < this.rivalCum.length - 1 && this.rivalCum[i] < d) i++;
    const a = this.rivalLine[i - 1], b = this.rivalLine[i];
    const seg = this.rivalCum[i] - this.rivalCum[i - 1] || 1;
    const t = (d - this.rivalCum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.z - a.z, b.x - a.x) };
  }

  /** Metres the rival is ahead of you (negative when you lead). */
  rivalLead(px: number, pz: number): number | null {
    const r = this.def?.rival;
    if (!r || this.state !== 'active') return null;
    const cps = this.def!.steps.map((s, i) => ({ s, i })).filter((k) => k.s.marker === 'checkpoint');
    const k = cps.findIndex((c) => c.i === this.index);
    if (k < 0) return null;
    const target = r.path[k + 1];
    const mine = this.routeCum[k + 1] - Math.hypot(px - target[0], pz - target[1]);
    return this.rivalDist - mine;
  }

  private updateRival(dt: number, ctx: MissionContext): void {
    const r = this.def!.rival!;
    const total = this.rivalCum[this.rivalCum.length - 1];
    let i = 1;
    while (i < this.rivalCum.length - 1 && this.rivalCum[i] <= this.rivalDist) i++;
    const toCorner = this.rivalCum[i] - this.rivalDist;
    let target = i < this.rivalCum.length - 1 ? Math.min(r.speed, r.cornerSpeed + toCorner * 0.55) : r.speed;
    // Don't drive through the player: hold back if their vehicle is right in front.
    const pose = this.rivalPose()!;
    const fx = Math.cos(pose.heading), fz = Math.sin(pose.heading);
    const rx = ctx.x - pose.x, rz = ctx.z - pose.z;
    const ahead = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
    if (ctx.inVehicle && ahead > 0 && ahead < 7 && lat < 2.4) target = Math.min(target, Math.max(0, Math.abs(ctx.speed) - 1));
    this.rivalSpeed += THREE.MathUtils.clamp(target - this.rivalSpeed, -12 * dt, 6 * dt);
    this.rivalDist = Math.min(total, this.rivalDist + this.rivalSpeed * dt);
  }

  // ---------- Running ----------
  get step(): StepDef | null {
    return this.def && this.state === 'active' ? this.def.steps[this.index] ?? null : null;
  }

  get timeLeft(): number {
    return this.def ? Math.max(0, this.def.timeLimit - this.elapsed) : 0;
  }

  /** The vehicle must be held still during a countdown. */
  get freezeVehicle(): boolean {
    return this.step?.kind === 'countdown';
  }

  objectiveText(): string {
    const s = this.step;
    if (!s || !this.def) return '';
    if (s.kind === 'countdown') return 'Get ready…';
    if (s.kind === 'goto' && s.marker === 'checkpoint') {
      const cps = this.def.steps.filter((k) => k.marker === 'checkpoint');
      const n = this.def.steps.slice(0, this.index + 1).filter((k) => k.marker === 'checkpoint').length;
      return `Checkpoint ${n} of ${cps.length}`;
    }
    if (s.hold && this.holdTime > 0) return `${s.text} (${Math.max(0, s.hold - this.holdTime).toFixed(1)} s)`;
    if (s.clearOf && this.pursuerDist !== null && this.pursuerDist < s.clearOf) return `${s.text}: lose the patrol first (nearest ${Math.round(this.pursuerDist)} m)`;
    return s.text;
  }

  /** The current step wants E pressed here (on foot, inside its marker). */
  pressHere(x: number, z: number, inVehicle: boolean): boolean {
    const s = this.step;
    return !!s && s.kind === 'goto' && !!s.press && !inVehicle && Math.hypot(x - s.x!, z - s.z!) < (s.radius ?? 5);
  }

  objectivePos(): { x: number; z: number } | null {
    const s = this.step;
    return s && s.kind === 'goto' ? { x: s.x!, z: s.z! } : null;
  }

  /** The goto step after the current one (shown faintly during races). */
  nextPos(): { x: number; z: number } | null {
    if (!this.def || this.state !== 'active') return null;
    const n = this.def.steps[this.index + 1];
    return n && n.kind === 'goto' && n.marker === 'checkpoint' ? { x: n.x!, z: n.z! } : null;
  }

  start(def: MissionDef): void {
    this.def = def;
    this.index = 0;
    this.elapsed = 0;
    this.timerOn = def.timerStartsAtStep <= 0;
    this.cargo = null;
    this.fares = 0;
    this.holdTime = 0;
    this.boundVehicle = null;
    this.boundKind = null;
    this.pursuerDist = null;
    if (def.rival) this.setupRival(def.rival);
    this.state = 'active';
    this.events.onStart(def);
    this.enterStep();
  }

  /** Player gave up from the pause menu. No reward, nothing saved. */
  abandon(): void {
    if (this.state === 'active') this.finish(false, 'You walked away from the job');
  }

  /** Called by the UI when the player closes the result card. */
  /** End the running job as failed (e.g. you went down in a fight). */
  fail(reason: string): void {
    if (this.state === 'active') this.finish(false, reason);
  }

  dismiss(): void {
    this.state = 'idle';
    this.def = null;
    this.cargo = null;
    this.hideMarkers();
  }

  /** The vehicle carrying the parcel hit something. */
  cargoHit(speed: number): void {
    if (this.cargo === null || this.state !== 'active' || speed < 3) return;
    this.cargo = Math.max(0, this.cargo - (speed - 3) * 6);
  }

  private hideMarkers(): void {
    this.ring.visible = this.beam.visible = this.nextBeam.visible = this.pad.visible = false;
  }

  private enterStep(): void {
    this.holdTime = 0;
    if (this.def && this.index === this.def.timerStartsAtStep) this.timerOn = true;
    const s = this.step;
    this.hideMarkers();
    if (!s) return;
    if (s.kind === 'countdown') {
      this.countdown = (s.seconds ?? 3) - 0.001;
      this.lastCount = Math.ceil(this.countdown) + 1;
    }
    if (s.kind !== 'goto') return;
    const x = s.x!, z = s.z!;
    const colour = MARKER_COLOURS[s.marker ?? 'checkpoint'];
    (this.beam.material as THREE.MeshBasicMaterial).color.set(colour);
    this.beam.visible = true;
    this.beam.position.set(x, 30, z);
    if (s.marker === 'checkpoint') {
      this.ring.visible = true;
      this.ring.position.set(x, s.y ?? 4, z);
      this.ring.scale.setScalar(s.y !== undefined ? (s.radius ?? 5.5) / 5.5 : 1);
      this.beam.visible = s.y === undefined;
      const prev = this.prevPoint();
      this.ring.rotation.set(0, -Math.atan2(z - prev.z, x - prev.x) + Math.PI / 2, 0);
      const next = this.nextPos();
      this.nextBeam.visible = !!next;
      if (next) this.nextBeam.position.set(next.x, 20, next.z);
    } else {
      const r = s.radius ?? 5;
      this.pad.visible = true;
      (this.pad.material as THREE.MeshBasicMaterial).color.set(colour);
      this.pad.scale.set(r, s.onFoot ? 2.5 : 6, r);
      this.pad.position.set(x, s.onFoot ? 1.25 : 3, z);
    }
  }

  private prevPoint(): { x: number; z: number } {
    for (let i = this.index - 1; i >= 0; i--) {
      const s = this.def!.steps[i];
      if (s.kind === 'goto') return { x: s.x!, z: s.z! };
    }
    return { x: 0, z: 0 };
  }

  private advance(): void {
    const def = this.def!;
    const done = this.step!;
    if (done.fare) this.fares += done.fare;
    if (done.givesCargo) this.cargo = 100;
    this.events.onStepDone(def, done, this.index);
    this.index++;
    if (this.index >= def.steps.length) return this.finish(true, 'Job done');
    this.enterStep();
  }

  private finish(success: boolean, reason: string): void {
    const def = this.def!;
    const time = Math.round(this.elapsed * 100) / 100;
    const data = this.save.data;
    const firstClear = success && !data.completedMissions.includes(def.id);
    let base = 0;
    let cash = 0;
    let paintName: string | undefined;
    let licence: string | undefined;
    let chapter: ChapterDef | null = null;
    if (success) {
      base = firstClear ? def.reward.cash : def.reward.repeatCash;
      if (this.cargo !== null) base = Math.round((base * (0.4 + 0.6 * (this.cargo / 100))) / 50) * 50;
      cash = base + this.fares;
      data.cash += cash;
      if (firstClear) data.completedMissions.push(def.id);
      if (def.type === 'race') data.stats.races++;
      if (def.type === 'delivery') data.stats.deliveries++;
      if (def.type === 'shift') data.stats.shifts++;
      data.stats.fares += this.fares;
      const paint = def.reward.paint;
      if (firstClear && paint && !data.paints.owned.includes(paint)) {
        data.paints.owned.push(paint);
        data.paints.active = paint;
        paintName = PAINTS[paint]?.name ?? paint;
      }
      const lic = def.reward.licence ?? def.reward.unlock;
      if (firstClear && lic && !data.licences.includes(lic)) {
        data.licences.push(lic);
        licence = lic;
      }
      if (def.type === 'race') {
        const prev = data.bestTimes[def.id];
        if (prev === undefined || time < prev) data.bestTimes[def.id] = Math.round(time * 100) / 100;
      }
      if ((data.bestPay[def.id] ?? 0) < cash) data.bestPay[def.id] = cash;
      const ch = this.chapters.find((c) => c.id === def.chapter);
      if (ch && !data.chaptersDone.includes(ch.id) && this.chapterComplete(ch.id)) {
        chapter = ch;
        data.chaptersDone.push(ch.id);
        data.cash += ch.bonus;
        if (ch.paint && !data.paints.owned.includes(ch.paint)) data.paints.owned.push(ch.paint);
      }
      this.save.save();
    }
    this.state = 'result';
    this.hideMarkers();
    this.events.onResult(def, { success, reason, time, cash, base, fares: this.fares, cargo: this.cargo, firstClear, best: data.bestTimes[def.id], paintName, licence, chapter });
  }

  update(dt: number, ctx: MissionContext, now: number): void {
    if (this.state !== 'active' || !this.def) return;
    const def = this.def;
    const s = this.step!;
    if (this.timerOn && s.kind !== 'countdown') this.elapsed += dt;
    this.ring.rotation.z += dt * 0.6;
    this.pad.scale.y *= 1 + 0.004 * Math.sin(now * 4);

    // Failure checks. Losing a car never ends a job: get out, find (or hijack) another and carry on.
    // Only aircraft and boat jobs still fail if you crash or leave the craft.
    const craftJob = this.boundKind === 'plane' || this.boundKind === 'heli' || this.boundKind === 'boat';
    if (craftJob && this.boundVehicle !== null && ctx.vehicleWrecked) return this.finish(false, 'Your vehicle was wrecked');
    if (craftJob && this.timerOn && def.failOnExit && this.boundVehicle !== null && ctx.vehicleId !== this.boundVehicle) return this.finish(false, 'You left the vehicle');
    if (!craftJob && this.boundVehicle !== null && ctx.inVehicle && ctx.vehicleId !== this.boundVehicle) {
      // Switched cars: the job (and any parcel) comes with you.
      this.boundVehicle = ctx.vehicleId;
      this.boundKind = ctx.vehicleKind;
    }
    if (this.timerOn && this.elapsed >= def.timeLimit) return this.finish(false, 'Time up');
    if (def.rival && this.timerOn && s.kind !== 'countdown') {
      this.updateRival(dt, ctx);
      if (this.rivalDist >= this.rivalCum[this.rivalCum.length - 1]) return this.finish(false, `${def.rival.name} crossed the line first`);
    }
    if (this.cargo !== null && this.cargo <= 0) return this.finish(false, 'The parcel is ruined');
    this.pursuerDist = ctx.pursuerDist ?? null;
    if (ctx.busted) return this.finish(false, 'The patrol boxed you in and caught you');
    if (def.failOnWreck && this.boundVehicle !== null && ctx.vehicleWrecked) return this.finish(false, 'Your getaway car was disabled');

    if (s.kind === 'enter') {
      const ok = ctx.inVehicle && (!s.vehicle || s.vehicle === 'any' || ctx.vehicleKind === s.vehicle);
      if (ok) {
        this.boundVehicle = ctx.vehicleId;
        this.boundKind = ctx.vehicleKind;
        this.advance();
      }
      return;
    }
    if (s.kind === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.events.onCountdown(n);
      }
      if (this.countdown <= 0) this.advance();
      return;
    }
    // goto
    const y = ctx.y ?? 0;
    const inside = Math.hypot(ctx.x - s.x!, ctx.z - s.z!) < (s.radius ?? 5) && (s.minY === undefined || y >= s.minY) && (s.maxY === undefined || y <= s.maxY) && (!s.onGround || ctx.grounded !== false);
    const modeOk = s.onFoot ? !ctx.inVehicle : s.inVehicle ? ctx.inVehicle && (!s.vehicle || s.vehicle === 'any' || ctx.vehicleKind === s.vehicle) : true;
    const slowOk = s.maxSpeed === undefined || Math.abs(ctx.speed) <= s.maxSpeed;
    const clearOk = !s.clearOf || ctx.pursuerDist === null || ctx.pursuerDist === undefined || ctx.pursuerDist >= s.clearOf;
    if (s.press) {
      // Press (or hold) E on foot inside the marker.
      const ready = inside && !ctx.inVehicle;
      if (ready && !s.hold && ctx.usePressed) this.advance();
      else if (ready && s.hold && (ctx.useHeld || (ctx.usePressed && this.holdTime > 0))) {
        this.holdTime += dt;
        if (this.holdTime >= s.hold) this.advance();
      } else if (!ready || !ctx.useHeld) this.holdTime = 0;
      return;
    }
    if (inside && modeOk && slowOk && clearOk) {
      if (s.hold) {
        this.holdTime += dt;
        if (this.holdTime >= s.hold) this.advance();
      } else this.advance();
    } else this.holdTime = 0;
  }
}
