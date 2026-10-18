import * as THREE from 'three';
import type { Box2, CollisionWorld } from './collision';
import { HumanLook, HumanRig } from './human';
import { BlkKingRig } from './blkking';
import { mat, textSprite } from './placeholders';
import * as F from './furniture';
import { EMPIRE } from './properties';

/**
 * The Chairman's world (fictional, built in code): his residence on Crown Ridge in north-west Harbour
 * Bend (a walled compound with a black sliding gate, guards, gardens, a pool, his cars and a three-
 * storey house whose ground-floor office is a real room for the meeting), and the Palmyra Grand Hotel
 * in the south-west, where his guests stay. Crown Ridge and the Palmyra Grand stand in for the
 * brief's Ikoyi residence and Victoria Island hotel: invented places, not real homes or businesses.
 */
export const MANSION = {
  x0: -194, x1: -130, z0: -194, z1: -132,
  /** The gate in the south wall, facing North Crescent (z = -120). */
  gate: { x: -162, z: -132, half: 4 },
  /** Where you report: the road outside the gate (drive-up marker) and the pavement at the gate. */
  approach: { x: -162, z: -124 },
  gateTalk: { x: -162, z: -129.6 },
  /** The front door (south face of the house) and where Musa leads you. */
  door: { x: -162, z: -156.2 },
  house: { x0: -184, x1: -140, z0: -186, z1: -158 },
  /** The office (inside the house's front-west corner): floor y = 0. */
  office: { x0: -182, x1: -170, z0: -168, z1: -158.6 },
  /** The car Tunde leaves for you in the forecourt, nose to the gate. */
  car: { x: -154.5, z: -146, heading: Math.PI / 2 },
};
export const HOTEL = {
  name: 'Palmyra Grand Hotel',
  x0: -190, x1: -136, z0: 144, z1: 190,
  /** The covered drop-off at the front door (north face, off South Crescent z = 120). */
  pickup: { x: -163, z: 131 },
  door: { x: -163, z: 143.4 },
};
/** Ground the district leaves clear (its own buildings there are skipped). */
export const CHAIRMAN_KEEP_OUT = [
  { x0: MANSION.x0 - 4, x1: MANSION.x1 + 3, z0: MANSION.z0 - 4, z1: MANSION.z1 + 4 },
  { x0: -198, x1: -128, z0: 128, z1: 198 },
];

export const LOOKS: Record<'chairman' | 'tunde' | 'musa' | 'guard' | 'guest', HumanLook> = {
  chairman: { shirt: '#efe3c2', pants: '#efe3c2', top: 'kaftan', pattern: false, hat: 'fila', hatColour: '#7a1f2b', skin: '#4a2e1c', build: 'heavy' },
  tunde: { shirt: '#5b3c8c', pants: '#22252a', top: 'jacket', skin: '#6b4430' },
  musa: { shirt: '#2a2e38', pants: '#1a1c22', top: 'jacket', hat: 'cap', hatColour: '#111214', skin: '#3a2416' },
  guard: { shirt: '#16171b', pants: '#16171b', top: 'jacket', skin: '#4a2e1c' },
  guest: { shirt: '#c9b37a', pants: '#2b2f3a', top: 'jacket', skin: '#5a3a26' },
};

interface Walker {
  rig: HumanRig;
  x: number;
  z: number;
  heading: number;
  path: { x: number; z: number }[];
  speed: number;
  /** Wait while the one you lead is this far behind (Musa). */
  lead?: () => { x: number; z: number } | null;
  done?: () => void;
}

export class ChairmanWorld {
  readonly root = new THREE.Group();
  /** Musa, head of security (at the gate until he leads you in). */
  readonly musa: HumanRig;
  readonly guards: HumanRig[] = [];
  private gateL: THREE.Group;
  private gateR: THREE.Group;
  private gateBox: Box2;
  private gateT = 0;
  /** Gate opens for whoever may enter (set by the game). */
  gateWanted = false;
  private walkers: Walker[] = [];
  private officeLight: THREE.PointLight;
  private suv: { obj: THREE.Object3D; path: { x: number; z: number }[]; i: number; s: number } | null = null;
  private suvObj: THREE.Object3D | null = null;
  private lamps: THREE.MeshStandardMaterial;
  private patrol: { rig: HumanRig; a: { x: number; z: number }; b: { x: number; z: number }; t: number }[] = [];
  private time = 0;
  /** The Chairman himself, out by the pool once you've met him: Bayo's Cartel Boss model, or the code-built figure. */
  boss: HumanRig | BlkKingRig;
  bossError: unknown = null;
  private smoke: { m: THREE.Mesh; t: number }[] = [];
  private smokeT = 0;
  private smokeMat = new THREE.MeshBasicMaterial({ color: '#d8d8d8', transparent: true, opacity: 0.35, depthWrite: false });

