import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HumanLook } from './human';
import { PoseState, target as poseTarget } from './poses';

/**
 * BLK KNG, the main player character (Bayo's own character kit: public/models/blk-king.glb).
 *
 * The model is a stylized, code-built GLB: 1.85 m tall, facing +Z, feet at y = 0, with named joints
 * (hips, spine, neck, head, shoulder_L/R, elbow_L/R, hand_L/R, hip_L/R, knee_L/R, ankle_L/R). This
 * class wraps it to face +X like the game's other person rigs and gives it the same API (animate,
 * seated, aim, swing, hold, gestures), so the controller, cars, weapons and cutscenes drive it
 * unchanged. Animation: idle breathing, walk and run blended by speed with a forward lean at a run,
 * a jump pose, the driving pose, aiming and melee swings; the pelvis height is solved from the legs
 * so the standing foot stays on the ground.
 *
 * Joint conventions in the model's own space (+Z forward): a negative x rotation on a hip or shoulder
 * swings the limb forward, a positive x on a knee bends it, a negative x on an elbow bends it.
 */
const JOINTS = ['hips', 'spine', 'neck', 'head', 'shoulder_L', 'shoulder_R', 'elbow_L', 'elbow_R', 'hand_L', 'hand_R', 'hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R'] as const;
type Joint = (typeof JOINTS)[number];

/** Leg lengths from the model: hip to knee, knee to ankle, ankle to sole. */
const THIGH = 0.405, SHIN = 0.41, FOOT = 0.085, HIP_DROP = 0.02;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

let cache: Promise<THREE.Group> | null = null;

/** Load the model once (the .glb, or the base64 .glb.json form used on hosts that don't serve .glb). */
export function loadBlkKing(base: string): Promise<THREE.Group> {
  if (cache) return cache;
  const loader = new GLTFLoader();
  const url = `${base}models/blk-king.glb`;
  cache = loader
    .loadAsync(url)
    .catch(async () => {
      const r = await fetch(`${url}.json`);
      if (!r.ok) throw new Error(`BLK KNG model not found (HTTP ${r.status})`);
      const { glb } = (await r.json()) as { glb: string };
      const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
      return loader.parseAsync(bytes.buffer, base);
    })
    .then((g) => g.scene);
  cache.catch(() => (cache = null));
  return cache;
}

export class BlkKingRig {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly joints = {} as Record<Joint, THREE.Object3D>;
  aim: 0 | 1 | 2 = 0;
  swing = 0;
  seated = false;
  readonly gesture = new PoseState();
  private rest = new Map<THREE.Object3D, THREE.Euler>();
  private cur = new Map<string, number>();
  private holder = new THREE.Group();
  private held: THREE.Object3D | null = null;
  private soles: THREE.Object3D[] = [];
  private phase = 0;
  private t = 0;
  private spd = 0;
  private airW = 0;
  private hipsY: number;

  constructor(scene: THREE.Group) {
    this.model = scene.clone(true);
    this.model.rotation.y = Math.PI / 2; // +Z forward -> +X forward, like the other rigs
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.root.name = 'blk-king';
    this.root.add(this.model);
    for (const n of JOINTS) {
      const o = this.model.getObjectByName(n);
      if (!o) throw new Error(`BLK KNG model is missing the ${n} joint`);
      this.joints[n] = o;
      this.rest.set(o, o.rotation.clone());
    }
    this.hipsY = this.joints.hips.position.y;
    // A weapon in the right hand: the holder turns the game's hand frame (X up when aiming) into this model's.
    this.holder.rotation.y = -Math.PI / 2;
    this.holder.position.set(0, -0.06, 0);
    this.joints.hand_R.add(this.holder);
    for (const s of ['L', 'R'] as const) {
      const sole = new THREE.Object3D();
      sole.position.set(0, -FOOT, 0);
      this.joints[`ankle_${s}`].add(sole);
      this.soles.push(sole);
    }
  }

  /** The look comes from the model itself (BLK KNG is a fixed outfit for now). */
  dress(_look: HumanLook): void {}

  hold(obj: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = obj;
    if (obj) {
      obj.position.set(0, 0, 0);
      this.holder.add(obj);
    }
  }

  /** Sole heights above the root (tests: the feet stay on the ground). */
  soleHeights(): number[] {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return this.soles.map((s) => s.getWorldPosition(v).y - this.root.position.y);
  }

  /** Blend one joint axis towards rest + offset. */
  private go(n: Joint, axis: 'x' | 'y' | 'z', offset: number, k: number): void {
    const o = this.joints[n];
    const key = `${n}.${axis}`;
    const r = this.rest.get(o)![axis];
    const v = this.cur.get(key) ?? 0;
    const nv = v + (offset - v) * k;
    this.cur.set(key, nv);
    o.rotation[axis] = r + nv;
  }
  private set(n: Joint, axis: 'x' | 'y' | 'z', offset: number): void {
    this.cur.set(`${n}.${axis}`, offset);
    this.joints[n].rotation[axis] = this.rest.get(this.joints[n])![axis] + offset;
  }

