/**
 * 2D collision on the ground plane (x/z, metres). Static obstacles are axis-aligned boxes with a
 * height so the camera can also avoid them. Movers (player, NPCs, car) are circles.
 */
export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  /** Disabled colliders are ignored (e.g. a barrier that has been taken away). */
  off?: boolean;
  /** Street furniture a car can smash through: called instead of blocking (it hides the prop). */
  smash?: () => void;
}

/** Phase 5: an extruded polygon (a real building footprint from map data), points as [x, z]. */
export interface Poly2 {
  pts: [number, number][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  off?: boolean;
  smash?: () => void;
}

export function pointInPoly(x: number, z: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on the polygon's outline to (x, z). */
function closestOnPoly(x: number, z: number, pts: [number, number][]): { x: number; z: number; d: number } {
  let best = { x: pts[0][0], z: pts[0][1], d: Infinity };
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

export interface Circle {
  x: number;
  z: number;
}

const CELL = 20;

export class CollisionWorld {
  readonly boxes: Box2[] = [];
  readonly polys: Poly2[] = [];
  private grid = new Map<string, number[]>();
  /** While set, every box added is also collected here (used to group the parts of one prop). */
  capture: Box2[] | null = null;
  /** How many props the last resolveCircle call smashed, and a hook for the debris effect. */
  lastSmashed = 0;
  onSmashed: ((x: number, z: number) => void) | null = null;
  private pgrid = new Map<string, number[]>();

  /** Add a building footprint (Phase 5 map tiles). Turn it off with `off` when its tile unloads. */
  addPoly(pts: [number, number][], height: number): Poly2 {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const poly: Poly2 = { pts, minX, maxX, minZ, maxZ, height };
    const index = this.polys.length;
    this.polys.push(poly);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        const list = this.pgrid.get(key);
        if (list) list.push(index);
        else this.pgrid.set(key, [index]);
      }
    }
    return poly;
  }

  /** Polygons whose grid cells touch the given square. */
  nearPolys(x: number, z: number, r: number): Poly2[] {
    if (!this.polys.length) return [];
    const seen = new Set<number>();
    const out: Poly2[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        for (const i of this.pgrid.get(`${cx},${cz}`) ?? []) {
          const p = this.polys[i];
          if (!seen.has(i) && !p.off && x + r > p.minX && x - r < p.maxX && z + r > p.minZ && z - r < p.maxZ) {
            seen.add(i);
            out.push(p);
          }
        }
      }
    }
    return out;
  }

  add(minX: number, maxX: number, minZ: number, maxZ: number, height: number): Box2 {
    const index = this.boxes.length;
    const box: Box2 = { minX, maxX, minZ, maxZ, height };
    this.boxes.push(box);
    this.capture?.push(box);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        const list = this.grid.get(key);
        if (list) list.push(index);
        else this.grid.set(key, [index]);
      }
    }
    return box;
  }

  /** Boxes whose grid cells touch the given rectangle (may include a few extra). */
  near(x: number, z: number, r: number): Box2[] {
    const seen = new Set<number>();
    const out: Box2[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = this.grid.get(`${cx},${cz}`);
        if (!list) continue;
        for (const i of list) {
          if (!seen.has(i) && !this.boxes[i].off) {
            seen.add(i);
            out.push(this.boxes[i]);
          }
        }
      }
    }
    return out;
  }

  /**
   * Pushes the circle out of any overlapping box. Returns the total push applied (0,0 if none).
   * smash: a fast vehicle breaks through smashable street furniture instead of stopping.
   */
  resolveCircle(c: Circle, radius: number, smash = false): { x: number; z: number } {
    let pushX = 0;
    let pushZ = 0;
    this.lastSmashed = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.near(c.x, c.z, radius)) {
        const px = Math.max(b.minX, Math.min(c.x, b.maxX));
        const pz = Math.max(b.minZ, Math.min(c.z, b.maxZ));
        let dx = c.x - px;
        let dz = c.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (smash && b.smash) {
          b.smash();
          this.lastSmashed++;
          this.onSmashed?.(px, pz);
          continue;
        }
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const k = (radius - d) / d;
          dx *= k;
          dz *= k;
        } else {
          // Centre is inside the box: leave along the shallowest side.
          const left = c.x - b.minX + radius;
          const right = b.maxX - c.x + radius;
          const back = c.z - b.minZ + radius;
          const front = b.maxZ - c.z + radius;
          const m = Math.min(left, right, back, front);
          dx = m === left ? -left : m === right ? right : 0;
          dz = m === back ? -back : m === front ? front : 0;
        }
        c.x += dx;
        c.z += dz;
        pushX += dx;
        pushZ += dz;
      }
      for (const p of this.nearPolys(c.x, c.z, radius)) {
        const q = closestOnPoly(c.x, c.z, p.pts);
        const inside = pointInPoly(c.x, c.z, p.pts);
        if (!inside && q.d >= radius) continue;
        if (smash && p.smash) {
          p.smash();
          this.lastSmashed++;
          this.onSmashed?.(q.x, q.z);
          continue;
        }
        let nx = c.x - q.x, nz = c.z - q.z;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        // Inside: leave through the nearest edge; outside but touching: step back out to the radius.
        const dx = inside ? -nx * (q.d + radius) : nx * (radius - q.d);
        const dz = inside ? -nz * (q.d + radius) : nz * (radius - q.d);
        c.x += dx;
        c.z += dz;
        pushX += dx;
        pushZ += dz;
      }
    }
    return { x: pushX, z: pushZ };
  }

  overlapsCircle(x: number, z: number, radius: number): boolean {
    for (const b of this.near(x, z, radius)) {
      const px = Math.max(b.minX, Math.min(x, b.maxX));
      const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - px) ** 2 + (z - pz) ** 2 < radius * radius) return true;
    }
    for (const p of this.nearPolys(x, z, radius)) if (pointInPoly(x, z, p.pts) || closestOnPoly(x, z, p.pts).d < radius) return true;
    return false;
  }

  /** True if the point is inside a box taller than y (used to keep the camera out of buildings). */
  blocksPoint(x: number, y: number, z: number): boolean {
    for (const b of this.near(x, z, 0.5)) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.height) return true;
    }
    for (const p of this.nearPolys(x, z, 0.1)) if (y < p.height && pointInPoly(x, z, p.pts)) return true;
    return false;
  }
}
