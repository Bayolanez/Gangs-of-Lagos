import * as THREE from 'three';
import { EkoK7, loaded } from './models';
import { CollisionWorld, pointInPoly } from './collision';
import { part } from './placeholders';

/**
 * Phase 4 "Street Kit": original PLACEHOLDER weapons. Names, stats and shapes are invented for this
 * game; nothing is modelled on a real firearm or on any other game's weapons.
 */
export type WeaponClass = 'melee' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'marksman';
export type WeaponId = 'pipe' | 'egret' | 'kingfisher' | 'breakwater' | 'harmattan' | 'heron';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cls: WeaponClass;
  /** Number key that draws it. */
  key: number;
  /** Damage per hit (per pellet for the shotgun). */
  damage: number;
  /** Shots (or swings) per second. */
  rate: number;
  auto: boolean;
  /** Rounds per magazine (0 for melee). */
  mag: number;
  reload: number;
  /** Metres. */
  range: number;
  /** Cone half-angle in radians at rest; moving or sprinting widens it. */
  spread: number;
  pellets: number;
  /** Price at the range counter. */
  price: number;
  ammoPack: number;
  ammoPrice: number;
  /** Range Day medal needed before the counter sells it (0 = always on sale, 1 bronze, 2 silver, 3 gold). */
  medal: number;
  /** Aiming field of view (degrees). */
  aimFov: number;
  colour: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pipe: { id: 'pipe', name: 'Iron pipe', cls: 'melee', key: 1, damage: 34, rate: 1.6, auto: false, mag: 0, reload: 0, range: 2.1, spread: 0, pellets: 1, price: 300, ammoPack: 0, ammoPrice: 0, medal: 0, aimFov: 55, colour: '#7d8288' },
  egret: { id: 'egret', name: 'Egret pistol', cls: 'pistol', key: 2, damage: 24, rate: 3.2, auto: false, mag: 12, reload: 1.3, range: 70, spread: 0.01, pellets: 1, price: 2500, ammoPack: 24, ammoPrice: 200, medal: 1, aimFov: 50, colour: '#2b2d31' },
  kingfisher: { id: 'kingfisher', name: 'Kingfisher SMG', cls: 'smg', key: 3, damage: 14, rate: 11, auto: true, mag: 30, reload: 1.8, range: 50, spread: 0.028, pellets: 1, price: 6000, ammoPack: 60, ammoPrice: 400, medal: 2, aimFov: 50, colour: '#1f5f8b' },
  breakwater: { id: 'breakwater', name: 'Breakwater shotgun', cls: 'shotgun', key: 4, damage: 13, rate: 1.1, auto: false, mag: 6, reload: 2.4, range: 26, spread: 0.07, pellets: 8, price: 7000, ammoPack: 12, ammoPrice: 400, medal: 2, aimFov: 52, colour: '#6b4a2e' },
  harmattan: { id: 'harmattan', name: 'Harmattan rifle', cls: 'rifle', key: 5, damage: 27, rate: 7, auto: true, mag: 30, reload: 2.0, range: 100, spread: 0.014, pellets: 1, price: 12000, ammoPack: 60, ammoPrice: 700, medal: 3, aimFov: 42, colour: '#8a7a55' },
  heron: { id: 'heron', name: 'Heron marksman rifle', cls: 'marksman', key: 6, damage: 80, rate: 0.9, auto: false, mag: 5, reload: 2.6, range: 170, spread: 0.0015, pellets: 1, price: 15000, ammoPack: 10, ammoPrice: 600, medal: 3, aimFov: 22, colour: '#3f5a3a' },
};
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const MEDALS = ['none', 'bronze', 'silver', 'gold'] as const;

// ---------- Ray tests (pure maths; no rendering needed, so tests can step the game) ----------

export interface Ray {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
}

