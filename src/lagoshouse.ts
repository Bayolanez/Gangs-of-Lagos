import * as THREE from 'three';
import type { CollisionWorld } from './collision';
import { HumanRig } from './human';
import { textSprite } from './placeholders';
import { CrewDef, memberLook } from './crews';
import * as F from './furniture';

/**
 * The crew house as Bayo's Modern Lagos House (lagos-house.glb, built from his own asset sheet).
 * A two-storey house on a 1.2 m stone podium in a 22 x 18 m plot: front garden and stairs, a terrace,
 * the ground floor (living, dining, kitchen, a bedroom, a bathroom, a store and a U-stair), the upper
 * floor (master bedroom, study, second bedroom, bathroom, roof terrace) and the roof (pergola lounge).
 *
 * The model has no collision data, so the walls, floors and stairs are rebuilt here as boxes and ramps
 * from the same measurements the model was made with. You walk up the front stairs, through the front
 * door (members only) and up the U-stair; the spiral stair to the roof is a short climb (E). The floors
 * above you hide so you can see in. Crew spots: your room is the master bedroom, bathrooms on both
 * floors, the gym on the roof, the planning map on the dining table, and the club run leaves from the
 * driveway. While the model loads (or if it can't), the code-built house in places.ts stands in.
 */

/** Plot centre in the world (house space x -11..11, z -9..9; the front, +Z, faces the road). */
export const LH = { x: -15, z: -59 };
const G = 1.25, U = 4.44, R = 7.83; // floor heights: ground, upper, roof
/** Where the crew's minibus waits on the driveway, facing out to the road. */
export const LH_GARAGE = { x: LH.x + 8.6, z: LH.z - 1, heading: Math.PI / 2 };

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}
interface Surface {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: (x: number, z: number) => number;
}
export interface HouseSpot {
  id: string;
  x: number;
  z: number;
  /** Floor height the spot is on. */
  y: number;
  r: number;
  label: string;
}

export class LagosHouse {
  active = false;
  readonly root = new THREE.Group();
  model: THREE.Object3D | null = null;
  layers: Record<'base' | 'ground_floor' | 'upper_floor' | 'roof_level', THREE.Object3D> | null = null;
  readonly members: HumanRig[] = [];
  private solids: Box[] = [];
  private surfaces: Surface[] = [];
  private lockBox: Box;
  private crew: CrewDef | null = null;
  private sign: THREE.Sprite | null = null;
  private flag = new THREE.MeshStandardMaterial({ color: '#8a8378', roughness: 0.8, side: THREE.DoubleSide });
  private glow: THREE.MeshStandardMaterial[] = [];
  private t = 0;
  /** Which floors show: 'all', 'ground' (upper floor and roof hidden) or 'upper' (roof hidden). */
  shown: 'all' | 'ground' | 'upper' = 'all';
  spots: HouseSpot[] = [];

  constructor(private scene: THREE.Scene) {
    this.root.name = 'lagos-house';
    this.root.position.set(LH.x, 0, LH.z);
    this.lockBox = { x0: 2.25, x1: 3.35, z0: 1.8, z1: 2.2, y0: G - 0.1, y1: 3.95 };
    this.buildColliders();
  }

