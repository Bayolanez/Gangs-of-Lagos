import * as THREE from 'three';
import { Obstacle, Vehicle, VehicleKind } from './vehicles';

/**
 * Phase 5: AI traffic on an imported road graph (map tiles from tools/osm-import). Vehicles follow the
 * road polylines in the right-hand half of two-way roads, obey one-way streets, pick a random road at
 * each junction and stop for whatever is in front of them. Kinematic, like the Harbour Bend traffic.
 * The same class runs BRT buses, restricted to BRT corridor edges.
 */
export type RoadKind = 'expressway' | 'brt' | 'service' | 'inner' | 'market';

export interface GraphEdge {
  a: number;
  b: number;
  type: RoadKind;
  w: number;
  lanes: number;
  oneway: boolean;
  road: number;
  pts: [number, number][];
}
export interface AreaGraph {
  nodes: [number, number][];
  edges: GraphEdge[];
}

/** Cruising speed in m/s by road type (market roads crawl). */
export const CRUISE: Record<RoadKind, number> = { expressway: 17, brt: 13, service: 7, inner: 8.5, market: 3.5 };

interface Path {
  edge: GraphEdge;
  fwd: boolean;
  pts: { x: number; z: number }[];
  cum: number[];
  len: number;
}

class Car {
  active = false;
  path!: Path;
  d = 0;
  speed = 0;
  cruise = 8;
  blocked = 0;
  stall = 0;
  honkCd = 0;
  constructor(readonly v: Vehicle) {}
}

export class AreaTraffic {
  readonly cars: Car[] = [];
  target: number;
  private edges: GraphEdge[];
  /** For each node, the edges you can leave it by (with direction). */
  private out = new Map<number, { e: GraphEdge; fwd: boolean }[]>();

  constructor(scene: THREE.Scene, count: number, private rand: () => number, graph: AreaGraph, private ox: number, private oz: number,
    filter: (e: GraphEdge) => boolean, kinds: VehicleKind[], colours: string[]) {
    this.target = count;
    this.edges = graph.edges.filter(filter);
    const add = (n: number, e: GraphEdge, fwd: boolean) => {
      const l = this.out.get(n);
      if (l) l.push({ e, fwd });
      else this.out.set(n, [{ e, fwd }]);
    };
    for (const e of this.edges) {
      add(e.a, e, true);
      if (!e.oneway) add(e.b, e, false);
    }
    for (let i = 0; i < count; i++) {
      const kind = kinds[i % kinds.length];
      const v = new Vehicle(kind, 0, 0, 0, kind === 'danfo' || kind === 'brt' ? undefined : colours[Math.floor(rand() * colours.length)]);
      v.group.visible = false;
      scene.add(v.group);
      this.cars.push(new Car(v));
    }
  }

  /** Build the lane path for an edge in one direction, offset into the right-hand half on two-way roads. */
  private path(e: GraphEdge, fwd: boolean): Path {
    const raw = fwd ? e.pts : [...e.pts].reverse();
    const off = e.oneway ? 0 : e.w / 4;
    const pts = raw.map((p, i) => {
      const q = raw[Math.min(i + 1, raw.length - 1)], pp = raw[Math.max(i - 1, 0)];
      const dx = q[0] - pp[0], dz = q[1] - pp[1], l = Math.hypot(dx, dz) || 1;
      // Right of travel in this game's axes (x east, z south) is (-dz, dx).
      return { x: p[0] + this.ox - (dz / l) * off, z: p[1] + this.oz + (dx / l) * off };
    });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { edge: e, fwd, pts, cum, len: Math.max(0.5, cum[cum.length - 1]) };
  }

