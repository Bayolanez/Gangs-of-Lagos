import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { HumanLook, HumanRig } from './human';
import { Batcher, textSprite } from './placeholders';
import { CrewDef, memberLook } from './crews';
import * as F from './furniture';

/**
 * Crews buildings (all fictional, built in code with the furniture kit in furniture.ts):
 *  - the crew house north of the square: your room with a bed, a bathroom, a gym, the living room
 *    with the planning table, and the garage the crew drives out of;
 *  - Afterglow, a club east of it, where the crew dances to its own music (clubmusic.ts);
 *  - EKO Arms, a gun shop with a street counter, between them.
 * The house and the club are walk-in interiors built where their outsides stand (the outside hides
 * while you're in, like Harbour Heights). Interiors are built the first time you go in.
 */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
interface Solid extends Rect {
  y0: number;
  y1: number;
}
export interface Spot {
  id: string;
  x: number;
  z: number;
  r: number;
  label: string;
}
type Mover = { x: number; z: number; y: number; heading: number; sync(): void };

export const HOUSE = { x0: -26, x1: -4, z0: -72, z1: -50, door: { x: -15, z: -50 }, height: 3.6 };
export const CLUB = { x0: 62, x1: 90, z0: -74, z1: -50, door: { x: 76, z: -50 }, height: 5 };
export const SHOP = { x0: 6, x1: 22, z0: -64, z1: -50, counter: { x: 14, z: -48.4 } };
/** Where the crew's minibus waits for the club run (the road in front of the house). */
export const GARAGE = { x: -10, z: -43, heading: 0 };
/** Ground the district must leave clear for these (its own buildings there are skipped). */
export const KEEP_OUT: Rect[] = [HOUSE, CLUB, SHOP].map((r) => ({ x0: r.x0 - 2, x1: r.x1 + 2, z0: r.z0 - 2, z1: r.z1 + 0.5 }));

const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.7) });

/** Put a furniture group in place: world position and turn (yaw, radians; 0 = front faces +Z). */
function place<T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x: number, z: number, yaw = 0, y = 0): T {
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  parent.add(o);
  return o;
}

abstract class Interior {
  inside = false;
  interior: THREE.Group | null = null;
  readonly exterior = new THREE.Group();
  protected solids: Solid[] = [];
  spots: Spot[] = [];
  protected t = 0;

  constructor(protected scene: THREE.Scene, world: CollisionWorld, readonly box: Rect & { door: { x: number; z: number }; height: number }) {
    world.add(box.x0, box.x1, box.z0, box.z1, box.height + 0.6);
    scene.add(this.exterior);
  }

  /** Flat floor inside. */
  readonly ground = (): number => 0;

