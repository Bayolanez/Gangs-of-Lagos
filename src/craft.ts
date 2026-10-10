import * as THREE from 'three';
import { CollisionWorld, pointInPoly } from './collision';
import { mat } from './placeholders';
import { BOUNDARY_H } from './district';

/**
 * Phase 6 "Wings and Water": a light plane, a helicopter and a speedboat with simple, forgiving
 * arcade controls. All three are original PLACEHOLDER shapes.
 *  - Plane: W/S throttle, A/D bank to turn, Arrow Up/Down nose up/down. Levels itself when you let go.
 *    Rotate at about 100 km/h; below about 80 km/h in the air the nose drops. Gentle touchdowns are fine.
 *  - Helicopter: hovers on its own. W/S tilt forward/back, A/D turn, Space (or Arrow Up) climb,
 *    Shift (or Arrow Down) descend.
 *  - Speedboat: drives like a car, on water only.
 * Anything solid you can stand on (ground, roofs) counts as a landing surface.
 */
export type CraftKind = 'plane' | 'heli' | 'boat';

export interface CraftInput {
  throttle: number; // W/S
  steer: number; // A/D
  pitch: number; // Arrow Up (+1) / Down (-1)
  lift: number; // heli: Space/Up (+1), Shift/Down (-1)
}

export interface CraftEnv {
  world: CollisionWorld;
  /** True where the surface is open water (boats float, planes ditch). */
  isWater(x: number, z: number): boolean;
}

export const WATER_Y = -1.75;
let nextId = 1000;

/** Height of whatever solid surface is under (x, z): ground 0, a roof, or the water line. */
export function surfaceAt(env: CraftEnv, x: number, z: number): number {
  let h = env.isWater(x, z) ? WATER_Y : 0;
  for (const b of env.world.near(x, z, 0.5)) if (b.height !== BOUNDARY_H && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) h = Math.max(h, b.height);
  for (const p of env.world.nearPolys(x, z, 0.5)) if (pointInPoly(x, z, p.pts)) h = Math.max(h, p.height);
  return h;
}

export class Craft {
  readonly id = nextId++;
  readonly group = new THREE.Group();
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch = 0;
  roll = 0;
  /** Forward speed (plane, boat) in m/s. */
  speed = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  health = 100;
  wrecked = false;
  grounded = true;
  hasDriver = false;
  private rotor: THREE.Object3D | null = null;
  private prop: THREE.Object3D | null = null;

  constructor(readonly kind: CraftKind, readonly home: { x: number; y: number; z: number; heading: number }) {
    this.x = home.x;
    this.y = home.y;
    this.z = home.z;
    this.heading = home.heading;
    if (kind === 'plane') this.buildPlane();
    else if (kind === 'heli') this.buildHeli();
    else this.buildBoat();
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.sync();
  }

  get kmh(): number {
    return Math.round((this.kind === 'heli' ? Math.hypot(this.vx, this.vz) : Math.abs(this.speed)) * 3.6);
  }

  /** Radius for getting in and for bumping. */
  get reach(): number {
    return this.kind === 'plane' ? 5 : this.kind === 'heli' ? 4.5 : 4.5;
  }

  reset(): void {
    Object.assign(this, { x: this.home.x, y: this.home.y, z: this.home.z, heading: this.home.heading, pitch: 0, roll: 0, speed: 0, vx: 0, vz: 0, vy: 0, health: 100, wrecked: false, grounded: true });
    this.sync();
  }

  place(x: number, y: number, z: number, heading: number): void {
    Object.assign(this, { x, y, z, heading, pitch: 0, roll: 0, speed: 0, vx: 0, vz: 0, vy: 0, grounded: true });
    this.sync();
  }

  private damage(n: number): void {
    this.health = Math.max(0, this.health - n);
    if (this.health === 0) this.wrecked = true;
  }

