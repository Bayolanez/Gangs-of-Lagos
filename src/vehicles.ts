import * as THREE from 'three';
import { CollisionWorld } from './collision';
import { mat, part } from './placeholders';
import { DESIGN_SPECS, DESIGNS, DesignKind, VehicleDesign } from './vehicledefs';

/**
 * Vehicles (Milestone 2). One arcade model shared by every vehicle, tuned per type.
 * Ported from the Milestone 1 car: steering needs speed, calms near top speed and flips in reverse;
 * the footprint is a row of circles that slide along walls. Adds health, damage smoke and wrecking.
 * PLACEHOLDER bodies: original, generic shapes built from boxes and cylinders.
 */
export type VehicleKind = 'hatchback' | 'danfo' | 'sedan' | 'keke' | 'brt' | DesignKind;

export interface VehicleSpec {
  name: string;
  len: number;
  wid: number;
  maxSpeed: number;
  maxReverse: number;
  accel: number;
  brake: number;
  rolling: number;
  steerDeg: number;
  circles: number[];
  circleR: number;
  health: number;
  camDist: number;
  camHeight: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  hatchback: { name: 'Hatchback', len: 4.4, wid: 1.85, maxSpeed: 30, maxReverse: 9, accel: 9.5, brake: 26, rolling: 4.5, steerDeg: 80, circles: [-1.4, 0, 1.4], circleR: 0.95, health: 100, camDist: 7.5, camHeight: 1.7 },
  danfo: { name: 'Danfo minibus', len: 4.8, wid: 2.0, maxSpeed: 22, maxReverse: 7, accel: 6.5, brake: 20, rolling: 4, steerDeg: 62, circles: [-1.6, 0, 1.6], circleR: 1.05, health: 140, camDist: 9.5, camHeight: 2.6 },
  sedan: { name: 'Saloon car', len: 4.6, wid: 1.85, maxSpeed: 24, maxReverse: 8, accel: 8, brake: 24, rolling: 4.5, steerDeg: 70, circles: [-1.5, 0, 1.5], circleR: 0.95, health: 100, camDist: 7.5, camHeight: 1.7 },
  brt: { name: 'BRT bus', len: 11, wid: 2.5, maxSpeed: 18, maxReverse: 4, accel: 4, brake: 14, rolling: 3, steerDeg: 40, circles: [-4, -1.35, 1.35, 4], circleR: 1.3, health: 300, camDist: 14, camHeight: 3.5 },
  keke: { name: 'Keke', len: 2.8, wid: 1.3, maxSpeed: 14, maxReverse: 5, accel: 6, brake: 18, rolling: 4, steerDeg: 90, circles: [-0.7, 0.7], circleR: 0.7, health: 60, camDist: 6, camHeight: 1.8 },
  // Visual style pass: the design-board vehicles (handling lives in vehicledefs.ts).
  ...DESIGN_SPECS,
};

/** Where the driver sits (local x, y, z) in the older vehicles; the new designs carry their own. */
const SEATS: Partial<Record<VehicleKind, [number, number, number]>> = { hatchback: [-0.15, 0.38, -0.4], sedan: [-0.15, 0.38, -0.4], danfo: [1.45, 0.55, -0.45], keke: [0.4, 0.45, 0], brt: [4.6, 1.1, -0.7] };

/** Tinted glass you can see the driver through (all vehicles). */
const GLASS = new THREE.MeshStandardMaterial({ color: '#2a4a5c', roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.38 });

/** Paint jobs for your own hatchback. price null = earned, not bought. */
export interface PaintDef {
  name: string;
  color: string;
  stripes?: boolean;
  metal?: number;
  price: number | null;
  earnedBy?: string;
}
export const PAINTS: Record<string, PaintDef> = {
  green: { name: 'Harbour green', color: '#1e6b4a', price: 0 },
  blue: { name: 'Lagoon blue', color: '#1f5f8b', price: 2500 },
  red: { name: 'Pepper red', color: '#b3261e', price: 2500 },
  danfo: { name: 'Danfo yellow', color: '#f2c21a', stripes: true, price: null, earnedBy: 'Win the Harbour Bend Sprint' },
  gold: { name: 'Eko gold', color: '#c9a227', metal: 0.85, price: null, earnedBy: 'Finish every Harbour Bend job' },
};

export interface DriveInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** Optional owner so the caller can tell what was hit. */
  ref?: unknown;
}

export interface ImpactInfo {
  speed: number;
  hit: unknown;
}

let nextId = 1;
const BODY_CACHE = new Map<string, THREE.BufferGeometry>();
const PANE_GEO = new THREE.BoxGeometry(1, 1, 1);
const TYRE_GEO = new THREE.TorusGeometry(0.72, 0.28, 10, 20);
const RIM_GEO = new THREE.CylinderGeometry(1, 1, 1, 16);
const LAMP_GEO = new THREE.SphereGeometry(1, 12, 8);
const BUMPER_GEO = new THREE.CapsuleGeometry(1, 1, 4, 10);

