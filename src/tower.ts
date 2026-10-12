import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { HumanRig } from './human';
import { Batcher, textSprite } from './placeholders';

/**
 * Harbour Heights (fictional): an enterable four-level tower on the south-east lawn of Harbour Bend
 * Square. Walk up to the glass doors and press E to go in. Inside are a lobby, a co-working floor,
 * a sky lounge and gym, and a penthouse. Switchback stairs on the west side and a lift in the
 * north-east corner both connect every floor.
 *
 * The interior is built the first time you go in (nothing is drawn or simulated before that). While
 * you are inside, the tower's own collision and floor heights replace the street's, and the camera is
 * kept inside the building. Walls and ceilings face inwards, so the camera never sees their backs.
 * All shapes are original placeholder geometry.
 */
export const TOWER = {
  name: 'Harbour Heights',
  cx: 16,
  cz: 10,
  /** Half the footprint (metres). */
  half: 8,
  floorH: 4,
  levels: 4,
  /** Outside the glass doors (south face), and where you stand once inside. */
  outside: { x: 16, z: 19.8 },
  door: { x: 16, z: 18 },
};
export const LEVEL_NAMES = ['Lobby', 'Co-working', 'Sky Lounge & Gym', 'Penthouse'];
export const LEVEL_KEYS = ['G', '1', '2', 'PH'];

const IN = 7.75; // inside face of the outer walls (local)
const H = TOWER.floorH;
const TOP = TOWER.levels * H;
/** Stairs: lane A next to the west wall, lane B beside it; flights run between zN and zS. */
const LA: [number, number] = [-7.75, -6.25];
const LB: [number, number] = [-6.25, -4.75];
const ZN = -5.5, ZS = 5.5, RUN = ZS - ZN;
/** Lift car (north-east corner), with its door on the west side. */
const LIFT = { x0: 5.0, x1: 7.75, z0: -7.75, z1: -5.0, doorZ0: -6.9, doorZ1: -5.6 };

interface Surface {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: (x: number, z: number) => number;
}
interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** Floor rectangles for a level with an optional stairwell hole (lane x-range over zN..zS). */
function slabRects(hole: [number, number] | null): [number, number, number, number][] {
  if (!hole) return [[-IN, IN, -IN, IN]];
  const r: [number, number, number, number][] = [[-IN, IN, -IN, ZN], [-IN, IN, ZS, IN]];
  if (hole[0] > -IN) r.push([-IN, hole[0], ZN, ZS]);
  r.push([hole[1], IN, ZN, ZS]);
  return r;
}
/** Which lane is open above each level (the flight arriving from below). */
const HOLES: ([number, number] | null)[] = [null, LA, LB, LA];

const mats = new Map<string, THREE.Material>();
/** Interior surfaces glow a little so rooms read as lit (there are no real lights inside). */
function imat(color: string, rough = 0.8): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, emissive: color, emissiveIntensity: 0.22 });
    mats.set(key, m);
  }
  return m;
}
const GLASS = new THREE.MeshStandardMaterial({ color: '#8fd0e0', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.25, depthWrite: false, emissive: '#2a4a6a', emissiveIntensity: 0.35 });

export class Tower {
  inside = false;
  /** Interior group (null until the first visit). */
  interior: THREE.Group | null = null;
  readonly exterior = new THREE.Group();
  private surfaces: Surface[] = [];
  private solids: Solid[] = [];
  private liftDoors: { l: THREE.Mesh; r: THREE.Mesh; open: number }[] = [];
  private concierge: HumanRig | null = null;
  /** Where to put the player when they come out (the street spot they went in from). */
  private returnTo = { x: TOWER.outside.x, z: TOWER.outside.z, heading: Math.PI / 2 };

  constructor(private scene: THREE.Scene, world: CollisionWorld) {
    const { cx, cz, half } = TOWER;
    world.add(cx - half, cx + half, cz - half, cz + half, TOP + 0.8);
    this.buildExterior();
    scene.add(this.exterior);
  }

  // ---------- Coordinates ----------
  private local(x: number, z: number): { x: number; z: number } {
    return { x: x - TOWER.cx, z: z - TOWER.cz };
  }