  /** Advance one step. Returns a short event name when something notable happens. */
  update(dt: number, input: CraftInput | null, env: CraftEnv): 'crash' | 'landed' | 'hard' | null {
    if (this.wrecked) return null;
    const inp = input ?? { throttle: 0, steer: 0, pitch: 0, lift: 0 };
    let event: 'crash' | 'landed' | 'hard' | null = null;
    if (this.kind === 'boat') event = this.updateBoat(dt, inp, env);
    else if (this.kind === 'plane') event = this.updatePlane(dt, inp, env, input !== null);
    else event = this.updateHeli(dt, inp, env, input !== null);
    if (this.rotor) this.rotor.rotation.y += dt * (this.grounded && !this.hasDriver ? 0 : 28);
    if (this.prop) this.prop.rotation.x += dt * (Math.abs(this.speed) > 0.5 || this.hasDriver ? 40 : 0);
    this.sync();
    return event;
  }

  private updateBoat(dt: number, inp: CraftInput, env: CraftEnv): 'crash' | null {
    const max = 21, accel = 7;
    if (inp.throttle > 0) this.speed += accel * inp.throttle * dt;
    else if (inp.throttle < 0) this.speed += (this.speed > 0 ? 12 : 4) * inp.throttle * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 3 * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -5, max);
    this.heading += inp.steer * 1.1 * Math.min(1, Math.abs(this.speed) / 4) * Math.sign(this.speed || 1) * dt;
    const nx = this.x + Math.cos(this.heading) * this.speed * dt, nz = this.z + Math.sin(this.heading) * this.speed * dt;
    // The bow must stay on water: run aground and you stop.
    const bx = nx + Math.cos(this.heading) * 2.4 * Math.sign(this.speed || 1), bz = nz + Math.sin(this.heading) * 2.4 * Math.sign(this.speed || 1);
    if (env.isWater(nx, nz) && env.isWater(bx, bz)) {
      this.x = nx;
      this.z = nz;
    } else {
      if (Math.abs(this.speed) > 9) this.damage((Math.abs(this.speed) - 9) * 3);
      this.speed = 0;
    }
    this.y = WATER_Y + Math.sin(performance.now() / 600 + this.x) * 0.04;
    this.roll += (-inp.steer * Math.min(1, Math.abs(this.speed) / 12) * 0.18 - this.roll) * Math.min(1, dt * 4);
    this.pitch += (Math.min(0.12, Math.abs(this.speed) / 150) - this.pitch) * Math.min(1, dt * 3);
    return this.wrecked ? 'crash' : null;
  }

  private updatePlane(dt: number, inp: CraftInput, env: CraftEnv, piloted: boolean): 'crash' | 'landed' | 'hard' | null {
    const ground = surfaceAt(env, this.x, this.z);
    const ROTATE = 28, STALL = 22, MAX = 62;
    // Throttle and drag
    if (inp.throttle > 0) this.speed += 11 * inp.throttle * dt;
    else if (inp.throttle < 0) this.speed += (this.grounded ? 14 : 5) * inp.throttle * dt;
    this.speed -= (this.grounded ? 1.2 : 0.4) * (this.speed / MAX) * dt * 4;
    if (!piloted && this.grounded) this.speed -= Math.min(this.speed, 6 * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, 0, MAX);

    if (this.grounded) {
      // Taxi and take off.
      this.heading += inp.steer * 0.8 * Math.min(1, this.speed / 6) * dt;
      this.roll = 0;
      this.pitch += ((inp.pitch > 0 && this.speed > ROTATE ? 0.15 : 0) - this.pitch) * Math.min(1, dt * 3);
      this.vy = 0;
      this.y = ground;
      if (this.pitch > 0.08 && this.speed > ROTATE) {
        this.grounded = false;
        this.vy = 2;
        this.y = ground + 0.15;
      }
    } else {
      // Fly: bank to turn, nose up/down, levels itself when you let go.
      this.roll += (inp.steer * 0.75 - this.roll) * Math.min(1, dt * 2.2);
      this.heading += this.roll * 0.55 * dt;
      const target = inp.pitch * 0.45;
      this.pitch += (target - this.pitch) * Math.min(1, dt * (inp.pitch ? 1.6 : 1.0));
      let climb = this.speed * Math.sin(this.pitch);
      if (this.speed < STALL) {
        // Stall: the nose drops and you sink until you have speed again.
        this.pitch = Math.max(-0.3, this.pitch - 0.6 * dt);
        climb -= (STALL - this.speed) * 0.6;
      }
      // Forgiving flare: close to the ground with the nose not pushed down, the sink rate eases off.
      if (inp.pitch >= 0 && this.y - ground < 6 && ground > WATER_Y + 0.01) climb = Math.max(climb, -3.5);
      this.vy += (climb - this.vy) * Math.min(1, dt * 3);
      this.y += this.vy * dt;
      this.y = Math.min(this.y, 450);
    }
    const nx = this.x + Math.cos(this.heading) * Math.cos(this.pitch) * this.speed * dt;
    const nz = this.z + Math.sin(this.heading) * Math.cos(this.pitch) * this.speed * dt;
    // Hitting something tall ends the flight.
    const ahead = surfaceAt(env, nx, nz);
    if (this.y < ahead - 0.5 && ahead > 1) {
      this.wrecked = true;
      return 'crash';
    }
    this.x = nx;
    this.z = nz;
    if (!this.grounded) {
      const floor = surfaceAt(env, this.x, this.z);
      if (this.y <= floor && this.vy <= 0) {
        this.y = floor;
        if (floor <= WATER_Y + 0.01) {
          this.wrecked = true; // ditched in the lagoon
          return 'crash';
        }
        const hard = this.vy < -7 || Math.abs(this.roll) > 0.5;
        if (this.vy < -14 || Math.abs(this.roll) > 0.9) {
          this.wrecked = true;
          return 'crash';
        }
        this.grounded = true;
        this.vy = 0;
        this.pitch = 0;
        this.roll = 0;
        if (hard) {
          this.damage(25);
          return 'hard';
        }
        return 'landed';
      }
    }
    return null;
  }

  private updateHeli(dt: number, inp: CraftInput, env: CraftEnv, piloted: boolean): 'crash' | 'landed' | 'hard' | null {
    // Tilt forward/back to move; it slows and hovers by itself.
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    if (!this.grounded) {
      this.vx += fx * inp.throttle * 13 * dt;
      this.vz += fz * inp.throttle * 13 * dt;
      this.heading += inp.steer * 1.4 * dt;
    } else if (inp.lift <= 0) {
      this.vx = this.vz = 0;
    }
    const damp = Math.min(1, dt * (inp.throttle ? 0.4 : 1.1));
    this.vx -= this.vx * damp;
    this.vz -= this.vz * damp;
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 45) {
      this.vx *= 45 / sp;
      this.vz *= 45 / sp;
    }
    const targetVy = piloted ? inp.lift * 8 : this.grounded ? 0 : -3;
    this.vy += (targetVy - this.vy) * Math.min(1, dt * 2.5);
    this.pitch += (-inp.throttle * 0.22 - this.pitch) * Math.min(1, dt * 3);
    this.roll += (-inp.steer * 0.12 - this.roll) * Math.min(1, dt * 3);
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const ahead = surfaceAt(env, nx, nz);
    if (this.y < ahead - 0.3) {
      // Side of a building: bounce back and take damage at speed.
      if (sp > 8) this.damage((sp - 8) * 4);
      this.vx *= -0.3;
      this.vz *= -0.3;
      if (this.wrecked) return 'crash';
    } else {
      this.x = nx;
      this.z = nz;
    }
    this.y += this.vy * dt;
    this.y = Math.min(this.y, 400);
    const f2 = surfaceAt(env, this.x, this.z);
    if (this.y <= f2) {
      const impact = -this.vy;
      this.y = f2;
      if (f2 <= WATER_Y + 0.01 && !this.grounded) {
        this.wrecked = true; // came down in the water
        return 'crash';
      }
      if (!this.grounded) {
        this.grounded = true;
        this.vy = 0;
        if (impact > 7) {
          this.damage((impact - 7) * 12);
          return this.wrecked ? 'crash' : 'hard';
        }
        return 'landed';
      }
      this.vy = Math.max(0, this.vy);
    } else if (this.y > f2 + 0.05) this.grounded = false;
    return null;
  }

  sync(): void {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(-this.heading);
    this.group.rotateZ(this.pitch);
    this.group.rotateX(this.roll);
  }

  // ---------- PLACEHOLDER shapes ----------
  private add(geo: THREE.BufferGeometry, color: string, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = this.group): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat(color, 0.45, 0.2));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  private buildPlane(): void {
    const body = '#e9e8e2', trim = '#1f5f8b';
    this.add(SPHERE, body, [0, 1.5, 0], [3.6, 0.75, 0.72]); // fuselage
    this.add(SPHERE, '#1b252c', [1.3, 1.95, 0], [1.1, 0.42, 0.6]); // canopy
    this.add(BOX_ROUND, body, [0.4, 2.15, 0], [1.6, 0.12, 9.6]); // high wing
    this.add(BOX_ROUND, trim, [0.4, 2.2, 0], [1.62, 0.05, 9.62]);
    this.add(BOX_ROUND, body, [-3.1, 1.65, 0], [0.9, 0.1, 3.2]); // tailplane
    this.add(BOX_ROUND, trim, [-3.2, 2.35, 0], [0.9, 1.3, 0.1]); // fin
    this.prop = new THREE.Group();
    this.prop.position.set(3.65, 1.5, 0);
    this.add(SPHERE, '#2b2b2b', [0, 0, 0], [0.25, 0.25, 0.25], [0, 0, 0], this.prop);
    this.add(BOX_ROUND, '#2b2b2b', [0.05, 0, 0], [0.06, 2.1, 0.14], [0, 0, 0], this.prop);
    this.group.add(this.prop);
    for (const z of [-1.3, 1.3]) {
      this.add(CYL, '#555', [0.6, 0.7, z], [0.05, 1.3, 0.05], [z > 0 ? -0.4 : 0.4, 0, 0]);
      this.add(TYRE, '#151515', [0.6, 0.32, z * 1.15], [0.32, 0.32, 0.4]);
    }
    this.add(TYRE, '#151515', [2.6, 0.25, 0], [0.24, 0.24, 0.3]);
  }

  private buildHeli(): void {
    const body = '#c0392b';
    this.add(SPHERE, body, [0.2, 1.6, 0], [2.0, 1.15, 1.05]); // cabin
    this.add(SPHERE, '#1b252c', [1.15, 1.75, 0], [0.95, 0.75, 0.85]); // bubble glass
    this.add(CYL, body, [-2.6, 1.85, 0], [0.18, 3.6, 0.18], [0, 0, Math.PI / 2]); // tail boom
    this.add(BOX_ROUND, body, [-4.3, 2.35, 0], [0.6, 1.0, 0.08]); // fin
    this.add(BOX_ROUND, '#2b2b2b', [-4.35, 2.4, 0.12], [0.08, 1.3, 0.05]); // tail rotor
    for (const z of [-0.85, 0.85]) {
      this.add(CYL, '#333', [0.2, 0.15, z], [0.06, 3.4, 0.06], [0, 0, Math.PI / 2]); // skids
      for (const x of [-0.6, 1.0]) this.add(CYL, '#333', [x, 0.5, z * 0.85], [0.04, 0.7, 0.04]);
    }
    this.rotor = new THREE.Group();
    this.rotor.position.set(0.2, 2.95, 0);
    this.add(CYL, '#333', [0, -0.15, 0], [0.12, 0.3, 0.12], [0, 0, 0], this.rotor);
    for (const a of [0, Math.PI / 2]) this.add(BOX_ROUND, '#222', [0, 0, 0], [9.5, 0.05, 0.28], [0, a, 0], this.rotor);
    this.group.add(this.rotor);
  }

  private buildBoat(): void {
    const hull = '#e9e8e2';
    this.add(SPHERE, hull, [0, 0.35, 0], [3.2, 0.55, 1.1]); // hull
    this.add(BOX_ROUND, '#1f5f8b', [0, 0.5, 0], [6.0, 0.14, 2.22]); // rub strake
    this.add(SPHERE, '#1b252c', [0.3, 1.1, 0], [0.7, 0.42, 0.9]); // windscreen
    this.add(BOX_ROUND, '#c9b48a', [-0.8, 0.85, 0], [2.2, 0.2, 1.7]); // deck seats
    this.add(BOX_ROUND, '#2b2b2b', [-3.0, 0.7, 0], [0.5, 0.9, 0.5]); // outboard motor
  }
}

const SPHERE = new THREE.SphereGeometry(1, 18, 12);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const TYRE = new THREE.TorusGeometry(0.7, 0.3, 8, 16);
/** Rounded panels (wings, fins, seats): a squashed sphere instead of a box. */
const BOX_ROUND = new THREE.SphereGeometry(0.5, 16, 8);
