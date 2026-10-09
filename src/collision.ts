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
}

export interface Circle {
  x: number;
  z: number;
}

const CELL = 20;

export class CollisionWorld {
  readonly boxes: Box2[] = [];
  private grid = new Map<string, number[]>();

  add(minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
    const index = this.boxes.length;
    this.boxes.push({ minX, maxX, minZ, maxZ, height });
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        const list = this.grid.get(key);
        if (list) list.push(index);
        else this.grid.set(key, [index]);
      }
    }
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
          if (!seen.has(i)) {
            seen.add(i);
            out.push(this.boxes[i]);
          }
        }
      }
    }
    return out;
  }

  /** Pushes the circle out of any overlapping box. Returns the total push applied (0,0 if none). */
  resolveCircle(c: Circle, radius: number): { x: number; z: number } {
    let pushX = 0;
    let pushZ = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.near(c.x, c.z, radius)) {
        const px = Math.max(b.minX, Math.min(c.x, b.maxX));
        const pz = Math.max(b.minZ, Math.min(c.z, b.maxZ));
        let dx = c.x - px;
        let dz = c.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
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
    }
    return { x: pushX, z: pushZ };
  }

  overlapsCircle(x: number, z: number, radius: number): boolean {
    for (const b of this.near(x, z, radius)) {
      const px = Math.max(b.minX, Math.min(x, b.maxX));
      const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - px) ** 2 + (z - pz) ** 2 < radius * radius) return true;
    }
    return false;
  }

  /** True if the point is inside a box taller than y (used to keep the camera out of buildings). */
  blocksPoint(x: number, y: number, z: number): boolean {
    for (const b of this.near(x, z, 0.5)) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.height) return true;
    }
    return false;
  }
}