  constructor(scene: THREE.Scene, private world: CollisionWorld) {
    this.root.name = 'chairman-world';
    scene.add(this.root);
    this.lamps = new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffd890', emissiveIntensity: 0.6 });
    this.officeLight = new THREE.PointLight('#ffe2b0', 0, 16, 1.6);
    this.officeLight.position.set(-176, 3.4, -163.5);
    this.root.add(this.officeLight);
    const g = this.buildCompound();
    this.gateL = g.l;
    this.gateR = g.r;
    this.gateBox = world.add(MANSION.gate.x - MANSION.gate.half, MANSION.gate.x + MANSION.gate.half, MANSION.gate.z - 0.3, MANSION.gate.z + 0.3, 3);
    this.buildHouse();
    this.buildOffice();
    this.buildHotel();
    this.musa = this.person(LOOKS.musa, -160.6, -130.4, Math.PI / 2, 'musa');
    this.boss = this.person(LOOKS.chairman, BOSS_SPOT.x, BOSS_SPOT.z, Math.PI / 2, 'chairman');
    this.boss.root.visible = false;
    for (const dx of [-2.4, 2.4]) this.guards.push(this.person(LOOKS.guard, BOSS_SPOT.x + dx, BOSS_SPOT.z - 0.6, Math.PI / 2, 'guard'));
    // His guys: two at the gate, one in the booth, two at the door, three walking the grounds.
    const post: [number, number, number][] = [[-168.4, -130.5, Math.PI / 2], [-155.6, -130.5, Math.PI / 2], [-153.6, -134.6, Math.PI], [-166.2, -156, Math.PI / 2], [-157.8, -156, Math.PI / 2]];
    for (const [x, z, h] of post) this.guards.push(this.person(LOOKS.guard, x, z, h, 'guard'));
    const beats: [number, number, number, number][] = [[-188, -140, -188, -180], [-136, -180, -136, -150], [-175, -189, -145, -189]];
    for (const [ax, az, bx, bz] of beats) {
      const rig = this.person(LOOKS.guard, ax, az, 0, 'guard');
      this.guards.push(rig);
      this.patrol.push({ rig, a: { x: ax, z: az }, b: { x: bx, z: bz }, t: Math.random() });
    }
  }

  private person(look: HumanLook, x: number, z: number, heading: number, name: string): HumanRig {
    const r = new HumanRig(look);
    r.root.name = name;
    r.root.position.set(x, 0, z);
    r.root.rotation.y = -heading;
    this.root.add(r.root);
    return r;
  }