  /** Walls and furniture inside push you out (same idea as Harbour Heights, world coordinates). */
  resolveCircle(p: { x: number; z: number; y?: number }, r: number): void {
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.solids) {
        if (s.y1 < 0.25) continue; // rugs and mats: walk over them
        const qx = THREE.MathUtils.clamp(p.x, s.x0, s.x1), qz = THREE.MathUtils.clamp(p.z, s.z0, s.z1);
        const dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) {
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        } else {
          const opts = [[s.x0 - r - p.x, 0], [s.x1 + r - p.x, 0], [0, s.z0 - r - p.z], [0, s.z1 + r - p.z]];
          opts.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
          p.x += opts[0][0];
          p.z += opts[0][1];
        }
      }
    }
  }

  /** Is this point inside a wall or tall furniture? (The follow camera stops short of it.) */
  blocksPoint(x: number, y: number, z: number): boolean {
    const b = this.box;
    if (x < b.x0 + 0.25 || x > b.x1 - 0.25 || z < b.z0 + 0.25 || z > b.z1 - 0.25 || y > b.height - 0.2) return true;
    for (const s of this.solids) if (s.y1 > 1.6 && y < s.y1 && x > s.x0 - 0.12 && x < s.x1 + 0.12 && z > s.z0 - 0.12 && z < s.z1 + 0.12) return true;
    return false;
  }

  /** Keep the follow camera inside the walls and under the ceiling. */
  clampCamera(pos: THREE.Vector3, playerY: number): void {
    const b = this.box;
    pos.x = THREE.MathUtils.clamp(pos.x, b.x0 + 0.5, b.x1 - 0.5);
    pos.z = THREE.MathUtils.clamp(pos.z, b.z0 + 0.5, b.z1 - 0.5);
    pos.y = THREE.MathUtils.clamp(pos.y, playerY + 0.6, b.height - 0.35);
  }

  nearDoorOutside(x: number, z: number): boolean {
    return !this.inside && Math.hypot(x - this.box.door.x, z - (this.box.door.z + 1.3)) < 2.4;
  }

  /** The thing you're next to inside (bed, gym, planning table, the way out...). */
  spotAt(x: number, z: number): Spot | null {
    if (!this.inside) return null;
    let best: Spot | null = null, bd = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r && d < bd) {
        best = s;
        bd = d;
      }
    }
    return best;
  }

  enter(p: Mover): void {
    if (!this.interior) {
      this.interior = new THREE.Group();
      this.interior.name = `${this.exterior.name}-interior`;
      this.buildInterior(this.interior);
      this.scene.add(this.interior);
    }
    this.inside = true;
    this.interior.visible = true;
    this.exterior.visible = false;
    p.x = this.box.door.x;
    p.z = this.box.door.z - 2.8;
    p.y = 0;
    p.heading = -Math.PI / 2;
    p.sync();
  }

  reset(): void {
    this.inside = false;
    if (this.interior) this.interior.visible = false;
    this.exterior.visible = true;
  }

  exit(p: Mover): void {
    this.reset();
    p.x = this.box.door.x;
    p.z = this.box.door.z + 1.6;
    p.y = 0;
    p.heading = Math.PI / 2;
    p.sync();
  }

  protected abstract buildInterior(g: THREE.Group): void;

  /** Shared helpers for building rooms: blocking boxes, textured walls with door gaps, floors, signs. */
  protected kit(g: THREE.Group, b: Batcher) {
    const solid = (x0: number, x1: number, z0: number, z1: number, y1 = 3) => this.solids.push({ x0, x1, z0, z1, y0: 0, y1 });
    /** A furniture group with a blocking footprint (half sizes hx, hz around x, z). */
    const thing = (o: THREE.Object3D, x: number, z: number, yaw: number, hx: number, hz: number, h = 1.2) => {
      place(g, o, x, z, yaw);
      const turned = Math.abs(Math.sin(yaw)) > 0.7;
      const ex = turned ? hz : hx, ez = turned ? hx : hz;
      solid(x - ex, x + ex, z - ez, z + ez, h);
      return o;
    };
    /** A wall along x (at z) or along z (at x) from a to c, with door gaps [centre, width]. */
    const wall = (along: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][], m: THREE.Material, h: number, skirting = '#5a3b24') => {
      const cuts = [a, ...gaps.flatMap(([mid, w]) => [mid - w / 2, mid + w / 2]), c];
      for (let i = 0; i < cuts.length; i += 2) {
        const p0 = cuts[i], p1 = cuts[i + 1], len = p1 - p0, mid = (p0 + p1) / 2;
        if (len <= 0.01) continue;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? len : 0.2, h, along === 'x' ? 0.2 : len), m);
        mesh.position.set(along === 'x' ? mid : at, h / 2, along === 'x' ? at : mid);
        mesh.receiveShadow = true;
        g.add(mesh);
        if (along === 'x') {
          b.add('box', skirting, mid, 0.06, at, len, 0.12, 0.24, 0, 0, 0, false);
          solid(p0, p1, at - 0.1, at + 0.1, h);
        } else {
          b.add('box', skirting, at, 0.06, mid, 0.24, 0.12, len, 0, 0, 0, false);
          solid(at - 0.1, at + 0.1, p0, p1, h);
        }
      }
      for (const [mid, w] of gaps) {
        // Lintel and a simple door frame round each opening.
        if (along === 'x') {
          b.add('box', '#e8e2d6', mid, h - 0.35, at, w, 0.7, 0.2, 0, 0, 0, false);
          for (const s of [-1, 1]) b.add('box', '#f2efe8', mid + (s * w) / 2, (h - 0.7) / 2, at, 0.08, h - 0.7, 0.26, 0, 0, 0, false);
        } else {
          b.add('box', '#e8e2d6', at, h - 0.35, mid, 0.2, 0.7, w, 0, 0, 0, false);
          for (const s of [-1, 1]) b.add('box', '#f2efe8', at, (h - 0.7) / 2, mid + (s * w) / 2, 0.26, h - 0.7, 0.08, 0, 0, 0, false);
        }
      }
    };
    /** A floor area with its own material (wood, tiles, rubber...). */
    const floorArea = (m: THREE.Material, x0: number, x1: number, z0: number, z1: number, y = 0.02) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    const shell = (wallM: THREE.Material, ceiling: string, doorColour: string) => {
      const bx = this.box, h = bx.height;
      wall('x', bx.z0 + 0.1, bx.x0, bx.x1, [], wallM, h);
      wall('x', bx.z1 - 0.1, bx.x0, bx.x1, [], wallM, h);
      wall('z', bx.x0 + 0.1, bx.z0, bx.z1, [], wallM, h);
      wall('z', bx.x1 - 0.1, bx.z0, bx.z1, [], wallM, h);
      b.add('box', ceiling, (bx.x0 + bx.x1) / 2, h + 0.05, (bx.z0 + bx.z1) / 2, bx.x1 - bx.x0, 0.1, bx.z1 - bx.z0, 0, 0, 0, false);
      // The front door, seen from inside.
      place(g, F.doorUnit(doorColour), bx.door.x, bx.z1 - 0.22, Math.PI);
    };
    const sign = (text: string, x: number, y: number, z: number, h = 0.6, color = '#ffcf5a') => {
      const s = textSprite(text, color, h);
      s.position.set(x, y, z);
      g.add(s);
      return s;
    };
    return { solid, thing, wall, floorArea, shell, sign };
  }
}

