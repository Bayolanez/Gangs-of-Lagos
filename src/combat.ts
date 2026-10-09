import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { HumanRig } from './human';
import { lineOfSight } from './weapons';

/**
 * Phase 4: health, armour, heat (1 to 5) and the fictional Harbour Patrol Unit.
 * The unit, its uniform and the hospital are invented; no real police force or agency is depicted.
 * Officers are PLACEHOLDER box people with simple steer-towards-you AI.
 */
export const UNIT_NAME = 'Harbour Patrol Unit';
export const MAX_HEAT = 5;
/** Officers on the street at each heat level. */
const OFFICERS_AT = [0, 2, 3, 4, 6, 8];
/** Seconds out of sight before heat drops by one level (plus a little more per level). */
export const COOL_BASE = 10;
export const COOL_PER_LEVEL = 3;

export type Crime = 'shots' | 'assault' | 'officer';

export interface Target {
  x: number;
  z: number;
}

export class Officer {
  x: number;
  z: number;
  heading = 0;
  health = 100;
  readonly radius = 0.35;
  readonly rig = new HumanRig({ shirt: '#4d6b8a', pants: '#20262e', skin: '#4a3020', top: 'jacket', hat: 'cap', stripe: true });
  shootTimer: number;
  downTimer = 0;
  leaving = false;
  /** Where this officer is searching when they can't see you. */
  search: Target | null = null;
  private stuck = 0;
  private sideStep = 0;
  private sideDir = 1;

  constructor(x: number, z: number, rand: () => number) {
    this.x = x;
    this.z = z;
    this.shootTimer = 1.2 + rand() * 1.2;
    this.sideDir = rand() < 0.5 ? 1 : -1;
    this.rig.root.userData.officer = this;
    this.sync();
  }

  get down(): boolean {
    return this.health <= 0;
  }

  hurt(amount: number): boolean {
    if (this.down) return false;
    this.health -= amount;
    if (this.down) {
      this.downTimer = 8;
      this.rig.root.rotation.z = Math.PI / 2; // falls over (no gore: they are knocked down)
      this.rig.root.position.y = 0.3;
    }
    return true;
  }

  /** Walk towards (or away from) the target; slide along walls and side-step when stuck. */
  move(dt: number, tx: number, tz: number, speed: number, world: CollisionWorld, away: boolean): number {
    let dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    if (away) {
      dx = -dx;
      dz = -dz;
    }
    if (this.sideStep > 0) {
      this.sideStep -= dt;
      [dx, dz] = [-dz * this.sideDir, dx * this.sideDir];
    }
    const ox = this.x, oz = this.z;
    this.x += dx * speed * dt;
    this.z += dz * speed * dt;
    world.resolveCircle(this, this.radius);
    const moved = Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
    this.stuck = moved < speed * 0.3 ? this.stuck + dt : 0;
    if (this.stuck > 0.5) {
      this.sideStep = 1.2;
      this.sideDir = -this.sideDir;
      this.stuck = 0;
    }
    const target = Math.atan2(dz, dx);
    let diff = target - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * Math.min(1, dt * 8);
    return moved;
  }

  face(tx: number, tz: number): void {
    this.heading = Math.atan2(tz - this.z, tx - this.x);
  }

  sync(): void {
    if (this.down) return;
    this.rig.root.position.set(this.x, 0, this.z);
    this.rig.root.rotation.y = -this.heading;
  }
}

export interface CombatEvents {
  /** An officer fired at the player; hit says whether it landed. */
  onOfficerShot(o: Officer, hit: boolean, tx: number, tz: number): void;
  onHeatChange(level: number, previous: number): void;
}

export interface PlayerView {
  x: number;
  z: number;
  /** In a vehicle: officers shoot the vehicle instead and miss more at speed. */
  vehicleSpeed: number | null;
  sprinting: boolean;
}

/** Health, armour, heat and officers. The caller applies damage to the player through hurtPlayer(). */
export class Combat {
  health = 100;
  armour = 0;
  heat = 0;
  /** Seconds since any officer last saw the player (drives cooling). */
  unseen = 0;
  /** Seconds since the player last took damage (drives regeneration). */
  calm = 99;
  readonly officers: Officer[] = [];
  private spawnTimer = 0;
  private crimeCooldown = 0;
  /** True while no officer can see you; changing clothes then clears heat. */
  hidden = true;
  /** Where the patrol last saw you. Officers arrive and search around here, so getting away works. */
  lastSeen: Target = { x: 0, z: 0 };
  private reported = false;

  constructor(private scene: THREE.Scene, private world: CollisionWorld, private rand: () => number, private events: CombatEvents, private canSpawnAt: (x: number, z: number) => boolean) {}

  get cooldownNeeded(): number {
    return COOL_BASE + COOL_PER_LEVEL * this.heat;
  }

  setHeat(level: number): void {
    const prev = this.heat;
    this.heat = Math.max(0, Math.min(MAX_HEAT, Math.round(level)));
    if (this.heat !== prev) {
      this.unseen = 0;
      this.events.onHeatChange(this.heat, prev);
    }
  }

  /** Report a crime. Repeated crimes inside a few seconds count once, so a burst of fire isn't instant 5 heat. */
  crime(kind: Crime): void {
    this.reported = true;
    if (kind === 'shots') {
      if (this.heat < 1) this.setHeat(1);
      return;
    }
    if (this.crimeCooldown > 0) return;
    this.crimeCooldown = 2.5;
    const floor = kind === 'officer' ? 3 : 2;
    this.setHeat(Math.max(floor, this.heat + 1));
  }

