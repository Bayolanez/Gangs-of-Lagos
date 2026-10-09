import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { mat, part } from './placeholders';

/**
 * Vehicles (Milestone 2). One arcade model shared by every vehicle, tuned per type.
 * Ported from the Milestone 1 car: steering needs speed, calms near top speed and flips in reverse;
 * the footprint is a row of circles that slide along walls. Adds health, damage smoke and wrecking.
 * PLACEHOLDER bodies: original, generic shapes built from boxes and cylinders.
 */
export type VehicleKind = 'hatchback' | 'danfo' | 'sedan' | 'keke';

export interface VehicleSpec {
  name: string;
  len: number;
  wid: number;
  maxSpeed: number;
  maxReverse: number;
  accel: number;
  brake: number;
  rolling: number;
  steerDeg: number;
  circles: number[];
  circleR: number;
  health: number;
  camDist: number;
  camHeight: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  hatchback: { name: 'Hatchback', len: 4.4, wid: 1.85, maxSpeed: 30, maxReverse: 9, accel: 9.5, brake: 26, rolling: 4.5, steerDeg: 80, circles: [-1.4, 0, 1.4], circleR: 0.95, health: 100, camDist: 7.5, camHeight: 1.7 },
  danfo: { name: 'Danfo minibus', len: 4.8, wid: 2.0, maxSpeed: 22, maxReverse: 7, accel: 6.5, brake: 20, rolling: 4, steerDeg: 62, circles: [-1.6, 0, 1.6], circleR: 1.05, health: 140, camDist: 9.5, camHeight: 2.6 },
  sedan: { name: 'Saloon car', len: 4.6, wid: 1.85, maxSpeed: 24, maxReverse: 8, accel: 8, brake: 24, rolling: 4.5, steerDeg: 70, circles: [-1.5, 0, 1.5], circleR: 0.95, health: 100, camDist: 7.5, camHeight: 1.7 },
  keke: { name: 'Keke', len: 2.8, wid: 1.3, maxSpeed: 14, maxReverse: 5, accel: 6, brake: 18, rolling: 4, steerDeg: 90, circles: [-0.7, 0.7], circleR: 0.7, health: 60, camDist: 6, camHeight: 1.8 },
};

/** Paint jobs for your own hatchback. price null = earned, not bought. */
export interface PaintDef {
  name: string;
  color: string;
  stripes?: boolean;
  metal?: number;
  price: number | null;
  earnedBy?: string;
}
export const PAINTS: Record<string, PaintDef> = {
  green: { name: 'Harbour green', color: '#1e6b4a', price: 0 },
  blue: { name: 'Lagoon blue', color: '#1f5f8b', price: 2500 },
  red: { name: 'Pepper red', color: '#b3261e', price: 2500 },
  danfo: { name: 'Danfo yellow', color: '#f2c21a', stripes: true, price: null, earnedBy: 'Win the Harbour Bend Sprint' },
  gold: { name: 'Eko gold', color: '#c9a227', metal: 0.85, price: null, earnedBy: 'Finish every Harbour Bend job' },
};

export interface DriveInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** Optional owner so the caller can tell what was hit. */
  ref?: unknown;
}

export interface ImpactInfo {
  speed: number;
  hit: unknown;
}

let nextId = 1;

export class Vehicle {
  readonly id = nextId++;
  readonly spec: VehicleSpec;
  x: number;
  z: number;
  heading: number;
  speed = 0;
  health: number;
  wrecked = false;
  hasDriver = false;
  frozen = false;
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private paintMat: THREE.MeshStandardMaterial;
  private stripes: THREE.Mesh[] = [];
  private brakeMat: THREE.MeshStandardMaterial;
  private smoke: THREE.Mesh[] = [];
  private smokeT = 0;
  private lastImpact = -10;

