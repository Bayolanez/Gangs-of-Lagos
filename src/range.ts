import * as THREE from 'three';
import { mat } from './placeholders';
import { Ray, rayBox } from './weapons';

/**
 * Range Day (Phase 4): timed pop-up targets at the fictional Harbour Bend Range.
 * You shoot west from the firing line with a loaner Egret pistol. Medals unlock weapons at the counter.
 */
export const RANGE = {
  /** Firing line (x) and where you stand for a challenge. */
  lineX: -61,
  stand: { x: -57, z: 0, heading: Math.PI },
  /** Lanes run west from the line; targets stand between these distances. */
  lanes: [-16, -8, 0, 8, 16],
  near: -72,
  far: -98,
  /** Area you must stay inside during a challenge. */
  area: { minX: -64, maxX: -48, minZ: -24, maxZ: 24 },
  duration: 40,
  /** Hits needed for bronze, silver and gold. */
  medals: [10, 18, 26],
  upTime: 3.2,
};

export const MEDAL_REWARDS = [
  '',
  'The Egret pistol is yours, with 24 rounds. The counter now sells it.',
  'The counter now sells the Kingfisher SMG and the Breakwater shotgun.',
  'The counter now sells the Harmattan rifle and the Heron marksman rifle.',
];

interface PopTarget {
  mesh: THREE.Group;
  x: number;
  z: number;
  up: number;
  rise: number;
}

export type RangeState = 'idle' | 'countdown' | 'live';

export class RangeChallenge {
  state: RangeState = 'idle';
  timeLeft = RANGE.duration;
  countdown = 0;
  hits = 0;
  shots = 0;
  private targets: PopTarget[] = [];
  private gap = 0;
  private lastLane = -1;

  constructor(private scene: THREE.Scene, private rand: () => number) {}

  start(): void {
    this.clear();
    this.state = 'countdown';
    this.countdown = 3;
    this.timeLeft = RANGE.duration;
    this.hits = 0;
    this.shots = 0;
    this.gap = 0;
  }

  get medal(): number {
    let m = 0;
    RANGE.medals.forEach((need, i) => {
      if (this.hits >= need) m = i + 1;
    });
    return m;
  }

  /** Remaining hits needed for the next medal, or null at gold. */
  get nextMedal(): { medal: number; need: number } | null {
    const i = RANGE.medals.findIndex((n) => this.hits < n);
    return i < 0 ? null : { medal: i + 1, need: RANGE.medals[i] - this.hits };
  }

  stop(): void {
    this.clear();
    this.state = 'idle';
  }

  private clear(): void {
    for (const t of this.targets) t.mesh.removeFromParent();
    this.targets = [];
  }

  private popUp(): void {
    let lane = Math.floor(this.rand() * RANGE.lanes.length);
    if (lane === this.lastLane) lane = (lane + 1) % RANGE.lanes.length;
    if (this.targets.some((t) => t.z === RANGE.lanes[lane])) return;
    this.lastLane = lane;
    const x = RANGE.near + (RANGE.far - RANGE.near) * this.rand();
    const z = RANGE.lanes[lane];
    const g = new THREE.Group();
    // PLACEHOLDER target: plain board on a post, rings painted as boxes.
    const add = (c: string, y: number, sy: number, sz: number, dx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, sy, sz), mat(c));
      m.position.set(dx, y, 0);
      m.castShadow = true;
      g.add(m);
    };
    add('#6b4a2e', 0.4, 0.8, 0.08);
    add('#efe6cf', 1.3, 1.0, 0.6);
    add('#c0392b', 1.3, 0.5, 0.3, 0.02);
    add('#111111', 1.3, 0.16, 0.1, 0.04);
    g.position.set(x, 0, z);
    g.scale.y = 0.01;
    this.scene.add(g);
    this.targets.push({ mesh: g, x, z, up: RANGE.upTime - Math.min(1.2, (RANGE.duration - this.timeLeft) * 0.03), rise: 0 });
  }

  /** Positions of standing targets (for tests and the debug hook). */
  standing(): { x: number; y: number; z: number }[] {
    return this.targets.filter((t) => t.rise >= 1).map((t) => ({ x: t.x, y: 1.3, z: t.z }));
  }

  /** Distance to the nearest standing target board along the ray (null if none). */
  rayHit(r: Ray, maxT: number): { t: number; index: number } | null {
    let best: { t: number; index: number } | null = null;
    this.targets.forEach((tg, index) => {
      if (tg.rise < 0.9) return;
      const t = rayBox(r, tg.x - 0.1, tg.x + 0.1, 0.8, 1.8, tg.z - 0.3, tg.z + 0.3);
      if (t !== null && t <= maxT && (!best || t < best.t)) best = { t, index };
    });
    return best;
  }

  hitTarget(index: number): void {
    const t = this.targets[index];
    if (!t) return;
    t.mesh.removeFromParent();
    this.targets.splice(index, 1);
    this.hits++;
    this.gap = Math.min(this.gap, 0.35);
  }

  /** Returns 'go' when the countdown ends and 'done' when time runs out. */
  update(dt: number): 'go' | 'done' | null {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'live';
        return 'go';
      }
      return null;
    }
    if (this.state !== 'live') return null;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.clear();
      this.state = 'idle';
      return 'done';
    }
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.rise = Math.min(1, t.rise + dt * 5);
      t.mesh.scale.y = Math.max(0.01, t.rise);
      t.up -= dt;
      if (t.up <= 0) {
        t.mesh.removeFromParent();
        this.targets.splice(i, 1);
      }
    }
    this.gap -= dt;
    if (this.gap <= 0 && this.targets.length < 2) {
      this.popUp();
      this.gap = 0.5 + this.rand() * 0.6;
    }
    return null;
  }
}