/** Distance along the ray to an axis-aligned box, or null. */
export function rayBox(r: Ray, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): number | null {
  let t0 = 0, t1 = Infinity;
  const axes: [number, number, number, number][] = [[r.ox, r.dx, minX, maxX], [r.oy, r.dy, minY, maxY], [r.oz, r.dz, minZ, maxZ]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Distance along the ray to an upright cylinder (people, vehicle footprints), or null. */
export function rayCylinder(r: Ray, cx: number, cz: number, radius: number, minY: number, maxY: number): number | null {
  const fx = r.ox - cx, fz = r.oz - cz;
  const a = r.dx * r.dx + r.dz * r.dz;
  if (a < 1e-9) return null;
  const b = 2 * (fx * r.dx + fz * r.dz);
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t < 0) continue;
    const y = r.oy + r.dy * t;
    if (y >= minY && y <= maxY) return t;
  }
  return null;
}

/** Distance along the ray to an extruded polygon (a building footprint from map data), or null. */
function rayPrism(r: Ray, pts: [number, number][], height: number): number | null {
  if (r.oy >= 0 && r.oy <= height && pointInPoly(r.ox, r.oz, pts)) return 0;
  let best: number | null = null;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], [bx, bz] = pts[i];
    const ex = bx - ax, ez = bz - az;
    const den = r.dx * ez - r.dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - r.ox) * ez - (az - r.oz) * ex) / den;
    const u = ((ax - r.ox) * r.dz - (az - r.oz) * r.dx) / den;
    if (t < 0 || u < 0 || u > 1) continue;
    const y = r.oy + r.dy * t;
    if (y >= 0 && y <= height && (best === null || t < best)) best = t;
  }
  // Roof: crossing the top from above.
  if (r.dy < 0 && r.oy > height) {
    const t = (height - r.oy) / r.dy;
    if (pointInPoly(r.ox + r.dx * t, r.oz + r.dz * t, pts) && (best === null || t < best)) best = t;
  }
  return best;
}

/** First wall/building along the ray within maxT (ground counts too), or maxT. */
export function rayWorld(r: Ray, world: CollisionWorld, maxT: number): number {
  let best = maxT;
  if (r.dy < -1e-6) best = Math.min(best, -r.oy / r.dy);
  for (const b of world.boxes) {
    if (b.off) continue;
    const t = rayBox(r, b.minX, b.maxX, 0, b.height, b.minZ, b.maxZ);
    if (t !== null && t < best) best = t;
  }
  for (const p of world.polys) {
    if (p.off || rayBox(r, p.minX, p.maxX, 0, p.height, p.minZ, p.maxZ) === null) continue;
    const t = rayPrism(r, p.pts, p.height);
    if (t !== null && t < best) best = t;
  }
  return best;
}

/** True if nothing solid stands between two points. */
export function lineOfSight(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const r: Ray = { ox: ax, oy: ay, oz: az, dx: dx / len, dy: dy / len, dz: dz / len };
  return rayWorld(r, world, len) >= len - 1e-3;
}

// ---------- What the player is carrying ----------

export interface Arsenal {
  owned: string[];
  /** Total rounds carried per weapon (magazine plus reserve). */
  ammo: Record<string, number>;
  equipped: string | null;
}

/** Live state for the drawn weapon: magazine, cooldown and reload. Not saved; rebuilt from Arsenal. */
export class WeaponState {
  drawn: WeaponId | null = null;
  inMag: Partial<Record<WeaponId, number>> = {};
  cooldown = 0;
  reloading = 0;
  /** The range loaner: an Egret with unlimited reserve that is never added to the arsenal. */
  loaner = false;
  /** Last weapon drawn (Q toggles back to it). */
  last: WeaponId | null = null;

  constructor(private arsenal: () => Arsenal) {}

  get def(): WeaponDef | null {
    return this.drawn ? WEAPONS[this.drawn] : null;
  }

  owns(id: WeaponId): boolean {
    return this.arsenal().owned.includes(id);
  }

  total(id: WeaponId): number {
    return this.loaner && id === 'egret' ? Infinity : this.arsenal().ammo[id] ?? 0;
  }

