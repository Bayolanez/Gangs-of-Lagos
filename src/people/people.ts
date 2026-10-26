import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildHuman, BUILDS, FITS, SKIN_TONES, type Outfit } from './human.js';
import { PoseState } from '../poses';
import type { HumanLook } from '../human';

/**
 * Lagos People (Bayo's kit): every person built on one shared skeleton with 43 animations, the
 * Quaternius Universal Animation Library (CC0), and dressed by human.js (bodies, faces, hair and Lagos
 * fits: BLK KNG, street, senator, agbada, office, okada, ankara, buba, street for women).
 *
 * PeopleRig wraps one person in the same API as the game's other rigs (aim, swing, seated, gestures,
 * hold, animate), so the player code, cars, weapons and cutscenes can drive it. It picks a clip from
 * what the body is doing and cross-fades: idle, walk, jog and sprint by speed (played faster or slower
 * to match), jump, driving or sitting, pistol aim, punches, a hit, death, and talking or dancing for
 * cutscene gestures. Built people cost a moment each, so the game builds a few and reuses them.
 */
export type FitName = keyof typeof FITS;
export type BuildName = keyof typeof BUILDS;
export type SkinName = keyof typeof SKIN_TONES;
export { FITS, BUILDS, SKIN_TONES };

export interface PersonOptions {
  fit?: FitName | Outfit;
  skin?: SkinName | string;
  build?: BuildName;
  name?: string;
}

/** Natural speeds of the locomotion clips (m/s), so feet match the ground. */
const CLIP_SPEED: Record<string, number> = { Walk_Loop: 1.45, Jog_Fwd_Loop: 3.4, Sprint_Loop: 6.2, Walk_Formal_Loop: 1.3 };
const ONCE = new Set(['Death01', 'Hit_Chest', 'Hit_Head', 'Punch_Cross', 'Punch_Jab', 'Jump_Start', 'Jump_Land', 'Pistol_Shoot', 'Pistol_Reload', 'Interact', 'PickUp_Table', 'Sitting_Enter', 'Sitting_Exit', 'Roll']);

export class PeopleLibrary {
  readonly clips: string[];
  private byName: Map<string, THREE.AnimationClip>;

  constructor(private ual: GLTF) {
    this.clips = ual.animations.map((c) => c.name);
    this.byName = new Map(ual.animations.map((c) => [c.name, c]));
  }

  clip(name: string): THREE.AnimationClip | undefined {
    return this.byName.get(name);
  }

  /** A dressed person, facing +X like the game's other rigs. */
  spawn(o: PersonOptions = {}): PeopleRig {
    return new PeopleRig(this, buildHuman(this.ual, o as Parameters<typeof buildHuman>[1]), o);
  }

  /** An everyday Lagos passer-by (seeded: the same seed gives the same person). Men and women. */
  randomNpc(seed: number): PeopleRig {
    let s = (seed * 9301 + 49297) % 2147483647 || 1;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length) % a.length];
    const fits = (Object.keys(FITS) as FitName[]).filter((f) => f !== 'blk_kng');
    return this.spawn({ fit: pick(fits), skin: pick(['deep', 'dark', 'brown', 'warm', 'caramel'] as SkinName[]), build: pick(Object.keys(BUILDS) as BuildName[]) });
  }
}

export class PeopleRig {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly bones: Record<string, THREE.Object3D> = {};
  readonly fit: string;
  aim: 0 | 1 | 2 = 0;
  swing = 0;
  seated = false;
  /** In a car (hands on the wheel) or on a chair (cutscenes). */
  seatKind: 'car' | 'chair' = 'car';
  /** Seconds left of a hit reaction / lying dead (set by the game). */
  hit = 0;
  dead = false;
  readonly gesture = new PoseState();
  /** The clip playing now (tests and look-dev). */
  clip = '';
  private action: THREE.AnimationAction | null = null;
  private holder = new THREE.Group();
  private held: THREE.Object3D | null = null;
  private punch = 0;
  private spd = 0;
  private air = 0;
  private wasAir = false;
  private landT = 0;

