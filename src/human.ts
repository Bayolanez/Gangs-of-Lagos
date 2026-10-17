import * as THREE from 'three';
import { printTexture } from './outfits';
import { applyPose, Pose, PoseState } from './poses';

/**
 * Procedural person (no boxes): a smooth body built from lathe, capsule and sphere shapes, with
 * shoulders, elbows, hips and knees that bend, hands, shoes, hair and a face (eyes, brows, nose,
 * lips, ears). Faces +X locally; +Z is the person's right. Still PLACEHOLDER art until artist-made
 * glTF characters replace it (Phase 7).
 */
export interface HumanLook {
  shirt: string;
  pants?: string;
  skin?: string;
  headwrap?: string;
  tray?: boolean;
  stripe?: boolean;
  /** Milestone 3 clothing options (player customization). */
  top?: 'tee' | 'kaftan' | 'jacket' | 'hoodie' | 'signature' | 'blkking' | 'greensuit';
  pattern?: boolean;
  hat?: 'fila' | 'cap' | 'bucket' | 'danfo';
  /** Visual style pass: a fixed hat colour (otherwise hats match the shirt) and track pants with a side stripe. */
  hatColour?: string;
  pantsStripe?: boolean;
  /** Cargo trousers: pockets on the thighs. */
  cargo?: boolean;
  /** Crews: a bandana tied round the head in the crew's colour. */
  bandana?: string;
}

/**
 * A bandana tied round a head of about 0.11 m radius centred on the origin (+X is the face): a band
 * across the forehead, a knot at the back and two short tails. Shared by every figure (scale to fit).
 */
export function makeBandana(colour: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bandana';
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), m);
  band.scale.set(0.118, 0.04, 0.114);
  band.position.set(-0.005, 0.085, 0);
  band.rotation.z = 0.12; // lower at the back, like a knot pulled tight
  (band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(band);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m);
  knot.scale.set(0.026, 0.024, 0.03);
  knot.position.set(-0.12, 0.072, 0);
  g.add(knot);
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
    tail.scale.set(0.012, 0.075, 0.03);
    tail.position.set(-0.13, 0.035, s * 0.018);
    tail.rotation.set(s * 0.25, 0, -0.35);
    g.add(tail);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// ---------- Shared geometry and materials (many people share them) ----------

const SEG = 16;
const geo = {
  sphere: new THREE.SphereGeometry(1, SEG, 12),
  capsule: new THREE.CapsuleGeometry(1, 1, 6, SEG),
  cyl: new THREE.CylinderGeometry(1, 1, 1, SEG),
  cone: new THREE.ConeGeometry(1, 1, 10),
  cap: new THREE.SphereGeometry(1, SEG, 8, 0, Math.PI * 2, 0, Math.PI / 2), // dome
  torus: new THREE.TorusGeometry(1, 0.3, 8, SEG),
};

/** Torso shape (hips to shoulders), revolved and later squashed front-to-back. */
function lathe(profile: [number, number][]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
}
const TORSO = lathe([[0.001, 0.0], [0.15, 0.0], [0.17, 0.08], [0.155, 0.2], [0.145, 0.3], [0.17, 0.42], [0.19, 0.5], [0.16, 0.56], [0.06, 0.6], [0.001, 0.6]]);
const KAFTAN = lathe([[0.001, -0.5], [0.22, -0.5], [0.2, -0.2], [0.18, 0.08], [0.165, 0.25], [0.18, 0.42], [0.2, 0.5], [0.17, 0.56], [0.06, 0.6], [0.001, 0.6]]);
const PELVIS = lathe([[0.001, -0.12], [0.12, -0.12], [0.16, -0.04], [0.155, 0.04], [0.001, 0.05]]);

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.75, sheen = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${sheen}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: sheen });
    mats.set(key, m);
  }
  return m;
}
let printMat: THREE.MeshStandardMaterial | null = null;
function patterned(): THREE.MeshStandardMaterial {
  if (!printMat) printMat = new THREE.MeshStandardMaterial({ map: printTexture(), roughness: 0.8 });
  return printMat;
}