  private box(colour: string | THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, collide = false, parent: THREE.Object3D = this.root): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), typeof colour === 'string' ? mat(colour, 0.7) : colour);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = y1 - y0 > 0.5;
    m.receiveShadow = true;
    parent.add(m);
    if (collide) this.world.add(x0, x1, z0, z1, y1);
    return m;
  }

  private palm(x: number, z: number, h = 7): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, h, 8), mat('#6b5440', 0.9));
    trunk.position.set(x, h / 2, z);
    this.root.add(trunk);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 4), mat('#2f6b3a', 0.8));
      const a = (i / 7) * Math.PI * 2;
      leaf.position.set(x + Math.cos(a) * 1.2, h - 0.2, z + Math.sin(a) * 1.2);
      leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
      this.root.add(leaf);
    }
    this.world.add(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 3);
  }

  private hedge(x0: number, x1: number, z0: number, z1: number): void {
    this.box('#2e5e34', x0, x1, 0, 1.1, z0, z1, true);
  }

  private gardenLamp(x: number, z: number): void {
    this.box('#26262b', x - 0.06, x + 0.06, 0, 1.0, z - 0.06, z + 0.06);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.lamps);
    s.position.set(x, 1.1, z);
    this.root.add(s);
  }

  // ---------- Crown Ridge: walls, gate, grounds ----------
  private buildCompound(): { l: THREE.Group; r: THREE.Group } {
    const M = MANSION, wallC = '#e9e2d4', capC = '#bfb3a0';
    // Lawn and paving (just above the ground).
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(M.x1 - M.x0, M.z1 - M.z0), mat('#4f8a45', 0.95));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set((M.x0 + M.x1) / 2, 0.025, (M.z0 + M.z1) / 2);
    lawn.receiveShadow = true;
    this.root.add(lawn);
    const pave = mat('#d8cdb8', 0.85);
    this.box(pave, M.gate.x - 4, M.gate.x + 4, 0, 0.05, -158, M.z1);
    this.box(pave, -173, -151, 0, 0.051, -158, -139);
    // Walls with a coping, gaps for the gate.
    const wall = (x0: number, x1: number, z0: number, z1: number) => {
      this.box(wallC, x0, x1, 0, 3, z0, z1, true);
      this.box(capC, x0 - 0.08, x1 + 0.08, 3, 3.18, z0 - 0.08, z1 + 0.08);
    };
    wall(M.x0, M.x1, M.z0, M.z0 + 0.5);
    wall(M.x0, M.x0 + 0.5, M.z0, M.z1);
    wall(M.x1 - 0.5, M.x1, M.z0, M.z1);
    wall(M.x0, M.gate.x - M.gate.half - 1.2, M.z1 - 0.5, M.z1);
    wall(M.gate.x + M.gate.half + 1.2, M.x1, M.z1 - 0.5, M.z1);
    // Gate pillars with lamps and cameras.
    for (const s of [-1, 1]) {
      const px = M.gate.x + s * (M.gate.half + 0.6);
      this.box('#3a3530', px - 0.6, px + 0.6, 0, 3.8, M.z1 - 0.8, M.z1 + 0.2, true);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), this.lamps);
      lamp.position.set(px, 4.05, M.z1 - 0.3);
      this.root.add(lamp);
      const cam = this.box('#d9d9d9', px - 0.15, px + 0.15, 3.3, 3.5, M.z1 + 0.2, M.z1 + 0.6);
      cam.rotation.x = 0.3;
      this.box('#111', px - 0.06, px + 0.06, 3.33, 3.47, M.z1 + 0.6, M.z1 + 0.66);
    }
    const plate = textSprite('CROWN RIDGE', '#d8b45a', 0.42);
    plate.position.set(M.gate.x - M.gate.half - 0.6, 2.6, M.z1 + 0.5);
    this.root.add(plate);
    // Two black sliding leaves.
    const leaf = () => {
      const g = new THREE.Group();
      const black = mat('#0d0d10', 0.4, 0.6);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(M.gate.half, 2.9, 0.14), black);
      frame.position.y = 1.5;
      frame.castShadow = true;
      g.add(frame);
      for (let i = 0; i < 6; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.16), mat('#c8a24a', 0.35, 0.8));
        bar.position.set(-M.gate.half / 2 + 0.35 + i * 0.66, 2.6, 0.02);
        g.add(bar);
      }
      this.root.add(g);
      return g;
    };
    const l = leaf(), r = leaf();
    // Guard booth, a fountain, a pool with loungers, palms, hedges and lamps.
    this.box('#d8d0c2', -155.2, -152, 0, 2.6, -136.4, -133.4, true);
    this.box('#1f2f45', -155.25, -151.95, 1.1, 2.1, -133.45, -133.35);
    this.box('#3a3530', -155.5, -151.7, 2.6, 2.8, -136.7, -133.1);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.7, 28), mat('#e6dfd0', 0.6));
    basin.position.set(-162, 0.35, -149);
    this.root.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 0.05, 28), new THREE.MeshStandardMaterial({ color: '#3fa9c9', roughness: 0.1, metalness: 0.2 }));
    water.position.set(-162, 0.66, -149);
    this.root.add(water);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.8, 12), mat('#e6dfd0', 0.6));
    spout.position.set(-162, 1.2, -149);
    this.root.add(spout);
    this.world.add(-164.6, -159.4, -151.6, -146.4, 0.7);
    this.box('#e8e2d6', -151, -137, 0, 0.12, -153, -139);
    const pool = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 12), new THREE.MeshStandardMaterial({ color: '#2fb6d8', roughness: 0.08, metalness: 0.1, emissive: '#0a3d4d', emissiveIntensity: 0.4 }));
    pool.position.set(-144, 0.13, -146);
    this.root.add(pool);
    for (const z of [-150.5, -147, -143.5]) {
      this.box('#f4f1ea', -138.8, -137.4, 0.12, 0.45, z - 0.4, z + 0.9);
      this.box('#f4f1ea', -138.8, -137.4, 0.45, 0.9, z - 0.4, z - 0.25);
    }
    for (let x = M.x0 + 4; x < M.x1 - 2; x += 8) this.palm(x, M.z0 + 3.2);
    for (let z = M.z0 + 10; z < M.z1 - 4; z += 9) {
      this.palm(M.x0 + 3, z);
      this.palm(M.x1 - 3, z, 6.2);
    }
    for (const x of [-171, -153]) this.palm(x, -136);
    this.hedge(-188, -175, -139.5, -138.5);
    this.hedge(-149, -137, -136.5, -135.5);
    this.hedge(-188, -187, -158, -139);
    for (const [x, z] of [[-166.5, -138], [-157.5, -138], [-166.5, -145], [-157.5, -145], [-174, -152], [-150, -152], [-150, -140], [-174, -140]]) this.gardenLamp(x, z);
    return { l, r };
  }

  // ---------- The house ----------
  private buildHouse(): void {
    const H = MANSION.house, white = mat('#f3efe6', 0.55), stone = mat('#cbbfae', 0.7), glass = new THREE.MeshStandardMaterial({ color: '#16243a', roughness: 0.08, metalness: 0.7 });
    const lit = new THREE.MeshStandardMaterial({ color: '#3a3020', emissive: '#ffcf7a', emissiveIntensity: 0.55, roughness: 0.3 });
    this.lit = lit;
    // One collider for the whole house; the office is only visited in the meeting.
    this.world.add(H.x0, H.x1, H.z0, H.z1, 12);
    // Ground floor: three blocks around the office (front-west), glass to the garden.
    this.box(white, H.x0, -170, 0, 4.2, H.z0, -168);
    this.box(white, H.x0, -182, 0, 4.2, -168, H.z1);
    this.box(white, -170, H.x1, 0, 4.2, H.z0, H.z1 + 0.6);
    for (let x = -168; x < H.x1 - 1; x += 3.4) this.box(x > -165 && x < -159 ? lit : glass, x, x + 2.8, 0.6, 3.6, H.z1 + 0.58, H.z1 + 0.66);
    // Upper floors: a wide cantilevered middle floor and a smaller top floor with a roof terrace.
    this.box(stone, H.x0 - 1, H.x1 + 1, 4.2, 4.6, H.z0, H.z1 + 2.5);
    this.box(white, H.x0 + 1, H.x1 - 1, 4.6, 8.2, H.z0 + 1, H.z1 - 0.5);
    for (let x = H.x0 + 2; x < H.x1 - 2; x += 3.6) this.box(Math.floor((x + 200) / 3.6) % 3 === 0 ? lit : glass, x, x + 3, 5.1, 7.7, H.z1 - 0.55, H.z1 - 0.45);
    this.box(glass, H.x0 + 2, H.x1 - 2, 5.2, 5.25, H.z1 + 2.4, H.z1 + 2.5); // balcony glass edge
    this.box(stone, H.x0 + 0.5, H.x1 - 0.5, 8.2, 8.5, H.z0 + 0.5, H.z1);
    this.box(white, -178, -150, 8.5, 11.6, H.z0 + 4, H.z1 - 6);
    for (let x = -177; x < -151; x += 3.5) this.box(glass, x, x + 2.9, 9.0, 11.1, H.z1 - 6.05, H.z1 - 5.95);
    this.box(stone, -179, -149, 11.6, 11.9, H.z0 + 3, H.z1 - 5);
    // Roof terrace rail and a pergola.
    this.box(glass, H.x0 + 0.5, H.x1 - 0.5, 8.5, 9.5, H.z1 - 0.1, H.z1);
    for (let x = -176; x <= -152; x += 6) this.box('#2a2622', x - 0.1, x + 0.1, 11.9, 14.2, -176, -175.8);
    this.box('#2a2622', -176.2, -151.8, 14.2, 14.4, -177, -170);
    // Porch: steps, a canopy on columns, a tall front door.
    this.box(stone, -167, -157, 0, 0.18, -158, -155.4);
    this.box(stone, -167.5, -156.5, 0, 0.09, -155.4, -154.6);
    this.box(white, -168, -156, 4.6, 4.9, -158, -153.6);
    for (const x of [-167.4, -156.6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.6, 16), white);
      col.position.set(x, 2.3, -154);
      col.castShadow = true;
      this.root.add(col);
      this.world.add(x - 0.25, x + 0.25, -154.25, -153.75, 4.6);
    }
    this.box('#2b1c12', -163.2, -160.8, 0.18, 3.6, H.z1 + 0.6, H.z1 + 0.72);
    this.box('#c8a24a', -161.15, -161.05, 1.6, 2.2, H.z1 + 0.72, H.z1 + 0.78);
    const name = textSprite('THE CHAIRMAN', '#d8b45a', 0.36);
    name.position.set(-162, 4.2, -153.4);
    this.root.add(name);
  }
  private lit!: THREE.MeshStandardMaterial;

  // ---------- The office (a real room for the meeting) ----------
  private buildOffice(): void {
    const O = MANSION.office, g = new THREE.Group();
    g.name = 'chairman-office';
    this.root.add(g);
    const wall = F.plaster('#e9dfcc', [3, 1]);
    const dark = mat('#2a1a12', 0.45);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(O.x1 - O.x0, O.z1 - O.z0), F.woodFloor([4, 3]));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((O.x0 + O.x1) / 2, 0.03, (O.z0 + O.z1) / 2);
    g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(O.x1 - O.x0, O.z1 - O.z0), mat('#f2ece0', 0.9));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((O.x0 + O.x1) / 2, 4.0, (O.z0 + O.z1) / 2);
    g.add(ceil);
    this.box(wall, O.x0, O.x1, 0, 4, O.z0 - 0.15, O.z0, false, g); // back (north) wall
    this.box(wall, O.x0 - 0.15, O.x0, 0, 4, O.z0, O.z1, false, g); // west
    this.box(wall, O.x1, O.x1 + 0.15, 0, 4, O.z0, O.z1, false, g); // east
    // Front: floor-to-ceiling glass to the garden in bronze frames.
    const glass = new THREE.MeshStandardMaterial({ color: '#9fb6c8', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.28 });
    this.box(glass, O.x0, O.x1, 0, 4, O.z1, O.z1 + 0.06, false, g);
    for (let x = O.x0; x <= O.x1 + 0.01; x += 3) this.box('#7a5a32', x - 0.05, x + 0.05, 0, 4, O.z1 - 0.02, O.z1 + 0.08, false, g);
    // The wall display: his properties, cars, aircraft and businesses.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.4), new THREE.MeshBasicMaterial({ map: displayTexture() }));
    screen.position.set(O.x0 + 0.09, 2.2, (O.z0 + O.z1) / 2);
    screen.rotation.y = Math.PI / 2;
    screen.name = 'office-display';
    g.add(screen);
    this.box('#111', O.x0, O.x0 + 0.06, 0.92, 3.48, (O.z0 + O.z1) / 2 - 2.75, (O.z0 + O.z1) / 2 + 2.75, false, g);
    // The desk, his chair, two guest chairs, a rug, shelves, a sofa, plants, a drinks cabinet.
    const dx = -176, dz = -166.2;
    this.box(dark, dx - 1.6, dx + 1.6, 0.72, 0.8, dz - 0.6, dz + 0.6, false, g);
    this.box(dark, dx - 1.5, dx + 1.5, 0, 0.72, dz - 0.5, dz - 0.4, false, g);
    for (const s of [-1, 1]) this.box(dark, dx + s * 1.45 - 0.05, dx + s * 1.45 + 0.05, 0, 0.72, dz - 0.5, dz + 0.5, false, g);
    this.box('#c8a24a', dx - 0.9, dx - 0.5, 0.8, 0.83, dz - 0.2, dz + 0.1, false, g); // brass tray
    this.box('#f4efe6', dx + 0.2, dx + 0.6, 0.8, 0.82, dz + 0.1, dz + 0.35, false, g); // the envelope
    const throne = new THREE.Group();
    this.box('#3a1a14', -0.45, 0.45, 0.42, 0.55, -0.45, 0.45, false, throne);
    this.box('#3a1a14', -0.45, 0.45, 0.55, 1.6, -0.55, -0.4, false, throne);
    this.box('#2a2622', -0.08, 0.08, 0, 0.42, -0.08, 0.08, false, throne);
    throne.position.set(dx, 0, dz - 1.05);
    g.add(throne);
    for (const s of [-1, 1]) {
      const c = F.chair();
      c.position.set(dx + s * 0.85, 0, dz + 1.25);
      c.rotation.y = Math.PI;
      g.add(c);
    }
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.6), F.rugMaterial('#7a1f2b'));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(dx, 0.04, dz + 0.6);
    g.add(rug);
    for (let i = 0; i < 4; i++) this.box('#3b2618', -173.6 + i * 0.9, -172.9 + i * 0.9, 0, 3.2, O.z0, O.z0 + 0.4, false, g);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) this.box(['#8a2b2b', '#2b4a8a', '#c8a24a', '#2b6a3a'][(i + k) % 4], -173.5 + i * 0.9, -173.0 + i * 0.9, 0.3 + k * 0.75, 0.6 + k * 0.75, O.z0 + 0.05, O.z0 + 0.3, false, g);
    const sofa = F.sofa('#3a2a22', 2.4);
    sofa.position.set(O.x1 - 0.6, 0, -162);
    sofa.rotation.y = Math.PI;
    g.add(sofa);
    for (const [x, z] of [[O.x0 + 0.6, O.z1 - 0.6], [O.x1 - 0.6, O.z0 + 0.6]] as const) {
      const p = F.plant();
      p.position.set(x, 0, z);
      g.add(p);
    }
    this.box('#1c1410', O.x0 + 0.1, O.x0 + 0.6, 0, 1.1, O.z0 + 0.4, O.z0 + 2.2, false, g);
    for (let i = 0; i < 5; i++) this.box(['#5a3a10', '#2a5a2a', '#e0d0a0'][i % 3], O.x0 + 0.25, O.x0 + 0.38, 1.1, 1.42, O.z0 + 0.6 + i * 0.3, O.z0 + 0.72 + i * 0.3, false, g);
    for (const x of [-179, -173]) {
      const l = F.ceilingLight(new THREE.MeshBasicMaterial({ color: '#fff3d6' }));
      l.position.set(x, 4, -163.5);
      g.add(l);
    }
  }

  // ---------- The Palmyra Grand Hotel ----------
  private buildHotel(): void {
    const Ht = HOTEL, stone = mat('#e7dcc8', 0.7), glass = new THREE.MeshStandardMaterial({ color: '#1d2c40', roughness: 0.1, metalness: 0.6 });
    this.box(stone, Ht.x0, Ht.x1, 0, 6, Ht.z0, Ht.z1, true);
    this.box(stone, Ht.x0 + 4, Ht.x1 - 4, 6, 30, Ht.z0 + 4, Ht.z1 - 4, true);
    this.box('#b8a888', Ht.x0 + 3.5, Ht.x1 - 3.5, 30, 31, Ht.z0 + 3.5, Ht.z1 - 3.5);
    for (let y = 7.5; y < 29; y += 3) this.box(glass, Ht.x0 + 5, Ht.x1 - 5, y, y + 1.8, Ht.z0 + 3.95, Ht.z0 + 4.0);
    for (let y = 7.5; y < 29; y += 3) for (const x of [Ht.x0 + 3.95, Ht.x1 - 4.0]) this.box(glass, x, x + 0.05, y, y + 1.8, Ht.z0 + 5, Ht.z1 - 5);
    this.box(this.lit, -170, -156, 0.5, 5.2, Ht.z0 - 0.06, Ht.z0);
    // Porte-cochère: a canopy on columns over the drop-off, lit underneath.
    this.box('#3a3028', -172, -154, 5.4, 6, 132, Ht.z0);
    this.box(this.lamps, -171.6, -154.4, 5.38, 5.42, 132.4, Ht.z0 - 0.4);
    for (const x of [-171.4, -154.6]) {
      this.box('#c8a24a', x - 0.25, x + 0.25, 0, 5.4, 132.4, 132.9, true);
    }
    this.box('#d8cdb8', -178, -148, 0, 0.05, 127, Ht.z0);
    this.box('#7a1f2b', -166, -160, 0.05, 0.07, 136, Ht.z0); // red carpet
    const sign = textSprite('THE PALMYRA GRAND', '#ffe2a0', 1.5);
    sign.position.set(-163, 9, Ht.z0 - 0.4);
    this.root.add(sign);
    const sub = textSprite('HOTEL · FICTIONAL', '#f4efe6', 0.5);
    sub.position.set(-163, 7.6, Ht.z0 - 0.4);
    this.root.add(sub);
    for (const [i, c] of ['#1f6fd1', '#c62828', '#f2b705'].entries()) {
      const x = -150 + i * 3;
      this.box('#d9d9d9', x - 0.05, x + 0.05, 0, 8, 138, 138.1, true);
      this.box(c, x + 0.05, x + 1.6, 6.8, 7.8, 138, 138.04);
    }
    for (const x of [-182, -176, -150, -144]) this.palm(x, 134, 6.5);
    // The doorman.
    this.person({ shirt: '#7a1f2b', pants: '#1a1c22', top: 'jacket', hat: 'cap', hatColour: '#7a1f2b', skin: '#4a2e1c' }, -159.5, 142.6, Math.PI / 2, 'doorman');
  }

  // ---------- Behaviour ----------
  /** People who walk somewhere and stop (Musa leading you in, the guest going into the club). */
  walk(rig: HumanRig, path: { x: number; z: number }[], speed: number, opts: { lead?: () => { x: number; z: number } | null; done?: () => void } = {}): void {
    this.walkers = this.walkers.filter((w) => w.rig !== rig);
    const p = rig.root.position;
    this.walkers.push({ rig, x: p.x, z: p.z, heading: -rig.root.rotation.y, path: [...path], speed, ...opts });
  }

  get musaWalking(): boolean {
    return this.walkers.some((w) => w.rig === this.musa);
  }

  /** Musa back at his post by the gate. */
  resetMusa(): void {
    this.walkers = this.walkers.filter((w) => w.rig !== this.musa);
    this.musa.root.position.set(-160.6, 0, -130.4);
    this.musa.root.rotation.y = -Math.PI / 2;
    this.musa.root.visible = true;
  }

  /** A black SUV sweeps in through the gate (when you first arrive). */
  suvArrives(car: THREE.Object3D): void {
    this.suvObj?.removeFromParent();
    this.suvObj = car;
    this.root.add(car);
    this.suv = { obj: car, path: [{ x: -196, z: -117 }, { x: -168, z: -117 }, { x: -162, z: -124 }, { x: -162, z: -138 }, { x: -170, z: -143 }, { x: -176, z: -147 }], i: 0, s: 0 };
    car.position.set(-196, 0, -117);
  }

  get suvMoving(): boolean {
    return !!this.suv;
  }

  /** Bayo's Cartel Boss model has loaded (null: keep the code-built figure; the error is kept for tests). */
  attachBoss(scene: THREE.Group | null, err?: unknown): void {
    if (!scene) {
      this.bossError = err ?? 'not loaded';
      return;
    }
    try {
      const rig = new BlkKingRig(scene, { name: 'chairman' });
      rig.root.position.copy(this.boss.root.position);
      rig.root.rotation.y = this.boss.root.rotation.y;
      rig.root.visible = this.boss.root.visible;
      this.boss.root.removeFromParent();
      this.root.add(rig.root);
      this.boss = rig;
    } catch (e) {
      this.bossError = e;
    }
  }

  /** The Chairman stands out by the pool (once you've met him; during the meeting he's in his office). */
  set bossOut(v: boolean) {
    this.boss.root.visible = v;
  }

  /** Lights in the office (on for the meeting). */
  officeLights(on: boolean): void {
    this.officeLight.intensity = on ? 9 : 0;
  }

  get gateOpen(): number {
    return this.gateT;
  }

  update(dt: number, night: number): void {
    this.time += dt;
    const M = MANSION, h = M.gate.half;
    const want = this.gateWanted || !!(this.suv && this.suv.i >= 1 && this.suv.i <= 3);
    this.gateT = THREE.MathUtils.clamp(this.gateT + (want ? dt : -dt) * 0.6, 0, 1);
    const k = this.gateT * this.gateT * (3 - 2 * this.gateT);
    this.gateL.position.set(M.gate.x - h / 2 - k * h, 0, M.z1 - 0.65);
    this.gateR.position.set(M.gate.x + h / 2 + k * h, 0, M.z1 - 0.65);
    this.gateBox.off = this.gateT > 0.6;
    this.lamps.emissiveIntensity = 0.4 + night * 2.4;
    this.lit.emissiveIntensity = 0.45 + night * 1.6;
    // Walkers.
    for (const w of [...this.walkers]) {
      const t = w.path[0];
      let sp = 0;
      if (t) {
        const lead = w.lead?.();
        const wait = lead && Math.hypot(lead.x - w.x, lead.z - w.z) > 7;
        const dx = t.x - w.x, dz = t.z - w.z, d = Math.hypot(dx, dz);
        if (d < 0.15) w.path.shift();
        else if (!wait) {
          sp = w.speed;
          const s = Math.min(d, sp * dt);
          w.x += (dx / d) * s;
          w.z += (dz / d) * s;
          w.heading = Math.atan2(dz, dx);
        } else if (lead) w.heading = Math.atan2(lead.z - w.z, lead.x - w.x);
      }
      w.rig.root.position.set(w.x, 0, w.z);
      w.rig.root.rotation.y = -w.heading;
      w.rig.animate(dt, sp);
      if (!w.path.length) {
        this.walkers.splice(this.walkers.indexOf(w), 1);
        w.done?.();
      }
    }
    for (const g of this.guards) if (!this.walkers.some((w) => w.rig === g) && !this.patrol.some((p) => p.rig === g)) g.animate(dt, 0);
    if (!this.musaWalking) this.musa.animate(dt, 0);
    if (this.boss.root.visible) {
      this.boss.animate(dt, 0);
      // Smoke from his cigar (the model's smoke_point; the code-built figure has none).
      const sp = this.boss.root.getObjectByName('smoke_point');
      if (sp && (this.smokeT -= dt) <= 0 && this.smoke.length < 14) {
        this.smokeT = 0.35;
        const m = new THREE.Mesh(SMOKE_GEO, this.smokeMat);
        sp.getWorldPosition(m.position);
        this.root.worldToLocal(m.position);
        this.root.add(m);
        this.smoke.push({ m, t: 0 });
      }
    }
    for (const p of [...this.smoke]) {
      p.t += dt;
      p.m.position.y += dt * 0.35;
      p.m.position.x += dt * 0.08;
      p.m.scale.setScalar(1 + p.t * 2.2);
      if (p.t > 2.6) {
        p.m.removeFromParent();
        this.smoke.splice(this.smoke.indexOf(p), 1);
      }
    }
    for (const p of this.patrol) {
      p.t += dt / 22;
      const u = p.t % 2 < 1 ? p.t % 1 : 1 - (p.t % 1);
      const x = p.a.x + (p.b.x - p.a.x) * u, z = p.a.z + (p.b.z - p.a.z) * u;
      const back = p.t % 2 >= 1;
      p.rig.root.position.set(x, 0, z);
      p.rig.root.rotation.y = -Math.atan2((p.b.z - p.a.z) * (back ? -1 : 1), (p.b.x - p.a.x) * (back ? -1 : 1));
      p.rig.animate(dt, 1.3);
    }
    // The SUV.
    const s = this.suv;
    if (s) {
      const t = s.path[s.i + 1];
      if (!t) this.suv = null;
      else {
        const p = s.obj.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
        const gateAhead = s.i === 2 && this.gateT < 0.85;
        s.s = gateAhead ? Math.max(0, s.s - dt * 8) : Math.min(s.i >= 3 ? 4 : 9, s.s + dt * 4);
        if (d < 0.5) s.i++;
        else {
          p.x += (dx / d) * Math.min(d, s.s * dt);
          p.z += (dz / d) * Math.min(d, s.s * dt);
          const want = -Math.atan2(dz, dx);
          s.obj.rotation.y += Math.atan2(Math.sin(want - s.obj.rotation.y), Math.cos(want - s.obj.rotation.y)) * Math.min(1, dt * 4);
        }
      }
    }
  }
}