  /** Damage soaks into armour first. Returns true if the player went down. */
  hurtPlayer(amount: number): boolean {
    if (this.health <= 0) return false;
    this.calm = 0;
    const soak = Math.min(this.armour, amount);
    this.armour -= soak;
    this.health = Math.max(0, this.health - (amount - soak));
    return this.health <= 0;
  }

  /** Back to full after a hospital stay; officers stand down. */
  recover(): void {
    this.health = 100;
    this.calm = 99;
    this.setHeat(0);
    this.clearOfficers();
  }

  clearOfficers(): void {
    for (const o of this.officers) o.rig.root.removeFromParent();
    this.officers.length = 0;
  }

  /** An officer that is up and has a clear view of p. */
  seenBy(p: Target): Officer | null {
    for (const o of this.officers) {
      if (o.down || o.leaving) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < 70 && lineOfSight(this.world, o.x, 1.6, o.z, p.x, 1.3, p.z)) return o;
    }
    return null;
  }

  /** Officers arrive 40 to 65 m from where you were last seen, out of your sight when possible. */
  private spawn(p: Target): void {
    const c = this.lastSeen;
    for (let i = 0; i < 32; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = 40 + this.rand() * 25;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!this.canSpawnAt(x, z) || this.world.overlapsCircle(x, z, 0.6)) continue;
      if (i < 24 && lineOfSight(this.world, x, 1.6, z, p.x, 1.3, p.z)) continue;
      const o = new Officer(x, z, this.rand);
      o.face(p.x, p.z);
      o.sync();
      this.officers.push(o);
      this.scene.add(o.rig.root);
      return;
    }
  }

  update(dt: number, p: PlayerView): void {
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);
    this.calm += dt;
    // Regenerate slowly once out of trouble: up to full when calm, half while wanted.
    const cap = this.heat > 0 ? 50 : 100;
    if (this.calm > 6 && this.health > 0 && this.health < cap) this.health = Math.min(cap, this.health + 2 * dt);

    const seer = this.seenBy(p);
    this.hidden = !seer;
    if (seer || this.reported) this.lastSeen = { x: p.x, z: p.z };
    this.reported = false;

    // Officers: keep the right number on the street for the heat level.
    const want = OFFICERS_AT[this.heat];
    const active = this.officers.filter((o) => !o.down && !o.leaving).length;
    this.spawnTimer -= dt;
    if (active < want && this.spawnTimer <= 0) {
      this.spawn(p);
      this.spawnTimer = 2.2;
    }
    if (this.heat === 0) for (const o of this.officers) o.leaving = true;

    if (this.heat > 0) {
      if (seer) this.unseen = 0;
      else {
        this.unseen += dt;
        if (this.unseen >= this.cooldownNeeded) this.setHeat(this.heat - 1);
      }
    }

    const run = 4.6 + this.heat * 0.25;
    // Iterate over a copy: a shot can put the player down, which clears every officer mid-loop.
    for (const o of [...this.officers]) {
      if (!this.officers.includes(o)) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (o.down) {
        o.downTimer -= dt;
        if (o.downTimer <= 0) this.remove(o);
        continue;
      }
      if (o.leaving) {
        o.move(dt, p.x, p.z, 2.4, this.world, true);
        o.rig.animate(dt, 2.4);
        o.sync();
        if (d > 70) this.remove(o);
        continue;
      }
      if (d > 120) {
        this.remove(o);
        continue;
      }
      const sees = d < 60 && lineOfSight(this.world, o.x, 1.6, o.z, p.x, 1.3, p.z);
      let speed = 0;
      if (sees) {
        o.search = null;
        if (d > 16) speed = o.move(dt, p.x, p.z, run, this.world, false);
        else o.face(p.x, p.z);
      } else {
        // Search: head for where you were last seen, then check spots around it.
        const ls = this.lastSeen;
        if (!o.search || Math.hypot(o.x - o.search.x, o.z - o.search.z) < 3) {
          const near = Math.hypot(o.x - ls.x, o.z - ls.z) < 6;
          const a = this.rand() * Math.PI * 2, r = near ? 6 + this.rand() * 14 : 0;
          o.search = { x: ls.x + Math.cos(a) * r, z: ls.z + Math.sin(a) * r };
        }
        speed = o.move(dt, o.search.x, o.search.z, run * 0.75, this.world, false);
      }
      o.rig.animate(dt, speed);
      o.sync();
      if (sees && d < 45) {
        o.shootTimer -= dt;
        if (o.shootTimer <= 0) {
          o.shootTimer = Math.max(0.6, 1.7 - this.heat * 0.2) + this.rand() * 0.5;
          o.face(p.x, p.z);
          let chance = 0.3 + this.heat * 0.07 - d * 0.005;
          if (p.vehicleSpeed !== null) chance -= Math.min(0.25, Math.abs(p.vehicleSpeed) * 0.02);
          if (p.sprinting) chance -= 0.1;
          const hit = this.rand() < Math.max(0.05, chance);
          this.events.onOfficerShot(o, hit, p.x, p.z);
        }
      }
    }
  }

  private remove(o: Officer): void {
    o.rig.root.removeFromParent();
    const i = this.officers.indexOf(o);
    if (i >= 0) this.officers.splice(i, 1);
  }
}