export class Vehicle {
  readonly id = nextId++;
  readonly spec: VehicleSpec;
  x: number;
  z: number;
  heading: number;
  speed = 0;
  health: number;
  wrecked = false;
  hasDriver = false;
  frozen = false;
  /** Phase 5: a pothole burst a tyre. Slower and pulls to one side until repaired or towed. */
  tyreBurst = false;
  /** Phase 5: a top speed imposed by the road (crowded market roads), in m/s; null for none. */
  speedCap: number | null = null;
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private paintMat: THREE.MeshStandardMaterial;
  private stripes: THREE.Mesh[] = [];
  private brakeMat: THREE.MeshStandardMaterial;
  /** Front-wheel steering pivots, the visible steering angle, indicator lamps and the wheel radius. */
  private steerPivots: THREE.Object3D[] = [];
  private steerVis = 0;
  private lastHeading = 0;
  private indicatorL: THREE.MeshStandardMaterial;
  private indicatorR: THREE.MeshStandardMaterial;
  private blink = 0;
  private wheelR = 0.34;
  /** Driver's seat in local coordinates (x forward, y up, z right). */
  readonly seat: [number, number, number];
  private smoke: THREE.Mesh[] = [];
  private smokeT = 0;
  /** Flames shown while the vehicle burns out (created on first use). */
  private flames: THREE.Mesh[] = [];
  burning = false;
  private lastImpact = -10;

