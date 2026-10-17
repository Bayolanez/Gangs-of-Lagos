import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { HumanLook, HumanRig } from './human';
import { Batcher, textSprite } from './placeholders';
import { CrewDef, memberLook } from './crews';

/**
 * Crews phase buildings (all fictional, PLACEHOLDER art built from boxes):
 *  - the crew house north of the square: your room with a bed, a bathroom, a gym, the planning table
 *    and the garage the crew drives out of;
 *  - Afterglow, a club east of it, where the crew dances;
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

  /** Shared helpers for building rooms: a box that may block, a floor, walls with door gaps. */
  protected kit(g: THREE.Group, b: Batcher) {
    const solid = (x0: number, x1: number, z0: number, z1: number, y1 = 3) => this.solids.push({ x0, x1, z0, z1, y0: 0, y1 });
    const piece = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, block = true) => {
      b.add('box', color, x, y + sy / 2, z, sx, sy, sz, 0, 0, 0, false);
      if (block) solid(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2, y + sy);
    };
    /** A wall along x (at z) or along z (at x) from a to c, with door gaps [centre, width]. */
    const wall = (along: 'x' | 'z', at: number, a: number, c: number, gaps: [number, number][], color: string, h: number) => {
      const cuts = [a, ...gaps.flatMap(([m, w]) => [m - w / 2, m + w / 2]), c];
      for (let i = 0; i < cuts.length; i += 2) {
        const p0 = cuts[i], p1 = cuts[i + 1], len = p1 - p0, mid = (p0 + p1) / 2;
        if (len <= 0.01) continue;
        if (along === 'x') piece(color, mid, 0, at, len, h, 0.2);
        else piece(color, at, 0, mid, 0.2, h, len);
      }
      // Lintels over the gaps
      for (const [m, w] of gaps) {
        if (along === 'x') b.add('box', color, m, h - 0.35, at, w, 0.7, 0.2, 0, 0, 0, false);
        else b.add('box', color, at, h - 0.35, m, 0.2, 0.7, w, 0, 0, 0, false);
      }
    };
    const floor = (color: string) => {
      const bx = this.box;
      b.add('box', color, (bx.x0 + bx.x1) / 2, 0.02, (bx.z0 + bx.z1) / 2, bx.x1 - bx.x0, 0.04, bx.z1 - bx.z0, 0, 0, 0, false);
    };
    const shell = (wallColor: string, ceiling: string) => {
      const bx = this.box, h = bx.height;
      wall('x', bx.z0 + 0.1, bx.x0, bx.x1, [], wallColor, h);
      wall('x', bx.z1 - 0.1, bx.x0, bx.x1, [], wallColor, h);
      wall('z', bx.x0 + 0.1, bx.z0, bx.z1, [], wallColor, h);
      wall('z', bx.x1 - 0.1, bx.z0, bx.z1, [], wallColor, h);
      b.add('box', ceiling, (bx.x0 + bx.x1) / 2, h + 0.05, (bx.z0 + bx.z1) / 2, bx.x1 - bx.x0, 0.1, bx.z1 - bx.z0, 0, 0, 0, false);
      // The front door, seen from inside.
      b.add('box', '#5a3a22', bx.door.x, 1.1, bx.door.z - 0.22, 1.3, 2.2, 0.06, 0, 0, 0, false);
    };
    const sign = (text: string, x: number, y: number, z: number, h = 0.6, color = '#ffcf5a') => {
      const s = textSprite(text, color, h);
      s.position.set(x, y, z);
      g.add(s);
      return s;
    };
    return { solid, piece, wall, floor, shell, sign };
  }
}