  private pose(p: Path, d: number): { x: number; z: number; h: number } {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < d) i++;
    const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - p.cum[i - 1]) / seg));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: Math.atan2(b.z - a.z, b.x - a.x) };
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

  hit(v: unknown): void {
    const c = this.cars.find((k) => k.v === v);
    if (c) {
      c.stall = 2.5;
      c.speed = 0;
    }
  }

  /** Which edge each active car is on (tests check BRT buses stay in BRT lanes). */
  edgeTypes(): RoadKind[] {
    return this.cars.filter((c) => c.active).map((c) => c.path.edge.type);
  }

  private trySpawn(c: Car, fx: number, fz: number, minD: number, maxD: number): boolean {
    if (!this.edges.length) return false;
    for (let k = 0; k < 10; k++) {
      const e = this.edges[Math.floor(this.rand() * this.edges.length)];
      const fwd = e.oneway || this.rand() < 0.5;
      const p = this.path(e, fwd);
      const d = this.rand() * p.len;
      const q = this.pose(p, d);
      const dist = Math.hypot(q.x - fx, q.z - fz);
      if (dist < minD || dist > maxD) continue;
      if (this.cars.some((o) => o.active && Math.hypot(o.v.x - q.x, o.v.z - q.z) < 12)) continue;
      Object.assign(c, { active: true, path: p, d, blocked: 0, stall: 0, cruise: CRUISE[e.type] * (0.85 + this.rand() * 0.3) });
      c.speed = c.cruise * 0.6;
      c.v.group.visible = true;
      c.v.drive(q.x, q.z, q.h, c.speed, false, 0);
      return true;
    }
    return false;
  }

  populate(focus: { x: number; z: number }): void {
    for (const c of this.cars.slice(0, this.target)) if (!c.active) this.trySpawn(c, focus.x, focus.z, 25, 180);
  }

  update(dt: number, focus: { x: number; z: number }, others: Obstacle[], onHonk: (x: number, z: number) => void): void {
    let active = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      active++;
      if (active > this.target || Math.hypot(c.v.x - focus.x, c.v.z - focus.z) > 260) this.despawn(c);
    }
    let spawned = 0;
    for (const c of this.cars.slice(0, this.target)) if (!c.active && spawned < 1 && this.trySpawn(c, focus.x, focus.z, 70, 200)) spawned++;

    for (const c of this.cars) {
      if (!c.active) continue;
      const v = c.v;
      const fx = Math.cos(v.heading), fz = Math.sin(v.heading);
      c.honkCd = Math.max(0, c.honkCd - dt);
      let nearest = Infinity, byTraffic = false;
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
      for (const o of this.cars) if (o !== c && o.active) for (const k of o.v.circles()) check(k, true);

      let target = c.cruise;
      if (nearest < Infinity) target = Math.min(target, Math.max(0, (nearest - 3) * 1.1));
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
        if (c.blocked > 8 && Math.hypot(v.x - focus.x, v.z - focus.z) > 25) {
          this.despawn(c);
          continue;
        }
      } else c.blocked = 0;

      c.d += c.speed * dt;
      while (c.d >= c.path.len) {
        c.d -= c.path.len;
        const end = c.path.fwd ? c.path.edge.b : c.path.edge.a;
        const opts = (this.out.get(end) ?? []).filter((o) => o.e !== c.path.edge);
        const pick = opts.length ? opts[Math.floor(this.rand() * opts.length)] : null;
        if (pick) c.path = this.path(pick.e, pick.fwd);
        else if (!c.path.edge.oneway) c.path = this.path(c.path.edge, !c.path.fwd); // dead end: turn round
        else {
          this.despawn(c);
          break;
        }
      }
      if (!c.active) continue;
      const q = this.pose(c.path, c.d);
      v.drive(q.x, q.z, q.h, c.speed, target < c.speed - 0.5 || c.speed < 0.3, dt);
    }
  }

  despawnAll(): void {
    for (const c of this.cars) this.despawn(c);
  }

  dispose(): void {
    for (const c of this.cars) c.v.group.removeFromParent();
  }

  private despawn(c: Car): void {
    c.active = false;
    c.v.group.visible = false;
  }
}
