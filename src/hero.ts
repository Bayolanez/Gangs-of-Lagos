import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HumanLook, HumanRig } from './human';
import { applyPose, Pose, PoseState } from './poses';
import { BlkKingRig } from './blkking';
import { makeBandana } from './human';

/**
 * The Gangs of Lagos lead character, built in code (no model files, no textures): an original,
 * stylized low-poly young man about 1.8 m tall. He has a short textured fade and a small goatee, and
 * wears a warm ochre hoodie (hood and drawstrings showing) under an open, cropped dark-teal jacket
 * with a gold chain and pendant, loose charcoal cargo trousers with side pockets and gathered cuffs,
 * and plain red, white and black high-top trainers. No logos or brand marks.
 *
 * The body is a hierarchy of groups with pivots at the joints:
 *   root > pelvis > spine > chest (torso, hoodie, jacket, chain), neck > head (hair, face),
 *                           shoulder > elbow > wrist (hand) on each side
 *          pelvis > hip > knee > ankle (trainer) on each side
 * Like the older HumanRig it faces +X, +Z is its right, and the pelvis sits at 0.92 m, so it drops
 * straight into the same controller, driver's seat and weapon code. The animation blends idle
 * (breathing, a slow weight shift), walk, run (faster swings, forward lean) and jump/fall by speed,
 * and the pelvis height is solved from the legs so the standing foot stays on the ground.
 *
 * PlayerRig (bottom of this file) wraps it: the hero draws the "Signature look" outfit, and every
 * other wardrobe outfit, or any error while building the hero, falls back to the older HumanRig.
 */

// ---------- Palette (warm sunset / teal art direction) ----------

export const HERO_COLOURS = {
  hoodie: '#d08a2e',
  hoodieRib: '#b4721f',
  string: '#f1e6cf',
  jacket: '#1d4d52',
  jacketRib: '#163a3e',
  seam: '#10292c',
  snap: '#b9924a',
  gold: '#d9a93a',
  hair: '#120d0a',
  fadeDark: '#1d1511',
  fadeLight: '#33241b',
  shoeWhite: '#efede6',
  shoeRed: '#c6303a',
  shoeBlack: '#18181b',
};

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.78, metal = 0, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${side}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
    mats.set(key, m);
  }
  return m;
}
/** A slightly darker or lighter version of a colour (pocket flaps, seams on the trousers). */
function shade(color: string, f: number): string {
  const c = new THREE.Color(color);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

// ---------- Shapes ----------

type Profile = [number, number][];
const SEG = 18;
/** Revolved shape. Profiles may run either way; they are turned bottom-to-top so the faces point outwards. */
const lathe = (p: Profile, phiStart = 0, phiLength = Math.PI * 2, seg = SEG) => {
  const pts = p[0][1] > p[p.length - 1][1] ? [...p].reverse() : p;
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);
};
/** Radius of a profile at height y (linear between points; profiles run bottom to top). */
function radiusAt(p: Profile, y: number): number {
  for (let i = 1; i < p.length; i++) {
    const [r0, y0] = p[i - 1], [r1, y1] = p[i];
    if (y >= y0 && y <= y1) return y1 === y0 ? Math.max(r0, r1) : r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return y < p[0][1] ? p[0][0] : p[p.length - 1][0];
}

// Torso shapes are revolved, then squashed front to back (x) and widened (z).
const SX = 0.76, SZ = 1.05;
/** Hoodie body, from the hem (y -0.06, just below the belt) to the neck; relative to the pelvis. */
const HOODIE: Profile = [[0.158, -0.06], [0.17, 0.0], [0.165, 0.1], [0.158, 0.2], [0.162, 0.3], [0.178, 0.4], [0.196, 0.48], [0.17, 0.55], [0.075, 0.6]];
/** Cropped jacket: ends at the waist, roomier than the hoodie everywhere. */
const JACKET: Profile = [[0.184, 0.06], [0.182, 0.12], [0.178, 0.22], [0.182, 0.32], [0.196, 0.41], [0.214, 0.48], [0.19, 0.555], [0.098, 0.6]];
/** Half-angle of the open jacket front (the hoodie shows through it). */
const OPEN = 0.43;

const shared = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  lowSphere: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 12),
  torus: new THREE.TorusGeometry(1, 0.25, 8, 20),
  thinRing: new THREE.TorusGeometry(1, 0.05, 5, 20),
};

/** Point on a revolved, squashed torso surface (phi: 0 = right side, PI/2 = front, as LatheGeometry). */
function onSurface(p: Profile, y: number, phi: number, out = 0): THREE.Vector3 {
  const r = radiusAt(p, y) + out;
  return new THREE.Vector3(r * Math.sin(phi) * SX, y, r * Math.cos(phi) * SZ);
}
function tube(points: THREE.Vector3[], radius: number, closed = false, seg = 24): THREE.TubeGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), seg, radius, 5, closed);
}

/** Hood lying flat on the upper back: a soft, wide pouch, folded at the top round the neck. */
let hoodGeo: THREE.BufferGeometry | null = null;
function hoodShape(): THREE.BufferGeometry {
  if (hoodGeo) return hoodGeo;
  const g = new THREE.SphereGeometry(1, 18, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Flat against the back (x), wide at the top and narrowing to a rounded point below (y, z).
    const width = 0.15 * (0.55 + 0.45 * (y + 1) / 2);
    p.setXYZ(i, x * 0.045 + (y > 0.4 ? (y - 0.4) * 0.05 : 0), y * 0.12, z * width);
  }
  g.computeVertexNormals();
  hoodGeo = g;
  return g;
}

/** Small deterministic random numbers (hair texture). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Textured short hair on top: a dome covered in small coils, merged into one mesh. */
let hairTopGeo: THREE.BufferGeometry | null = null;
function hairTop(): THREE.BufferGeometry {
  if (hairTopGeo) return hairTopGeo;
  const parts: THREE.BufferGeometry[] = [];
  const dome = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.29);
  dome.scale(0.113, 0.134, 0.107);
  parts.push(dome.toNonIndexed());
  const r = rng(11);
  for (let ring = 0; ring < 5; ring++) {
    const theta = 0.04 * Math.PI + ring * 0.055 * Math.PI;
    const n = ring === 0 ? 5 : 7 + ring * 4;
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * Math.PI * 2 + r() * 0.4;
      const s = 0.012 + r() * 0.005;
      const g = new THREE.SphereGeometry(1, 6, 5);
      g.scale(s, s * 0.8, s);
      const st = Math.sin(theta), ct = Math.cos(theta);
      g.translate(-Math.cos(phi) * st * 0.114, ct * 0.135 - 0.002, Math.sin(phi) * st * 0.108);
      parts.push(g.toNonIndexed());
    }
  }
  hairTopGeo = mergeGeometries(parts.map((g) => {
    g.deleteAttribute('uv');
    return g;
  }))!;
  hairTopGeo.computeVertexNormals();
  return hairTopGeo;
}