// ---------- The crew house ----------
export class CrewHouse extends Interior {
  private crew: CrewDef | null = null;
  private signSprite: THREE.Sprite | null = null;
  private accent = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.8 });
  /** Crew members hanging out round the planning table. */
  readonly members: HumanRig[] = [];

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    super(scene, world, HOUSE);
    this.exterior.name = 'crew-house';
    const b = new Batcher();
    const bx = HOUSE, cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2, w = bx.x1 - bx.x0, d = bx.z1 - bx.z0;
    b.add('box', '#c9b79a', cx, bx.height / 2 + 0.3, cz, w, bx.height + 0.6, d); // walls
    b.add('box', '#7a3b2a', cx, bx.height + 0.75, cz, w + 0.6, 0.3, d + 0.6); // roof slab
    b.add('box', '#3c2a1c', bx.door.x, 1.15, bx.z1 + 0.03, 1.4, 2.3, 0.08, 0, 0, 0, false); // front door
    b.add('box', '#6b6f73', bx.x1 - 3.5, 1.4, bx.z1 + 0.03, 4.6, 2.8, 0.08, 0, 0, 0, false); // garage roller door
    for (const x of [bx.x0 + 3, bx.x0 + 7]) b.add('box', '#2a4a5c', x, 1.8, bx.z1 + 0.03, 2.2, 1.2, 0.06, 0, 0, 0, false); // windows
    b.add('box', '#d8d2c4', bx.door.x, 0.1, bx.z1 + 1.1, 3, 0.2, 2.2, 0, 0, 0, false); // front step
    b.build(this.exterior);
    // The accent stripe takes the crew's colour once you've joined.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.35, d + 0.04), this.accent);
    stripe.position.set(cx, bx.height - 0.2, cz);
    this.exterior.add(stripe);
    this.setCrew(null);
  }

  /** Whose house it is (null: nobody's yet, the door stays locked). */
  setCrew(crew: CrewDef | null): void {
    this.crew = crew;
    this.accent.color.set(crew ? crew.colour : '#8a8378');
    this.signSprite?.removeFromParent();
    this.signSprite = textSprite(crew ? `${crew.name.toUpperCase()} HOUSE` : 'CREW HOUSE · MEMBERS ONLY', crew ? crew.colour : '#ffcf5a', 0.75);
    this.signSprite.position.set(HOUSE.door.x, HOUSE.height + 1.5, HOUSE.z1 + 0.4);
    this.exterior.add(this.signSprite);
    this.members.forEach((m, i) => crew && m.dress(memberLook(crew, i + 1)));
    for (const m of this.members) m.root.visible = !!crew;
  }

  get owner(): CrewDef | null {
    return this.crew;
  }

  protected buildInterior(g: THREE.Group): void {
    const b = new Batcher();
    const glow = new Batcher(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.7) }));
    const { piece, wall, floor, shell, sign } = this.kit(g, b);
    const bx = HOUSE, h = bx.height;
    floor('#8a6a4a');
    shell('#e6dccb', '#f2ede2');
    // Back rooms: your room, the bathroom, the gym (north half); living room with the planning table (south).
    const zMid = -61, xa = -18.7, xb = -11.3;
    wall('x', zMid, bx.x0, bx.x1, [[-22.3, 1.6], [-15, 1.6], [-7.6, 1.6]], '#e6dccb', h);
    wall('z', xa, bx.z0, zMid, [], '#e6dccb', h);
    wall('z', xb, bx.z0, zMid, [], '#e6dccb', h);
    b.add('box', '#d9e4e8', -15, 0.03, -66.5, 7.2, 0.02, 10.8, 0, 0, 0, false); // bathroom tiles
    b.add('box', '#3a3d42', -7.6, 0.03, -66.5, 7.2, 0.02, 10.8, 0, 0, 0, false); // gym mats

    // Your room: bed, side table and lamp, wardrobe, a rug in the crew's colour.
    piece('#4a3524', -23.6, 0, -69.4, 2.2, 0.45, 1.6);
    piece('#f2f0ea', -23.6, 0.45, -69.4, 2.0, 0.18, 1.5, false);
    piece('#c9c4ba', -24.4, 0.63, -69.4, 0.45, 0.14, 1.2, false); // pillow
    piece('#2f4a6a', -23.2, 0.63, -69.4, 1.2, 0.06, 1.52, false); // blanket
    piece('#5a3e28', -21.6, 0, -71, 0.6, 0.6, 0.6);
    glow.add('sph', '#ffe2a8', -21.6, 0.85, -71, 0.14, 0.14, 0.14, 0, 0, 0, false);
    piece('#6a4a30', -25.4, 0, -64, 0.8, 2.2, 2.4);
    const rug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 1.8), this.accent);
    rug.position.set(-22.6, 0.05, -66.6);
    g.add(rug);
    sign('YOUR ROOM', -22.3, 2.9, -61.25, 0.32, '#ffe9c0');

    // Bathroom: toilet, basin with a mirror, shower.
    piece('#f4f4f2', -17.4, 0, -71.2, 0.55, 0.42, 0.7);
    piece('#f4f4f2', -17.4, 0.42, -71.45, 0.55, 0.5, 0.2, false);
    piece('#f4f4f2', -13, 0, -71.4, 0.8, 0.85, 0.5);
    b.add('box', '#bfd6e0', -13, 1.6, -71.82, 0.8, 0.8, 0.03, 0, 0, 0, false); // mirror
    piece('#dfe8ec', -12.4, 0, -63.4, 1.6, 0.1, 1.6, false); // shower tray
    b.add('box', '#7fb0c8', -13.2, 1.1, -63.4, 0.04, 2.0, 1.6, 0, 0, 0, false); // curtain
    b.add('cyl', '#b8bcc0', -12.4, 2.3, -63.4, 0.08, 0.06, 0.08, 0, 0, 0, false); // shower head
    sign('BATHROOM', -15, 2.9, -61.25, 0.32, '#ffe9c0');

    // Gym: weight bench and bar, punching bag, dumbbell rack, a mirror wall.
    piece('#202226', -7.2, 0, -68.6, 0.45, 0.48, 1.6);
    b.add('cyl', '#b8bcc0', -7.2, 1.0, -69.1, 0.03, 1.8, 0.03, 0, 0, Math.PI / 2, false);
    for (const s of [-1, 1]) b.add('cyl', '#2a2a2a', -7.2 + s * 0.75, 1.0, -69.1, 0.22, 0.06, 0.22, 0, 0, Math.PI / 2, false);
    for (const s of [-1, 1]) piece('#3a3d42', -7.2 + s * 0.6, 0, -69.1, 0.08, 1.0, 0.08);
    b.add('cyl', '#7a1e1e', -5.2, 1.3, -64.2, 0.28, 1.1, 0.28, 0, 0, 0, false);
    piece('#2a2a2a', -5.2, 1.85, -64.2, 0.06, 1.0, 0.06, false);
    piece('#3a3d42', -10.6, 0, -70.6, 0.5, 0.9, 1.8);
    b.add('box', '#c8d8e0', -4.25, 1.4, -67, 0.03, 1.8, 3.6, 0, 0, 0, false);
    sign('GYM', -7.6, 2.9, -61.25, 0.32, '#ffe9c0');

    // Living room: the planning table with a street map, sofa and TV, the garage door.
    piece('#5a3e28', -15, 0, -56, 2.6, 0.82, 1.5);
    const map = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.25), new THREE.MeshStandardMaterial({ map: planningMap(), roughness: 0.9 }));
    map.rotation.x = -Math.PI / 2;
    map.position.set(-15, 0.84, -56);
    g.add(map);
    piece('#2e3a4a', -23.5, 0, -53.2, 2.8, 0.75, 1.0);
    piece('#2e3a4a', -23.5, 0.75, -52.8, 2.8, 0.5, 0.25, false);
    piece('#18191c', -23.5, 0, -59.6, 2.2, 0.5, 0.5);
    b.add('box', '#0c0d10', -23.5, 1.25, -59.7, 1.8, 1.0, 0.06, 0, 0, 0, false);
    piece('#6b6f73', -4.3, 0, -55, 0.15, 2.8, 4.4, false); // garage roller door (inside)
    sign('GARAGE · CLUB RUN', -5.2, 3.0, -55, 0.3, '#ffe9c0');
    sign('PLANNING', -15, 2.6, -56, 0.32, '#ffe9c0');
    for (const [x, z] of [[-21, -55], [-9, -55], [-15, -66], [-22, -66], [-7.5, -66]]) glow.add('box', '#ffe2a8', x, h - 0.05, z, 1.2, 0.05, 0.3, 0, 0, 0, false);
    b.build(g);
    glow.build(g);
    // Warm light so the rooms read clearly (the house is closed in).
    const lamp = new THREE.PointLight('#ffe6c4', 18, 30, 1.2);
    lamp.position.set(-15, h - 0.4, -61);
    g.add(lamp);

    // Crew members round the planning table.
    const spots: [number, number, number][] = [[-16.8, -54.8, -0.6], [-13.1, -54.9, -2.4], [-15, -57.5, 1.57]];
    spots.forEach(([x, z, hd], i) => {
      const rig = new HumanRig(this.crew ? memberLook(this.crew, i + 1) : { shirt: '#22252a' });
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = -hd;
      rig.root.visible = !!this.crew;
      rig.root.name = `house-member-${i}`;
      g.add(rig.root);
      this.members.push(rig);
      this.solids.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3, y0: 0, y1: 1.8 });
    });

    this.spots = [
      { id: 'bed', x: -23.6, z: -67.6, r: 1.7, label: 'Sleep in your bed' },
      { id: 'bath', x: -15, z: -67.5, r: 2.2, label: 'Use the bathroom' },
      { id: 'gym', x: -7.6, z: -67.2, r: 2.0, label: 'Work out' },
      { id: 'plan', x: -15, z: -53.8, r: 2.2, label: 'Plan with the crew' },
      { id: 'club', x: -5.6, z: -55, r: 1.8, label: 'Drive to the club with the crew' },
      { id: 'exit', x: HOUSE.door.x, z: HOUSE.door.z - 1.1, r: 1.3, label: 'Leave the house' },
    ];
  }

  update(dt: number): void {
    if (!this.inside) return;
    this.t += dt;
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
  private ball: THREE.Mesh | null = null;
  /** People dancing: the regulars and, after a club run, your crew. */
  readonly dancers: { rig: HumanRig; x: number; z: number; ph: number }[] = [];
  private crewDancers: HumanRig[] = [];

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    super(scene, world, CLUB);
    this.exterior.name = 'club-afterglow';
    const b = new Batcher();
    const glow = new Batcher(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 2.0) }));
    const bx = CLUB, cx = (bx.x0 + bx.x1) / 2, cz = (bx.z0 + bx.z1) / 2;
    b.add('box', '#24202e', cx, bx.height / 2 + 0.4, cz, bx.x1 - bx.x0, bx.height + 0.8, bx.z1 - bx.z0);
    b.add('box', '#14121a', bx.door.x, 1.2, bx.z1 + 0.03, 1.8, 2.4, 0.08, 0, 0, 0, false);
    for (const x of [bx.door.x - 3, bx.door.x + 3]) b.add('cyl', '#d9c27a', x, 0.5, bx.z1 + 1.2, 0.06, 1.0, 0.06, 0, 0, 0, false); // rope posts
    b.add('box', '#7a1e3a', bx.door.x, 0.95, bx.z1 + 1.2, 6, 0.05, 0.05, 0, 0, 0, false); // velvet rope
    glow.add('box', '#ff4fa3', cx, bx.height + 0.2, bx.z1 + 0.05, bx.x1 - bx.x0 - 1, 0.12, 0.05, 0, 0, 0, false);
    b.build(this.exterior);
    glow.build(this.exterior);
    const s = textSprite('AFTERGLOW', '#ff7ad0', 1.6);
    s.position.set(bx.door.x, bx.height - 0.6, bx.z1 + 0.5);
    this.exterior.add(s);
    const s2 = textSprite('club · fictional', '#f0f0eb', 0.45);
    s2.position.set(bx.door.x, bx.height - 1.7, bx.z1 + 0.5);
    this.exterior.add(s2);
  }

  protected buildInterior(g: THREE.Group): void {
    const b = new Batcher();
    const { piece, floor, shell, sign } = this.kit(g, b);
    const bx = CLUB, h = bx.height;
    floor('#141218');
    shell('#2a2436', '#100e14');
    // Dance floor: tiles that pulse in colour.
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
    // DJ booth, speakers, the bar and stools, a mirror ball.
    piece('#1a1a22', 76, 0, -72, 4, 1.1, 1.2);
    b.add('box', '#3ff0ff', 76, 1.12, -71.5, 3.6, 0.04, 0.2, 0, 0, 0, false);
    for (const x of [72.5, 79.5]) piece('#0c0c10', x, 0, -72.4, 1.2, 2.4, 1.0);
    piece('#3a2418', 64.2, 0, -62, 1.2, 1.1, 14);
    for (let z = -68; z <= -56; z += 2) b.add('cyl', '#b8bcc0', 65.6, 0.75, z, 0.22, 0.06, 0.22, 0, 0, 0, false);
    piece('#2a2a32', 62.6, 0, -62, 0.6, 2.2, 14, false); // shelves of bottles behind the bar
    let k = 0;
    for (let z = -68; z <= -56; z += 0.6) b.add('cyl', ['#3a7a3a', '#7a5a2a', '#c8c8c8'][k++ % 3], 62.7, 1.6, z, 0.06, 0.3, 0.06, 0, 0, 0, false);
    piece('#2a2436', 88, 0, -62, 1.4, 0.45, 8); // seating
    b.build(g);
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: '#dfe6ff', metalness: 1, roughness: 0.15, flatShading: true }));
    this.ball.position.set(fx, h - 0.8, fz);
    g.add(this.ball);
    sign('AFTERGLOW', 76, 3.6, -73.4, 0.9, '#ff7ad0');
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
    if (!this.inside) return;
    this.t += dt;
    const beat = this.t * 2.1;
    this.tiles.forEach((m, i) => {
      const k = (Math.sin(beat * Math.PI + i * 0.9) + 1) / 2;
      const hue = ((i * 0.07 + this.t * 0.05) % 1 + 1) % 1;
      m.color.setHSL(hue, 0.9, 0.12 + 0.35 * k);
    });
    if (this.ball) this.ball.rotation.y += dt * 0.8;
    for (const d of this.dancers) {
      d.rig.pose = 'dance';
      const bob = Math.abs(Math.sin((this.t + d.ph) * 4.2)) * 0.06;
      d.rig.root.position.set(d.x, bob, d.z);
      // Face the middle of the floor, swaying side to side; regulars glance at you when you're close.
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
    const b = new Batcher();
    const s = SHOP, cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    b.add('box', '#5c6168', cx, 2.2, cz, s.x1 - s.x0, 4.4, s.z1 - s.z0);
    b.add('box', '#2a2d33', cx, 4.6, cz, s.x1 - s.x0 + 0.4, 0.3, s.z1 - s.z0 + 0.4);
    b.add('box', '#1c1e22', cx, 1.6, s.z1 + 0.04, 5.2, 2.0, 0.06, 0, 0, 0, false); // service window
    b.add('box', '#3a3d42', cx, 0.55, s.counter.z, 5.6, 1.1, 0.8); // counter
    b.add('box', '#c8a24a', cx, 1.12, s.counter.z, 5.6, 0.05, 0.85, 0, 0, 0, false);
    b.add('box', '#b71c1c', cx, 3.25, s.z1 + 0.6, 6.2, 0.1, 1.4, 0, 0, 0, false); // awning
    // Display rack behind the window (shapes only).
    for (let i = 0; i < 5; i++) b.add('box', '#222428', cx - 2 + i, 1.7, s.z1 - 0.15, 0.08, 0.7, 0.05, 0, 0, 0.6, false);
    b.build(this.group);
    world.add(s.x0, s.x1, s.z0, s.z1, 4.4);
    world.add(cx - 2.8, cx + 2.8, s.counter.z - 0.4, s.counter.z + 0.4, 1.1);
    const sign = textSprite('EKO ARMS', '#ffcf5a', 1.1);
    sign.position.set(cx, 3.9, s.z1 + 0.3);
    this.group.add(sign);
    const sub = textSprite('licensed dealer · fictional', '#f0f0eb', 0.4);
    sub.position.set(cx, 3.35, s.z1 + 0.3);
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