  constructor(readonly kind: VehicleKind, x: number, z: number, heading: number, color?: string) {
    this.spec = SPECS[kind];
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.health = this.spec.health;
    this.paintMat = new THREE.MeshStandardMaterial({ color: color ?? '#1e6b4a', roughness: 0.35, metalness: 0.4 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: '#7a0c08', emissive: '#ff2a1a', emissiveIntensity: 0.2 });
    this.indicatorL = new THREE.MeshStandardMaterial({ color: '#8a5a10', emissive: '#ffa21a', emissiveIntensity: 0.1 });
    this.indicatorR = this.indicatorL.clone();
    this.lastHeading = heading;
    this.seat = kind in DESIGNS ? DESIGNS[kind as DesignKind].driver : SEATS[kind] ?? [0, 0.4, -0.4];
    if (kind in DESIGNS) {
      this.buildDesign(DESIGNS[kind as DesignKind], color);
    } else switch (kind) {
      case 'hatchback': this.buildHatchback(); break;
      case 'danfo': this.buildDanfo(); break;
      case 'sedan': this.buildSedan(); break;
      case 'keke': this.buildKeke(); break;
      case 'brt': this.buildBrt(); break;
    }
    const smokeMat = new THREE.MeshBasicMaterial({ color: '#2a2826', transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), smokeMat.clone());
      s.visible = false;
      this.group.add(s);
      this.smoke.push(s);
    }
    this.cleanPaint = this.paintMat.color.clone();
    this.sync();
  }

  /** The paint colour before any fire blackened it (restored by repair). */
  private cleanPaint: THREE.Color | null = null;

  // ---------- Bodies (PLACEHOLDER art: procedural, original shapes) ----------
  /**
   * Extrude a side profile ([x, y] points, x forward) across the vehicle's width with rounded edges.
   * Geometry is cached per vehicle kind so traffic cars share it.
   */
  private extrude(key: string, profile: [number, number][] | THREE.Shape, width: number, m: THREE.Material, bevel = 0.08, z = 0): THREE.Mesh {
    const ck = `${this.kind}|${key}`;
    let g = BODY_CACHE.get(ck);
    if (!g) {
      const shape = profile instanceof THREE.Shape ? profile : new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
      const depth = Math.max(0.01, width - 2 * bevel);
      g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
      g.translate(0, 0, -depth / 2);
      g.computeVertexNormals();
      BODY_CACHE.set(ck, g);
    }
    const mesh = new THREE.Mesh(g, m);
    mesh.position.z = z;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Side profile with wheel arches cut into the sill: bottom edge from back to front, then `top` points front to back. */
  private profile(back: number, front: number, sill: number, arches: [number, number][], top: [number, number][]): THREE.Shape {
    const sh = new THREE.Shape();
    sh.moveTo(back, sill);
    for (const [cx, r] of arches) {
      sh.lineTo(cx - r, sill);
      sh.absarc(cx, sill, r, Math.PI, 0, true); // arch over the wheel
    }
    sh.lineTo(front, sill);
    for (const [x, y] of top) sh.lineTo(x, y);
    sh.lineTo(back, sill);
    return sh;
  }

  /** A glass pane between two points of the side profile (windscreens and rear windows). */
  private pane(x1: number, y1: number, x2: number, y2: number, width: number, glass: THREE.Material): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const m = new THREE.Mesh(PANE_GEO, glass);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    m.scale.set(len, 0.025, width);
    this.group.add(m);
  }

  private wheel(x: number, z: number, r: number, w: number, front = x > 0, rimColour = '#a9adb1', spokes = 0): void {
    const pivot = new THREE.Group();
    this.wheelR = r;
    // Front wheels sit in a steering knuckle that turns about the vertical axis.
    const knuckle = new THREE.Group();
    knuckle.position.set(x, r, z);
    this.group.add(knuckle);
    if (front && this.kind !== 'keke') this.steerPivots.push(knuckle);
    const tyre = new THREE.Mesh(TYRE_GEO, mat('#141414', 0.9));
    tyre.scale.set(r, r, w * 2.4);
    tyre.castShadow = true;
    pivot.add(tyre);
    const rim = new THREE.Mesh(RIM_GEO, mat(rimColour, 0.35, 0.7));
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(r * 0.62, w * 0.9, r * 0.62);
    pivot.add(rim);
    const hub = new THREE.Mesh(RIM_GEO, mat('#5d6166', 0.4, 0.6));
    hub.rotation.x = Math.PI / 2;
    hub.scale.set(r * 0.2, w * 1.02, r * 0.2);
    pivot.add(hub);
    // Spokes on the outer face so the wheel visibly turns.
    const face = Math.sign(z || 1) * w * 0.47;
    for (let i = 0; i < spokes; i++) {
      const sp = new THREE.Mesh(PANE_GEO, mat('#c8a26a', 0.3, 0.8));
      const a = (i / spokes) * Math.PI * 2;
      sp.position.set(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, face);
      sp.rotation.z = a;
      sp.scale.set(r * 0.58, r * 0.1, 0.03);
      pivot.add(sp);
    }
    knuckle.add(pivot);
    this.wheels.push(pivot);
  }

  /** Rounded head and tail lamps, bumpers and mirrors. */
  private lights(front: number, back: number, y: number, spread: number, bumperY = y - 0.3, width = spread * 2 + 0.5): void {
    const head = mat('#fff3c4', 0.2);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(LAMP_GEO, head);
      h.position.set(front, y, s * spread);
      h.scale.set(0.05, 0.08, 0.15);
      this.group.add(h);
      const t = new THREE.Mesh(LAMP_GEO, this.brakeMat);
      t.position.set(back, y, s * spread);
      t.scale.set(0.05, 0.07, 0.13);
      this.group.add(t);
    }
    for (const x of [front, back]) {
      const bump = new THREE.Mesh(BUMPER_GEO, mat('#202224', 0.6));
      bump.position.set(x + Math.sign(x) * 0.02, bumperY, 0);
      bump.rotation.x = Math.PI / 2;
      bump.scale.set(0.09, (width - 0.1) / 3, 0.09); // capsule is 3 units tall
      bump.castShadow = true;
      this.group.add(bump);
    }
  }

  private mirrors(x: number, y: number, half: number): void {
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(LAMP_GEO, mat('#1d1f22', 0.5));
      m.position.set(x, y, s * (half + 0.1));
      m.scale.set(0.06, 0.07, 0.1);
      this.group.add(m);
    }
  }

  private buildHatchback(): void {
    const glass = GLASS;
    const W = 1.72;
    const body = this.profile(-2.1, 2.08, 0.3, [[-1.3, 0.42], [1.3, 0.42]],
      [[2.15, 0.52], [2.08, 0.8], [1.0, 0.92], [0.2, 1.36], [-1.5, 1.4], [-1.98, 1.12], [-2.12, 0.78]]);
    this.extrude('body', body, W, this.paintMat, 0.09);
    this.extrude('glass', [[0.86, 0.97], [0.2, 1.33], [-1.46, 1.36], [-1.88, 1.1], [-1.86, 0.97]], W + 0.03, glass, 0.01);
    this.pane(1.03, 0.94, 0.23, 1.39, W * 0.86, glass);
    this.pane(-1.53, 1.43, -2.01, 1.14, W * 0.86, glass);
    for (const s of [-1, 1]) {
      this.stripes.push(part(this.group, 'box', '#111111', [0, 0.72, s * (W / 2 + 0.035)], [3.6, 0.09, 0.012], [0, 0, 0], false));
      this.stripes.push(part(this.group, 'box', '#111111', [0, 0.55, s * (W / 2 + 0.035)], [3.6, 0.09, 0.012], [0, 0, 0], false));
      for (const ax of [-1.3, 1.3]) this.wheel(ax, s * 0.8, 0.34, 0.22);
    }
    this.lights(2.18, -2.16, 0.74, 0.62, 0.42, W);
    this.mirrors(0.85, 0.98, W / 2);
    this.setPaint('green');
  }

  private buildDanfo(): void {
    const glass = GLASS;
    this.paintMat.color.set('#f2c21a');
    const W = 1.92;
    const body = this.profile(-2.36, 2.4, 0.34, [[-1.45, 0.46], [1.45, 0.46]],
      [[2.46, 0.6], [2.44, 1.12], [2.22, 1.4], [2.02, 2.18], [1.7, 2.3], [-2.2, 2.32], [-2.36, 2.1]]);
    this.extrude('body', body, W, this.paintMat, 0.08);
    this.extrude('glass', [[1.9, 1.55], [1.72, 2.12], [-2.15, 2.12], [-2.15, 1.55]], W + 0.03, glass, 0.01);
    this.pane(2.27, 1.42, 2.06, 2.14, W * 0.88, glass);
    for (const s of [-1, 1]) {
      part(this.group, 'box', '#111111', [0, 1.02, s * (W / 2 + 0.03)], [4.5, 0.11, 0.012], [0, 0, 0], false);
      part(this.group, 'box', '#111111', [0, 1.24, s * (W / 2 + 0.03)], [4.5, 0.11, 0.012], [0, 0, 0], false);
      for (const ax of [-1.45, 1.45]) this.wheel(ax, s * 0.86, 0.36, 0.24);
    }
    part(this.group, 'box', '#3a2a10', [-0.3, 1.05, -(W / 2 + 0.025)], [1.0, 1.35, 0.012], [0, 0, 0], false); // sliding door seam
    // Roof rack: round rails
    for (const z of [0.78, -0.78]) {
      const rail = new THREE.Mesh(BUMPER_GEO, mat('#2b2b2b', 0.6));
      rail.position.set(-0.2, 2.45, z);
      rail.rotation.z = Math.PI / 2;
      rail.scale.set(0.035, 3.4 / 3, 0.035);
      this.group.add(rail);
    }
    this.lights(2.47, -2.39, 0.86, 0.72, 0.45, W);
    this.mirrors(2.0, 1.5, W / 2);
  }

  private buildSedan(): void {
    const glass = GLASS;
    const W = 1.74;
    const body = this.profile(-2.22, 2.2, 0.3, [[-1.4, 0.42], [1.4, 0.42]],
      [[2.28, 0.5], [2.2, 0.8], [1.05, 0.9], [0.35, 1.34], [-0.78, 1.36], [-1.45, 0.98], [-2.18, 0.92], [-2.27, 0.52]]);
    this.extrude('body', body, W, this.paintMat, 0.09);
    this.extrude('glass', [[0.92, 0.95], [0.33, 1.3], [-0.74, 1.32], [-1.32, 0.97]], W + 0.03, glass, 0.01);
    this.pane(1.09, 0.93, 0.36, 1.37, W * 0.86, glass);
    this.pane(-0.8, 1.39, -1.48, 1.0, W * 0.86, glass);
    for (const s of [-1, 1]) for (const ax of [-1.4, 1.4]) this.wheel(ax, s * 0.8, 0.34, 0.22);
    this.lights(2.3, -2.28, 0.7, 0.62, 0.42, W);
    this.mirrors(0.95, 0.98, W / 2);
  }

  private buildKeke(): void {
    // Open-sided tricycle: a rounded tub, a cowl round the front wheel, pillars and a canopy roof.
    this.extrude('tub', [[-1.2, 0.36], [0.95, 0.36], [1.32, 0.68], [1.22, 1.08], [0.88, 1.12], [0.62, 0.9], [-1.26, 0.95]], 1.22, this.paintMat, 0.08);
    this.extrude('roof', [[-1.32, 1.72], [0.8, 1.72], [0.98, 1.78], [0.82, 1.85], [-1.32, 1.84]], 1.32, mat('#151515', 0.7), 0.04);
    this.pane(0.88, 1.15, 0.8, 1.7, 1.0, mat('#1b252c', 0.12, 0.6));
    for (const x of [-1.24, 0.8]) {
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(BUMPER_GEO, mat('#222222', 0.6));
        p.position.set(x, 1.33, s * 0.58);
        p.scale.set(0.03, 0.8 / 3, 0.03);
        this.group.add(p);
      }
    }
    this.wheel(-0.85, 0.6, 0.28, 0.18);
    this.wheel(-0.85, -0.6, 0.28, 0.18);
    this.wheel(1.15, 0.01, 0.28, 0.18);
    this.lights(1.33, -1.28, 0.92, 0.38, 0.5, 1.2);
  }

  /** PLACEHOLDER BRT bus (Phase 5): long two-tone body, original colours and no operator branding. */
  private buildBrt(): void {
    const glass = GLASS;
    this.paintMat.color.set('#1f5f8b');
    const W = 2.42;
    const body = this.profile(-5.42, 5.42, 0.36, [[-3.6, 0.6], [3.4, 0.6]],
      [[5.48, 0.6], [5.5, 2.55], [5.3, 3.0], [-5.32, 3.02], [-5.45, 2.8]]);
    this.extrude('body', body, W, this.paintMat, 0.1);
    this.extrude('skirt', [[-5.45, 0.42], [5.48, 0.42], [5.5, 1.0], [-5.47, 1.0]], W + 0.02, mat('#e9e8e2', 0.7), 0.02);
    this.extrude('glass', [[5.0, 1.6], [4.9, 2.7], [-5.1, 2.7], [-5.1, 1.6]], W + 0.03, glass, 0.01);
    this.pane(5.52, 1.5, 5.4, 2.75, W * 0.9, glass);
    for (const s of [-1, 1]) for (const ax of [-3.6, 3.4]) this.wheel(ax, s * 1.08, 0.5, 0.3);
    this.lights(5.55, -5.5, 1.0, 0.95, 0.5, W);
    this.mirrors(5.3, 2.3, W / 2);
  }

  /**
   * Design-board vehicles (visual style pass): built from the data in vehicledefs.ts. Lower body with
   * wheel arches, a glasshouse in paint or roof colour, see-through side glass with pillars, door seams
   * and handles, an accent stripe, bumpers and grille, head/tail/brake lamps and indicators, mirrors,
   * seats and a dashboard inside, and spoked wheels whose fronts steer. Original shapes, no badges.
   */
  private buildDesign(d: VehicleDesign, colour?: string): void {
    const W = d.width;
    const [fa, ra] = d.axles;
    const front = d.body[0][0], back = d.body[d.body.length - 1][0];
    this.paintMat.color.set(colour ?? d.paint);
    this.paintMat.roughness = 0.32;
    this.paintMat.metalness = 0.35;
    const trim = mat(d.trim, 0.6);
    const box = (m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0, shadow = false) => {
      const b = new THREE.Mesh(PANE_GEO, m);
      b.position.set(x, y, z);
      b.rotation.z = rz;
      b.scale.set(sx, sy, sz);
      b.castShadow = shadow;
      this.group.add(b);
      return b;
    };
    // Body and glasshouse
    const lower = this.profile(back, front, d.sill, [[ra, d.wheelR + 0.08], [fa, d.wheelR + 0.08]], d.body);
    this.extrude('body', lower, W, this.paintMat, 0.08);
    const upperMat = d.upper ? mat(d.upper, 0.4, 0.15) : d.roof ? mat(d.roof, 0.35, 0.3) : this.paintMat;
    const cabinW = d.upper ? W : W - 0.14;
    if (d.upper) this.extrude('cabin', d.cabin, cabinW, upperMat, 0.08);
    else {
      // Hollow glasshouse so the driver and seats show through the glass: roof panel and pillars.
      const [p0, p1, p2, p3] = d.cabin;
      const strip = (a: [number, number], b: [number, number], z: number, thick: number, wide: number) => {
        const m = new THREE.Mesh(PANE_GEO, upperMat);
        m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
        m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
        m.scale.set(Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.04, thick, wide);
        m.castShadow = true;
        this.group.add(m);
      };
      strip(p1, p2, 0, 0.07, cabinW); // roof
      for (const sz of [-1, 1]) {
        strip(p0, p1, sz * (cabinW / 2 - 0.04), 0.1, 0.08); // A-pillars
        strip(p2, p3, sz * (cabinW / 2 - 0.06), 0.24, 0.12); // C-pillars
        strip(p1, p2, sz * (cabinW / 2 - 0.02), 0.06, 0.06); // roof rails over the doors
      }
    }
    // Lower cladding round the arches (crossover) in the trim colour.
    if (d.roofRack) this.extrude('clad', this.profile(back - 0.02, front + 0.02, d.sill - 0.02, [[ra, d.wheelR + 0.1], [fa, d.wheelR + 0.1]], [[front + 0.02, 0.62], [back - 0.02, 0.62]]), W + 0.04, trim, 0.03);
    if (d.upper) this.extrude('windows', d.windows, cabinW + 0.04, GLASS, 0.01);
    else for (const sz of [-1, 1]) this.extrude('sideglass', d.windows, 0.02, GLASS, 0, sz * (cabinW / 2 - 0.01));
    this.pane(d.screen[0], d.screen[1], d.screen[2], d.screen[3], W * 0.84, GLASS);
    this.pane(d.rear[0], d.rear[1], d.rear[2], d.rear[3], W * 0.84, GLASS);
    const wy = d.windows.map((p) => p[1]);
    const wy0 = Math.min(...wy), wy1 = Math.max(...wy);
    for (const px of d.pillars) box(upperMat, px, (wy0 + wy1) / 2, 0, 0.12, wy1 - wy0, cabinW + 0.06);
    // Door seams and handles
    const sideZ = W / 2 + 0.004;
    const seam = mat('#0e0f12', 0.7);
    for (const s of [-1, 1]) {
      for (const dx of d.doors) box(seam, dx, (d.doorY[0] + d.doorY[1]) / 2, s * sideZ, 0.018, d.doorY[1] - d.doorY[0], 0.008);
      for (let i = 0; i + 1 < d.doors.length; i++) box(trim, d.doors[i] - 0.28, d.doorY[1] - 0.16, s * (sideZ + 0.01), 0.16, 0.035, 0.02);
      if (d.sliding) box(seam, (d.doors[1] + back) / 2, 1.5, s * sideZ, d.doors[1] - back - 0.4, 0.03, 0.01); // sliding-door rail
      // Accent stripe
      const [x0, y0, x1, y1] = d.stripe;
      box(mat(d.accent, 0.4), (x0 + x1) / 2, (y0 + y1) / 2, s * (sideZ + 0.003), Math.hypot(x1 - x0, y1 - y0), 0.065, 0.01, Math.atan2(y1 - y0, x1 - x0));
      if (d.glowAccent) {
        const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.glowAccent).multiplyScalar(1.6) });
        box(glowM, 0, d.sill + 0.05, s * (sideZ + 0.006), (fa - ra) - 1.0, 0.025, 0.01);
      }
      // Mirrors on short stalks
      box(this.paintMat, d.screen[0] - 0.08, d.screen[1] + 0.06, s * (W / 2 + 0.13), 0.14, 0.1, 0.2, 0, true);
      box(trim, d.screen[0] - 0.02, d.screen[1] + 0.02, s * (W / 2 + 0.03), 0.06, 0.04, 0.12);
    }
    // Lamps: headlights (restrained glow), tail and brake lights, indicators front and back.
    const [lf, lr, ly] = d.lamps;
    const head = new THREE.MeshStandardMaterial({ color: '#f6eccc', emissive: '#ffe2a8', emissiveIntensity: 0.55, roughness: 0.2 });
    for (const s of [-1, 1]) {
      box(head, lf, ly, s * (W / 2 - 0.3), 0.08, d.upper ? 0.16 : 0.1, d.upper ? 0.3 : 0.4);
      box(this.brakeMat, lr, ly + 0.04, s * (W / 2 - 0.26), 0.06, d.upper ? 0.26 : 0.12, d.upper ? 0.16 : 0.4);
      const ind = s < 0 ? this.indicatorL : this.indicatorR;
      box(ind, lf - 0.02, ly - 0.14, s * (W / 2 - 0.1), 0.06, 0.06, 0.14);
      box(ind, lr + 0.01, ly - 0.08, s * (W / 2 - 0.08), 0.05, 0.06, 0.12);
    }
    // Bumpers, grille and (crossover) skid plate
    const bumperY = d.sill + 0.1;
    box(trim, front - 0.05, bumperY, 0, 0.24, 0.22, W + 0.02, 0, true);
    box(trim, back + 0.05, bumperY, 0, 0.24, 0.22, W + 0.02, 0, true);
    const gH = d.upper ? 0.32 : 0.16, gW = d.upper ? W * 0.55 : W * 0.42;
    box(mat('#121316', 0.5), front + 0.01, ly - 0.12, 0, 0.05, gH, gW);
    for (let i = 0; i < (d.slats ?? 3); i++) {
      const n = d.slats ?? 3;
      if (d.slats) box(trim, front + 0.04, ly - 0.12, -gW / 2 + (gW * (i + 0.5)) / n, 0.03, gH, 0.04);
      else box(mat('#3a3d42', 0.4, 0.5), front + 0.04, ly - 0.12 - gH / 2 + (gH * (i + 0.5)) / n, 0, 0.02, 0.025, gW);
    }
    if (d.roofRack) box(mat('#a9adb1', 0.35, 0.6), front - 0.02, d.sill + 0.02, 0, 0.2, 0.08, W * 0.5);
    if (d.glowAccent) box(new THREE.MeshBasicMaterial({ color: new THREE.Color(d.glowAccent).multiplyScalar(1.6) }), front + 0.04, d.sill + 0.02, 0, 0.02, 0.025, W * 0.8);
    // Inside: seats, dashboard, steering wheel (seen through the glass)
    const seatM = mat('#2a2a30', 0.8);
    for (const sx of d.seats) {
      for (const sz of d.seats.length > 2 && sx < d.seats[0] ? [-0.5, 0, 0.5] : [-0.42, 0.42]) {
        box(seatM, sx, d.seatY, sz, 0.46, 0.12, 0.44);
        box(seatM, sx - 0.24, d.seatY + 0.3, sz, 0.1, 0.52, 0.44, 0.12);
      }
    }
    box(mat('#1d1e22', 0.7), d.screen[0] - 0.22, d.screen[1] - 0.06, 0, 0.32, 0.12, W - 0.3);
    const wheelM = new THREE.Mesh(TYRE_GEO, mat('#141414', 0.6));
    wheelM.position.set(d.driver[0] + 0.48, d.seatY + 0.42, d.driver[2]);
    wheelM.rotation.y = Math.PI / 2;
    wheelM.rotation.x = 0.4;
    wheelM.scale.setScalar(0.17);
    this.group.add(wheelM);
    // Roof rack (crossover)
    if (d.roofRack) {
      const top = Math.max(...d.cabin.map((p) => p[1]));
      const x0 = d.cabin[1][0] - 0.2, x1 = d.cabin[2][0] + 0.15;
      const rack = mat('#18191c', 0.6);
      for (const z of [-0.72, 0.72]) {
        box(rack, (x0 + x1) / 2, top + 0.13, z, x0 - x1, 0.05, 0.05);
        for (const x of [x0 - 0.1, x1 + 0.1]) box(rack, x, top + 0.06, z, 0.06, 0.12, 0.06);
      }
      for (let i = 0; i < 4; i++) box(rack, x1 + ((x0 - x1) * (i + 0.5)) / 4, top + 0.15, 0, 0.05, 0.04, 1.5);
    }
    // Wheels: spoked alloys, steel wheels on the minibus.
    for (const s of [-1, 1]) for (const ax of [fa, ra]) this.wheel(ax, s * d.track, d.wheelR, d.upper ? 0.24 : 0.23, ax > 0, d.rim, d.upper ? 0 : 5);
  }

  // ---------- State ----------
  setPaint(id: string): void {
    const p = PAINTS[id] ?? PAINTS.green;
    this.paintMat.color.set(p.color);
    this.cleanPaint = this.paintMat.color.clone();
    this.paintMat.metalness = p.metal ?? 0.4;
    this.paintMat.roughness = p.metal ? 0.25 : 0.35;
    for (const s of this.stripes) s.visible = !!p.stripes;
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  get healthPct(): number {
    return Math.max(0, this.health / this.spec.health);
  }

  repair(): void {
    this.health = this.spec.health;
    this.wrecked = false;
    this.tyreBurst = false;
    if (this.burning) this.setBurning(false);
    if (this.cleanPaint) this.paintMat.color.copy(this.cleanPaint);
    for (const s of this.smoke) s.visible = false;
  }

  damage(amount: number): void {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) {
      this.wrecked = true;
      this.speed = 0;
    }
  }

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  circles(): Obstacle[] {
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    return this.spec.circles.map((o) => ({ x: this.x + fx * o, z: this.z + fz * o, r: this.spec.circleR, ref: this }));
  }

  contains(px: number, pz: number, pad = 0): boolean {
    const dx = px - this.x, dz = pz - this.z;
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < this.spec.len / 2 + pad && Math.abs(lz) < this.spec.wid / 2 + pad;
  }

  /** Pushes a circle (person) out of this vehicle's footprint. */
  pushOut(p: { x: number; z: number }, radius: number): boolean {
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const dx = p.x - this.x, dz = p.z - this.z;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    const hx = this.spec.len / 2 + radius, hz = this.spec.wid / 2 + radius;
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return false;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = Math.sign(lx || 1) * hx;
    else lz = Math.sign(lz || 1) * hz;
    const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
    p.x = this.x + lx * c2 - lz * s2;
    p.z = this.z + lx * s2 + lz * c2;
    return true;
  }

  /** Physics step for a driven (or coasting) vehicle. Returns the hardest impact this frame, if any. */
  update(dt: number, input: DriveInput | null, world: CollisionWorld, obstacles: Obstacle[], now: number): ImpactInfo | null {
    const sp = this.spec;
    const usable = input && !this.frozen && !this.wrecked;
    const thr = usable ? input.throttle : 0;
    const steer = usable ? input.steer : 0;
    const hb = input ? input.handbrake || this.frozen || this.wrecked : true;

    if (thr > 0) this.speed += (this.speed < 0 ? sp.brake : sp.accel) * thr * dt;
    else if (thr < 0) this.speed += (this.speed > 0 ? sp.brake : sp.accel * 0.6) * thr * dt;
    else this.speed = towards(this.speed, 0, sp.rolling * dt);
    if (hb) this.speed = towards(this.speed, 0, sp.brake * 1.2 * dt);
    // A badly damaged engine loses power.
    let limit = sp.maxSpeed * (this.healthPct < 0.3 ? 0.6 : 1) * (this.tyreBurst ? 0.55 : 1);
    if (this.speedCap !== null) limit = Math.min(limit, this.speedCap);
    this.speed = THREE.MathUtils.clamp(this.speed, -sp.maxReverse, limit);

    const abs = Math.abs(this.speed);
    const grip = Math.min(1, abs / 7) * (1 - 0.45 * Math.min(1, abs / sp.maxSpeed));
    this.heading += steer * THREE.MathUtils.degToRad(sp.steerDeg) * grip * Math.sign(this.speed) * (input?.handbrake ? 1.5 : 1) * dt;
    if (this.tyreBurst) this.heading += 0.06 * grip * Math.sign(this.speed) * dt; // a flat tyre pulls

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    let impact: ImpactInfo | null = null;
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    for (const off of sp.circles) {
      const c = { x: this.x + fx * off, z: this.z + fz * off };
      // Going faster than a jog, the car smashes through street furniture instead of stopping.
      let push = world.resolveCircle(c, sp.circleR, abs > 3);
      if (world.lastSmashed) this.speed *= 0.93;
      let hit: unknown = 'world';
      for (const o of obstacles) {
        if (o.ref === this) continue;
        const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz), min = sp.circleR + o.r;
        if (d < min && d > 1e-4) {
          push = { x: push.x + (dx / d) * (min - d), z: push.z + (dz / d) * (min - d) };
          hit = o.ref ?? 'obstacle';
        }
      }
      if (push.x !== 0 || push.z !== 0) {
        this.x += push.x;
        this.z += push.z;
        const n = Math.hypot(push.x, push.z);
        const along = Math.abs((fx * push.x + fz * push.z) / n);
        if (along > 0.35) {
          // Against another vehicle, what hurts is the closing speed, not your own speed.
          let sev = abs;
          if (hit instanceof Vehicle) {
            const vx = fx * this.speed - Math.cos(hit.heading) * hit.speed, vz = fz * this.speed - Math.sin(hit.heading) * hit.speed;
            sev = Math.hypot(vx, vz);
          }
          if (!impact || sev > impact.speed) impact = { speed: sev, hit };
          this.speed *= abs > 4 ? -0.25 : 0;
        }
      }
    }
    if (impact) {
      if (now - this.lastImpact < 0.25) impact = null;
      else this.lastImpact = now;
    }
    // Cars take a lot more punishment now: only real hits hurt, and less per hit.
    if (impact && impact.speed > 6) this.damage((impact.speed - 6) * 1.25);

    this.brakeMat.emissiveIntensity = (thr < 0 && this.speed > 0.5) || (hb && this.hasDriver) ? 1.6 : 0.2;
    for (const w of this.wheels) w.rotation.z -= (this.speed * dt) / this.wheelR;
    this.animateSteer(steer, dt);
    this.lastHeading = this.heading;
    this.animateSmoke(dt);
    this.sync();
    return impact;
  }

  /** Kinematic move for AI traffic: no physics, just pose, wheels and brake lights. */
  drive(x: number, z: number, heading: number, speed: number, braking: boolean, dt: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = speed;
    this.brakeMat.emissiveIntensity = braking ? 1.6 : 0.2;
    for (const w of this.wheels) w.rotation.z -= (speed * dt) / this.wheelR;
    // Traffic steers its front wheels by how fast it is turning.
    let turn = heading - this.lastHeading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.animateSteer(dt > 0 && Math.abs(speed) > 0.5 ? THREE.MathUtils.clamp((turn / dt) * 1.4, -1, 1) : 0, dt);
    this.lastHeading = heading;
    this.sync();
  }

  /** Set the vehicle on fire (true) or put the fire out (false). */
  setBurning(on: boolean): void {
    this.burning = on;
    if (on && !this.flames.length) {
      const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.25), transparent: true, opacity: 0.9, depthWrite: false });
      const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.5), transparent: true, opacity: 0.85, depthWrite: false });
      const cone = new THREE.ConeGeometry(0.45, 1.6, 8);
      for (let i = 0; i < 7; i++) {
        const f = new THREE.Mesh(cone, i % 2 ? warm : hot);
        f.position.set((i / 6 - 0.5) * this.spec.len * 0.7, 1.2, ((i * 37) % 7) / 7 - 0.5);
        this.group.add(f);
        this.flames.push(f);
      }
    }
    for (const f of this.flames) f.visible = on;
  }

  /** Flicker the flames and blacken the paint while it burns (t: seconds of fire left). */
  animateFire(dt: number, t: number): void {
    this.smokeT += dt;
    this.flames.forEach((f, i) => {
      const k = 0.7 + Math.abs(Math.sin(this.smokeT * (7 + i) + i)) * 0.7 + (t < 1.5 ? (1.5 - t) * 0.6 : 0);
      f.scale.set(k * 0.9, k, k * 0.9);
      f.position.y = 1.1 + k * 0.45;
    });
    this.paintMat.color.lerp(new THREE.Color('#1a1614'), Math.min(1, dt * 0.6));
    this.animateSmoke(dt);
  }

  /** Turn the front wheels towards the steering input and blink the indicator on that side. */
  private animateSteer(steer: number, dt: number): void {
    this.steerVis += (steer * 0.5 - this.steerVis) * Math.min(1, dt * 10);
    for (const k of this.steerPivots) k.rotation.y = -this.steerVis;
    this.blink += dt;
    const on = Math.floor(this.blink * 2.6) % 2 === 0;
    this.indicatorR.emissiveIntensity = this.steerVis > 0.12 && on ? 2.2 : 0.1;
    this.indicatorL.emissiveIntensity = this.steerVis < -0.12 && on ? 2.2 : 0.1;
  }

  /** Visible front-wheel angle in radians (positive = turning right). */
  get steerAngle(): number {
    return this.steerVis;
  }

  /** Rotation of the first wheel about its axle (tests check the wheels turn). */
  get wheelSpin(): number {
    return this.wheels[0]?.rotation.z ?? 0;
  }

  private animateSmoke(dt: number): void {
    const show = this.healthPct < 0.4;
    this.smokeT += dt * (this.wrecked ? 1.6 : 1);
    this.smoke.forEach((s, i) => {
      s.visible = show;
      if (!show) return;
      const t = (this.smokeT * 0.8 + i / this.smoke.length) % 1;
      s.position.set(this.spec.len * 0.38, 1.0 + t * 2.2, (i % 2 ? 0.2 : -0.2) * t);
      s.scale.setScalar(0.6 + t * 1.8);
      (s.material as THREE.MeshBasicMaterial).opacity = (this.wrecked ? 0.7 : 0.45) * (1 - t);
    });
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = -this.heading;
  }
}

function towards(v: number, target: number, step: number): number {
  return v > target ? Math.max(target, v - step) : Math.min(target, v + step);
}