  /** Floor number for a height (0 lobby to 3 penthouse). */
  levelOf(y: number): number {
    return THREE.MathUtils.clamp(Math.floor((y + 0.6) / H), 0, TOWER.levels - 1);
  }

  /** Standing at the tower's glass doors outside. */
  nearDoorOutside(x: number, z: number): boolean {
    return !this.inside && Math.abs(x - TOWER.door.x) < 2 && z > TOWER.door.z && z < TOWER.door.z + 3.2;
  }

  /** Inside, at the lobby doors. */
  nearExit(x: number, z: number, y: number): boolean {
    const l = this.local(x, z);
    return this.inside && this.levelOf(y) === 0 && l.z > IN - 1.9 && Math.abs(l.x) < 1.8;
  }

  /** Inside the lift car on any floor. */
  inLift(x: number, z: number): boolean {
    const l = this.local(x, z);
    return this.inside && l.x > LIFT.x0 + 0.15 && l.z < LIFT.z1 - 0.15;
  }

  // ---------- Physics while inside ----------
  /** Height of the floor or stair under (x, z) that you could be standing on from height y. */
  readonly ground = (x: number, z: number, y: number): number => {
    const l = this.local(x, z);
    let best = 0;
    for (const s of this.surfaces) {
      if (l.x < s.x0 || l.x > s.x1 || l.z < s.z0 || l.z > s.z1) continue;
      const h = s.h(l.x, l.z);
      if (h <= y + 0.6 && h > best) best = h;
    }
    return best;
  };