export type HeroJoint = 'pelvis' | 'spine' | 'chest' | 'neck' | 'head' | 'armR' | 'armL' | 'elbowR' | 'elbowL' | 'handR' | 'handL' | 'legR' | 'legL' | 'kneeR' | 'kneeL' | 'ankleR' | 'ankleL';

const THIGH = 0.44, SHIN = 0.42, SOLE = 0.06, HIP_Y = THIGH + SHIN + SOLE;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The hero. The API matches HumanRig (dress, hold, animate, aim, swing, seated) so the player code
 * does not care which one it drives. In this class the side names are anatomical: "R" is his right
 * (+Z), "L" his left. The gun hand is his right hand.
 */
export class HeroRig {
  readonly root = new THREE.Group();
  readonly joints: Record<HeroJoint, THREE.Group>;
  aim: 0 | 1 | 2 = 0;
  swing = 0;
  seated = false;
  /** Cutscene gesture layered over the animation (see poses.ts). */
  readonly gesture = new PoseState();
  private held: THREE.Object3D | null = null;
  private worn: THREE.Object3D[] = [];
  private soles: THREE.Object3D[] = [];
  private phase = 0;
  private t = 0;
  private spd = 0;
  private airW = 0;
  /** Smoothed joint rotations (so changes of gait blend instead of snapping). */
  private cur = new Map<string, number>();

  constructor(look: HumanLook) {
    const g = () => new THREE.Group();
    const j = {
      pelvis: g(), spine: g(), chest: g(), neck: g(), head: g(),
      armR: g(), armL: g(), elbowR: g(), elbowL: g(), handR: g(), handL: g(),
      legR: g(), legL: g(), kneeR: g(), kneeL: g(), ankleR: g(), ankleL: g(),
    };
    this.joints = j;
    for (const [k, o] of Object.entries(j)) o.name = `hero-${k}`;
    this.root.name = 'hero';
    j.pelvis.position.set(0, HIP_Y, 0);
    this.root.add(j.pelvis);
    j.pelvis.add(j.spine, j.legR, j.legL);
    j.spine.add(j.chest, j.neck, j.armR, j.armL);
    j.neck.position.set(0, 0.6, 0);
    j.head.position.set(0, 0.1, 0);
    j.neck.add(j.head);
    j.armR.position.set(0, 0.5, 0.205);
    j.armL.position.set(0, 0.5, -0.205);
    for (const s of ['R', 'L'] as const) {
      const arm = j[`arm${s}`], elbow = j[`elbow${s}`], hand = j[`hand${s}`];
      elbow.position.set(0, -0.29, 0);
      hand.position.set(0, -0.28, 0);
      arm.add(elbow);
      elbow.add(hand);
      const leg = j[`leg${s}`], knee = j[`knee${s}`], ankle = j[`ankle${s}`];
      leg.position.set(0, 0, s === 'R' ? 0.1 : -0.1);
      knee.position.set(0, -THIGH, 0);
      ankle.position.set(0, -SHIN, 0);
      leg.add(knee);
      knee.add(ankle);
    }
    this.dress(look);
  }

