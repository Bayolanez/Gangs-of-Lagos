import * as THREE from 'three';
import { ROAD_LINES } from './district';
import { Obstacle, Vehicle, VehicleKind } from './vehicles';

/**
 * Ambient AI traffic (Milestone 2). Cars follow the road grid in the right-hand lane, pick a random
 * turn at each junction, slow for corners, stop for anything in front of them and honk if you block
 * them. They are kinematic (no physics) and cannot be entered. PLACEHOLDER vehicle bodies.
 */
type V2 = { x: number; z: number };
interface Piece { a: V2; c: V2; b: V2; len: number; turn: boolean }

const N = ROAD_LINES.length;
const LANE = 3;
const INSET = 8;
const node = (i: number): V2 => ({ x: ROAD_LINES[Math.floor(i / N)], z: ROAD_LINES[i % N] });
function neighbours(i: number): number[] {
  const a = Math.floor(i / N), b = i % N;
  const out: number[] = [];
  if (a > 0) out.push(i - N);
  if (a < N - 1) out.push(i + N);
  if (b > 0) out.push(i - 1);
  if (b < N - 1) out.push(i + 1);
  return out;
}
function dir(from: number, to: number): V2 {
  const p = node(from), q = node(to), l = Math.hypot(q.x - p.x, q.z - p.z);
  return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
}
const right = (d: V2): V2 => ({ x: -d.z, z: d.x });
function bez(p: Piece, t: number): V2 {
  const u = 1 - t;
  return { x: u * u * p.a.x + 2 * u * t * p.c.x + t * t * p.b.x, z: u * u * p.a.z + 2 * u * t * p.c.z + t * t * p.b.z };
}
function tangent(p: Piece, t: number): V2 {
  return { x: 2 * (1 - t) * (p.c.x - p.a.x) + 2 * t * (p.b.x - p.c.x), z: 2 * (1 - t) * (p.c.z - p.a.z) + 2 * t * (p.b.z - p.c.z) };
}
function makePiece(a: V2, c: V2, b: V2, turn: boolean): Piece {
  let len = 0;
  let prev = a;
  const p = { a, c, b, len: 0, turn };
  for (let i = 1; i <= 8; i++) {
    const q = bez(p, i / 8);
    len += Math.hypot(q.x - prev.x, q.z - prev.z);
    prev = q;
  }
  p.len = Math.max(0.5, len);
  return p;
}
function roadPiece(from: number, to: number): Piece {
  const d = dir(from, to), r = right(d), p = node(from), q = node(to);
  const a = { x: p.x + d.x * INSET + r.x * LANE, z: p.z + d.z * INSET + r.z * LANE };
  const b = { x: q.x - d.x * INSET + r.x * LANE, z: q.z - d.z * INSET + r.z * LANE };
  return makePiece(a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, b, false);
}
function turnPiece(from: number, to: number, next: number): Piece {
  const dIn = dir(from, to), dOut = dir(to, next), rIn = right(dIn), rOut = right(dOut), n = node(to);
  const a = { x: n.x - dIn.x * INSET + rIn.x * LANE, z: n.z - dIn.z * INSET + rIn.z * LANE };
  const b = { x: n.x + dOut.x * INSET + rOut.x * LANE, z: n.z + dOut.z * INSET + rOut.z * LANE };
  const straight = dIn.x * dOut.x + dIn.z * dOut.z > 0.9;
  const c = straight ? { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } : { x: n.x + (rIn.x + rOut.x) * LANE, z: n.z + (rIn.z + rOut.z) * LANE };
  return makePiece(a, c, b, !straight);
}

const KINDS: VehicleKind[] = ['sedan', 'sedan', 'hatchback', 'keke', 'danfo', 'sedan', 'keke', 'hatchback', 'danfo', 'sedan', 'sedan', 'keke'];
const COLOURS = ['#d8d8d2', '#2a2d33', '#8a1f1a', '#2e5e8c', '#9aa0a6', '#5a6b3a', '#c9b48a', '#1d1d1f', '#e7e3d6', '#6b2d5c'];

class TrafficCar {
  active = false;
  from = 0;
  to = 1;
  piece!: Piece;
  t = 0;
  cruise = 9;
  speed = 0;
  blocked = 0;
  ghost = 0;
  stall = 0;
  honkCd = 0;
  inJunction = false;
  constructor(readonly v: Vehicle) {}
}

export class Traffic {
  readonly cars: TrafficCar[] = [];
  /** How many cars to keep on the road (lowered on slow machines). */
  target: number;

  constructor(scene: THREE.Scene, count: number, private rand: () => number) {
    this.target = count;
    for (let i = 0; i < count; i++) {
      const kind = KINDS[i % KINDS.length];
      const v = new Vehicle(kind, 0, 0, 0, kind === 'danfo' ? undefined : COLOURS[Math.floor(rand() * COLOURS.length)]);
      v.group.visible = false;
      scene.add(v.group);
      this.cars.push(new TrafficCar(v));
    }
  }

  owns(v: unknown): boolean {
    return this.cars.some((c) => c.active && c.v === v);
  }

  get activeCount(): number {
    return this.cars.filter((c) => c.active).length;
  }

  vehicles(): Vehicle[] {
    return this.cars.filter((c) => c.active).map((c) => c.v);
  }

  obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const c of this.cars) if (c.active) out.push(...c.v.circles());
    return out;
  }

  /** The player hit this car: it stops for a moment and complains. */
  hit(v: unknown): void {
    const c = this.cars.find((k) => k.v === v);
    if (c) {
      c.stall = 2.5;
      c.speed = 0;
    }
  }

  private place(c: TrafficCar): void {
    const p = bez(c.piece, c.t), tg = tangent(c.piece, c.t);
    c.v.drive(p.x, p.z, Math.atan2(tg.z, tg.x), c.speed, false, 0);
  }

  private trySpawn(c: TrafficCar, focus: V2, minD: number, maxD: number): boolean {
    for (let attempt = 0; attempt < 8; attempt++) {
      const from = Math.floor(this.rand() * N * N);
      const ns = neighbours(from);
      const to = ns[Math.floor(this.rand() * ns.length)];
      const piece = roadPiece(from, to);
      const t = 0.1 + this.rand() * 0.6;
      const p = bez(piece, t);
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d < minD || d > maxD) continue;
      if (this.cars.some((o) => o.active && Math.hypot(o.v.x - p.x, o.v.z - p.z) < 14)) continue;
      Object.assign(c, { active: true, from, to, piece, t, cruise: (c.v.kind === 'keke' ? 7 : 8) + this.rand() * 3, blocked: 0, ghost: 0, stall: 0, inJunction: false });
      c.speed = c.cruise * 0.6;
      c.v.group.visible = true;
      this.place(c);
      return true;
    }
    return false;
  }

  /** Fill the roads at the start, keeping clear of where you stand. */
  populate(focus: V2): void {
    for (const c of this.cars.slice(0, this.target)) if (!c.active) this.trySpawn(c, focus, 30, 170);
  }

  /**
   * others: everything traffic should stop for (you, your vehicle, parked vehicles, residents).
   * onHonk is called when a car has been stuck behind you for a while.
   */
  update(dt: number, focus: V2, others: Obstacle[], onHonk: (x: number, z: number) => void): void {
    let active = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      active++;
      if (active > this.target || Math.hypot(c.v.x - focus.x, c.v.z - focus.z) > 230) this.despawn(c);
    }
    let spawned = 0;
    for (const c of this.cars.slice(0, this.target)) {
      if (!c.active && spawned < 1 && this.trySpawn(c, focus, 70, 180)) spawned++;
    }

    for (const c of this.cars) {
      if (!c.active) continue;
      const v = c.v;
      const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
      c.ghost = Math.max(0, c.ghost - dt);
      c.honkCd = Math.max(0, c.honkCd - dt);

      // What is ahead of us?
      let nearest = Infinity;
      let byTraffic = false;
      const check = (o: Obstacle, isTraffic: boolean) => {
        const rx = o.x - v.x, rz = o.z - v.z;
        const f = rx * fx + rz * fz - v.spec.len / 2;
        const lat = Math.abs(rx * -fz + rz * fx);
        if (f > -1 && f < 14 && lat < 1.3 + o.r && f < nearest) {
          nearest = f;
          byTraffic = isTraffic;
        }
      };
      for (const o of others) check(o, false);
      if (c.ghost === 0) for (const o of this.cars) if (o !== c && o.active) for (const k of o.v.circles()) check(k, true);

      // Give way at junctions: wait if someone else is already turning through ours.
      let yieldNow = false;
      if (!c.inJunction && c.t > 0.82 && c.ghost === 0) {
        yieldNow = this.cars.some((o) => o !== c && o.active && o.inJunction && o.from === c.to);
      }

      let target = c.piece.turn ? Math.min(c.cruise, 5.5) : c.cruise;
      if (nearest < Infinity) target = Math.min(target, Math.max(0, (nearest - 3) * 1.1));
      if (yieldNow) target = 0;
      if (c.stall > 0) {
        c.stall -= dt;
        target = 0;
      }
      c.speed += THREE.MathUtils.clamp(target - c.speed, -14 * dt, 4 * dt);
      if (c.speed < 0.3 && target < 0.3) {
        c.blocked += dt;
        if (!byTraffic && nearest < Infinity && c.blocked > 2 && c.honkCd === 0) {
          c.honkCd = 3.5;
          onHonk(v.x, v.z);
        }
        if (byTraffic && c.blocked > 4) c.ghost = 2.5; // break rare standoffs between AI cars
        if (c.blocked > 12 && Math.hypot(v.x - focus.x, v.z - focus.z) > 40) {
          this.despawn(c);
          continue;
        }
      } else c.blocked = 0;

      // Advance along the lane: road segment, then a junction piece, then the next road segment...
      c.t += (c.speed * dt) / c.piece.len;
      if (c.t >= 1) {
        if (c.inJunction) {
          c.piece = roadPiece(c.from, c.to);
          c.inJunction = false;
        } else {
          const opts = neighbours(c.to).filter((n) => n !== c.from);
          const next = opts.length ? opts[Math.floor(this.rand() * opts.length)] : c.from;
          c.piece = turnPiece(c.from, c.to, next);
          c.inJunction = true;
          c.from = c.to;
          c.to = next;
        }
        c.t = 0;
      }
      const p = bez(c.piece, c.t), tg = tangent(c.piece, c.t);
      v.drive(p.x, p.z, Math.atan2(tg.z, tg.x), c.speed, target < c.speed - 0.5 || c.speed < 0.3, dt);
    }
  }

  private despawn(c: TrafficCar): void {
    c.active = false;
    c.v.group.visible = false;
  }
}