/** Simple per-person variety from the shirt colour (hair style, beard). */
function seedOf(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export class HumanRig {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  /** armL is the right arm (the gun hand): the rig faces +X, so +Z is its right. */
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private handL = new THREE.Group();
  private head = new THREE.Group();
  /** The head joint (crew bandanas and props attach here). */
  get headBone(): THREE.Group {
    return this.head;
  }
  private phase = 0;
  /** Meshes that belong to the current look (removed when re-dressing). */
  private worn: THREE.Object3D[] = [];
  /** Phase 4: 0 arms down, 1 one arm raised (pistol, pipe), 2 both arms on a long gun. */
  aim: 0 | 1 | 2 = 0;
  /** Seconds left in a melee swing. */
  swing = 0;
  private held: THREE.Object3D | null = null;
  /** Sitting at the wheel of a vehicle (legs forward, hands on the wheel). */
  seated = false;
  private posed = false;
  private tray = false;
  /** Cutscene gesture layered over the animation (see poses.ts). */
  readonly gesture = new PoseState();
  get pose(): Pose {
    return this.gesture.pose;
  }
  set pose(p: Pose) {
    this.gesture.pose = p;
  }

  constructor(look: HumanLook) {
    this.hips.position.set(0, 0.92, 0);
    this.legL.position.set(0, 0, 0.095);
    this.legR.position.set(0, 0, -0.095);
    this.kneeL.position.set(0, -0.44, 0);
    this.kneeR.position.set(0, -0.44, 0);
    this.legL.add(this.kneeL);
    this.legR.add(this.kneeR);
    this.hips.add(this.legL, this.legR);
    this.armL.position.set(0, 1.43, 0.19);
    this.armR.position.set(0, 1.43, -0.19);
    this.elbowL.position.set(0, -0.29, 0);
    this.elbowR.position.set(0, -0.29, 0);
    this.handL.position.set(0, -0.27, 0);
    this.armL.add(this.elbowL);
    this.armR.add(this.elbowR);
    this.elbowL.add(this.handL);
    this.head.position.set(0, 1.62, 0);
    this.root.add(this.hips, this.armL, this.armR, this.head);
    this.dress(look);
  }

  private mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0], shadow = true): THREE.Mesh {
    const o = new THREE.Mesh(g, m);
    o.position.set(...pos);
    o.scale.set(...scale);
    o.rotation.set(...rot);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    this.worn.push(o);
    return o;
  }

  /** A rounded limb hanging down from its parent's origin, `len` long, `r` thick at the bottom and `rTop` at the top. */
  private limb(parent: THREE.Object3D, m: THREE.Material, len: number, r: number, rTop = r): void {
    // The shared capsule is 3 units tall (radius 1, straight part 1): scale it to the limb's length.
    const w = (r + rTop) / 2;
    this.mesh(parent, geo.capsule, m, [0, -len / 2, 0], [w, len / 3, w]);
  }

  /** Rebuild the body and clothes for a new look (used by the wardrobe). */
  dress(look: HumanLook): void {
    for (const m of this.worn) m.removeFromParent();
    this.worn = [];
    const skinC = look.skin ?? '#5a3a26';
    const skin = mat(skinC, 0.48); // soft, slightly glossy skin
    const pantsM = mat(look.pants ?? '#1f2430', 0.85);
    const top = look.top ?? 'tee';
    // Hoodie under a dark jacket: the jacket is the outer cloth, the chosen colour shows as the hood and front.
    const hood: THREE.Material = look.pattern ? patterned() : mat(look.shirt, 0.82);
    const cloth: THREE.Material = top === 'hoodie' ? mat('#22232b', 0.7) : hood;
    const seed = seedOf(look.shirt + (look.headwrap ?? ''));
    const dark = mat('#141010', 0.4);
    const shoe = mat(seed % 3 === 0 ? '#e9e6dd' : '#1b1b1d', 0.55);

    // --- Legs: thighs and shins in trousers, rounded shoes
    for (const [leg, knee] of [[this.legL, this.kneeL], [this.legR, this.kneeR]] as const) {
      this.limb(leg, pantsM, 0.46, 0.075, 0.085);
      this.limb(knee, pantsM, 0.42, 0.06, 0.07);
      this.mesh(knee, geo.capsule, shoe, [0.045, -0.43, 0], [0.055, 0.09, 0.06], [0, 0, Math.PI / 2]);
      this.mesh(knee, geo.cyl, mat('#d8d4c8', 0.7), [0.03, -0.465, 0], [0.12, 0.02, 0.075], [0, 0, 0], false); // sole edge
      if (look.cargo) {
        const out = leg === this.legL ? 0.085 : -0.085;
        this.mesh(leg, geo.sphere, pantsM, [0.0, -0.28, out], [0.05, 0.07, 0.025], [0, 0, 0], false); // thigh pocket
      }
      if (look.pantsStripe) {
        // White side stripe down the outside of each leg.
        const out = leg === this.legL ? 0.079 : -0.079;
        this.mesh(leg, geo.capsule, mat('#f4efe6', 0.7), [0, -0.23, out], [0.011, 0.14, 0.011], [0, 0, 0], false);
        this.mesh(knee, geo.capsule, mat('#f4efe6', 0.7), [0, -0.2, out * 0.86], [0.01, 0.12, 0.01], [0, 0, 0], false);
      }
    }
    this.mesh(this.hips, PELVIS, pantsM, [0, 0.04, 0], [0.82, 1, 1]);

    // --- Torso
    const torsoGeo = top === 'kaftan' ? KAFTAN : TORSO;
    this.mesh(this.root, torsoGeo, cloth, [0, 0.9, 0], [0.74, 1, 1]);
    if (top === 'hoodie') {
      // Hoodie front showing between the open jacket, a hood resting on the back, and a hem below the jacket.
      this.mesh(this.root, geo.capsule, hood, [0.112, 1.18, 0], [0.03, 0.12, 0.075], [0, 0, 0], false);
      this.mesh(this.root, geo.sphere, hood, [-0.09, 1.5, 0], [0.09, 0.07, 0.13], [0, 0, 0.3]);
      this.mesh(this.root, geo.torus, hood, [0.0, 1.47, 0], [0.1, 0.1, 0.12], [Math.PI / 2, 0, 0], false);
      this.mesh(this.root, geo.cyl, hood, [0, 0.93, 0], [0.12, 0.06, 0.155], [0, 0, 0], false);
    } else if (top === 'jacket') {
      // Open jacket over a light shirt: a lighter panel at the front and a collar.
      this.mesh(this.root, geo.capsule, mat('#efede6', 0.8), [0.115, 1.2, 0], [0.025, 0.13, 0.06], [0, 0, 0], false);
      this.mesh(this.root, geo.torus, cloth, [0.015, 1.47, 0], [0.11, 0.11, 0.13], [Math.PI / 2, 0, 0], false);
    } else if (top === 'kaftan') {
      this.mesh(this.root, geo.torus, mat('#e9e1c8', 0.7), [0.02, 1.48, 0], [0.09, 0.09, 0.1], [Math.PI / 2, 0, 0], false); // neckline trim
    } else {
      this.mesh(this.root, geo.torus, cloth, [0.0, 1.475, 0], [0.085, 0.085, 0.1], [Math.PI / 2, 0, 0], false); // crew neck
    }
    if (look.stripe) {
      for (const side of [1, -1]) this.mesh(this.root, geo.capsule, mat('#111111', 0.8), [side * 0.118, 1.2, 0], [0.012, 0.14, 0.045], [0, 0, 0], false);
    }

    // --- Arms: sleeves (short for tees), forearms and hands with a thumb
    const longSleeves = top !== 'tee';
    for (const [arm, elbow] of [[this.armL, this.elbowL], [this.armR, this.elbowR]] as const) {
      this.mesh(arm, geo.sphere, cloth, [0, -0.01, -0.0], [0.066, 0.06, 0.066]); // shoulder
      this.limb(arm, longSleeves ? cloth : skin, 0.3, 0.052, 0.06);
      if (!longSleeves) this.mesh(arm, geo.cyl, cloth, [0, -0.07, 0], [0.072, 0.13, 0.072]); // short sleeve
      this.limb(elbow, longSleeves ? cloth : skin, 0.27, 0.042, 0.05);
      if (longSleeves) this.mesh(elbow, geo.cyl, skin, [0, -0.25, 0], [0.04, 0.04, 0.04], [0, 0, 0], false); // wrist
      const hand = elbow === this.elbowL ? this.handL : elbow;
      const hy = elbow === this.elbowL ? -0.04 : -0.31;
      this.mesh(hand, geo.sphere, skin, [0.0, hy, 0], [0.04, 0.06, 0.03]); // palm
      this.mesh(hand, geo.capsule, skin, [0.03, hy + 0.01, 0], [0.012, 0.018, 0.012], [0, 0, -0.6]); // thumb
    }

    // --- Neck and head
    this.mesh(this.root, geo.cyl, skin, [0, 1.535, 0], [0.05, 0.12, 0.05]);
    const h = this.head;
    this.mesh(h, geo.sphere, skin, [0, 0.07, 0], [0.105, 0.125, 0.1]); // cranium
    this.mesh(h, geo.sphere, skin, [0.022, 0.005, 0], [0.085, 0.075, 0.08]); // jaw
    this.mesh(h, geo.sphere, skin, [0.07, -0.02, 0], [0.03, 0.025, 0.04], [0, 0, 0], false); // chin
    for (const z of [-0.1, 0.1]) this.mesh(h, geo.sphere, skin, [-0.005, 0.06, z], [0.016, 0.027, 0.012], [0, 0, 0], false); // ears
    // Eyes: whites, dark irises, brows
    for (const z of [-0.036, 0.036]) {
      this.mesh(h, geo.sphere, mat('#f2efe8', 0.3), [0.085, 0.078, z], [0.016, 0.012, 0.019], [0, 0, 0], false);
      this.mesh(h, geo.sphere, dark, [0.098, 0.078, z], [0.006, 0.009, 0.009], [0, 0, 0], false);
      this.mesh(h, geo.capsule, mat('#1a120d', 0.8), [0.094, 0.105, z], [0.006, 0.012, 0.006], [Math.PI / 2, 0, z > 0 ? 0.12 : -0.12], false);
    }
    this.mesh(h, geo.cone, skin, [0.105, 0.045, 0], [0.018, 0.045, 0.022], [0, 0, -Math.PI / 2], false); // nose
    this.mesh(h, geo.sphere, skin, [0.1, 0.025, 0], [0.012, 0.012, 0.026], [0, 0, 0], false); // nostrils
    this.mesh(h, geo.capsule, mat('#5a2e24', 0.45), [0.092, -0.008, 0], [0.011, 0.017, 0.011], [Math.PI / 2, 0, 0], false); // lips

    // Hair (unless covered), and a short beard on some men
    const hairM = mat('#15100c', 0.9);
    const covered = !!look.headwrap || !!look.hat;
    /** Loose curls: a ring of soft puffs (also peeking out under a cap). */
    const curls = (y: number, ring: number, n: number, size: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (Math.cos(a) > 0.55 && y > 0.12) continue; // keep the forehead clear
        this.mesh(h, geo.sphere, hairM, [-0.015 + Math.cos(a) * ring, y + ((i * 7) % 3) * 0.006, Math.sin(a) * ring * 1.05], [size, size * 0.9, size], [0, 0, 0], false);
      }
    };
    if (look.hat === 'cap' && seed % 2 === 0) curls(0.07, 0.1, 14, 0.032);
    if (!covered) {
      if (seed % 4 === 0) {
        // Full curly hair (an afro-style volume of small puffs)
        this.mesh(h, geo.cap, hairM, [-0.01, 0.11, 0], [0.122, 0.11, 0.118]);
        curls(0.17, 0.085, 12, 0.042);
        curls(0.11, 0.112, 14, 0.036);
        this.mesh(h, geo.sphere, hairM, [-0.02, 0.2, 0], [0.07, 0.04, 0.07], [0, 0, 0], false);
      } else if (seed % 4 === 1) {
        // Low fade with a flat top
        this.mesh(h, geo.cap, hairM, [-0.005, 0.11, 0], [0.108, 0.08, 0.103]);
      } else if (seed % 4 === 2) {
        // Short twists: small bumps over a cap
        this.mesh(h, geo.cap, hairM, [-0.005, 0.1, 0], [0.11, 0.1, 0.105]);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.mesh(h, geo.sphere, hairM, [-0.01 + Math.cos(a) * 0.06, 0.18, Math.sin(a) * 0.06], [0.03, 0.03, 0.03], [0, 0, 0], false);
        }
      } else {
        this.mesh(h, geo.cap, hairM, [-0.005, 0.105, 0], [0.108, 0.09, 0.104]); // close crop
      }
    }
    if (!look.headwrap && seed % 3 === 1) this.mesh(h, geo.sphere, hairM, [0.03, -0.005, 0], [0.072, 0.06, 0.082], [0, 0, 0], false); // beard shadow

    // Headwrap (gele) and hats: soft rounded shapes
    if (look.headwrap) {
      const wrap = mat(look.headwrap, 0.7);
      this.mesh(h, geo.sphere, wrap, [-0.01, 0.15, 0], [0.13, 0.1, 0.13]);
      this.mesh(h, geo.torus, wrap, [-0.03, 0.2, 0], [0.09, 0.09, 0.11], [0.4, 0, 0.3]);
      this.mesh(h, geo.sphere, wrap, [-0.05, 0.24, 0.04], [0.07, 0.05, 0.08], [0.5, 0, 0], false);
    }
    const hatC: THREE.Material = look.hatColour ? mat(look.hatColour, 0.75) : look.pattern ? patterned() : mat(look.shirt, 0.8);
    switch (look.hat) {
      case 'fila':
        this.mesh(h, geo.cyl, hatC, [-0.01, 0.17, 0], [0.11, 0.1, 0.108]);
        this.mesh(h, geo.sphere, hatC, [-0.02, 0.22, 0.03], [0.1, 0.04, 0.09], [0.3, 0, 0]);
        break;
      case 'cap':
      case 'danfo': {
        const c = look.hat === 'danfo' ? mat('#f2c21a', 0.7) : hatC;
        this.mesh(h, geo.cap, c, [0, 0.12, 0], [0.112, 0.09, 0.108]);
        this.mesh(h, geo.cyl, c, [0.1, 0.125, 0], [0.09, 0.012, 0.085], [0, 0, -0.08]); // brim
        if (look.hat === 'danfo') this.mesh(h, geo.cyl, mat('#111111', 0.7), [0, 0.14, 0], [0.113, 0.02, 0.109], [0, 0, 0], false);
        break;
      }
      case 'bucket':
        this.mesh(h, geo.cyl, mat('#8a7a55', 0.85), [0, 0.15, 0], [0.11, 0.1, 0.11]);
        this.mesh(h, geo.cyl, mat('#8a7a55', 0.85), [0, 0.11, 0], [0.17, 0.012, 0.17]);
        break;
    }

    // Crew bandana
    if (look.bandana) {
      const band = makeBandana(look.bandana);
      h.add(band);
      this.worn.push(band);
    }

    // Market tray carried on the head
    this.tray = !!look.tray;
    if (look.tray) {
      this.mesh(h, geo.cyl, mat('#7a5a2b', 0.8), [0, 0.27, 0], [0.32, 0.03, 0.32]);
      const goods = ['#d9481b', '#f2c14e', '#e8e0c8', '#3a7d2a'];
      goods.forEach((c, i) => this.mesh(h, geo.sphere, mat(c, 0.6), [-0.12 + (i % 2) * 0.24, 0.33, -0.12 + Math.floor(i / 2) * 0.24], [0.08, 0.06, 0.08]));
      this.armL.rotation.set(-2.6, 0, 0);
      this.armR.rotation.set(2.6, 0, 0);
      this.elbowL.rotation.z = this.elbowR.rotation.z = 0;
    }
  }

  /** Put a (placeholder) weapon in the right hand, or empty it with null. */
  hold(obj: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = obj;
    if (obj) {
      obj.position.set(0, -0.04, 0);
      this.handL.add(obj);
    }
  }

  /** speed in m/s drives the walk cycle. */
  animate(dt: number, speed: number, airborne = false): void {
    const k = Math.min(1, dt * 10);
    if (this.seated) {
      const kk = Math.min(1, dt * 12);
      for (const [g, v] of [[this.legL, 1.45], [this.legR, 1.45], [this.kneeL, -1.35], [this.kneeR, -1.35], [this.armL, 1.05], [this.armR, 1.05], [this.elbowL, 0.5], [this.elbowR, 0.5]] as const) g.rotation.z += (v - g.rotation.z) * kk;
      this.hips.position.y += (0.92 - this.hips.position.y) * kk;
      return;
    }
    if (speed > 0.1 && !airborne) {
      this.phase += dt * (4 + speed * 1.6);
      const amp = Math.min(0.7, 0.25 + speed * 0.09);
      const s = Math.sin(this.phase) * amp;
      this.legL.rotation.z = s;
      this.legR.rotation.z = -s;
      // Knees bend as each leg swings through behind you.
      this.kneeL.rotation.z = -Math.max(0, -Math.sin(this.phase + 0.6)) * amp * 1.4;
      this.kneeR.rotation.z = -Math.max(0, Math.sin(this.phase + 0.6)) * amp * 1.4;
      this.hips.position.y = 0.92 + Math.abs(Math.cos(this.phase)) * 0.025 * (speed / 3);
      if (!this.tray) {
        this.armL.rotation.z = -s * 0.8;
        this.armR.rotation.z = s * 0.8;
      }
    } else {
      this.legL.rotation.z += ((airborne ? 0.45 : 0) - this.legL.rotation.z) * k;
      this.legR.rotation.z += ((airborne ? -0.15 : 0) - this.legR.rotation.z) * k;
      this.kneeL.rotation.z += ((airborne ? -0.7 : 0) - this.kneeL.rotation.z) * k;
      this.kneeR.rotation.z += ((airborne ? -0.3 : 0) - this.kneeR.rotation.z) * k;
      this.hips.position.y += (0.92 - this.hips.position.y) * k;
      if (!this.tray) {
        this.armL.rotation.z -= this.armL.rotation.z * k;
        this.armR.rotation.z -= this.armR.rotation.z * k;
      }
    }
    // Relaxed elbows; straight when aiming.
    if (!this.tray) {
      const bend = this.aim || this.swing > 0 ? 0 : 0.22;
      this.elbowL.rotation.z += (bend - this.elbowL.rotation.z) * k;
      const support = this.aim === 2 ? 0.5 : 0.22;
      this.elbowR.rotation.z += (support - this.elbowR.rotation.z) * k;
    }
    // Weapon poses override the arm swing.
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt);
      this.armL.rotation.set(0, 0, 0.3 + (this.swing / 0.3) * 2.2);
      this.posed = true;
    } else if (this.aim) {
      this.armL.rotation.set(this.aim === 2 ? 0.1 : 0, 0, 1.5);
      if (this.aim === 2) this.armR.rotation.set(-0.75, 0, 1.3); // support hand reaches in to the gun
      else this.armR.rotation.x = 0;
      this.posed = true;
    } else if (this.posed) {
      this.armL.rotation.x = 0;
      this.armR.rotation.x = 0;
      this.posed = false;
    } else if (!this.tray) {
      // Ease back from any gesture.
      this.armL.rotation.x -= this.armL.rotation.x * k;
      this.armR.rotation.x -= this.armR.rotation.x * k;
    }
    this.head.rotation.x -= this.head.rotation.x * k;
    this.head.rotation.y -= this.head.rotation.y * k;
    this.head.rotation.z -= this.head.rotation.z * k;
    this.gesture.tick(dt);
    // armL is the right arm on this rig.
    applyPose({ armR: this.armL, armL: this.armR, elbowR: this.elbowL, elbowL: this.elbowR, head: this.head }, this.gesture.active, this.gesture.t, this.gesture.weight);
  }
}