  private mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], shadow = true): THREE.Mesh {
    const o = new THREE.Mesh(geo, m);
    o.position.set(...pos);
    o.scale.set(...scale);
    o.rotation.set(...rot);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    this.worn.push(o);
    return o;
  }

  /** Small part laid on a torso surface, its +Y axis pointing out of the surface. */
  private onBody(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: Profile, y: number, phi: number, out: number, scale: [number, number, number]): THREE.Mesh {
    const o = this.mesh(parent, geo, m, [0, 0, 0], scale, [0, 0, 0], false);
    o.position.copy(onSurface(p, y, phi, out));
    const n = new THREE.Vector3(Math.sin(phi) / SX, 0, Math.cos(phi) / SZ).normalize();
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return o;
  }

  /** Builds the body and clothes. Only skin, trouser colour and headwear come from the look. */
  dress(look: HumanLook): void {
    for (const m of this.worn) m.removeFromParent();
    this.worn = [];
    this.soles = [];
    const C = HERO_COLOURS;
    const j = this.joints;
    const skinC = look.skin ?? '#5a3a26';
    const skin = mat(skinC, 0.5);
    const skinDark = mat(shade(skinC, 0.72), 0.6);
    const pantsC = look.pants ?? '#2b2b2b';
    const pants = mat(pantsC, 0.9);
    const pantsDark = mat(shade(pantsC, 0.78), 0.9);
    const hoodie = mat(C.hoodie, 0.85);
    const hoodieRib = mat(C.hoodieRib, 0.9);
    const jacket = mat(C.jacket, 0.62);
    const jacketShell = mat(C.jacket, 0.62, 0, THREE.DoubleSide);
    const rib = mat(C.jacketRib, 0.85);
    const seam = mat(C.seam, 0.8);
    const gold = mat(C.gold, 0.3, 0.85);
    const hair = mat(C.hair, 0.95);

    // ---- Trousers: pelvis, loose thighs with cargo pockets, shins bunching into gathered cuffs
    this.mesh(j.pelvis, lathe([[0.001, -0.13], [0.13, -0.13], [0.166, -0.05], [0.16, 0.04], [0.001, 0.07]]), pants, [0, 0, 0], [0.8, 1, 1.05]);
    for (const z of [0.066, -0.066]) this.mesh(j.pelvis, new RoundedBoxGeometry(0.012, 0.085, 0.075, 2, 0.005), pantsDark, [-0.128, -0.06, z], [1, 1, 1], [0, z > 0 ? 0.25 : -0.25, 0], false); // back pockets
    const thigh = lathe([[0.001, 0.05], [0.088, 0.035], [0.102, -0.02], [0.1, -0.15], [0.092, -0.32], [0.083, -THIGH]]);
    const shin = lathe([[0.082, 0.02], [0.08, -0.1], [0.074, -0.24], [0.07, -0.3]]);
    for (const s of ['R', 'L'] as const) {
      const leg = j[`leg${s}`], knee = j[`knee${s}`], ankle = j[`ankle${s}`];
      const side = s === 'R' ? 1 : -1;
      this.mesh(leg, thigh, pants);
      this.mesh(knee, shared.sphere, pants, [0, 0, 0], [0.077, 0.05, 0.077], [0, 0, 0], false);
      this.mesh(knee, shin, pants);
      // Fabric bunching above the cuff, then the elastic cuff sitting on the trainer's collar.
      this.mesh(knee, shared.torus, pants, [0, -0.31, 0], [0.066, 0.066, 0.066], [Math.PI / 2, 0, 0], false);
      this.mesh(knee, shared.torus, pants, [0.004, -0.335, 0], [0.064, 0.064, 0.062], [Math.PI / 2 + 0.12, 0, 0], false);
      this.mesh(knee, shared.cyl, pantsDark, [0, -0.362, 0], [0.06, 0.04, 0.06], [0, 0, 0], false);
      // Cargo pocket on the outside of the thigh, with a flap and a snap.
      this.mesh(leg, new RoundedBoxGeometry(0.115, 0.13, 0.032, 2, 0.012), pants, [0.0, -0.25, side * 0.093], [1, 1, 1], [0, 0, 0], false);
      this.mesh(leg, new RoundedBoxGeometry(0.122, 0.038, 0.038, 2, 0.012), pantsDark, [0.0, -0.18, side * 0.097], [1, 1, 1], [side * 0.08, 0, 0], false);
      this.mesh(leg, shared.lowSphere, mat('#3c3c40', 0.4, 0.5), [0.0, -0.183, side * 0.117], [0.008, 0.008, 0.005], [0, 0, 0], false);
      // Side seam down the outside of the leg.
      this.mesh(leg, tube([new THREE.Vector3(0, 0.0, side * 0.1), new THREE.Vector3(0, -0.15, side * 0.101), new THREE.Vector3(0, -0.43, side * 0.084)], 0.0035, false, 10), pantsDark, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      this.trainer(ankle);
    }

    // ---- Hoodie body (shows through the open jacket and below its cropped hem)
    const chest = j.chest;
    this.mesh(chest, lathe(HOODIE), hoodie, [0, 0, 0], [SX, 1, SZ]);
    this.mesh(chest, lathe([[radiusAt(HOODIE, -0.06) + 0.004, -0.065], [radiusAt(HOODIE, 0.0) + 0.005, 0.0]]), hoodieRib, [0, 0, 0], [SX, 1, SZ], [0, 0, 0], false); // hem rib
    // Kangaroo pocket.
    this.mesh(chest, new RoundedBoxGeometry(0.018, 0.11, 0.2, 3, 0.008), hoodie, [radiusAt(HOODIE, 0.07) * SX - 0.002, 0.065, 0], [1, 1, 1], [0, 0, 0.08], false);
    this.mesh(chest, tube([new THREE.Vector3(0.137, 0.115, -0.09), new THREE.Vector3(0.142, 0.118, 0), new THREE.Vector3(0.137, 0.115, 0.09)], 0.003, false, 8), hoodieRib, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);

    // ---- Gold chain and pendant (lies on the hoodie, inside the open jacket)
    const chain: THREE.Vector3[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const drop = Math.pow((1 + Math.cos(a)) / 2, 2);
      const y = 0.552 - 0.16 * drop;
      const r = radiusAt(HOODIE, y) + 0.009;
      chain.push(new THREE.Vector3(r * Math.cos(a) * SX, y, r * Math.sin(a) * SZ));
    }
    this.mesh(chest, tube(chain, 0.0058, true, 64), gold, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
    const px = radiusAt(HOODIE, 0.37) * SX + 0.014;
    this.mesh(chest, shared.torus, gold, [px - 0.002, 0.386, 0], [0.007, 0.007, 0.007], [0, Math.PI / 2, 0], false); // bail
    this.mesh(chest, shared.cyl, gold, [px, 0.355, 0], [0.024, 0.006, 0.024], [0, 0, Math.PI / 2 - 0.08], false); // disc
    this.mesh(chest, shared.torus, mat('#a87a22', 0.35, 0.85), [px + 0.004, 0.355, 0], [0.015, 0.015, 0.015], [0, Math.PI / 2, 0.08], false); // rim

    // ---- Drawstrings with tipped ends
    for (const z of [0.03, -0.03]) {
      const pts = [0.575, 0.52, 0.46, 0.4, 0.355].map((y, i) => new THREE.Vector3(radiusAt(HOODIE, y) * SX + 0.016, y, z * (1 + i * 0.06)));
      this.mesh(chest, tube(pts, 0.0045, false, 12), mat(C.string, 0.85), [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      const end = pts[pts.length - 1];
      this.mesh(chest, shared.cyl, mat('#d8cfb8', 0.5, 0.3), [end.x, end.y - 0.014, end.z], [0.0055, 0.022, 0.0055], [0, 0, 0], false);
    }

    // ---- Hood resting on the back and shoulders, rim round the neck
    this.mesh(chest, hoodShape(), hoodie, [-0.15, 0.5, 0], [1, 1, 1], [0, 0, 0.18]);
    this.mesh(chest, shared.torus, hoodie, [-0.03, 0.605, 0], [0.098, 0.098, 0.115], [Math.PI / 2, 0.3, 0], false);
    this.mesh(chest, shared.torus, hoodieRib, [-0.03, 0.61, 0], [0.086, 0.086, 0.1], [Math.PI / 2, 0.3, 0], false);

    // ---- Open, cropped jacket: shell, ribbed hem, plackets with snaps, seams, welt pockets, collar
    const ps = Math.PI / 2 + OPEN, pl = Math.PI * 2 - OPEN * 2;
    this.mesh(chest, lathe(JACKET, ps, pl, 24), jacketShell, [0, 0, 0], [SX, 1, SZ]);
    this.mesh(chest, lathe([[radiusAt(JACKET, 0.06) + 0.006, 0.035], [radiusAt(JACKET, 0.125) + 0.005, 0.125]], ps, pl, 24), mat(C.jacketRib, 0.85, 0, THREE.DoubleSide), [0, 0, 0], [SX, 1, SZ], [0, 0, 0], false);
    for (const y of [0.06, 0.08, 0.1]) this.mesh(chest, tube(this.ring(y, 0.008, ps, pl), 0.0022, false, 24), seam, [0, 0, 0], [1, 1, 1], [0, 0, 0], false); // rib lines
    for (const side of [1, -1]) {
      const phi = Math.PI / 2 - side * OPEN;
      const edge = [0.04, 0.15, 0.27, 0.39, 0.48, 0.545].map((y) => onSurface(JACKET, y, phi, 0.004));
      this.mesh(chest, tube(edge, 0.011, false, 16), rib, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      if (side > 0) for (const y of [0.17, 0.27, 0.37, 0.46]) this.onBody(chest, shared.cyl, mat(C.snap, 0.35, 0.7), JACKET, y, phi - 0.045, 0.006, [0.011, 0.005, 0.011]);
      // Slanted welt pocket on each front panel.
      const a = onSurface(JACKET, 0.16, Math.PI / 2 - side * 0.95, 0.003), b = onSurface(JACKET, 0.27, Math.PI / 2 - side * 0.72, 0.003);
      this.mesh(chest, tube([a, a.clone().lerp(b, 0.5).multiplyScalar(1.01), b], 0.007, false, 8), rib, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      // Side seam.
      this.mesh(chest, tube([0.13, 0.25, 0.37, 0.45].map((y) => onSurface(JACKET, y, side > 0 ? 0 : Math.PI, 0.002)), 0.0028, false, 10), seam, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      // Collar: folded points lying on the chest either side of the opening.
      const cp = onSurface(JACKET, 0.54, Math.PI / 2 - side * (OPEN + 0.18), 0.012);
      this.mesh(chest, new RoundedBoxGeometry(0.012, 0.085, 0.07, 2, 0.005), jacket, [cp.x, cp.y, cp.z], [1, 1, 1], [side * -0.55, side * 0.5, -0.35], false);
    }
    // Back: centre seam and a yoke across the shoulders.
    this.mesh(chest, tube([0.13, 0.25, 0.37, 0.46].map((y) => onSurface(JACKET, y, Math.PI * 1.5, 0.002)), 0.0028, false, 10), seam, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
    this.mesh(chest, tube(this.ring(0.44, 0.003, Math.PI + 0.35, Math.PI - 0.7), 0.0028, false, 16), seam, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
    // Stand collar round the back of the neck.
    this.mesh(chest, lathe([[0.104, 0.55], [0.1, 0.61], [0.11, 0.645]], Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 20), mat(C.jacket, 0.62, 0, THREE.DoubleSide), [0, 0, 0], [1.05, 1, 1.12], [0, 0, 0], false);

    // ---- Arms: bomber sleeves, ribbed cuffs, a hint of hoodie cuff, hands
    const upper = lathe([[0.001, 0.065], [0.05, 0.058], [0.072, 0.02], [0.07, -0.08], [0.064, -0.2], [0.059, -0.29]]);
    const lower = lathe([[0.059, 0.01], [0.057, -0.08], [0.051, -0.2], [0.048, -0.235]]);
    for (const s of ['R', 'L'] as const) {
      const arm = j[`arm${s}`], elbow = j[`elbow${s}`], hand = j[`hand${s}`];
      const side = s === 'R' ? 1 : -1;
      this.mesh(arm, upper, jacket);
      this.mesh(arm, shared.thinRing, seam, [0, -0.005, 0], [0.071, 0.071, 0.071], [Math.PI / 2, 0, side * 0.35], false); // armhole seam
      this.mesh(elbow, shared.sphere, jacket, [0, 0, 0], [0.056, 0.05, 0.056], [0, 0, 0], false);
      this.mesh(elbow, lower, jacket);
      this.mesh(elbow, tube([new THREE.Vector3(-0.058, 0.0, 0), new THREE.Vector3(-0.054, -0.12, 0), new THREE.Vector3(-0.047, -0.23, 0)], 0.0025, false, 8), seam, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
      this.mesh(elbow, shared.cyl, rib, [0, -0.252, 0], [0.047, 0.042, 0.047]);
      this.mesh(elbow, shared.cyl, hoodieRib, [0, -0.276, 0], [0.041, 0.012, 0.041], [0, 0, 0], false);
      this.hand(hand, skin, side);
    }

    // ---- Neck and head
    this.mesh(j.neck, shared.cyl, skin, [0.005, 0.04, 0], [0.05, 0.13, 0.05]);
    this.head(j.head, skin, skinDark, hair, look);
  }

  /** Points round the jacket at height y between two angles (seams and rib lines). */
  private ring(y: number, out: number, phiStart: number, phiLength: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) pts.push(onSurface(JACKET, y, phiStart + (i / 16) * phiLength, out));
    return pts;
  }

  /** A stylized hand: palm, a block of fingers curled a little, and a thumb on the front. */
  private hand(hand: THREE.Group, skin: THREE.Material, side: number): void {
    this.mesh(hand, shared.cyl, skin, [0, 0.0, 0], [0.034, 0.03, 0.03], [0, 0, 0], false); // wrist
    this.mesh(hand, shared.sphere, skin, [0, -0.045, 0], [0.042, 0.05, 0.027]);
    this.mesh(hand, shared.capsule, skin, [0.012, -0.09, 0], [0.026, 0.016, 0.034], [0, 0, 0.35], false);
    this.mesh(hand, shared.capsule, skin, [0.034, -0.04, -side * 0.012], [0.012, 0.016, 0.012], [side * 0.2, 0, -0.7], false);
  }

  /** Red, white and black high-top trainer (no brand marks). Origin at the ankle, sole 6 cm below. */
  private trainer(ankle: THREE.Group): void {
    const C = HERO_COLOURS;
    const white = mat(C.shoeWhite, 0.55), red = mat(C.shoeRed, 0.5), black = mat(C.shoeBlack, 0.6);
    this.mesh(ankle, new RoundedBoxGeometry(0.285, 0.02, 0.108, 2, 0.008), black, [0.055, -0.05, 0]); // outsole
    this.mesh(ankle, new RoundedBoxGeometry(0.278, 0.032, 0.104, 2, 0.012), white, [0.055, -0.027, 0], [1, 1, 1], [0, 0, 0], false); // midsole
    this.mesh(ankle, new RoundedBoxGeometry(0.17, 0.065, 0.094, 2, 0.028), white, [0.075, 0.0, 0], [1, 1, 1], [0, 0, 0], false); // vamp
    this.mesh(ankle, shared.sphere, white, [0.135, -0.008, 0], [0.065, 0.036, 0.047], [0, 0, 0], false); // toe box
    this.mesh(ankle, new RoundedBoxGeometry(0.13, 0.05, 0.099, 2, 0.018), red, [0.015, 0.014, 0], [1, 1, 1], [0, 0, 0.05], false); // red quarter panels
    this.mesh(ankle, shared.sphere, red, [-0.045, 0.012, 0], [0.048, 0.055, 0.05], [0, 0, 0], false); // heel counter
    this.mesh(ankle, shared.cyl, black, [-0.002, 0.05, 0], [0.057, 0.075, 0.056], [0, 0, 0], false); // high-top collar
    this.mesh(ankle, shared.torus, black, [-0.004, 0.088, 0], [0.054, 0.054, 0.054], [Math.PI / 2, 0, 0], false); // padded rim
    this.mesh(ankle, new RoundedBoxGeometry(0.022, 0.085, 0.05, 2, 0.008), white, [0.05, 0.06, 0], [1, 1, 1], [0, 0, -0.3], false); // tongue
    this.mesh(ankle, new RoundedBoxGeometry(0.11, 0.012, 0.07, 2, 0.004), black, [0.075, 0.034, 0], [1, 1, 1], [0, 0, -0.18], false); // eyestay
    for (let i = 0; i < 4; i++) this.mesh(ankle, shared.capsule, white, [0.05 + i * 0.022, 0.044 - i * 0.004, 0], [0.004, 0.009, 0.004], [Math.PI / 2, 0, 0], false); // laces
    this.mesh(ankle, new RoundedBoxGeometry(0.015, 0.04, 0.03, 2, 0.006), white, [-0.06, 0.07, 0], [1, 1, 1], [0, 0, 0.1], false); // heel tab
    const sole = new THREE.Object3D();
    sole.position.set(0.05, -SOLE, 0);
    ankle.add(sole);
    this.worn.push(sole);
    this.soles.push(sole);
  }

  /** Head: skull, face, ears, fade haircut with a textured top, small goatee, optional headwear. */
  private head(h: THREE.Group, skin: THREE.Material, skinDark: THREE.Material, hair: THREE.Material, look: HumanLook): void {
    const C = HERO_COLOURS;
    this.mesh(h, shared.sphere, skin, [-0.005, 0.075, 0], [0.106, 0.126, 0.1]); // cranium
    this.mesh(h, shared.sphere, skin, [0.022, 0.006, 0], [0.088, 0.076, 0.083]); // jaw
    this.mesh(h, shared.sphere, skin, [0.072, -0.024, 0], [0.03, 0.028, 0.042], [0, 0, 0], false); // chin
    for (const z of [0.05, -0.05]) this.mesh(h, shared.lowSphere, skin, [0.062, 0.044, z], [0.024, 0.018, 0.026], [0, 0, 0], false); // cheekbones
    for (const z of [0.1, -0.1]) {
      this.mesh(h, shared.sphere, skin, [-0.006, 0.06, z], [0.018, 0.03, 0.013], [0, 0, 0], false); // ear
      this.mesh(h, shared.lowSphere, skinDark, [-0.002, 0.058, z * 1.08], [0.01, 0.018, 0.005], [0, 0, 0], false); // inner ear
    }
    // Eyes: whites, brown irises, a catch-light, lids and brows.
    for (const z of [0.037, -0.037]) {
      this.mesh(h, shared.sphere, mat('#f1ece2', 0.3), [0.085, 0.078, z], [0.014, 0.011, 0.018], [0, 0, 0], false);
      this.mesh(h, shared.sphere, mat('#2a170e', 0.25), [0.097, 0.078, z], [0.006, 0.0095, 0.0095], [0, 0, 0], false);
      this.mesh(h, shared.lowSphere, mat('#ffffff', 0.2), [0.1025, 0.082, z - 0.003], [0.0025, 0.0025, 0.0025], [0, 0, 0], false);
      this.mesh(h, shared.capsule, skinDark, [0.094, 0.09, z], [0.005, 0.011, 0.005], [Math.PI / 2, 0, 0], false); // upper lid
      this.mesh(h, shared.capsule, hair, [0.097, 0.106, z * 1.05], [0.0045, 0.012, 0.005], [Math.PI / 2, z > 0 ? -0.15 : 0.15, 0], false); // brow
    }
    // Broad nose and full lips.
    this.mesh(h, shared.capsule, skin, [0.1, 0.06, 0], [0.011, 0.012, 0.012], [0, 0, 0.25], false); // bridge
    this.mesh(h, shared.sphere, skin, [0.108, 0.038, 0], [0.02, 0.018, 0.022], [0, 0, 0], false); // tip
    for (const z of [0.02, -0.02]) this.mesh(h, shared.lowSphere, skin, [0.098, 0.033, z], [0.014, 0.013, 0.013], [0, 0, 0], false); // nostril wings
    this.mesh(h, shared.sphere, mat('#4a2a20', 0.5), [0.094, 0.002, 0], [0.012, 0.008, 0.028], [0, 0, 0], false); // upper lip
    this.mesh(h, shared.sphere, mat('#5e3529', 0.45), [0.092, -0.012, 0], [0.013, 0.009, 0.026], [0, 0, 0], false); // lower lip
    // Small goatee: moustache, corners, soul patch and chin.
    this.mesh(h, shared.capsule, hair, [0.1, 0.015, 0], [0.006, 0.014, 0.006], [Math.PI / 2, 0, 0], false);
    for (const z of [0.027, -0.027]) this.mesh(h, shared.capsule, hair, [0.09, -0.006, z], [0.004, 0.008, 0.004], [0, 0, 0], false);
    this.mesh(h, shared.lowSphere, hair, [0.094, -0.026, 0], [0.008, 0.009, 0.011], [0, 0, 0], false);
    this.mesh(h, shared.sphere, hair, [0.08, -0.04, 0], [0.026, 0.024, 0.032], [0, 0, 0], false);

    // Fade: two shells round the sides and back (darker above, closer to the skin below), clear of the face.
    const fs = Math.PI + 0.95, fl = Math.PI * 2 - 1.9;
    this.mesh(h, new THREE.SphereGeometry(1, 20, 6, fs, fl, Math.PI * 0.27, Math.PI * 0.1), mat(C.fadeDark, 0.95), [-0.005, 0.075, 0], [0.11, 0.131, 0.104], [0, 0, 0], false);
    this.mesh(h, new THREE.SphereGeometry(1, 20, 6, fs, fl, Math.PI * 0.37, Math.PI * 0.09), mat(C.fadeLight, 0.95), [-0.005, 0.075, 0], [0.108, 0.129, 0.1025], [0, 0, 0], false);
    const covered = !!look.hat || !!look.headwrap;
    if (!covered) this.mesh(h, hairTop(), hair, [-0.005, 0.075, 0]);

    // Headwear from the wardrobe (simple shapes; plain, no logos).
    const hatC = mat(look.hatColour ?? look.shirt, 0.75);
    switch (look.hat) {
      case 'fila':
        this.mesh(h, shared.cyl, hatC, [-0.01, 0.17, 0], [0.112, 0.1, 0.108]);
        this.mesh(h, shared.sphere, hatC, [-0.02, 0.22, 0.03], [0.1, 0.04, 0.09], [0.3, 0, 0]);
        break;
      case 'cap':
      case 'danfo': {
        const c = look.hat === 'danfo' ? mat('#f2c21a', 0.7) : hatC;
        this.mesh(h, new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), c, [-0.005, 0.12, 0], [0.116, 0.095, 0.11]);
        this.mesh(h, shared.cyl, c, [0.1, 0.125, 0], [0.09, 0.012, 0.086], [0, 0, -0.08]);
        if (look.hat === 'danfo') this.mesh(h, shared.cyl, mat('#111111', 0.7), [-0.005, 0.14, 0], [0.117, 0.02, 0.111], [0, 0, 0], false);
        break;
      }
      case 'bucket':
        this.mesh(h, shared.cyl, mat('#8a7a55', 0.85), [0, 0.15, 0], [0.114, 0.1, 0.112]);
        this.mesh(h, shared.cyl, mat('#8a7a55', 0.85), [0, 0.11, 0], [0.17, 0.012, 0.17]);
        break;
    }
    if (look.headwrap) this.mesh(h, shared.sphere, mat(look.headwrap, 0.7), [-0.01, 0.15, 0], [0.13, 0.1, 0.13]);
  }

  /** Put a (placeholder) weapon in the right hand, or empty it with null. */
  hold(obj: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = obj;
    if (obj) {
      obj.position.set(0, -0.04, 0);
      this.joints.handR.add(obj);
    }
  }

  /** World height of each sole (above the root), for tests and look-dev. */
  soleHeights(): number[] {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return this.soles.map((s) => s.getWorldPosition(v).y - this.root.position.y);
  }

  /** Blend towards a target rotation (radians) on one joint axis. */
  private go(o: THREE.Object3D, axis: 'x' | 'y' | 'z', target: number, k: number): void {
    const key = `${o.name}.${axis}`;
    const v = this.cur.get(key) ?? o.rotation[axis];
    const n = v + (target - v) * k;
    this.cur.set(key, n);
    o.rotation[axis] = n;
  }

  /** speed in m/s; airborne while jumping or falling. */
  animate(dt: number, speed: number, airborne = false): void {
    const j = this.joints;
    const k = 1 - Math.exp(-dt * 16);
    this.t += dt;
    this.spd += (speed - this.spd) * Math.min(1, dt * 8);
    this.airW += ((airborne && !this.seated ? 1 : 0) - this.airW) * Math.min(1, dt * 10);

    if (this.seated) {
      const kk = 1 - Math.exp(-dt * 14);
      for (const s of ['R', 'L'] as const) {
        this.go(j[`leg${s}`], 'z', 1.45, kk);
        this.go(j[`leg${s}`], 'x', 0, kk);
        this.go(j[`knee${s}`], 'z', -1.35, kk);
        this.go(j[`ankle${s}`], 'z', -0.15, kk);
        this.go(j[`arm${s}`], 'z', 1.05, kk);
        this.go(j[`arm${s}`], 'x', 0, kk);
        this.go(j[`elbow${s}`], 'z', 0.5, kk);
      }
      this.go(j.spine, 'z', 0.06, kk);
      this.go(j.spine, 'y', 0, kk);
      this.go(j.spine, 'x', 0, kk);
      this.go(j.neck, 'z', -0.04, kk);
      this.go(j.pelvis, 'y', 0, kk);
      j.pelvis.position.set(0, HIP_Y, 0);
      j.chest.scale.setScalar(1);
      return;
    }

    const air = this.airW;
    const moveW = smooth(0.12, 1.2, this.spd) * (1 - air);
    const runW = smooth(3.8, 6.0, this.spd);
    const idleW = 1 - smooth(0.05, 0.8, this.spd);
    // Stride: longer legs swing and a flight phase at a run; cadence follows speed so feet don't skate.
    const amp = lerp(0.5, 0.72, runW);
    const strideLen = 4 * 0.9 * Math.sin(amp) * (1 + 0.6 * runW);
    const freq = Math.max(0.8, this.spd / strideLen);
    if (this.spd > 0.05) this.phase += dt * Math.PI * 2 * freq;
    const s = Math.sin(this.phase);
    const swingA = amp * moveW;

    // Legs: hips swing opposite each other; knees flex in early swing; ankles keep the trainers level.
    const hips = { R: s * swingA, L: -s * swingA };
    const knees = { R: 0, L: 0 };
    for (const side of ['R', 'L'] as const) {
      const p = this.phase + (side === 'L' ? Math.PI : 0);
      const flex = Math.pow(Math.max(0, Math.cos(p + 0.6)), 1.5) * lerp(0.8, 1.45, runW) + 0.06 * runW;
      knees[side] = -flex * moveW;
    }
    // Jump / fall: one knee tucked, the other trailing.
    hips.R = lerp(hips.R, 0.55, air);
    knees.R = lerp(knees.R, -0.95, air);
    hips.L = lerp(hips.L, -0.12, air);
    knees.L = lerp(knees.L, -0.4, air);

    // Idle weight shift: the pelvis drifts side to side; the legs lean to keep the feet planted.
    const shift = Math.sin(this.t * 0.7) * 0.018 * idleW;
    const splay = 0.035;
    for (const side of ['R', 'L'] as const) {
      const sgn = side === 'R' ? 1 : -1;
      this.go(j[`leg${side}`], 'z', hips[side], k);
      this.go(j[`leg${side}`], 'x', Math.asin(shift / (THIGH + SHIN)) - sgn * splay * (1 - air * 0.5), k);
      this.go(j[`knee${side}`], 'z', knees[side], k);
      this.go(j[`ankle${side}`], 'z', -(hips[side] + knees[side]) * 0.85 * (1 - air * 0.6), k);
    }
    // Pelvis height from the legs: the lower foot rests on the ground (plus a small bounce at a run).
    const reach = (sd: 'R' | 'L') => {
      const h = j[`leg${sd}`].rotation.z, kn = j[`knee${sd}`].rotation.z;
      return (THIGH * Math.cos(h) + SHIN * Math.cos(h + kn)) * Math.cos(j[`leg${sd}`].rotation.x);
    };
    const groundY = Math.max(reach('R'), reach('L')) + SOLE;
    const bounce = runW * moveW * 0.035 * Math.abs(Math.sin(this.phase * 2));
    const pelvisY = lerp(groundY + bounce, HIP_Y, air);
    j.pelvis.position.y += (pelvisY - j.pelvis.position.y) * Math.min(1, dt * 30);
    j.pelvis.position.z = shift;
    this.go(j.pelvis, 'y', -s * 0.08 * moveW, k);

    // Upper body: forward lean at a run, shoulders counter-rotate, breathing, head stays level.
    const lean = -(0.05 * moveW + 0.17 * runW * moveW) - 0.06 * air;
    this.go(j.spine, 'z', lean, k);
    this.go(j.spine, 'y', s * 0.14 * moveW, k);
    this.go(j.spine, 'x', -shift * 1.6, k);
    const breath = Math.sin(this.t * (2.1 + runW * 1.6)) * (0.6 + 0.4 * runW + 0.4 * idleW);
    j.chest.scale.set(1 + 0.008 * breath, 1 + 0.01 * breath, 1 + 0.01 * breath);
    this.go(j.neck, 'z', -lean * 0.7, k);
    this.go(j.neck, 'y', Math.sin(this.t * 0.33) * 0.12 * idleW, k);
    this.go(j.neck, 'x', shift * 1.2, k);

    // Arms swing against the legs; elbows pump at a run; out and up in the air.
    const armA = -s * swingA * lerp(0.8, 1.0, runW);
    const elbow = lerp(0.2, 1.35, runW) * moveW + 0.16 * (1 - moveW) + 0.03 * breath;
    for (const side of ['R', 'L'] as const) {
      const sgn = side === 'R' ? 1 : -1;
      const swing = side === 'R' ? armA : -armA;
      this.go(j[`arm${side}`], 'z', lerp(swing + 0.04 * idleW * breath, 0.35, air), k);
      this.go(j[`arm${side}`], 'x', -sgn * lerp(0.09 + 0.05 * runW, 0.5, air), k);
      this.go(j[`elbow${side}`], 'z', lerp(elbow + (side === 'R' ? 0.15 : -0.15) * s * runW, 0.55, air), k);
      j[`arm${side}`].position.y = 0.5 + 0.003 * breath;
    }

    this.gesture.tick(dt);
    applyPose({ armR: j.armR, armL: j.armL, elbowR: j.elbowR, elbowL: j.elbowL, head: j.neck }, this.gesture.active, this.gesture.t, this.gesture.weight);

    // Weapon poses override the arm swing (same poses as the older rig).
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt);
      this.setRot(j.armR, 0, 0.3 + (this.swing / 0.3) * 2.2);
      this.setRot(j.elbowR, 0, 0);
    } else if (this.aim) {
      this.setRot(j.armR, this.aim === 2 ? -0.1 : -0.05, 1.5);
      this.setRot(j.elbowR, 0, 0);
      if (this.aim === 2) {
        this.setRot(j.armL, 0.75, 1.3); // support hand reaches in to the gun
        this.setRot(j.elbowL, 0, 0.5);
      }
    }
  }

  private setRot(o: THREE.Object3D, x: number, z: number): void {
    o.rotation.x = x;
    o.rotation.z = z;
    this.cur.set(`${o.name}.x`, x);
    this.cur.set(`${o.name}.z`, z);
  }
}

/**
 * The player's rig. Bodies, in order of preference for each outfit:
 *  - BLK KNG (the "BLK KNG" outfit, the default): Bayo's character model (blkking.ts), once it has loaded;
 *  - Green Suit (the "Green Suit" outfit): Bayo's second model on the same rig, bottle prop hidden;
 *  - the code-built hero (the Signature look, and the stand-in for BLK KNG while the model loads or if it fails);
 *  - the older HumanRig for every other wardrobe outfit, and as the last fallback (also with ?classic).
 * Same API as all of them.
 */
type Body = HeroRig | HumanRig | BlkKingRig;
export class PlayerRig {
  readonly root = new THREE.Group();
  aim: 0 | 1 | 2 = 0;
  swing = 0;
  seated = false;
  /** Cutscene gesture for whichever body is showing. */
  pose: Pose = 'none';
  hero: HeroRig | null = null;
  /** BLK KNG, once the model has loaded. */
  blk: BlkKingRig | null = null;
  /** Green Suit, once his model has loaded. */
  green: BlkKingRig | null = null;
  greenError: string | null = null;
  readonly basic: HumanRig;
  /** Which body is showing. */
  mode: 'blkking' | 'greensuit' | 'hero' | 'basic' = 'basic';
  /** Set if building the hero threw; the older rig is used from then on. */
  heroError: string | null = null;
  /** Set if the BLK KNG model failed to load or build. */
  blkError: string | null = null;
  private held: THREE.Object3D | null = null;
  /** Crews: the bandana colour you wear once you've joined one (null for none). */
  bandana: string | null = null;
  private bandanaMesh: THREE.Object3D | null = null;
  private forceBasic: boolean;
  private look: HumanLook;

  constructor(look: HumanLook) {
    this.forceBasic = typeof location !== 'undefined' && new URLSearchParams(location.search).has('classic');
    this.look = look;
    this.basic = new HumanRig(this.basicLook(look));
    this.root.add(this.basic.root);
    this.dress(look);
  }

  /** Hand over the loaded BLK KNG model (or the error if it could not load). */
  attachModel(scene: THREE.Group | null, error?: unknown): void {
    if (!scene) {
      this.blkError = String((error as Error)?.message ?? error ?? 'not loaded');
      return;
    }
    try {
      this.blk = new BlkKingRig(scene);
      this.blk.root.visible = false;
      this.root.add(this.blk.root);
    } catch (e) {
      this.blkError = String((e as Error)?.message ?? e);
      console.warn('BLK KNG model could not be used; keeping the code-built character.', e);
    }
    this.dress(this.look);
  }

  /** Hand over the loaded Green Suit model (or the error if it could not load). */
  attachGreen(scene: THREE.Group | null, error?: unknown): void {
    if (!scene) {
      this.greenError = String((error as Error)?.message ?? error ?? 'not loaded');
      return;
    }
    try {
      this.green = new BlkKingRig(scene, { name: 'green-suit', hideProp: true });
      this.green.root.visible = false;
      this.root.add(this.green.root);
    } catch (e) {
      this.greenError = String((e as Error)?.message ?? e);
      console.warn('Green Suit model could not be used; using the nearest wardrobe look.', e);
    }
    this.dress(this.look);
  }

  /** The older rig can't draw the signature outfit exactly; it gets the nearest look it has. */
  private basicLook(look: HumanLook): HumanLook {
    if (look.top === 'blkking') return { ...look, top: 'tee', shirt: '#1f2a5a', pants: '#141414', pattern: false, stripe: false };
    if (look.top === 'greensuit') return { ...look, top: 'jacket', shirt: '#2f6b3a', pants: '#2f6b3a', pattern: false, stripe: false };
    return look.top === 'signature' ? { ...look, top: 'hoodie', shirt: HERO_COLOURS.hoodie, pattern: false, stripe: false, cargo: true } : look;
  }

  dress(look: HumanLook): void {
    this.look = look;
    let want: PlayerRig['mode'] = this.forceBasic ? 'basic' : look.top === 'blkking' ? (this.blk ? 'blkking' : 'hero') : look.top === 'greensuit' ? (this.green ? 'greensuit' : 'basic') : look.top === 'signature' ? 'hero' : 'basic';
    if (want === 'hero' && this.heroError) want = 'basic';
    if (want === 'hero') {
      const heroLook: HumanLook = look.top === 'blkking' ? { ...look, top: 'signature' } : look;
      try {
        if (!this.hero) {
          this.hero = new HeroRig(heroLook);
          this.hero.root.visible = false;
          this.root.add(this.hero.root);
        } else this.hero.dress(heroLook);
      } catch (e) {
        this.heroError = String((e as Error)?.message ?? e);
        console.warn('Hero character failed to build; using the placeholder rig.', e);
        this.hero?.root.removeFromParent();
        this.hero = null;
        want = 'basic';
      }
    }
    if (want === 'basic') this.basic.dress(this.basicLook(look));
    this.mode = want;
    this.basic.root.visible = want === 'basic';
    if (this.hero) this.hero.root.visible = want === 'hero';
    if (this.blk) this.blk.root.visible = want === 'blkking';
    if (this.green) this.green.root.visible = want === 'greensuit';
    this.hold(this.held);
    if (this.bandana) this.fitBandana();
  }

  private get active(): Body {
    return this.mode === 'blkking' && this.blk ? this.blk : this.mode === 'greensuit' && this.green ? this.green : this.mode === 'hero' && this.hero ? this.hero : this.basic;
  }

  /** Wear (or take off) a crew bandana; it follows whichever body is showing. */
  setBandana(colour: string | null): void {
    this.bandana = colour;
    this.fitBandana();
  }

  /** The head joint of the body that's showing. */
  get headJoint(): THREE.Object3D | null {
    const a = this.active;
    if (a === this.blk || a === this.green) return (a as BlkKingRig).joints.head ?? null;
    if (a === this.hero) return (a as HeroRig).joints.head;
    return (a as HumanRig).headBone;
  }

  private fitBandana(): void {
    this.bandanaMesh?.removeFromParent();
    this.bandanaMesh = null;
    const head = this.headJoint;
    if (!this.bandana || !head) return;
    // Size it to the head: the head's box in the joint's own space (hair included), measured at rest.
    const band = makeBandana(this.bandana);
    const holder = new THREE.Group();
    holder.name = 'bandana-holder';
    holder.add(band);
    head.updateWorldMatrix(true, true);
    const inv = head.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    head.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      box.union(tmp);
    });
    const model = this.active === this.blk || this.active === this.green;
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      // Model rigs face +Z in joint space and scale their heads in model units; the code rigs face +X.
      const r = (model ? Math.max(size.x, size.z) : Math.max(size.y, size.z)) / 2;
      const k = r / 0.118;
      holder.position.set(c.x, box.min.y + size.y * 0.55 - 0.085 * k, c.z);
      holder.scale.setScalar(k * 1.02);
    }
    if (model) holder.rotation.y = -Math.PI / 2; // the bandana's +X (face) to the model's +Z
    head.add(holder);
    this.bandanaMesh = holder;
  }

  hold(obj: THREE.Object3D | null): void {
    this.held = obj;
    // Only the showing body holds it (hold() on the others just empties their hands).
    const a = this.active;
    for (const b of [this.basic, this.hero, this.blk, this.green]) if (b && b !== a) b.hold(null);
    a.hold(obj);
  }

  animate(dt: number, speed: number, airborne = false): void {
    const a = this.active;
    a.aim = this.aim;
    a.seated = this.seated;
    a.gesture.pose = this.pose;
    if (this.swing > 0) {
      a.swing = this.swing;
      this.swing = 0;
    }
    a.animate(dt, speed, airborne);
  }
}