  /** The model has loaded: show it and take over from the code-built house. */
  attach(scene: THREE.Group, world: CollisionWorld): void {
    const m = scene.clone(true);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = !(mesh.material as THREE.Material).transparent;
      if (/light_emissive$/.test(o.name)) {
        mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
        this.glow.push(mesh.material as THREE.MeshStandardMaterial);
      }
    });
    const get = (n: string) => m.getObjectByName(n);
    const layers = { base: get('base'), ground_floor: get('ground_floor'), upper_floor: get('upper_floor'), roof_level: get('roof_level') };
    if (!layers.base || !layers.ground_floor || !layers.upper_floor || !layers.roof_level) throw new Error('lagos-house model is missing a layer');
    this.layers = layers as LagosHouse['layers'];
    this.model = m;
    this.root.add(m);
    this.addCrewDressing();
    this.scene.add(this.root);
    // Cars and people on the street can't drive through the podium, the house or the boundary walls.
    const w = (x0: number, x1: number, z0: number, z1: number, h: number) => world.add(LH.x + x0, LH.x + x1, LH.z + z0, LH.z + z1, h);
    w(-8, 6, -7, 5, 7.8);
    w(-11, 11, -9, -8.75, 1.8);
    w(-11, -10.75, -9, 9, 1.8);
    w(10.75, 10.9, -9, 9, 1.6);
    this.active = true;
    this.setCrew(this.crew);
  }

  // ---------- Collision: walls and furniture as boxes, floors and stairs as surfaces ----------
  private buildColliders(): void {
    const S = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => this.solids.push({ x0, x1, z0, z1, y0, y1 });
    const flat = (x0: number, x1: number, z0: number, z1: number, h: number) => this.surfaces.push({ x0, x1, z0, z1, h: () => h });
    /** A wall along x (at z0..z1) with gaps [a, b]. */
    const wx = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, gaps: [number, number][] = []) => {
      let x = x0;
      for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (a > x) S(x, a, z0, z1, y0, y1);
        x = b;
      }
      if (x < x1) S(x, x1, z0, z1, y0, y1);
    };
    const wz = (z0: number, z1: number, x0: number, x1: number, y0: number, y1: number, gaps: [number, number][] = []) => {
      let z = z0;
      for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (a > z) S(x0, x1, z, a, y0, y1);
        z = b;
      }
      if (z < z1) S(x0, x1, z, z1, y0, y1);
    };
    // Garden: boundary walls, fence, planters along them, tree trunks.
    S(-11, 11, -9, -8.0, 0, 1.8);
    S(-11, -10.0, -9, 9, 0, 1.8);
    S(10.75, 10.9, -9, 9, 0, 1.6);
    for (const [x, z] of [[-9.2, 6.8], [-4.8, 7.6], [5.2, 7.8]]) S(x - 0.18, x + 0.18, z - 0.18, z + 0.18, 0, 3);
    // Podium: a 1.2 m step you can't climb except by the stairs; glass rails round the terrace.
    S(-8, 6, -7, 5, 0, 0.9); // (lower than its 1.2 m top, so the last steps of the stairs aren't caught on its edge)
    flat(-8, 6, -7, 5, 1.23);
    this.surfaces.push({ x0: 0.6, x1: 3.4, z0: 5, z1: 7.4, h: (_x, z) => THREE.MathUtils.clamp(((7.4 - z) / 2.4) * 1.2, 0, 1.2) }); // front stairs
    this.surfaces.push({ x0: 6.0, x1: 7.8, z0: 3.6, z1: 5.0, h: (x) => THREE.MathUtils.clamp(((7.8 - x) / 1.8) * 1.2, 0, 1.2) }); // side stairs to the driveway
    wx(-7.9, 0.6, 4.9, 5.0, 1.2, 2.2);
    wx(3.4, 5.9, 4.9, 5.0, 1.2, 2.2);
    wz(-6.9, 4.9, -8.0, -7.9, 1.2, 2.2);
    S(-3.7, -2.7, 3.0, 4.0, 1.2, 2.0); // terrace table
    S(-7.8, -6.2, 3.9, 4.8, 1.2, 1.9);
    S(3.6, 5.8, 4.1, 4.8, 1.2, 1.9);
    // Ground floor (1.25): outer walls, the glass front with the front door, partitions, furniture.
    flat(-7, 5, -6, 2, G);
    wx(-7, 5, -6, -5.8, G, 3.95);
    wz(-6, 2, -7, -6.8, G, 3.95);
    wz(-6, 2, 4.8, 5.0, G, 3.95);
    wx(-7, 2.25, 1.85, 2.05, G, 3.95);
    wx(3.35, 5.05, 1.85, 2.05, G, 3.95);
    wx(-6.8, 4.8, -2.06, -1.94, G, 3.95, [[-4.8, -3.9], [-1.6, -0.8], [0.3, 2.7], [3.1, 3.9]]);
    wz(-5.8, -2.06, -2.26, -2.14, G, 3.95);
    wz(-5.8, -2.06, 0.14, 0.26, G, 3.95);
    wz(-5.8, -2.06, 2.74, 2.86, G, 3.95);
    S(-5.9, -3.3, -1.75, -0.95, G, 2.1); // sofa
    S(-6.55, -5.75, -0.65, 1.15, G, 2.1); // sofa
    S(-5.2, -4.0, -0.25, 0.45, G, 1.7); // coffee table
    S(-3.2, -2.0, -1.0, 1.0, G, 2.6); // TV unit
    S(-1.4, 0.6, -0.15, 0.75, G, 2.0); // dining table
    S(4.1, 4.8, -1.9, 1.7, G, 3.6); // kitchen run
    S(2.2, 3.6, -1.0, 1.0, G, 2.2); // island
    S(-5.4, -3.8, -5.75, -3.5, G, 1.9); // bed
    S(-2.9, -2.3, -4.7, -3.1, G, 3.4); // wardrobe
    S(-2.1, -0.1, -5.8, -5.25, G, 2.1); // vanity
    S(-1.02, -0.98, -3.4, -2.1, G, 3.3); // shower glass
    S(-0.75, -0.15, -4.45, -3.95, G, 2.0); // toilet
    S(3.0, 4.7, -5.8, -5.4, G, 3.2); // store shelf
    // U-stair: up the left flight, across the landing, up the right flight (a stringer between them).
    this.surfaces.push({ x0: 0.4, x1: 1.45, z0: -4.63, z1: -2.2, h: (_x, z) => G + ((-2.2 - z) / 2.43) * 1.6 });
    flat(0.4, 2.6, -5.8, -4.63, G + 1.6);
    this.surfaces.push({ x0: 1.55, x1: 2.6, z0: -4.63, z1: -2.2, h: (_x, z) => G + 1.6 + ((z + 4.63) / 2.43) * (U - G - 1.6) });
    S(1.45, 1.55, -4.63, -2.2, G, U + 1);
    // Upper floor (4.44) and its roof terrace over the ground floor.
    flat(-3, 0.4, -6, 3.5, U);
    flat(2.6, 6.5, -6, 3.5, U);
    flat(0.4, 2.6, -2.2, 3.5, U);
    flat(0.4, 2.6, -6, -4.6, U);
    flat(-7, -3, -6, 2, U + 0.01);
    wx(-3, 6.5, -6, -5.8, U, 7.35);
    wz(-6, 3.5, 6.3, 6.5, U, 7.35);
    wz(-6, 3.5, -3, -2.8, U, 7.35, [[0.6, 1.8]]); // glass wall to the terrace, with its door
    wx(-3, 6.5, 3.3, 3.5, U, 7.35);
    wx(-2.8, 0.4, -1.06, -0.94, U, 7.35, [[-1.2, -0.4]]);
    wz(-5.8, -0.94, 0.34, 0.46, U, 7.35, [[-1.9, -1.1]]);
    wz(-5.8, -0.44, 2.74, 2.86, U, 7.35, [[-2.0, -1.2]]);
    wx(2.86, 6.3, -0.56, -0.44, U, 7.35, [[3.3, 4.1]]);
    wz(-0.94, 3.3, 1.44, 1.56, U, 7.35, [[-0.5, 0.3]]);
    wx(0.4, 1.45, -2.25, -2.15, U, U + 1); // rail at the stair void
    wx(-7, -3, 1.9, 2.0, U, U + 1); // terrace rails and parapet
    wz(-6, 2, -7.0, -6.9, U, U + 1);
    wx(-7, -3, -6, -5.8, U, U + 1);
    S(-1.6, 0.1, -0.75, 1.35, U, U + 0.7); // master bed
    S(-2.75, -2.15, 0.9, 2.9, U, U + 2.2); // wardrobe
    S(1.6, 2.0, -0.4, 1.4, U, U + 2.2); // bookshelf
    S(4.4, 6.2, 0.3, 1.0, U, U + 0.8); // desk
    S(2.7, 4.1, 1.8, 2.6, U, U + 0.8); // study dining
    S(4.0, 5.8, 2.5, 3.2, U, U + 0.9); // sofa
    S(3.8, 5.4, -5.7, -3.6, U, U + 0.7); // second bed
    S(-2.7, -1.0, -5.8, -5.25, U, U + 0.9); // vanity
    S(-2.75, -1.95, -3.25, -1.55, U, U + 0.6); // bath
    S(-6.4, -4.4, -0.8, 0.4, U, U + 0.6); // loungers
    S(-6.9, -3.1, -5.75, -5.05, U, U + 0.7); // planters
    S(-6.9, -6.2, -4.6, -1.6, U, U + 0.7);
    // Roof (7.83): parapets, the stair head, pergola lounge, AC units, tank, solar panels, planters.
    flat(-2.8, 6.3, -5.8, 3.3, R);
    flat(-2.7, 2.1, -1.1, 3.2, R + 0.03);
    wx(-3, 6.5, -6, -5.8, R, R + 0.6);
    wz(-6, 3.5, -3, -2.8, R, R + 0.6);
    wz(-6, 3.5, 6.3, 6.5, R, R + 0.6);
    wx(-3, 6.5, 3.3, 3.5, R, R + 1.1);
    S(0.2, 2.4, -6, -4.0, R, R + 2.6); // stair head box
    S(-1.5, 0.9, -0.45, 0.45, R, R + 0.9); // sofa
    S(-2.5, -1.6, 0.5, 2.1, R, R + 0.9);
    S(-0.85, 0.25, 0.9, 1.5, R, R + 0.5);
    S(2.6, 5.6, -5.8, -5.0, R, R + 1.0); // AC units
    S(4.6, 6.0, -4.3, -2.9, R, R + 3); // water tank
    S(2.6, 5.7, -1.5, -0.5, R, R + 0.9); // solar panels
    S(2.4, 6.2, 2.55, 3.25, R, R + 0.6); // planters
    S(-2.75, -2.15, -3.8, -1.4, R, R + 0.6);
    // Roof gym equipment (added below) blocks too.
    S(2.7, 3.9, 0.2, 2.0, R, R + 1.3);
    S(5.3, 5.9, 0.5, 1.1, R, R + 2.2);
    S(4.2, 6.0, 1.9, 2.4, R, R + 1.0);

    this.spots = [
      { id: 'door', x: 2.8, z: 3.0, y: 1.23, r: 1.6, label: 'Crew house (members only)' },
      { id: 'plan', x: -0.4, z: 1.45, y: G, r: 1.4, label: 'Plan with the crew' },
      { id: 'bath', x: -1.0, z: -4.3, y: G, r: 1.4, label: 'Use the bathroom' },
      { id: 'roof-up', x: 2.1, z: -1.7, y: U, r: 1.0, label: 'Take the spiral stair to the roof' },
      { id: 'bed', x: -0.75, z: 2.4, y: U, r: 1.6, label: 'Sleep in your room' },
      { id: 'bath', x: -1.6, z: -3.6, y: U, r: 1.7, label: 'Use the bathroom' },
      { id: 'roof-down', x: 1.3, z: -3.4, y: R, r: 1.3, label: 'Down the spiral stair' },
      { id: 'gym', x: 4.3, z: 1.0, y: R, r: 2.0, label: 'Work out' },
      { id: 'club', x: 7.6, z: 6.2, y: 0, r: 2.0, label: 'Drive to the club with the crew' },
    ];
  }

  /** The crew's touches: a flag on the roof, a sign at the gate, the planning map, the roof gym, members. */
  private addCrewDressing(): void {
    const g = this.root;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 10), new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.6, roughness: 0.4 }));
    pole.position.set(6.0, R + 1.5, 3.0);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75, 8, 1), this.flag);
    flag.position.set(6.6, R + 2.6, 3.0);
    flag.name = 'crew-flag';
    g.add(flag);
    // The planning map on the dining table.
    const map = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: mapTexture(), roughness: 0.9 }));
    map.rotation.x = -Math.PI / 2;
    map.position.set(-0.4, G + 0.77, 0.3);
    g.add(map);
    // Roof gym under the sky.
    const bench = F.benchPress();
    bench.position.set(3.3, R, 1.1);
    bench.rotation.y = Math.PI / 2;
    g.add(bench);
    const bag = F.punchingBag();
    bag.position.set(5.6, R - 0.6, 0.8);
    g.add(bag);
    const rack = F.dumbbellRack();
    rack.position.set(5.1, R, 2.15);
    g.add(rack);
    // Crew members at the dining table.
    const at: [number, number, number][] = [[-1.95, 0.3, 0], [1.1, 0.3, Math.PI], [-0.4, -0.75, Math.PI / 2]];
    at.forEach(([x, z, hd], i) => {
      const rig = new HumanRig({ shirt: '#22252a' });
      rig.root.position.set(x, G, z);
      rig.root.rotation.y = -hd;
      rig.root.name = `lagos-member-${i}`;
      g.add(rig.root);
      this.members.push(rig);
      this.solids.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3, y0: G, y1: G + 1.8 });
    });
  }

  /** Whose house (null: nobody's, the front door stays locked). */
  setCrew(crew: CrewDef | null): void {
    this.crew = crew;
    this.flag.color.set(crew ? crew.colour : '#8a8378');
    this.members.forEach((m, i) => {
      if (crew) m.dress(memberLook(crew, i + 1));
      m.root.visible = !!crew;
    });
    if (!this.active) return;
    this.sign?.removeFromParent();
    this.sign = textSprite(crew ? `${crew.name.toUpperCase()} HOUSE` : 'CREW HOUSE · MEMBERS ONLY', crew ? crew.colour : '#ffcf5a', 0.7);
    this.sign.position.set(2.0, 2.6, 8.9);
    this.root.add(this.sign);
  }

  get owner(): CrewDef | null {
    return this.crew;
  }

  get locked(): boolean {
    return !this.crew;
  }

  // ---------- Physics for the player inside the plot ----------
  private local(x: number, z: number): { x: number; z: number } {
    return { x: x - LH.x, z: z - LH.z };
  }

  /** In the plot (the garden, the house, the roof). */
  contains(x: number, z: number): boolean {
    const l = this.local(x, z);
    return this.active && l.x > -11 && l.x < 11 && l.z > -9 && l.z < 9;
  }

  /** Under the house's roof (for hiding floors and keeping the camera in). */
  indoors(x: number, z: number, y: number): boolean {
    const l = this.local(x, z);
    return this.contains(x, z) && y > 1.0 && y < 7.5 && l.x > -7 && l.x < 6.5 && l.z > -6 && l.z < (y > 4 ? 3.5 : 2);
  }

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

  resolveCircle(p: { x: number; z: number; y?: number }, r: number): void {
    const py = p.y ?? 0;
    const boxes = this.locked ? [...this.solids, this.lockBox] : this.solids;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of boxes) {
        if (py + 1.7 <= s.y0 || py + 0.15 >= s.y1) continue;
        const lx = p.x - LH.x, lz = p.z - LH.z;
        const qx = THREE.MathUtils.clamp(lx, s.x0, s.x1), qz = THREE.MathUtils.clamp(lz, s.z0, s.z1);
        const dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) {
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        } else {
          const opts = [[s.x0 - r - lx, 0], [s.x1 + r - lx, 0], [0, s.z0 - r - lz], [0, s.z1 + r - lz]];
          opts.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
          p.x += opts[0][0];
          p.z += opts[0][1];
        }
      }
    }
  }

  /** Is this point inside a wall? (The follow camera stops short of walls.) */
  blocksPoint(x: number, y: number, z: number): boolean {
    const l = this.local(x, z);
    for (const s of this.solids) if (s.y1 - s.y0 > 1.5 && y > s.y0 && y < s.y1 && l.x > s.x0 - 0.1 && l.x < s.x1 + 0.1 && l.z > s.z0 - 0.1 && l.z < s.z1 + 0.1) return true;
    return false;
  }

  /** What you're next to (only the locked front door until you're a member). */
  spotAt(x: number, z: number, y: number): HouseSpot | null {
    if (!this.active) return null;
    const l = this.local(x, z);
    let best: HouseSpot | null = null, bd = Infinity;
    for (const s of this.spots) {
      if (Math.abs(y - s.y) > 1.2) continue;
      if (s.id === 'door' ? !this.locked : this.locked) continue;
      const d = Math.hypot(l.x - s.x, l.z - s.z);
      if (d < s.r && d < bd) {
        best = s;
        bd = d;
      }
    }
    return best;
  }

  /** Where a spot's teleport lands (spiral stair), in world coordinates. */
  stairTo(id: 'roof-up' | 'roof-down'): { x: number; z: number; y: number } {
    return id === 'roof-up' ? { x: LH.x + 1.3, z: LH.z - 3.2, y: R } : { x: LH.x + 2.1, z: LH.z - 1.5, y: U };
  }

  update(dt: number, px: number, py: number, pz: number, night: number): void {
    if (!this.active || !this.layers) return;
    this.t += dt;
    const inside = this.indoors(px, pz, py);
    const want = !inside ? 'all' : py < 4 ? 'ground' : 'upper';
    if (want !== this.shown) {
      this.shown = want;
      this.layers.upper_floor.visible = want !== 'ground';
      this.layers.roof_level.visible = want === 'all';
    }
    for (const m of this.glow) m.emissiveIntensity = 0.6 + night * 2.2;
    const flag = this.root.getObjectByName('crew-flag') as THREE.Mesh | undefined;
    if (flag) flag.rotation.y = 0.15 * Math.sin(this.t * 2.3);
    this.members.forEach((m, i) => {
      if (!m.root.visible) return;
      m.pose = (Math.floor(this.t / 4) + i) % 3 === 0 ? 'talk' : (Math.floor(this.t / 4) + i) % 3 === 1 ? 'point' : 'none';
      m.animate(dt, 0);
    });
  }
}

/** A street map for the planning table (canvas texture, fictional streets). */
function mapTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 192;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e8dcc0';
  x.fillRect(0, 0, 384, 192);
  x.strokeStyle = '#9a8a6a';
  x.lineWidth = 8;
  for (const v of [60, 160, 260, 350]) {
    x.beginPath();
    x.moveTo(v, 0);
    x.lineTo(v, 192);
    x.stroke();
  }
  for (const v of [50, 140]) {
    x.beginPath();
    x.moveTo(0, v);
    x.lineTo(384, v);
    x.stroke();
  }
  for (const [px, py, col] of [[110, 90, '#c62828'], [210, 150, '#1f6fd1'], [300, 80, '#f2b705']] as const) {
    x.fillStyle = col;
    x.beginPath();
    x.arc(px, py, 10, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