// ---------- The crew house ----------
export class CrewHouse extends Interior {
  private crew: CrewDef | null = null;
  private signSprite: THREE.Sprite | null = null;
  private accent = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.8 });
  private rugM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  private towel = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.95 });
  private fan: THREE.Group | null = null;
  private tv: THREE.MeshBasicMaterial | null = null;
  /** Crew members hanging out round the planning table. */
  readonly members: HumanRig[] = [];

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    super(scene, world, HOUSE);
    this.exterior.name = 'crew-house';
    const bx = HOUSE, cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2, w = bx.x1 - bx.x0, d = bx.z1 - bx.z0, h = bx.height;
    const ex = this.exterior;
    // Plastered walls, a parapet round the flat roof, a crew-colour band.
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.6, d), F.plaster('#d8c7a8', [6, 1]));
    walls.position.set(cx, (h + 0.6) / 2, cz);
    walls.castShadow = walls.receiveShadow = true;
    ex.add(walls);
    const b = new Batcher();
    for (const [px, pz, sx, sz] of [[cx, bx.z0, w + 0.3, 0.3], [cx, bx.z1, w + 0.3, 0.3], [bx.x0, cz, 0.3, d], [bx.x1, cz, 0.3, d]]) b.add('box', '#c9b79a', px, h + 0.95, pz, sx, 0.7, sz);
    b.add('box', '#9a8a70', cx, 0.25, bx.z1 + 0.02, w + 0.1, 0.5, 0.06, 0, 0, 0, false); // plinth
    b.add('box', '#d8d2c4', bx.door.x, 0.1, bx.z1 + 1.1, 3, 0.2, 2.2, 0, 0, 0, false); // front step
    for (const x of [bx.door.x - 2.2, bx.door.x + 2.2]) {
      b.add('box', '#8a7a62', x, 0.3, bx.z1 + 0.7, 1.0, 0.6, 0.7); // planters
      b.add('sph', '#2e7d32', x, 0.75, bx.z1 + 0.7, 0.45, 0.35, 0.3, 0, 0, 0, false);
    }
    b.add('box', '#6b6f73', bx.x1 - 3.5, 1.45, bx.z1 + 0.04, 4.6, 2.9, 0.08, 0, 0, 0, false); // garage roller door
    for (let i = 0; i < 9; i++) b.add('box', '#5a5e62', bx.x1 - 3.5, 0.2 + i * 0.32, bx.z1 + 0.09, 4.5, 0.03, 0.02, 0, 0, 0, false);
    b.build(ex);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.35, d + 0.04), this.accent);
    stripe.position.set(cx, h - 0.2, cz);
    ex.add(stripe);
    place(ex, F.doorUnit('#3c2a1c', 1.3, 2.3), bx.door.x, bx.z1 + 0.04);
    for (const x of [bx.x0 + 3, bx.x0 + 7, bx.door.x + 4.4]) place(ex, F.windowUnit(1.8, 1.2), x, bx.z1 + 0.03, 0, 1.75);
    for (const z of [cz - 5, cz + 4]) place(ex, F.windowUnit(1.6, 1.1), bx.x0 - 0.03, z, -Math.PI / 2, 1.8);
    place(ex, F.acUnit(), bx.x0 + 5, bx.z1 + 0.2, 0, 2.9);
    place(ex, F.waterTank(), bx.x0 + 4, cz - 4, 0, h + 0.6);
    this.setCrew(null);
  }

  /** Whose house it is (null: nobody's yet, the door stays locked). */
  setCrew(crew: CrewDef | null): void {
    this.crew = crew;
    const c = crew ? crew.colour : '#8a8378';
    this.accent.color.set(c);
    this.towel.color.set(c);
    const rug = F.rugMaterial(c);
    this.rugM.map = rug.map;
    this.rugM.needsUpdate = true;
    this.signSprite?.removeFromParent();
    this.signSprite = textSprite(crew ? `${crew.name.toUpperCase()} HOUSE` : 'CREW HOUSE · MEMBERS ONLY', crew ? crew.colour : '#ffcf5a', 0.75);
    this.signSprite.position.set(HOUSE.door.x, HOUSE.height + 1.6, HOUSE.z1 + 0.4);
    this.exterior.add(this.signSprite);
    this.members.forEach((m, i) => crew && m.dress(memberLook(crew, i + 1)));
    for (const m of this.members) m.root.visible = !!crew;
  }

  get owner(): CrewDef | null {
    return this.crew;
  }

  protected buildInterior(g: THREE.Group): void {
    const b = new Batcher();
    const { thing, wall, floorArea, shell, sign, solid } = this.kit(g, b);
    const bx = HOUSE, h = bx.height;
    const wallM = F.plaster('#ece3d2');
    floorArea(F.woodFloor([5, 5]), bx.x0, bx.x1, bx.z0, bx.z1);
    shell(wallM, '#f2ede2', '#3c2a1c');
    // Back rooms: your room, the bathroom, the gym (north half); living room with the planning table (south).
    const zMid = -61, xa = -18.7, xb = -11.3;
    wall('x', zMid, bx.x0, bx.x1, [[-22.3, 1.6], [-15, 1.6], [-7.6, 1.6]], wallM, h);
    wall('z', xa, bx.z0, zMid, [], wallM, h);
    wall('z', xb, bx.z0, zMid, [], wallM, h);
    floorArea(F.tiles('#e9f0f2', '#cfe0e6', [4, 6]), xa + 0.1, xb - 0.1, bx.z0 + 0.2, zMid - 0.1, 0.025);
    floorArea(F.rubber([4, 6]), xb + 0.1, bx.x1 - 0.2, bx.z0 + 0.2, zMid - 0.1, 0.025);
    const bathWall = F.tiles('#f6f8f9', '#e2edf1', [6, 2]);
    const tilesUp = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.4), bathWall);
    tilesUp.position.set(-15, 0.75, bx.z0 + 0.21);
    g.add(tilesUp);

    // Your room: bed, side table with lamp, wardrobe, rug, posters, a plant.
    thing(F.bed('#2f4a6a'), -23.6, -70.2, 0, 0.8, 1.1, 0.7);
    thing(F.nightstand(GLOW), -21.9, -71.2, 0, 0.26, 0.24, 0.7);
    thing(F.wardrobe(), -25.5, -64.5, Math.PI / 2, 0.62, 0.32, 2.3);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), this.rugM);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-22.6, 0.04, -66.6);
    g.add(rug);
    place(g, F.picture(F.posterMaterial('#1f6fd1', 1), 0.7, 0.95), -22.6, bx.z0 + 0.22, 0, 1.8);
    place(g, F.picture(F.posterMaterial('#c62828', 2), 0.6, 0.8), -19.0, -66, -Math.PI / 2, 1.7);
    thing(F.plant(), -19.4, -62, 0, 0.22, 0.22, 1);
    sign('YOUR ROOM', -22.3, 3.0, -61.25, 0.3, '#ffe9c0');

    // Bathroom: toilet, basin and mirror, shower, towel rail.
    thing(F.toilet(), -17.4, -71.3, 0, 0.25, 0.35, 0.9);
    thing(F.basin(), -13.6, -71.5, 0, 0.32, 0.26, 1);
    thing(F.shower('#7fb0c8'), -12.4, -63.4, -Math.PI / 2, 0.8, 0.8, 0.15);
    const rail = F.towelRail('#888888');
    rail.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).roughness === 0.95) m.material = this.towel;
    });
    place(g, rail, -15.6, bx.z0 + 0.2);
    sign('BATHROOM', -15, 3.0, -61.25, 0.3, '#ffe9c0');

    // Gym: bench press, punching bag, dumbbell rack, treadmill, a mirror wall.
    thing(F.benchPress(), -7.2, -68.6, 0, 0.6, 0.85, 1.25);
    thing(F.punchingBag(), -5.3, -64.2, 0, 0.3, 0.3, 2.0);
    thing(F.dumbbellRack(), -10.5, -70.4, Math.PI / 2, 0.8, 0.25, 0.9);
    thing(F.treadmill(), -5.2, -70.2, 0, 0.42, 0.9, 1.4);
    b.add('box', '#c8d8e0', -4.25, 1.4, -66.8, 0.03, 1.9, 3.8, 0, 0, 0, false);
    sign('GYM', -7.6, 3.0, -61.25, 0.3, '#ffe9c0');

    // Living room: planning table and chairs, L sofa and TV, coffee table, plants, fan, garage door.
    thing(F.planningTable(planningMap()), -15, -56, 0, 1.3, 0.75, 0.9);
    for (const [x, z, yaw] of [[-16.9, -57.6, 0], [-13.1, -57.6, 0]] as const) place(g, F.chair(), x, z, yaw);
    thing(F.sofa('#2e3a4a', 3.0), -23.4, -52.6, Math.PI, 1.5, 0.45, 0.9);
    thing(F.sofa('#2e3a4a', 2.2), -25.2, -55.6, Math.PI / 2, 1.1, 0.45, 0.9);
    thing(F.coffeeTable(), -22.6, -55.2, 0, 0.55, 0.3, 0.45);
    this.tv = new THREE.MeshBasicMaterial({ color: '#2a4a6a' });
    thing(F.tvUnit(this.tv), -22.6, -59.9, 0, 1.0, 0.25, 2.0);
    for (const [x, z] of [[-8, -51.2], [-25.2, -51.2], [-9.5, -60.2]]) thing(F.plant(), x, z, 0, 0.22, 0.22, 1);
    place(g, F.picture(F.posterMaterial('#f2b705', 3), 1.2, 0.8), -15, -60.85, Math.PI, 2.1);
    b.add('box', '#6b6f73', -4.3, 1.4, -55, 0.15, 2.8, 4.4, 0, 0, 0, false); // garage roller door (inside)
    for (let i = 0; i < 9; i++) b.add('box', '#5a5e62', -4.38, 0.2 + i * 0.3, -55, 0.02, 0.03, 4.3, 0, 0, 0, false);
    sign('GARAGE · CLUB RUN', -5.2, 3.0, -55, 0.3, '#ffe9c0');
    sign('PLANNING', -15, 2.7, -56, 0.3, '#ffe9c0');
    const fan = F.ceilingFan();
    place(g, fan.group, -15, -56, 0, h);
    this.fan = fan.blades;
    for (const [x, z] of [[-21, -55], [-9, -55], [-15, -66], [-22.3, -66], [-7.6, -66]]) place(g, F.ceilingLight(GLOW), x, z, 0, h - 0.03);
    b.build(g);
    const lamp = new THREE.PointLight('#ffe6c4', 18, 30, 1.2);
    lamp.position.set(-15, h - 0.4, -61);
    g.add(lamp);

    // Crew members round the planning table.
    const spots: [number, number, number][] = [[-16.8, -54.6, -0.6], [-13.1, -54.7, -2.4], [-15, -57.9, 1.57]];
    spots.forEach(([x, z, hd], i) => {
      const rig = new HumanRig(this.crew ? memberLook(this.crew, i + 1) : { shirt: '#22252a' });
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = -hd;
      rig.root.visible = !!this.crew;
      rig.root.name = `house-member-${i}`;
      g.add(rig.root);
      this.members.push(rig);
      solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 1.8);
    });

    this.spots = [
      { id: 'bed', x: -23.6, z: -68.1, r: 1.7, label: 'Sleep in your bed' },
      { id: 'bath', x: -15, z: -67.5, r: 2.2, label: 'Use the bathroom' },
      { id: 'gym', x: -7.6, z: -66.6, r: 2.0, label: 'Work out' },
      { id: 'plan', x: -15, z: -53.8, r: 2.2, label: 'Plan with the crew' },
      { id: 'club', x: -5.6, z: -55, r: 1.8, label: 'Drive to the club with the crew' },
      { id: 'exit', x: HOUSE.door.x, z: HOUSE.door.z - 1.1, r: 1.3, label: 'Leave the house' },
    ];
  }

  update(dt: number): void {
    if (!this.inside) return;
    this.t += dt;
    if (this.fan) this.fan.rotation.y += dt * 4;
    if (this.tv) this.tv.color.setHSL(0.58 + 0.04 * Math.sin(this.t * 0.7), 0.5, 0.25 + 0.08 * Math.sin(this.t * 3.1) * Math.sin(this.t * 1.3));
    this.members.forEach((m, i) => {
      m.pose = (Math.floor(this.t / 4) + i) % 3 === 0 ? 'talk' : (Math.floor(this.t / 4) + i) % 3 === 1 ? 'point' : 'none';
      m.animate(dt, 0);
    });
  }
}