  constructor(readonly kind: VehicleKind, x: number, z: number, heading: number, color?: string) {
    this.spec = SPECS[kind];
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.health = this.spec.health;
    this.paintMat = new THREE.MeshStandardMaterial({ color: color ?? '#1e6b4a', roughness: 0.35, metalness: 0.4 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: '#7a0c08', emissive: '#ff2a1a', emissiveIntensity: 0.2 });
    switch (kind) {
      case 'hatchback': this.buildHatchback(); break;
      case 'danfo': this.buildDanfo(); break;
      case 'sedan': this.buildSedan(); break;
      case 'keke': this.buildKeke(); break;
    }
    const smokeMat = new THREE.MeshBasicMaterial({ color: '#2a2826', transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), smokeMat.clone());
      s.visible = false;
      this.group.add(s);
      this.smoke.push(s);
    }
    this.sync();
  }

  // ---------- Bodies (placeholders) ----------
  private wheel(x: number, z: number, r: number, w: number): void {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    part(pivot, 'cyl', '#151515', [0, 0, 0], [r * 2, w, r * 2], [Math.PI / 2, 0, 0]);
    part(pivot, 'box', '#9a9da0', [0, 0, Math.sign(z) * (w / 2 + 0.01)], [r * 0.9, r * 0.9, 0.02], [0, 0, 0], false);
    this.group.add(pivot);
    this.wheels.push(pivot);
  }

  private lights(front: number, back: number, y: number, spread: number): void {
    const head = mat('#fff3c4');
    for (const s of [-1, 1]) {
      part(this.group, 'box', head, [front, y, s * spread], [0.04, 0.14, 0.32], [0, 0, 0], false);
      part(this.group, 'box', this.brakeMat, [back, y, s * spread], [0.04, 0.12, 0.28], [0, 0, 0], false);
    }
  }

  private buildHatchback(): void {
    const g = this.group;
    const glass = mat('#1b252c', 0.15, 0.6);
    part(g, 'box', this.paintMat, [0, 0.62, 0], [4.3, 0.62, 1.8]);
    part(g, 'box', glass, [-0.25, 1.15, 0], [2.4, 0.55, 1.66]);
    part(g, 'box', this.paintMat, [-0.3, 1.45, 0], [2.1, 0.07, 1.6]);
    part(g, 'box', '#222222', [2.14, 0.45, 0], [0.08, 0.24, 1.78]);
    part(g, 'box', '#222222', [-2.14, 0.45, 0], [0.08, 0.24, 1.78]);
    for (const s of [-1, 1]) {
      this.stripes.push(part(g, 'box', '#111111', [0, 0.72, s * 0.905], [4.2, 0.1, 0.02], [0, 0, 0], false));
      this.stripes.push(part(g, 'box', '#111111', [0, 0.52, s * 0.905], [4.2, 0.1, 0.02], [0, 0, 0], false));
      for (const ax of [-1.3, 1.3]) this.wheel(ax, s * 0.84, 0.34, 0.24);
    }
    this.lights(2.16, -2.16, 0.78, 0.63);
    this.setPaint('green');
  }

  private buildDanfo(): void {
    const g = this.group;
    const glass = mat('#1b252c', 0.15, 0.6);
    this.paintMat.color.set('#f2c21a');
    part(g, 'box', this.paintMat, [0, 1.35, 0], [4.7, 1.8, 1.95]);
    part(g, 'box', this.paintMat, [2.2, 0.85, 0], [0.4, 0.9, 1.9], [0, 0, 0.2]);
    part(g, 'box', glass, [0.1, 1.75, 0], [4.3, 0.6, 1.97], [0, 0, 0], false);
    part(g, 'box', glass, [2.36, 1.75, 0], [0.04, 0.6, 1.7], [0, 0, 0], false);
    for (const s of [-1, 1]) {
      part(g, 'box', '#111111', [0, 1.0, s * 0.99], [4.7, 0.12, 0.02], [0, 0, 0], false);
      part(g, 'box', '#111111', [0, 1.22, s * 0.99], [4.7, 0.12, 0.02], [0, 0, 0], false);
      for (const ax of [-1.45, 1.45]) this.wheel(ax, s * 0.86, 0.36, 0.24);
    }
    part(g, 'box', '#3a2a10', [-0.3, 1.0, -0.99], [1.0, 1.4, 0.03], [0, 0, 0], false); // sliding door seam
    for (let x = -1.6; x <= 1.6; x += 0.8) part(g, 'box', '#2b2b2b', [x, 2.32, 0], [0.06, 0.06, 1.8], [0, 0, 0], false); // roof rack
    part(g, 'box', '#2b2b2b', [0, 2.32, 0.82], [3.4, 0.06, 0.06], [0, 0, 0], false);
    part(g, 'box', '#2b2b2b', [0, 2.32, -0.82], [3.4, 0.06, 0.06], [0, 0, 0], false);
    this.lights(2.42, -2.36, 0.85, 0.7);
  }

  private buildSedan(): void {
    const g = this.group;
    const glass = mat('#1b252c', 0.15, 0.6);
    part(g, 'box', this.paintMat, [0, 0.62, 0], [4.5, 0.6, 1.8]);
    part(g, 'box', glass, [-0.1, 1.12, 0], [2.3, 0.5, 1.64]);
    part(g, 'box', this.paintMat, [-0.1, 1.4, 0], [2.0, 0.07, 1.56]);
    for (const s of [-1, 1]) for (const ax of [-1.4, 1.4]) this.wheel(ax, s * 0.84, 0.34, 0.24);
    this.lights(2.26, -2.26, 0.72, 0.62);
  }

  private buildKeke(): void {
    const g = this.group;
    part(g, 'box', this.paintMat, [-0.25, 0.8, 0], [2.0, 0.7, 1.25]);
    part(g, 'box', this.paintMat, [0.95, 0.75, 0], [0.7, 0.55, 0.6]);
    part(g, 'box', '#151515', [-0.2, 1.75, 0], [2.3, 0.08, 1.3]);
    for (const x of [-1.25, 0.85]) for (const s of [-1, 1]) part(g, 'box', '#222222', [x, 1.35, s * 0.6], [0.06, 0.85, 0.06], [0, 0, 0], false);
    this.wheel(-0.85, 0.6, 0.28, 0.18);
    this.wheel(-0.85, -0.6, 0.28, 0.18);
    this.wheel(1.15, 0.01, 0.28, 0.18);
    this.lights(1.31, -1.26, 0.95, 0.4);
  }

  // ---------- State ----------
  setPaint(id: string): void {
    const p = PAINTS[id] ?? PAINTS.green;
    this.paintMat.color.set(p.color);
    this.paintMat.metalness = p.metal ?? 0.4;
    this.paintMat.roughness = p.metal ? 0.25 : 0.35;
    for (const s of this.stripes) s.visible = !!p.stripes;
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  get healthPct(): number {
    return Math.max(0, this.health / this.spec.health);
  }

  repair(): void {
    this.health = this.spec.health;
    this.wrecked = false;
    for (const s of this.smoke) s.visible = false;
  }

  damage(amount: number): void {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) {
      this.wrecked = true;
      this.speed = 0;
    }
  }

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  circles(): Obstacle[] {
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    return this.spec.circles.map((o) => ({ x: this.x + fx * o, z: this.z + fz * o, r: this.spec.circleR, ref: this }));
  }

  contains(px: number, pz: number, pad = 0): boolean {
    const dx = px - this.x, dz = pz - this.z;
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < this.spec.len / 2 + pad && Math.abs(lz) < this.spec.wid / 2 + pad;
  }

  /** Pushes a circle (person) out of this vehicle's footprint. */
  pushOut(p: { x: number; z: number }, radius: number): boolean {
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const dx = p.x - this.x, dz = p.z - this.z;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    const hx = this.spec.len / 2 + radius, hz = this.spec.wid / 2 + radius;
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return false;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = Math.sign(lx || 1) * hx;
    else lz = Math.sign(lz || 1) * hz;
    const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
    p.x = this.x + lx * c2 - lz * s2;
    p.z = this.z + lx * s2 + lz * c2;
    return true;
  }

  /** Physics step for a driven (or coasting) vehicle. Returns the hardest impact this frame, if any. */
  update(dt: number, input: DriveInput | null, world: CollisionWorld, obstacles: Obstacle[], now: number): ImpactInfo | null {
    const sp = this.spec;
    const usable = input && !this.frozen && !this.wrecked;
    const thr = usable ? input.throttle : 0;
    const steer = usable ? input.steer : 0;
    const hb = input ? input.handbrake || this.frozen || this.wrecked : true;

    if (thr > 0) this.speed += (this.speed < 0 ? sp.brake : sp.accel) * thr * dt;
    else if (thr < 0) this.speed += (this.speed > 0 ? sp.brake : sp.accel * 0.6) * thr * dt;
    else this.speed = towards(this.speed, 0, sp.rolling * dt);
    if (hb) this.speed = towards(this.speed, 0, sp.brake * 1.2 * dt);
    // A badly damaged engine loses power.
    const limit = sp.maxSpeed * (this.healthPct < 0.3 ? 0.6 : 1);
    this.speed = THREE.MathUtils.clamp(this.speed, -sp.maxReverse, limit);

    const abs = Math.abs(this.speed);
    const grip = Math.min(1, abs / 7) * (1 - 0.45 * Math.min(1, abs / sp.maxSpeed));
    this.heading += steer * THREE.MathUtils.degToRad(sp.steerDeg) * grip * Math.sign(this.speed) * (input?.handbrake ? 1.5 : 1) * dt;

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    let impact: ImpactInfo | null = null;
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    for (const off of sp.circles) {
      const c = { x: this.x + fx * off, z: this.z + fz * off };
      let push = world.resolveCircle(c, sp.circleR);
      let hit: unknown = 'world';
      for (const o of obstacles) {
        if (o.ref === this) continue;
        const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz), min = sp.circleR + o.r;
        if (d < min && d > 1e-4) {
          push = { x: push.x + (dx / d) * (min - d), z: push.z + (dz / d) * (min - d) };
          hit = o.ref ?? 'obstacle';
        }
      }
      if (push.x !== 0 || push.z !== 0) {
        this.x += push.x;
        this.z += push.z;
        const n = Math.hypot(push.x, push.z);
        const along = Math.abs((fx * push.x + fz * push.z) / n);
        if (along > 0.35) {
          if (!impact || abs > impact.speed) impact = { speed: abs, hit };
          this.speed *= abs > 4 ? -0.25 : 0;
        }
      }
    }
    if (impact) {
      if (now - this.lastImpact < 0.25) impact = null;
      else this.lastImpact = now;
    }
    if (impact && impact.speed > 4) this.damage((impact.speed - 4) * 3.2);

    this.brakeMat.emissiveIntensity = (thr < 0 && this.speed > 0.5) || (hb && this.hasDriver) ? 1.6 : 0.2;
    for (const w of this.wheels) w.rotation.z -= (this.speed * dt) / 0.34;
    this.animateSmoke(dt);
    this.sync();
    return impact;
  }

  /** Kinematic move for AI traffic: no physics, just pose, wheels and brake lights. */
  drive(x: number, z: number, heading: number, speed: number, braking: boolean, dt: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = speed;
    this.brakeMat.emissiveIntensity = braking ? 1.6 : 0.2;
    for (const w of this.wheels) w.rotation.z -= (speed * dt) / 0.34;
    this.sync();
  }

  private animateSmoke(dt: number): void {
    const show = this.healthPct < 0.4;
    this.smokeT += dt * (this.wrecked ? 1.6 : 1);
    this.smoke.forEach((s, i) => {
      s.visible = show;
      if (!show) return;
      const t = (this.smokeT * 0.8 + i / this.smoke.length) % 1;
      s.position.set(this.spec.len * 0.38, 1.0 + t * 2.2, (i % 2 ? 0.2 : -0.2) * t);
      s.scale.setScalar(0.6 + t * 1.8);
      (s.material as THREE.MeshBasicMaterial).opacity = (this.wrecked ? 0.7 : 0.45) * (1 - t);
    });
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = -this.heading;
  }
}

function towards(v: number, target: number, step: number): number {
  return v > target ? Math.max(target, v - step) : Math.min(target, v + step);
}