  animate(dt: number, speed: number, airborne = false): void {
    const k = 1 - Math.exp(-dt * 16);
    this.t += dt;
    this.spd += (speed - this.spd) * Math.min(1, dt * 8);
    this.airW += ((airborne && !this.seated ? 1 : 0) - this.airW) * Math.min(1, dt * 10);
    const J = this.joints;

    if (this.seated) {
      const kk = 1 - Math.exp(-dt * 14);
      for (const s of ['L', 'R'] as const) {
        this.go(`hip_${s}`, 'x', -1.45, kk);
        this.go(`knee_${s}`, 'x', 1.35, kk);
        this.go(`ankle_${s}`, 'x', -0.1, kk);
        this.go(`shoulder_${s}`, 'x', -1.0, kk);
        this.go(`shoulder_${s}`, 'z', s === 'L' ? -0.22 : 0.22, kk);
        this.go(`elbow_${s}`, 'x', -0.55, kk);
      }
      this.go('spine', 'x', -0.05, kk);
      J.hips.position.y = this.hipsY;
      return;
    }

    const air = this.airW;
    const moveW = smooth(0.12, 1.2, this.spd) * (1 - air);
    const runW = smooth(3.8, 6.0, this.spd);
    const idleW = 1 - smooth(0.05, 0.8, this.spd);
    const amp = lerp(0.5, 0.72, runW);
    const strideLen = 4 * 0.82 * Math.sin(amp) * (1 + 0.6 * runW);
    if (this.spd > 0.05) this.phase += dt * Math.PI * 2 * Math.max(0.8, this.spd / strideLen);
    const s = Math.sin(this.phase);
    const sw = amp * moveW;

    // Legs (left forward when s > 0), knees flexing in early swing, ankles keeping the soles level.
    const hip = { L: -s * sw, R: s * sw };
    const knee = { L: 0, R: 0 };
    for (const side of ['L', 'R'] as const) {
      const p = this.phase + (side === 'R' ? Math.PI : 0);
      knee[side] = (Math.pow(Math.max(0, Math.cos(p + 0.6)), 1.5) * lerp(0.8, 1.45, runW) + 0.06 * runW) * moveW;
    }
    hip.R = lerp(hip.R, -0.55, air);
    knee.R = lerp(knee.R, 0.95, air);
    hip.L = lerp(hip.L, 0.12, air);
    knee.L = lerp(knee.L, 0.4, air);
    for (const side of ['L', 'R'] as const) {
      this.go(`hip_${side}`, 'x', hip[side], k);
      this.go(`knee_${side}`, 'x', knee[side], k);
      this.go(`ankle_${side}`, 'x', -(hip[side] + knee[side]) * 0.85 * (1 - air * 0.6), k);
    }
    // Pelvis height from the legs: the lower foot rests on the ground.
    const reach = (sd: 'L' | 'R') => {
      const h = this.cur.get(`hip_${sd}.x`) ?? 0, kn = this.cur.get(`knee_${sd}.x`) ?? 0;
      return THIGH * Math.cos(h) + SHIN * Math.cos(h + kn);
    };
    const ground = Math.max(reach('L'), reach('R')) + FOOT + HIP_DROP;
    const bounce = runW * moveW * 0.035 * Math.abs(Math.sin(this.phase * 2));
    const target = lerp(ground + bounce, this.hipsY, air);
    J.hips.position.y += (target - J.hips.position.y) * Math.min(1, dt * 30);

    // Upper body: lean at a run, counter-turn, breathing; arms swing against the legs.
    const lean = 0.05 * moveW + 0.17 * runW * moveW + 0.06 * air;
    this.go('spine', 'x', lean, k);
    this.go('spine', 'y', s * 0.1 * moveW, k);
    this.go('neck', 'x', -lean * 0.7, k);
    this.go('neck', 'y', Math.sin(this.t * 0.33) * 0.12 * idleW, k);
    const breath = Math.sin(this.t * (2.1 + runW * 1.6));
    const armA = s * sw * lerp(0.85, 1.0, runW);
    for (const side of ['L', 'R'] as const) {
      const sg = side === 'L' ? 1 : -1;
      this.go(`shoulder_${side}`, 'x', lerp(side === 'L' ? armA : -armA, 0.2, air), k);
      // Arms down from the modelled A-pose, out a little when airborne.
      this.go(`shoulder_${side}`, 'z', lerp(-0.2 * sg + 0.02 * breath * sg, 0.25 * sg, air), k);
      this.go(`elbow_${side}`, 'x', -(lerp(0.2, 1.3, runW) * moveW + 0.16 * (1 - moveW)) - 0.4 * air, k);
    }

    // Cutscene gestures (poses.ts angles mapped onto this model's axes).
    this.gesture.tick(dt);
    const w = this.gesture.weight;
    if (this.gesture.active !== 'none' && w > 0) {
      const g = poseTarget(this.gesture.active, this.gesture.t);
      for (const [side, a] of [['R', g.r], ['L', g.l]] as const) {
        if (!a) continue;
        const sg = side === 'L' ? 1 : -1;
        const sh = `shoulder_${side}` as Joint, el = `elbow_${side}` as Joint;
        this.set(sh, 'x', lerp(this.cur.get(`${sh}.x`)!, -a.z, w));
        this.set(sh, 'z', lerp(this.cur.get(`${sh}.z`)!, -0.3 * sg + a.x, w));
        this.set(el, 'x', lerp(this.cur.get(`${el}.x`)!, -a.e, w));
      }
      if (g.head) {
        this.set('neck', 'y', lerp(this.cur.get('neck.y')!, g.head.y ?? 0, w));
        this.set('neck', 'x', lerp(this.cur.get('neck.x')!, -(g.head.z ?? 0), w));
      }
    }

    // Weapons: raise the gun arm, the support hand for long guns, or swing the melee weapon.
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt);
      this.set('shoulder_R', 'x', -(0.3 + (this.swing / 0.3) * 2.2));
      this.set('shoulder_R', 'z', 0.3);
      this.set('elbow_R', 'x', 0);
    } else if (this.aim) {
      this.set('shoulder_R', 'x', -1.5);
      this.set('shoulder_R', 'z', 0.3);
      this.set('elbow_R', 'x', 0);
      if (this.aim === 2) {
        this.set('shoulder_L', 'x', -1.35);
        this.set('shoulder_L', 'z', -0.75);
        this.set('elbow_L', 'x', -0.5);
      }
    }
  }
}