  mag(id: WeaponId): number {
    const d = WEAPONS[id];
    if (d.cls === 'melee') return 0;
    const m = this.inMag[id] ?? Math.min(d.mag, this.total(id));
    return Math.min(m, this.total(id));
  }

  reserve(id: WeaponId): number {
    return this.total(id) - this.mag(id);
  }

  draw(id: WeaponId | null): boolean {
    if (id && !this.loaner && !this.owns(id)) return false;
    if (this.drawn && this.drawn !== id) this.last = this.drawn;
    this.drawn = id;
    this.reloading = 0;
    this.cooldown = Math.max(this.cooldown, 0.25);
    if (!this.loaner) this.arsenal().equipped = id;
    return true;
  }

  /** Start a reload if it would add rounds. */
  reload(): boolean {
    const d = this.def;
    if (!d || d.cls === 'melee' || this.reloading > 0) return false;
    if (this.mag(d.id) >= d.mag || this.reserve(d.id) <= 0) return false;
    this.reloading = d.reload;
    return true;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const d = this.def;
        if (d) this.inMag[d.id] = Math.min(d.mag, this.total(d.id));
      }
    }
  }

  /**
   * Try to fire (or swing). Returns 'fired', 'empty' (click, needs a reload), or null if it can't yet.
   * Spends a round; starts an automatic reload when the magazine runs dry and rounds remain.
   */
  trigger(): 'fired' | 'empty' | null {
    const d = this.def;
    if (!d || this.cooldown > 0 || this.reloading > 0) return null;
    this.cooldown = 1 / d.rate;
    if (d.cls === 'melee') return 'fired';
    const m = this.mag(d.id);
    if (m <= 0) {
      if (!this.reload()) this.cooldown = 0.3;
      return 'empty';
    }
    this.inMag[d.id] = m - 1;
    if (!(this.loaner && d.id === 'egret')) this.arsenal().ammo[d.id] = Math.max(0, (this.arsenal().ammo[d.id] ?? 0) - 1);
    if (m - 1 <= 0) this.reload();
    return 'fired';
  }
}

/** PLACEHOLDER weapon shapes, built to sit in the hand with the barrel along the arm's -Y axis. */
export function weaponMesh(id: WeaponId): THREE.Group {
  // The Harmattan rifle is drawn as Bayo's EKO K7 model (models.ts) once it has loaded.
  const eko = id === 'harmattan' ? loaded.get('eko-k7') : undefined;
  if (eko) {
    try {
      return new EkoK7(eko).root;
    } catch (e) {
      console.warn('EKO K7 model could not be used; using the built rifle.', e);
    }
  }
  const g = new THREE.Group();
  const d = WEAPONS[id];
  const c = d.colour;
  switch (d.cls) {
    case 'melee':
      part(g, 'cyl', c, [0, -0.35, 0], [0.05, 0.75, 0.05]);
      break;
    case 'pistol':
      part(g, 'box', c, [0, -0.12, 0], [0.06, 0.22, 0.04]);
      part(g, 'box', '#141414', [-0.05, -0.04, 0], [0.08, 0.05, 0.035]);
      break;
    case 'smg':
      part(g, 'box', c, [0, -0.2, 0], [0.08, 0.38, 0.06]);
      part(g, 'box', '#141414', [-0.08, -0.12, 0], [0.12, 0.06, 0.05]);
      break;
    case 'shotgun':
      part(g, 'box', c, [0, -0.1, 0], [0.08, 0.3, 0.07]);
      part(g, 'cyl', '#2a2a2a', [0, -0.5, 0], [0.06, 0.6, 0.06]);
      break;
    case 'rifle':
    case 'marksman':
      part(g, 'box', c, [0, -0.15, 0], [0.08, 0.4, 0.06]);
      part(g, 'cyl', '#2a2a2a', [0, -0.6, 0], [0.04, d.cls === 'marksman' ? 0.8 : 0.6, 0.04]);
      if (d.cls === 'marksman') part(g, 'cyl', '#141414', [0.07, -0.25, 0], [0.05, 0.25, 0.05]);
      break;
  }
  return g;
}