  /** Push a circle out of the interior walls, rails and furniture at its height. */
  resolveCircle(p: { x: number; z: number; y?: number }, r: number): void {
    const py = p.y ?? 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.solids) {
        if (py + 1.7 <= s.y0 || py + 0.15 >= s.y1) continue;
        const lx = p.x - TOWER.cx, lz = p.z - TOWER.cz;
        const qx = THREE.MathUtils.clamp(lx, s.x0, s.x1), qz = THREE.MathUtils.clamp(lz, s.z0, s.z1);
        const dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) {
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        } else {
          // Centre inside the box: leave by the nearest side.
          const opts = [[s.x0 - r - lx, 0], [s.x1 + r - lx, 0], [0, s.z0 - r - lz], [0, s.z1 + r - lz]];
          opts.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
          p.x += opts[0][0];
          p.z += opts[0][1];
        }
      }
    }
  }

  /** Keep the follow camera inside the building and under the ceiling of your floor. */
  clampCamera(pos: THREE.Vector3, playerY: number): void {
    const base = this.levelOf(playerY) * H;
    const m = IN - 0.35;
    pos.x = THREE.MathUtils.clamp(pos.x, TOWER.cx - m, TOWER.cx + m);
    pos.z = THREE.MathUtils.clamp(pos.z, TOWER.cz - m, TOWER.cz + m);
    pos.y = THREE.MathUtils.clamp(pos.y, Math.max(base + 0.5, playerY + 0.6), Math.max(base + H - 0.6, playerY + 1.9));
  }

  // ---------- Going in and out ----------
  enter(p: { x: number; z: number; y: number; heading: number; sync(): void }): void {
    if (!this.interior) this.buildInterior();
    this.returnTo = { x: TOWER.outside.x, z: TOWER.outside.z, heading: Math.PI / 2 };
    this.inside = true;
    this.interior!.visible = true;
    this.exterior.visible = false;
    p.x = TOWER.cx;
    p.z = TOWER.cz + IN - 1.3;
    p.y = 0;
    p.heading = -Math.PI / 2;
    p.sync();
  }

  /** Leave interior mode without moving anyone (you were taken out of the building some other way). */
  reset(): void {
    this.inside = false;
    if (this.interior) this.interior.visible = false;
    this.exterior.visible = true;
  }

  exit(p: { x: number; z: number; y: number; heading: number; sync(): void }): void {
    this.reset();
    p.x = this.returnTo.x;
    p.z = this.returnTo.z;
    p.y = 0;
    p.heading = this.returnTo.heading;
    p.sync();
  }

  /** Ride the lift to a floor: same spot in the car, new height. */
  liftTo(p: { x: number; z: number; y: number; sync(): void }, level: number): void {
    const n = THREE.MathUtils.clamp(level, 0, TOWER.levels - 1);
    p.x = TOWER.cx + (LIFT.x0 + LIFT.x1) / 2;
    p.z = TOWER.cz + (LIFT.z0 + LIFT.z1) / 2;
    p.y = n * H;
    p.sync();
  }

  update(dt: number, px: number, pz: number, py: number): void {
    if (!this.inside || !this.interior) return;
    const lv = this.levelOf(py);
    const l = this.local(px, pz);
    this.liftDoors.forEach((d, i) => {
      const near = i === lv && Math.hypot(l.x - LIFT.x0, l.z - (LIFT.doorZ0 + LIFT.doorZ1) / 2) < 3.2;
      d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 6);
      const w = (LIFT.doorZ1 - LIFT.doorZ0) / 2;
      const mid = (LIFT.doorZ0 + LIFT.doorZ1) / 2;
      d.l.position.z = mid - w / 2 - d.open * w * 0.95;
      d.r.position.z = mid + w / 2 + d.open * w * 0.95;
    });
    this.concierge?.animate(dt, 0);
  }

  // ---------- Building it ----------
  private buildExterior(): void {
    const { cx, cz, half } = TOWER;
    const b = new Batcher();
    const w = half * 2;
    // Body, floor bands and glazing on all four sides (lobby fully glazed at the front).
    b.add('box', '#e9dcc6', cx, TOP / 2, cz, w, TOP, w);
    for (let f = 0; f < TOWER.levels; f++) {
      const y0 = f * H;
      b.add('box', '#c9b79c', cx, y0 + 0.12, cz, w + 0.12, 0.24, w + 0.12, 0, 0, 0, false);
      const gy = y0 + (f === 0 ? 1.75 : 2.0), gh = f === 0 ? 3.2 : 2.1;
      b.add('box', f === 3 ? '#2d4f66' : '#28465e', cx, gy, cz + half + 0.02, w - (f === 0 ? 2 : 1.6), gh, 0.1, 0, 0, 0, false);
      b.add('box', '#28465e', cx, y0 + 2.0, cz - half - 0.02, w - 1.6, 2.1, 0.1, 0, 0, 0, false);
      b.add('box', '#28465e', cx - half - 0.02, y0 + 2.0, cz, 0.1, 2.1, w - 1.6, 0, 0, 0, false);
      b.add('box', '#28465e', cx + half + 0.02, y0 + 2.0, cz, 0.1, 2.1, w - 1.6, 0, 0, 0, false);
    }
    // Penthouse terrace rail, roof parapet, plant room.
    b.add('box', '#cfc3ad', cx, TOP + 0.45, cz - half + 0.15, w, 0.9, 0.3, 0, 0, 0, false);
    b.add('box', '#cfc3ad', cx, TOP + 0.45, cz + half - 0.15, w, 0.9, 0.3, 0, 0, 0, false);
    b.add('box', '#cfc3ad', cx - half + 0.15, TOP + 0.45, cz, 0.3, 0.9, w, 0, 0, 0, false);
    b.add('box', '#cfc3ad', cx + half - 0.15, TOP + 0.45, cz, 0.3, 0.9, w, 0, 0, 0, false);
    b.add('box', '#a9a399', cx + 3, TOP + 1.2, cz - 3, 4, 2.4, 3.5);
    // Entrance: canopy, door frame, glass doors, steps.
    const dz = cz + half;
    b.add('box', '#1f3d47', cx, 3.45, dz + 1.4, 6, 0.18, 2.8, 0, 0, 0, false);
    b.add('box', '#d8a23a', cx, 3.34, dz + 2.78, 6, 0.08, 0.06, 0, 0, 0, false);
    for (const s of [-1, 1]) b.add('box', '#1f3d47', cx + s * 1.15, 1.35, dz + 0.08, 0.16, 2.7, 0.2, 0, 0, 0, false);
    b.add('box', '#1f3d47', cx, 2.72, dz + 0.08, 2.46, 0.16, 0.2, 0, 0, 0, false);
    b.add('box', '#9fd8e8', cx, 1.32, dz + 0.1, 2.1, 2.6, 0.06, 0, 0, 0, false);
    b.add('box', '#bdb4a6', cx, 0.06, dz + 1.4, 4, 0.12, 2.8, 0, 0, 0, false);
    b.build(this.exterior);
    const sign = textSprite('HARBOUR HEIGHTS', '#ffd27a', 1.0);
    sign.position.set(cx, 4.3, dz + 2.0);
    const sub = textSprite('Residences · fictional · press E at the doors', '#f0efe9', 0.38);
    sub.position.set(cx, 3.75, dz + 2.0);
    this.exterior.add(sign, sub);
  }

  private buildInterior(): void {
    const g = new THREE.Group();
    g.name = 'harbour-heights-interior';
    g.position.set(TOWER.cx, 0, TOWER.cz);
    const b = new Batcher();
    const glow = new Batcher(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) }));
    const solid = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => this.solids.push({ x0, x1, z0, z1, y0, y1 });
    /** A furniture box (local coordinates, sitting on level yb) that also blocks you. */
    const piece = (color: string, x: number, yb: number, z: number, sx: number, sy: number, sz: number, block = true, y = 0, ry = 0) => {
      b.add('box', color, x, yb + y + sy / 2, z, sx, sy, sz, 0, ry, 0, false);
      if (block) solid(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2, yb + y, yb + y + sy);
    };
    const cyl = (color: string, x: number, y: number, z: number, r: number, h: number) => b.add('cyl', color, x, y, z, r, h, r, 0, 0, 0, false);
    const plane = (w: number, d: number, m: THREE.Material, pos: [number, number, number], rot: [number, number, number]) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      g.add(mesh);
      return mesh;
    };
    const label = (text: string, x: number, y: number, z: number, h = 0.5, color = '#ffd27a') => {
      const s = textSprite(text, color, h);
      s.position.set(x, y, z);
      g.add(s);
    };

    // Outer walls: collision for the whole height (the lobby doors are glass; leave with E).
    solid(-8, 8, -8, -IN, 0, TOP);
    solid(-8, 8, IN, 8, 0, TOP);
    solid(-8, -IN, -8, 8, 0, TOP);
    solid(IN, 8, -8, 8, 0, TOP);
    // Stair divider between the two flights, full height.
    solid(LA[1] - 0.07, LA[1] + 0.07, ZN, ZS, 0, TOP);
    b.add('box', '#d9d2c4', LA[1], TOP / 2, 0, 0.14, TOP, RUN, 0, 0, 0, false);
    // Lift shaft walls (west wall has the door opening).
    solid(LIFT.x0 - 0.15, LIFT.x0, LIFT.z0, LIFT.doorZ0, 0, TOP);
    solid(LIFT.x0 - 0.15, LIFT.x0, LIFT.doorZ1, LIFT.z1, 0, TOP);
    solid(LIFT.x0 - 0.15, IN, LIFT.z1, LIFT.z1 + 0.15, 0, TOP);

    const wallC = ['#efe6d6', '#e4ebe8', '#f1e3d3', '#f4ece0'];
    const floorC = ['#d9cfc0', '#b9b2a8', '#7f8a8c', '#c8a77e'];
    for (let lv = 0; lv < TOWER.levels; lv++) {
      const yb = lv * H;
      const wall = imat(wallC[lv]);
      // Floor (with the stairwell hole) and the ceiling above it (with the next floor's hole).
      for (const [x0, x1, z0, z1] of slabRects(HOLES[lv])) {
        plane(x1 - x0, z1 - z0, imat(floorC[lv], 0.55), [(x0 + x1) / 2, yb + 0.07, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]);
        this.surfaces.push({ x0, x1, z0, z1, h: () => yb });
      }
      for (const [x0, x1, z0, z1] of slabRects(lv + 1 < TOWER.levels ? HOLES[lv + 1] : null)) plane(x1 - x0, z1 - z0, imat('#f7f3ec'), [(x0 + x1) / 2, yb + H - 0.25, (z0 + z1) / 2], [Math.PI / 2, 0, 0]);
      // Walls facing in: a solid strip, a window band (glass), and a strip above.
      const tall = lv === 3;
      const wy0 = tall ? 0.35 : 0.9, wy1 = tall ? 3.45 : 3.0;
      for (const side of ['N', 'S', 'W', 'E'] as const) {
        const rot: [number, number, number] = side === 'N' ? [0, 0, 0] : side === 'S' ? [0, Math.PI, 0] : side === 'W' ? [0, Math.PI / 2, 0] : [0, -Math.PI / 2, 0];
        const at = (y: number): [number, number, number] => (side === 'N' ? [0, y, -IN] : side === 'S' ? [0, y, IN] : side === 'W' ? [-IN, y, 0] : [IN, y, 0]);
        const lobbyFront = lv === 0 && side === 'S';
        if (!lobbyFront) plane(IN * 2, wy0, wall, at(yb + wy0 / 2), rot);
        plane(IN * 2, (lobbyFront ? 3.2 : wy1) - (lobbyFront ? 0 : wy0), GLASS, at(yb + (lobbyFront ? 1.6 : (wy0 + wy1) / 2)), rot);
        plane(IN * 2, H - (lobbyFront ? 3.2 : wy1), wall, at(yb + ((lobbyFront ? 3.2 : wy1) + H) / 2), rot);
      }
      // Ceiling lights.
      for (const [lx, lz] of [[-1.5, -3], [3, -2], [-1.5, 3], [3, 3.5]]) glow.add('box', '#ffffff', lx, yb + H - 0.3, lz, 1.2, 0.05, 0.3, 0, 0, 0, false);
      // Lift: car interior, doors, floor buttons.
      piece('#8e8a84', (LIFT.x0 + LIFT.x1) / 2, yb, LIFT.z0 + 0.1, LIFT.x1 - LIFT.x0, 2.8, 0.1, false);
      piece('#b9b3a8', LIFT.x1 - 0.05, yb, (LIFT.z0 + LIFT.z1) / 2, 0.1, 2.8, LIFT.z1 - LIFT.z0, false);
      piece('#3a3d42', LIFT.x1 - 0.12, yb, -6.3, 0.06, 0.5, 0.3, false, 1.1);
      piece('#c9a24a', (LIFT.x0 + LIFT.x1) / 2, yb, LIFT.z0 + 0.25, 2.2, 0.05, 0.05, false, 0.95);
      glow.add('box', '#ffffff', (LIFT.x0 + LIFT.x1) / 2, yb + 2.85, (LIFT.z0 + LIFT.z1) / 2, 1.2, 0.04, 1.2, 0, 0, 0, false);
      b.add('box', '#a7aeb5', LIFT.x0 - 0.08, yb + 1.5, (LIFT.z0 + LIFT.z1) / 2 - 0.9, 0.16, 3.0, 1.3, 0, 0, 0, false);
      b.add('box', '#a7aeb5', LIFT.x0 - 0.08, yb + 1.5, LIFT.z1 - 0.25, 0.16, 3.0, 0.5, 0, 0, 0, false);
      b.add('box', '#a7aeb5', (LIFT.x0 + IN) / 2, yb + 1.5, LIFT.z1 + 0.08, IN - LIFT.x0 + 0.1, 3.0, 0.16, 0, 0, 0, false);
      b.add('box', '#a7aeb5', LIFT.x0 - 0.08, yb + 2.95, (LIFT.doorZ0 + LIFT.doorZ1) / 2, 0.18, 0.3, LIFT.doorZ1 - LIFT.doorZ0, 0, 0, 0, false);
      const doorM = imat('#c4c9cf', 0.35);
      const dw = (LIFT.doorZ1 - LIFT.doorZ0) / 2;
      const dl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.75, dw), doorM);
      const dr = dl.clone();
      dl.position.set(LIFT.x0 - 0.12, yb + 1.38, LIFT.doorZ0 + dw / 2);
      dr.position.set(LIFT.x0 - 0.12, yb + 1.38, LIFT.doorZ1 - dw / 2);
      g.add(dl, dr);
      this.liftDoors.push({ l: dl, r: dr, open: 0 });
      label(`LIFT · ${LEVEL_KEYS[lv]}`, LIFT.x0 - 0.3, yb + 3.3, (LIFT.doorZ0 + LIFT.doorZ1) / 2, 0.36, '#ffffff');
      label(`${LEVEL_KEYS[lv]} · ${LEVEL_NAMES[lv].toUpperCase()}`, 0, yb + 3.25, -IN + 0.3, 0.5);
      label('STAIRS', LB[1] + 0.4, yb + 2.5, lv % 2 === 0 ? ZS + 1.1 : ZN - 1.1, 0.36, '#ffffff');
    }

    // ---- Stairs: three flights as ramps (physics) drawn as steps, with rails.
    const flights: { lane: [number, number]; y0: number; up: 'N' | 'S' }[] = [
      { lane: LA, y0: 0, up: 'N' },
      { lane: LB, y0: H, up: 'S' },
      { lane: LA, y0: 2 * H, up: 'N' },
    ];
    for (const f of flights) {
      const [x0, x1] = f.lane;
      const hAt = f.up === 'N' ? (_x: number, z: number) => f.y0 + (H * (ZS - z)) / RUN : (_x: number, z: number) => f.y0 + (H * (z - ZN)) / RUN;
      this.surfaces.push({ x0, x1, z0: ZN, z1: ZS, h: hAt });
      const steps = 14;
      for (let i = 0; i < steps; i++) {
        const top = f.y0 + (H * (i + 1)) / steps;
        const zc = f.up === 'N' ? ZS - ((i + 0.5) * RUN) / steps : ZN + ((i + 0.5) * RUN) / steps;
        b.add('box', i % 2 ? '#bfa483' : '#c9ae8c', (x0 + x1) / 2, top - 0.14, zc, x1 - x0, 0.28, RUN / steps + 0.01, 0, 0, 0, false);
      }
      // Underside stringer.
      const slope = Math.atan2(H, RUN);
      b.add('box', '#8d8378', (x0 + x1) / 2, f.y0 + H / 2 - 0.3, 0, x1 - x0, 0.2, Math.hypot(RUN, H), f.up === 'N' ? slope : -slope, 0, 0, false);
    }
    // Rails (glass panels with a steel top rail), and their colliders.
    const rail = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
      solid(x0, x1, z0, z1, y0, y1);
      b.add('box', '#9fd8e8', (x0 + x1) / 2, (y0 + Math.min(y1, y0 + 1.05)) / 2, (z0 + z1) / 2, x1 - x0, Math.min(y1 - y0, 1.05), z1 - z0, 0, 0, 0, false);
      b.add('box', '#6c737a', (x0 + x1) / 2, y0 + 1.05, (z0 + z1) / 2, Math.max(0.06, x1 - x0), 0.06, Math.max(0.06, z1 - z0), 0, 0, 0, false);
    };
    rail(LA[0], LA[1], ZS, ZS + 0.1, H, H + 1.1); // level 1: end of the open stairwell
    rail(LB[1] - 0.05, LB[1] + 0.05, ZN, ZS, H, 2 * H + 1.2); // flight 2's open side (and level 2's stairwell)
    rail(LB[0], LB[1], ZN - 0.1, ZN, 2 * H, 2 * H + 1.1); // level 2: end of the open stairwell
    rail(LA[0], LA[1], ZS, ZS + 0.1, 3 * H, 3 * H + 1.1); // penthouse: end of the open stairwell
    // The rail beside flight 2 is drawn as a sloping glass balustrade on top of the level-1 rail.
    b.add('box', '#9fd8e8', LB[1], 1.5 * H + 0.5, 0, 0.06, 1.0, RUN, -Math.atan2(H, RUN), 0, 0, false);

    // ---- Lobby (G)
    {
      const yb = 0;
      piece('#7a5a3a', 4.3, yb, 2.2, 3.6, 1.1, 0.8); // reception desk
      piece('#d8c4a0', 4.3, yb, 2.2, 3.7, 0.06, 0.9, false, 1.1);
      piece('#7a5a3a', 6.3, yb, 1.1, 0.8, 1.1, 1.6);
      piece('#2b3a4a', 0.2, yb, -7.45, 4.5, 2.2, 0.15, false, 0.4); // feature wall
      piece('#3c6e71', -1.5, yb, -3.8, 2.8, 0.45, 0.9); // sofa
      piece('#3c6e71', -1.5, yb, -4.15, 2.8, 0.5, 0.25, true, 0.45); // its back
      piece('#3c6e71', -1.5, yb, -0.3, 2.8, 0.45, 0.9);
      piece('#3c6e71', -1.5, yb, 0.05, 2.8, 0.5, 0.25, true, 0.45);
      piece('#5a4030', -1.5, yb, -2.05, 1.6, 0.4, 0.8); // coffee table
      piece('#c0392b', -1.5, yb, -2.05, 3.6, 0.02, 4.2, false); // rug
      piece('#4d5a66', 7.45, yb, -1.5, 0.25, 1.6, 3.2, true, 0.3); // mailboxes
      for (const [x, z] of [[-2.6, 6.9], [2.6, 6.9], [-3.9, -6.9]]) {
        cyl('#6b4a2e', x, yb + 0.35, z, 0.45, 0.7);
        b.add('sph', '#2e6b3a', x, yb + 1.05, z, 0.9, 1.0, 0.9, 0, 0, 0, false);
        solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, yb, yb + 1.2);
      }
      label('HARBOUR HEIGHTS', 0.2, yb + 2.2, -7.3, 0.6);
      label('G Lobby · 1 Co-working · 2 Sky Lounge & Gym · PH Penthouse', 0.2, yb + 1.6, -7.3, 0.24, '#f0efe9');
      label('EXIT · press E at the doors', 0, yb + 2.9, IN - 0.4, 0.32, '#7dffb0');
      // Concierge behind the desk (a fictional character).
      this.concierge = new HumanRig({ shirt: '#1f3d47', pants: '#22252a', top: 'jacket', skin: '#5a3a26' });
      this.concierge.root.position.set(4.3, 0, 1.2);
      this.concierge.root.rotation.y = -Math.PI / 2;
      g.add(this.concierge.root);
    }
    // ---- Co-working (1)
    {
      const yb = H;
      for (const x of [-2.2, 1.4, 5.0])
        for (const z of [-1.4, 2.4]) {
          piece('#e8e2d6', x, yb, z, 1.7, 0.75, 0.85);
          piece('#22252a', x, yb, z - 0.2, 0.7, 0.42, 0.05, false, 0.75);
          piece('#2f8f8f', x, yb, z + 0.7, 0.55, 0.5, 0.5);
        }
      piece('#5a4030', 2.0, yb, 6.0, 3.0, 0.75, 1.3); // meeting table
      for (const x of [0.9, 2.0, 3.1]) for (const z of [5.0, 7.0]) piece('#d35400', x, yb, z, 0.5, 0.5, 0.5);
      piece('#f7f7f2', 1.2, yb, -7.6, 3.0, 1.3, 0.05, false, 0.9); // whiteboard
      for (const [x, z] of [[-3.8, -6.8], [6.9, 6.9]]) {
        cyl('#6b4a2e', x, yb + 0.35, z, 0.45, 0.7);
        b.add('sph', '#2e6b3a', x, yb + 1.05, z, 0.9, 1.0, 0.9, 0, 0, 0, false);
        solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, yb, yb + 1.2);
      }
    }
    // ---- Sky Lounge & Gym (2)
    {
      const yb = 2 * H;
      for (const x of [0.2, 2.2]) {
        piece('#2b2d31', x, yb, -6.2, 0.9, 0.25, 2.0); // treadmill
        piece('#2b2d31', x, yb, -7.1, 0.9, 1.2, 0.12, true, 0.25);
      }
      piece('#3a3d42', -2.2, yb, -3.0, 0.5, 0.45, 1.6); // bench
      piece('#9aa0a6', -2.2, yb, -3.0, 2.0, 0.06, 0.06, false, 1.2); // bar
      piece('#c0392b', -2.4, yb, 1.0, 2.0, 0.02, 2.6, false); // mats
      piece('#5a3a22', 2.6, yb, 1.6, 2.6, 0.8, 1.4); // pool table
      piece('#1e7a46', 2.6, yb, 1.6, 2.3, 0.04, 1.15, false, 0.8);
      piece('#3b2416', 6.9, yb, 3.0, 1.0, 1.1, 4.0); // juice bar
      piece('#d8c4a0', 6.9, yb, 3.0, 1.1, 0.06, 4.1, false, 1.1);
      for (const z of [1.6, 3.0, 4.4]) cyl('#d8a23a', 5.9, yb + 0.4, z, 0.35, 0.8);
    }
    // ---- Penthouse (PH)
    {
      const yb = 3 * H;
      piece('#efe6d6', 2.3, yb, 2.8, 0.12, 1.4, 5.6); // half-height partition to the bedroom
      piece('#2a1a12', 5.0, yb, 3.6, 2.2, 0.5, 2.3); // bed
      piece('#f4efe6', 5.0, yb, 3.6, 2.0, 0.12, 2.1, false, 0.5);
      piece('#c9a24a', 5.0, yb, 3.0, 2.0, 0.14, 1.0, false, 0.62); // throw
      piece('#f4efe6', 5.0, yb, 4.55, 1.6, 0.18, 0.4, false, 0.62); // pillows
      piece('#2a1a12', 5.0, yb, 4.85, 2.4, 1.1, 0.12); // headboard
      for (const x of [3.6, 6.4]) piece('#5a4030', x, yb, 4.7, 0.5, 0.5, 0.5);
      piece('#7a5a3a', IN - 0.35, yb, 3.5, 0.6, 2.2, 3.2); // wardrobe
      piece('#3c3a5a', -2.0, yb, 5.2, 3.6, 0.45, 1.0); // L-shaped sofa
      piece('#3c3a5a', -2.0, yb, 5.6, 3.6, 0.5, 0.25, true, 0.45);
      piece('#3c3a5a', -4.3, yb, 3.9, 1.0, 0.45, 2.6);
      piece('#c9a24a', -2.0, yb, 3.3, 1.4, 0.38, 0.8); // coffee table
      piece('#b0413e', -2.2, yb, 3.8, 4.0, 0.02, 3.4, false); // rug
      piece('#1a1c22', -2.0, yb, 0.6, 2.4, 0.5, 0.45); // TV unit
      piece('#0c0d10', -2.0, yb, 0.6, 1.9, 1.05, 0.06, false, 0.6); // TV
      piece('#e9e4dc', 0.2, yb, -7.35, 6.6, 0.95, 0.7); // kitchen counter
      piece('#2b2d31', 0.2, yb, -7.6, 6.6, 1.1, 0.12, false, 1.3); // splashback
      piece('#e9e4dc', 0.4, yb, -4.4, 2.8, 0.95, 1.0); // island
      for (const x of [-0.5, 0.4, 1.3]) cyl('#2b2d31', x, yb + 0.35, -3.5, 0.32, 0.7);
      piece('#5a4030', -1.4, yb, -1.4, 1.8, 0.76, 1.0); // dining table
      for (const [x, z] of [[-2.0, -2.2], [-0.8, -2.2], [-2.0, -0.6], [-0.8, -0.6]]) piece('#d8c4a0', x, yb, z, 0.45, 0.5, 0.45);
      for (const [x, z] of [[-3.9, -6.9], [3.6, 6.9]]) {
        cyl('#3a2a1e', x, yb + 0.35, z, 0.45, 0.7);
        b.add('sph', '#2e6b3a', x, yb + 1.1, z, 0.9, 1.1, 0.9, 0, 0, 0, false);
        solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, yb, yb + 1.2);
      }
      label('PENTHOUSE', -1.0, yb + 3.25, 7.3, 0.5);
    }
    b.build(g);
    glow.build(g);
    g.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.interior = g;
    this.scene.add(g);
  }
}