/** Where the Chairman stands by the pool, looking down the drive. */
const BOSS_SPOT = { x: -146, z: -137.6 };
const SMOKE_GEO = new THREE.SphereGeometry(0.04, 8, 6);

/** The office wall display: his empire at a glance (fictional holdings from properties.ts). */
function displayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 472;
  const x = c.getContext('2d')!;
  const bg = x.createLinearGradient(0, 0, 1024, 472);
  bg.addColorStop(0, '#0b1324');
  bg.addColorStop(1, '#1d1030');
  x.fillStyle = bg;
  x.fillRect(0, 0, 1024, 472);
  x.fillStyle = '#d8b45a';
  x.font = 'bold 34px Arial';
  x.fillText('AKINWALE HOLDINGS', 32, 52);
  x.fillStyle = '#8d93a8';
  x.font = '18px Arial';
  x.fillText('PROPERTIES · FLEET · VENUES', 34, 80);
  const items = EMPIRE.slice(0, 8);
  items.forEach((p, i) => {
    const cx = 32 + (i % 4) * 246, cy = 104 + Math.floor(i / 4) * 178;
    x.fillStyle = 'rgba(255,255,255,0.06)';
    x.fillRect(cx, cy, 230, 160);
    x.fillStyle = ['#c8a24a', '#3ff0ff', '#ff4fa3', '#5dff9a'][i % 4];
    x.fillRect(cx, cy, 230, 6);
    x.fillStyle = '#f4efe6';
    x.font = 'bold 20px Arial';
    wrap(x, p.name, cx + 12, cy + 38, 206, 24);
    x.fillStyle = '#8d93a8';
    x.font = '15px Arial';
    x.fillText(p.kind.toUpperCase(), cx + 12, cy + 140);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrap(x: CanvasRenderingContext2D, text: string, px: number, py: number, w: number, lh: number): void {
  let line = '', y = py;
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (x.measureText(t).width > w && line) {
      x.fillText(line, px, y);
      line = word;
      y += lh;
    } else line = t;
  }
  x.fillText(line, px, y);
}
