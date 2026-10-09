import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { mat, part } from './placeholders';

/**
 * Arcade car, ported from the Unreal reference (GOLCar): kinematic, accel/brake/steer with
 * steering that needs speed, calms near top speed and flips in reverse; slides along walls.
 * PLACEHOLDER body: an original, generic hatchback built from boxes.
 */
export const CAR_LEN = 4.4;
export const CAR_WID = 1.85;
const CIRCLES = [-1.4, 0, 1.4];
const CIRCLE_R = 0.95;

export interface DriveInput {
  throttle: number; // -1..1
  steer: number;    // -1..1 (positive = right)
  handbrake: boolean;
}

export class Car {
  x: number;
  z: number;
  heading: number;
  speed = 0; // m/s along heading
  hasDriver = false;
  frozen = false;
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private paint: THREE.MeshStandardMaterial;
  private stripes: THREE.Mesh[] = [];
  private brakeMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private lastImpact = 0;

  // Tuning (m/s, m/s^2, rad/s)
  maxSpeed = 30;
  maxReverse = 9;
  accel = 9.5;
  brake = 26;
  rolling = 4.5;
  steerRate = THREE.MathUtils.degToRad(80);

  constructor(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.paint = new THREE.MeshStandardMaterial({ color: '#1e6b4a', roughness: 0.35, metalness: 0.4 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: '#7a0c08', emissive: '#ff2a1a', emissiveIntensity: 0.2 });
    this.headMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#fff1c0', emissiveIntensity: 0.6 });
    const g = this.group;
    const glass = mat('#1b252c', 0.15, 0.6);
    part(g, 'box', this.paint, [0, 0.62, 0], [4.3, 0.62, 1.8]);
    part(g, 'box', glass, [-0.25, 1.15, 0], [2.4, 0.55, 1.66]);
    part(g, 'box', this.paint, [-0.3, 1.45, 0], [2.1, 0.07, 1.6]);
    part(g, 'box', '#222222', [2.14, 0.45, 0], [0.08, 0.24, 1.78]);
    part(g, 'box', '#222222', [-2.14, 0.45, 0], [0.08, 0.24, 1.78]);
    for (const s of [-1, 1]) {
      part(g, 'box', this.headMat, [2.16, 0.78, s * 0.62], [0.04, 0.14, 0.34], [0, 0, 0], false);
      part(g, 'box', this.brakeMat, [-2.16, 0.8, s * 0.64], [0.04, 0.12, 0.3], [0, 0, 0], false);
      this.stripes.push(part(g, 'box', '#111111', [0, 0.72, s * 0.905], [4.2, 0.1, 0.02], [0, 0, 0], false));
      this.stripes.push(part(g, 'box', '#111111', [0, 0.52, s * 0.905], [4.2, 0.1, 0.02], [0, 0, 0], false));
      for (const ax of [-1.3, 1.3]) {
        const pivot = new THREE.Group();
        pivot.position.set(ax, 0.34, s * 0.84);
        part(pivot, 'cyl', '#151515', [0, 0, 0], [0.68, 0.24, 0.68], [Math.PI / 2, 0, 0]);
        part(pivot, 'box', '#9a9da0', [0, 0, s * 0.125], [0.3, 0.3, 0.02], [0, 0, 0], false);
        g.add(pivot);
        this.wheels.push(pivot);
      }
    }
    this.setPaint('default');
    this.sync();
  }

  /** 'danfo' is the reward paint from the Harbour Bend Sprint (yellow with black stripes). */
  setPaint(kind: 'default' | 'danfo'): void {
    this.paint.color.set(kind === 'danfo' ? '#f2c21a' : '#1e6b4a');
    for (const s of this.stripes) s.visible = kind === 'danfo';
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading));
  }

  /** True if the point lies within the car footprint grown by pad metres. */
  contains(px: number, pz: number, pad = 0): boolean {
    const dx = px - this.x;
    const dz = pz - this.z;
    const c = Math.cos(-this.heading);
    const s = Math.sin(-this.heading);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) < CAR_LEN / 2 + pad && Math.abs(lz) < CAR_WID / 2 + pad;
  }

  /** Pushes a circle (player/NPC) out of the car footprint. */
  pushOut(p: { x: number; z: number }, radius: number): void {
    const c = Math.cos(-this.heading);
    const s = Math.sin(-this.heading);
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    let lx = dx * c - dz * s;
    let lz = dx * s + dz * c;
    const hx = CAR_LEN / 2 + radius;
    const hz = CAR_WID / 2 + radius;
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = Math.sign(lx || 1) * hx;
    else lz = Math.sign(lz || 1) * hz;
    const c2 = Math.cos(this.heading);
    const s2 = Math.sin(this.heading);
    p.x = this.x + lx * c2 - lz * s2;
    p.z = this.z + lx * s2 + lz * c2;
  }

  /** Returns impact speed (m/s) if the car hit something this frame, else 0. */
  update(dt: number, input: DriveInput | null, world: CollisionWorld, obstacles: { x: number; z: number }[], now: number): number {
    const thr = input && !this.frozen ? input.throttle : 0;
    const steer = input && !this.frozen ? input.steer : 0;
    const hb = input ? input.handbrake || this.frozen : true;

    if (thr > 0) this.speed += (this.speed < 0 ? this.brake : this.accel) * thr * dt;
    else if (thr < 0) this.speed += (this.speed > 0 ? this.brake : this.accel * 0.6) * thr * dt;
    else this.speed = towards(this.speed, 0, this.rolling * dt);
    if (hb) this.speed = towards(this.speed, 0, this.brake * 1.2 * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -this.maxReverse, this.maxSpeed);

    const abs = Math.abs(this.speed);
    const grip = Math.min(1, abs / 7) * (1 - 0.45 * Math.min(1, abs / this.maxSpeed));
    this.heading += steer * this.steerRate * grip * Math.sign(this.speed) * (input?.handbrake ? 1.5 : 1) * dt;

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    // Collide the three footprint circles with the world and with people.
    let impact = 0;
    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    for (const off of CIRCLES) {
      const c = { x: this.x + fx * off, z: this.z + fz * off };
      let push = world.resolveCircle(c, CIRCLE_R);
      for (const o of obstacles) {
        const dx = c.x - o.x;
        const dz = c.z - o.z;
        const d = Math.hypot(dx, dz);
        const min = CIRCLE_R + 0.4;
        if (d < min && d > 1e-4) {
          push = { x: push.x + (dx / d) * (min - d), z: push.z + (dz / d) * (min - d) };
        }
      }
      if (push.x !== 0 || push.z !== 0) {
        this.x += push.x;
        this.z += push.z;
        const n = Math.hypot(push.x, push.z);
        const along = Math.abs((fx * push.x + fz * push.z) / n);
        if (along > 0.35) {
          impact = Math.max(impact, abs);
          this.speed *= abs > 4 ? -0.25 : 0;
        }
      }
    }
    if (impact > 0 && now - this.lastImpact < 0.25) impact = 0;
    if (impact > 0) this.lastImpact = now;

    this.brakeMat.emissiveIntensity = (thr < 0 && this.speed > 0.5) || hb ? 1.6 : 0.2;
    for (const w of this.wheels) w.rotation.z -= (this.speed * dt) / 0.34;
    this.sync();
    return impact;
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = -this.heading;
  }
}

function towards(v: number, target: number, step: number): number {
  return v > target ? Math.max(target, v - step) : Math.min(target, v + step);
}
