import * as THREE from 'three';
import type { SaveStore } from './save';

/** Data-driven mission definitions (public/data/missions.json). Only 'race' runs in this milestone. */
export interface MissionDef {
  id: string;
  type: 'race';
  name: string;
  giver: string;
  intro: string;
  start: { x: number; z: number };
  startRadius: number;
  requiresVehicle: boolean;
  timeLimit: number;
  checkpointRadius: number;
  checkpoints: [number, number][];
  reward: { cash: number; repeatCash: number; unlock?: string; unlockName?: string };
}

export type MissionState = 'idle' | 'countdown' | 'active' | 'result';

export interface MissionResult {
  success: boolean;
  reason: string;
  time: number;
  cash: number;
  unlockName?: string;
  firstClear: boolean;
  best?: number;
}

export interface MissionContext {
  inCar: boolean;
  carX: number;
  carZ: number;
  carSpeed: number;
}

export interface MissionEvents {
  onIntro(def: MissionDef): void;
  onCountdown(n: number): void;
  onCheckpoint(index: number, total: number): void;
  onResult(def: MissionDef, result: MissionResult): void;
}

export async function loadMissions(url: string): Promise<MissionDef[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { missions?: MissionDef[] };
    return (data.missions ?? []).filter((m) => m.type === 'race' && Array.isArray(m.checkpoints) && m.checkpoints.length > 0);
  } catch (err) {
    console.warn('Missions could not be loaded.', err);
    return [];
  }
}

export class MissionRunner {
  state: MissionState = 'idle';
  def: MissionDef | null = null;
  index = 0;
  elapsed = 0;
  private countdown = 0;
  private lastCount = 0;
  private cooldown = 0;
  private readonly startMarker: THREE.Group;
  private readonly ring: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly nextBeam: THREE.Mesh;

  constructor(scene: THREE.Scene, readonly missions: MissionDef[], private save: SaveStore, private events: MissionEvents) {
    this.startMarker = new THREE.Group();
    const startBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 8, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: '#f5c518', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    startBeam.position.y = 4;
    const startRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 3, 48), new THREE.MeshBasicMaterial({ color: '#f5c518', side: THREE.DoubleSide }));
    startRing.rotation.x = -Math.PI / 2;
    startRing.position.y = 0.06;
    this.startMarker.add(startBeam, startRing);
    scene.add(this.startMarker);

    this.ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.35, 10, 48), new THREE.MeshBasicMaterial({ color: '#63d681' }));
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#63d681', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.nextBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#63d681', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    scene.add(this.ring, this.beam, this.nextBeam);
    this.hideCheckpoints();
  }

  /** The mission whose start marker is shown (first one for now). */
  get available(): MissionDef | null {
    return this.missions[0] ?? null;
  }

  get timeLeft(): number {
    return this.def ? Math.max(0, this.def.timeLimit - this.elapsed) : 0;
  }

  /** Car must be held still while counting down. */
  get freezeCar(): boolean {
    return this.state === 'countdown';
  }

  objectiveText(): string {
    if (!this.def) return '';
    if (this.state === 'countdown') return 'Get ready…';
    return `Checkpoint ${Math.min(this.index + 1, this.def.checkpoints.length)} of ${this.def.checkpoints.length}`;
  }

  objectivePos(): { x: number; z: number } | null {
    if (this.state === 'active' && this.def) {
      const [x, z] = this.def.checkpoints[this.index];
      return { x, z };
    }
    if (this.state === 'idle' && this.available) return null;
    return null;
  }

  private hideCheckpoints(): void {
    this.ring.visible = this.beam.visible = this.nextBeam.visible = false;
  }

  private placeCheckpoints(): void {
    if (!this.def) return;
    const cps = this.def.checkpoints;
    const [x, z] = cps[this.index];
    this.ring.visible = this.beam.visible = true;
    this.ring.position.set(x, 4, z);
    const prev = this.index > 0 ? cps[this.index - 1] : [this.def.start.x, this.def.start.z];
    this.ring.rotation.set(0, -Math.atan2(z - prev[1], x - prev[0]) + Math.PI / 2, 0);
    this.beam.position.set(x, 30, z);
    const next = cps[this.index + 1];
    this.nextBeam.visible = !!next;
    if (next) this.nextBeam.position.set(next[0], 20, next[1]);
  }

  start(def: MissionDef): void {
    this.def = def;
    this.index = 0;
    this.elapsed = 0;
    this.countdown = 3.999;
    this.lastCount = 4;
    this.state = 'countdown';
    this.startMarker.visible = false;
    this.events.onIntro(def);
  }

  /** Called by the UI when the player closes the result card. */
  dismiss(): void {
    this.state = 'idle';
    this.def = null;
    this.cooldown = 3;
    this.hideCheckpoints();
  }

  private finish(success: boolean, reason: string): void {
    const def = this.def!;
    const time = this.elapsed;
    let cash = 0;
    let unlockName: string | undefined;
    const data = this.save.data;
    const firstClear = success && !data.completedMissions.includes(def.id);
    if (success) {
      cash = firstClear ? def.reward.cash : def.reward.repeatCash;
      data.cash += cash;
      if (firstClear) data.completedMissions.push(def.id);
      if (firstClear && def.reward.unlock && !data.unlocks.includes(def.reward.unlock)) {
        data.unlocks.push(def.reward.unlock);
        unlockName = def.reward.unlockName ?? def.reward.unlock;
      }
      const prevBest = data.bestTimes[def.id];
      if (prevBest === undefined || time < prevBest) data.bestTimes[def.id] = Math.round(time * 100) / 100;
      this.save.save();
    }
    this.state = 'result';
    this.hideCheckpoints();
    this.events.onResult(def, { success, reason, time, cash, unlockName, firstClear, best: data.bestTimes[def.id] });
  }

  update(dt: number, ctx: MissionContext, now: number): void {
    const avail = this.available;
    this.startMarker.visible = this.state === 'idle' && !!avail;
    if (avail) {
      this.startMarker.position.set(avail.start.x, 0, avail.start.z);
      (this.startMarker.children[0] as THREE.Mesh).scale.set(1, 1 + 0.08 * Math.sin(now * 4), 1);
    }
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.state === 'idle' && avail && this.cooldown === 0) {
      const inMarker = Math.hypot(ctx.carX - avail.start.x, ctx.carZ - avail.start.z) < avail.startRadius;
      if ((!avail.requiresVehicle || ctx.inCar) && inMarker && Math.abs(ctx.carSpeed) < 8) this.start(avail);
      return;
    }
    if (!this.def) return;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.events.onCountdown(n);
      }
      if (this.countdown <= 0) {
        this.state = 'active';
        this.placeCheckpoints();
      }
      return;
    }

    if (this.state === 'active') {
      this.elapsed += dt;
      this.ring.rotation.z += dt * 0.6;
      if (this.def.requiresVehicle && !ctx.inCar) return this.finish(false, 'You left the car');
      if (this.elapsed >= this.def.timeLimit) return this.finish(false, 'Time up');
      const [x, z] = this.def.checkpoints[this.index];
      if (Math.hypot(ctx.carX - x, ctx.carZ - z) < this.def.checkpointRadius) {
        this.index++;
        this.events.onCheckpoint(this.index, this.def.checkpoints.length);
        if (this.index >= this.def.checkpoints.length) return this.finish(true, 'All checkpoints cleared');
        this.placeCheckpoints();
      }
    }
  }
}