/** A hand-drawn street map for the planning table (canvas texture, fictional streets). */
function planningMap(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 280;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e8dcc0';
  x.fillRect(0, 0, 512, 280);
  x.strokeStyle = '#9a8a6a';
  x.lineWidth = 10;
  for (const v of [80, 210, 340, 470]) {
    x.beginPath();
    x.moveTo(v, 0);
    x.lineTo(v, 280);
    x.stroke();
  }
  for (const v of [60, 150, 240]) {
    x.beginPath();
    x.moveTo(0, v);
    x.lineTo(512, v);
    x.stroke();
  }
  x.fillStyle = '#3a6ea5';
  x.fillRect(480, 0, 32, 280);
  for (const [px, py, col] of [[150, 100, '#c62828'], [280, 200, '#1f6fd1'], [400, 110, '#f2b705'], [120, 220, '#2e7d32']] as const) {
    x.fillStyle = col;
    x.beginPath();
    x.arc(px, py, 12, 0, Math.PI * 2);
    x.fill();
  }
  x.strokeStyle = '#c62828';
  x.lineWidth = 4;
  x.setLineDash([10, 8]);
  x.beginPath();
  x.moveTo(150, 100);
  x.lineTo(280, 200);
  x.lineTo(400, 110);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Afterglow, the club ----------
export class Club extends Interior {
  private tiles: THREE.MeshBasicMaterial[] = [];
  private neons: THREE.MeshBasicMaterial[] = [];
  private ball: THREE.Mesh | null = null;
  private platters: THREE.Object3D[] = [];
  private bouncer: HumanRig;
  /** Beat clock (seconds); the music sets it so the lights pulse in time. */
  beat = 0;
  bpm = 112;
  /** People dancing: the regulars and, after a club run, your crew. */
  readonly dancers: { rig: HumanRig; x: number; z: number; ph: number }[] = [];
  private crewDancers: HumanRig[] = [];

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    super(scene, world, CLUB);
    this.exterior.name = 'club-afterglow';
    const bx = CLUB, cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2, w = bx.x1 - bx.x0, d = bx.z1 - bx.z0, h = bx.height;
    const ex = this.exterior;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.8, d), F.plaster('#2a2436', [6, 1]));
    walls.position.set(cx, (h + 0.8) / 2, cz);
    walls.castShadow = walls.receiveShadow = true;
    ex.add(walls);
    const b = new Batcher();
    b.add('box', '#14121a', bx.door.x, 1.25, bx.z1 + 0.04, 2.2, 2.5, 0.08, 0, 0, 0, false); // double doors
    b.add('box', '#c9a24a', bx.door.x, 1.25, bx.z1 + 0.09, 0.04, 2.4, 0.02, 0, 0, 0, false);
    b.add('box', '#1c1a24', bx.door.x, 2.85, bx.z1 + 1.1, 5, 0.12, 2.2); // canopy
    for (const x of [bx.door.x - 2.3, bx.door.x + 2.3]) b.add('cyl', '#c9a24a', x, 1.4, bx.z1 + 2.1, 0.05, 2.8, 0.05, 0, 0, 0, false);
    for (const x of [bx.door.x - 3, bx.door.x + 3]) b.add('cyl', '#d9c27a', x, 0.5, bx.z1 + 1.2, 0.06, 1.0, 0.06, 0, 0, 0, false);
    b.add('box', '#7a1e3a', bx.door.x, 0.95, bx.z1 + 1.2, 6, 0.06, 0.06, 0, 0, 0, false); // velvet rope
    b.build(ex);
    // Neon outline round the facade and poster frames.
    for (const [y, c] of [[h + 0.65, '#ff4fa3'], [0.4, '#3ff0ff']] as const) {
      const n = F.neon(c, w - 0.4);
      n.position.set(cx, y, bx.z1 + 0.06);
      ex.add(n);
      this.neons.push(n.material as THREE.MeshBasicMaterial);
    }
    for (const [x, seed] of [[bx.door.x - 6, 4], [bx.door.x + 6, 5]] as const) place(ex, F.picture(F.posterMaterial('#ff4fa3', seed), 1.4, 1.9), x, bx.z1 + 0.06, 0, 1.7);
    const s = textSprite('AFTERGLOW', '#ff7ad0', 1.6);
    s.position.set(bx.door.x, h - 0.6, bx.z1 + 0.5);
    ex.add(s);
    const s2 = textSprite('club · fictional', '#f0f0eb', 0.45);
    s2.position.set(bx.door.x, h - 1.7, bx.z1 + 0.5);
    ex.add(s2);
    this.bouncer = new HumanRig({ shirt: '#111114', pants: '#111114', skin: '#3b2416', top: 'jacket' });
    this.bouncer.root.position.set(bx.door.x + 1.7, 0, bx.z1 + 0.8);
    this.bouncer.root.rotation.y = -Math.PI / 2;
    this.bouncer.pose = 'crossed';
    ex.add(this.bouncer.root);
  }

  protected buildInterior(g: THREE.Group): void {
    const b = new Batcher();
    const { thing, floorArea, shell, sign, solid } = this.kit(g, b);
    const bx = CLUB, h = bx.height;
    floorArea(new THREE.MeshStandardMaterial({ color: '#141218', roughness: 0.35, metalness: 0.2 }), bx.x0, bx.x1, bx.z0, bx.z1);
    shell(F.plaster('#2a2436', [6, 1]), '#100e14', '#14121a');
    // Dance floor: tiles that pulse in time.
    const fx = 76, fz = -63, n = 6, size = 1.6;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const m = new THREE.MeshBasicMaterial({ color: '#331144' });
        const tile = new THREE.Mesh(new THREE.BoxGeometry(size - 0.06, 0.04, size - 0.06), m);
        tile.position.set(fx + (i - n / 2 + 0.5) * size, 0.05, fz + (j - n / 2 + 0.5) * size);
        g.add(tile);
        this.tiles.push(m);
      }
    }
    // DJ booth with spinning decks, speaker stacks, the bar with stools and bottles, booths, neon.
    const dj = F.djBooth();
    thing(dj.group, 76, -72.2, 0, 1.8, 0.5, 1.2);
    this.platters = dj.platters;
    for (const x of [72.2, 79.8]) thing(F.speaker(2.4), x, -72.6, 0, 0.5, 0.4, 2.4);
    for (const x of [63.2, 88.8]) for (const z of [-56, -70]) thing(F.speaker(1.6), x, z, x < 76 ? Math.PI / 2 : -Math.PI / 2, 0.5, 0.4, 1.6);
    // Bar along the west wall.
    b.add('box', '#3a2418', 64.4, 0.55, -62, 1.0, 1.1, 12);
    b.add('box', '#c9a24a', 64.4, 1.12, -62, 1.2, 0.05, 12.2, 0, 0, 0, false);
    solid(63.9, 64.9, -68, -56, 1.15);
    b.add('box', '#2a2a32', 62.4, 1.6, -62, 0.4, 2.4, 12, 0, 0, 0, false);
    let k = 0;
    for (let z = -67.6; z <= -56.4; z += 0.45) b.add('cyl', ['#3a7a3a', '#7a5a2a', '#c8c8c8', '#3ff0ff'][k++ % 4], 62.7, 1.95, z, 0.06, 0.32, 0.06, 0, 0, 0, false);
    const shelfGlow = F.neon('#ffb43c', 11.6);
    shelfGlow.position.set(62.65, 1.75, -62);
    shelfGlow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(shelfGlow);
    for (let z = -67; z <= -57; z += 1.6) place(g, F.barStool(), 65.6, z);
    // Booths on the east side.
    for (const z of [-58, -66]) thing(F.boothSeat('#5a1e3a', 2.4), 88.2, z, -Math.PI / 2, 1.2, 0.5, 0.9);
    // Neon strips along the walls and ceiling.
    for (const [x, z, len, c, yaw] of [[76, bx.z0 + 0.15, 26, '#ff4fa3', 0], [76, bx.z1 - 0.15, 26, '#3ff0ff', 0], [bx.x0 + 0.15, -62, 22, '#ffb43c', Math.PI / 2], [bx.x1 - 0.15, -62, 22, '#ff4fa3', Math.PI / 2]] as const) {
      const nn = F.neon(c, len);
      nn.position.set(x, h - 0.4, z);
      nn.rotation.y = yaw;
      g.add(nn);
      this.neons.push(nn.material as THREE.MeshBasicMaterial);
    }
    b.build(g);
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: '#dfe6ff', metalness: 1, roughness: 0.15, flatShading: true }));
    this.ball.position.set(fx, h - 0.8, fz);
    g.add(this.ball);
    sign('AFTERGLOW', 76, 3.7, -73.4, 0.9, '#ff7ad0');
    const lights: [string, number, number][] = [['#ff4fa3', 70, -63], ['#3ff0ff', 82, -63], ['#ffb43c', 76, -57]];
    for (const [c, x, z] of lights) {
      const l = new THREE.PointLight(c, 14, 18, 1.2);
      l.position.set(x, h - 0.6, z);
      g.add(l);
    }
    // Regulars on the dance floor.
    const looks: HumanLook[] = [
      { shirt: '#e0479a', pants: '#1c1d22', skin: '#5a3a26', top: 'tee' },
      { shirt: '#3ff0ff', pants: '#2b2b2b', skin: '#3b2416', top: 'jacket' },
      { shirt: '#ffb43c', pants: '#1c1d22', skin: '#7a4e30', headwrap: '#e0479a' },
      { shirt: '#f0efe9', pants: '#2d3e5c', skin: '#4a2e1c', top: 'hoodie' },
      { shirt: '#7b1e2b', pants: '#1c1d22', skin: '#6a4228', hat: 'cap', hatColour: '#111111' },
    ];
    const at: [number, number][] = [[73.5, -65], [78.5, -64.5], [75, -60.5], [79.5, -60], [72.8, -61]];
    looks.forEach((lk, i) => {
      const rig = new HumanRig(lk);
      const [x, z] = at[i];
      rig.root.position.set(x, 0, z);
      g.add(rig.root);
      this.dancers.push({ rig, x, z, ph: i * 1.3 });
    });
    this.spots = [{ id: 'exit', x: CLUB.door.x, z: CLUB.door.z - 1.1, r: 1.3, label: 'Leave the club' }];
  }

  /** Your crew joins the dancing (after a club run), or goes home. */
  setCrewDancing(crew: CrewDef | null): void {
    for (const r of this.crewDancers) {
      r.root.removeFromParent();
      const k = this.dancers.findIndex((d) => d.rig === r);
      if (k >= 0) this.dancers.splice(k, 1);
    }
    this.crewDancers = [];
    if (!crew || !this.interior) return;
    const at: [number, number][] = [[75.5, -63.5], [77.5, -62.2], [74.2, -62.5], [76.8, -65.6]];
    at.forEach(([x, z], i) => {
      const rig = new HumanRig(memberLook(crew, i));
      rig.root.position.set(x, 0, z);
      this.interior!.add(rig.root);
      this.crewDancers.push(rig);
      this.dancers.push({ rig, x, z, ph: 0.4 + i });
    });
  }

  get crewCount(): number {
    return this.crewDancers.length;
  }

  update(dt: number, px = 0, pz = 0): void {
    this.t += dt;
    this.bouncer.animate(dt, 0);
    // The facade neon flickers gently outside too.
    const beats = this.beat * (this.bpm / 60);
    const pulse = Math.pow(1 - (beats % 1), 3);
    this.neons.forEach((m, i) => m.color.setScalar(1).multiplyScalar(1.4 + (i % 2 ? pulse : 1 - pulse) * 1.2));
    if (!this.inside) return;
    this.tiles.forEach((m, i) => {
      const on = (Math.floor(beats) + i * 7) % 4 === 0 ? 1 : 0;
      const hue = ((i * 0.07 + this.t * 0.05) % 1 + 1) % 1;
      m.color.setHSL(hue, 0.9, 0.1 + 0.25 * pulse + 0.2 * on);
    });
    if (this.ball) this.ball.rotation.y += dt * 0.8;
    for (const p of this.platters) p.rotation.y += dt * 3.5;
    for (const d of this.dancers) {
      d.rig.pose = 'dance';
      const bob = Math.abs(Math.sin((beats + d.ph) * Math.PI)) * 0.06;
      d.rig.root.position.set(d.x, bob, d.z);
      const near = Math.hypot(px - d.x, pz - d.z) < 2.5;
      const toward = near ? Math.atan2(pz - d.z, px - d.x) : Math.atan2(-63 - d.z, 76 - d.x);
      d.rig.root.rotation.y = -(toward + 0.35 * Math.sin((this.t + d.ph) * 1.05));
      d.rig.animate(dt, 0);
    }
  }
}