  constructor(private lib: PeopleLibrary, human: THREE.Object3D, o: PersonOptions) {
    this.model = human;
    human.rotation.y = Math.PI / 2; // the model faces +Z; the game's rigs face +X
    human.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // skinned: the bind-pose bounds don't follow the animation
      }
      if ((m as THREE.Bone).isBone) this.bones[m.name] = m;
    });
    this.fit = typeof o.fit === 'object' ? o.fit.label : o.fit ?? 'street';
    this.root.name = o.name ?? `person-${this.fit}`;
    this.root.add(human);
    this.mixer = new THREE.AnimationMixer(human);
    this.holder.name = 'held';
    this.bones.hand_r?.add(this.holder);
    this.play('Idle_Loop', 0);
  }

  /** Cross-fade to a clip by name ('Walk_Loop', 'Driving_Loop', 'Punch_Cross'...). */
  play(name: string, fade = 0.2): void {
    if (name === this.clip) return;
    const c = this.lib.clip(name);
    if (!c) return;
    const next = this.mixer.clipAction(c);
    next.reset();
    next.timeScale = 1;
    if (ONCE.has(name)) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    next.play();
    if (this.action && fade > 0) this.action.crossFadeTo(next, fade, false);
    else this.action?.stop();
    this.action = next;
    this.clip = name;
  }

  /** The rig's own look is fixed by its fit (the wardrobe builds another person instead). */
  dress(_look: HumanLook): void {}

  get headBone(): THREE.Object3D | null {
    return this.bones.Head ?? null;
  }

  hold(obj: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = obj;
    if (obj) {
      obj.position.set(0, 0, 0);
      this.holder.add(obj);
    }
  }

  /** What the body is doing -> which clip. */
  private choose(speed: number): string {
    if (this.dead) return 'Death01';
    if (this.seated) return this.seatKind === 'chair' ? 'Sitting_Idle_Loop' : 'Driving_Loop';
    if (this.air > 0.5) return this.landT > 0 ? 'Jump_Land' : 'Jump_Loop';
    if (this.punch > 0) return 'Punch_Cross';
    if (this.hit > 0) return 'Hit_Chest';
    if (this.landT > 0) return 'Jump_Land';
    // The player walks at 3.2 m/s and sprints at 6.6; residents stroll at about 1.3 and flee at 4.2.
    if (speed > 0.15) return speed < 4.0 ? 'Walk_Loop' : speed < 6.0 ? 'Jog_Fwd_Loop' : 'Sprint_Loop';
    if (this.aim > 0) return 'Pistol_Aim_Neutral';
    const g = this.gesture.pose;
    if (g === 'dance') return 'Dance_Loop';
    if (g === 'talk' || g === 'point' || g === 'shrug' || g === 'beckon' || g === 'wave') return 'Idle_Talking_Loop';
    return 'Idle_Loop';
  }

  animate(dt: number, speed: number, airborne = false): void {
    this.gesture.tick(dt);
    this.spd += (speed - this.spd) * Math.min(1, dt * 8);
    this.air = airborne && !this.seated ? 1 : 0;
    if (this.wasAir && !airborne) this.landT = 0.25;
    this.wasAir = airborne;
    this.landT = Math.max(0, this.landT - dt);
    this.hit = Math.max(0, this.hit - dt);
    if (this.swing > 0) {
      this.punch = 0.45;
      this.swing = 0;
    }
    this.punch = Math.max(0, this.punch - dt);
    const want = this.choose(this.spd);
    this.play(want, want === 'Jump_Loop' || want === 'Punch_Cross' ? 0.08 : 0.2);
    const base = CLIP_SPEED[this.clip];
    if (this.action) this.action.timeScale = base ? THREE.MathUtils.clamp(this.spd / base, 0.6, 2.3) : 1;
    this.mixer.update(dt);
    // Seated, the pelvis sits where the other rigs put theirs (0.92 m above the root), so car seats and
    // chairs line up the same way for everyone.
    this.model.position.y = 0;
    if (this.seated && this.bones.pelvis) {
      this.root.updateWorldMatrix(true, true);
      const py = this.bones.pelvis.getWorldPosition(new THREE.Vector3()).y - this.root.getWorldPosition(new THREE.Vector3()).y;
      this.model.position.y = 0.92 - py;
    }
    // A held weapon points down at the side, or forward along the aim (the rig faces +X; up is +Y).
    if (this.held) {
      this.root.updateWorldMatrix(true, true);
      const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, this.aim > 0 ? Math.PI / 2 : 0));
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      const handQ = this.bones.hand_r.getWorldQuaternion(new THREE.Quaternion());
      this.holder.quaternion.copy(handQ.invert().multiply(rootQ.multiply(want)));
      // Undo the bones' scale so the gun is its own size.
      const ws = this.bones.hand_r.getWorldScale(new THREE.Vector3());
      this.holder.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
    }
  }

  /** Height of each foot above the root (tests: the feet stay on the ground). */
  soleHeights(): number[] {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return ['foot_l', 'foot_r'].map((n) => (this.bones[n] ? this.bones[n].getWorldPosition(v).y - this.root.position.y : 0));
  }
}

/** Load the shared skeleton and its animations (Bayo's kit: UAL1_Standard.glb). */
export function makeLibrary(ual: GLTF): PeopleLibrary {
  if (!ual.animations.length) throw new Error('Lagos People: the skeleton has no animations');
  return new PeopleLibrary(ual);
}