// ---------- EKO Arms, the gun shop ----------
export class ArmsShop {
  readonly group = new THREE.Group();
  readonly keeper: HumanRig;
  private t = 0;

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    this.group.name = 'eko-arms';
    const s = SHOP, cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, w = s.x1 - s.x0, d = s.z1 - s.z0;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, 4.4, d), F.plaster('#5c6168', [4, 1]));
    walls.position.set(cx, 2.2, cz);
    walls.castShadow = walls.receiveShadow = true;
    this.group.add(walls);
    const b = new Batcher();
    b.add('box', '#2a2d33', cx, 4.55, cz, w + 0.4, 0.3, d + 0.4);
    b.add('box', '#b71c1c', cx, 3.2, s.z1 + 0.7, 6.4, 0.1, 1.6, -0.15, 0, 0, false); // awning
    for (let i = 0; i < 8; i++) b.add('box', i % 2 ? '#f0efe9' : '#b71c1c', cx - 2.8 + i * 0.8, 3.08, s.z1 + 1.48, 0.8, 0.22, 0.04, 0, 0, 0, false); // scalloped edge
    // Security grille, half raised, either side of the service window.
    for (const x of [cx - 4.4, cx + 4.4]) for (let i = 0; i < 6; i++) b.add('box', '#3a3d42', x, 0.3 + i * 0.4, s.z1 + 0.05, 2.4, 0.06, 0.03, 0, 0, 0, false);
    b.build(this.group);
    place(this.group, F.gunWall(5.2, 1.6), cx, s.z1 - 0.3, 0, 1.75);
    place(this.group, F.glassCounter(5.6), cx, s.counter.z);
    // A lit sign box.
    const signBox = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.95, 0.08), new THREE.MeshBasicMaterial({ color: '#1a1a1e' }));
    signBox.position.set(cx, 3.95, s.z1 + 0.05);
    this.group.add(signBox);
    world.add(s.x0, s.x1, s.z0, s.z1, 4.4);
    world.add(cx - 2.8, cx + 2.8, s.counter.z - 0.4, s.counter.z + 0.4, 1.1);
    const sign = textSprite('EKO ARMS', '#ffcf5a', 1.0);
    sign.position.set(cx, 3.97, s.z1 + 0.5);
    this.group.add(sign);
    const sub = textSprite('licensed dealer · fictional', '#f0f0eb', 0.36);
    sub.position.set(cx, 3.5, s.z1 + 0.5);
    this.group.add(sub);
    this.keeper = new HumanRig({ shirt: '#3a3d42', pants: '#1c1d22', skin: '#4a2e1c', top: 'jacket', hat: 'cap', hatColour: '#b71c1c' });
    this.keeper.root.position.set(cx + 0.6, 0, s.counter.z - 0.75);
    this.keeper.root.rotation.y = -Math.PI / 2; // facing the street (+z)
    this.group.add(this.keeper.root);
    scene.add(this.group);
  }

  /** Close enough to the counter to buy. */
  near(x: number, z: number): boolean {
    return Math.hypot(x - SHOP.counter.x, z - (SHOP.counter.z + 1.3)) < 2.4;
  }

  update(dt: number, px: number, pz: number): void {
    this.t += dt;
    this.keeper.pose = this.near(px, pz) ? 'talk' : 'none';
    this.keeper.animate(dt, 0);
  }
}
