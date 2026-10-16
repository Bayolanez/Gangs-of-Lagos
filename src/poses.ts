import type * as THREE from 'three';

/**
 * Procedural gestures for cutscenes (no animation clips exist in this project): each pose is a
 * small function of time that sets the arm, elbow and head joints. They are layered over the normal
 * idle animation and fade in, so cuts between poses don't snap. Works on both person rigs.
 */
export type Pose = 'none' | 'talk' | 'point' | 'wave' | 'crossed' | 'nod' | 'lookout' | 'shrug' | 'thumbs' | 'beckon';
export const POSES: Pose[] = ['none', 'talk', 'point', 'wave', 'crossed', 'nod', 'lookout', 'shrug', 'thumbs', 'beckon'];

export interface PoseJoints {
  /** The person's right arm (+Z side) and left arm, their elbows, and the head (or neck). */
  armR: THREE.Object3D;
  armL: THREE.Object3D;
  elbowR: THREE.Object3D;
  elbowL: THREE.Object3D;
  head: THREE.Object3D;
}

export type Arm = { z: number; x: number; e: number };
export interface Target {
  r?: Arm;
  l?: Arm;
  head?: { y?: number; z?: number; x?: number };
}

/** The joint angles a pose wants at time t (seconds since it began). Outward on the right arm is -x. */
export function target(pose: Pose, t: number): Target {
  const s = Math.sin;
  switch (pose) {
    case 'talk':
      return { r: { z: 0.4 + 0.14 * s(t * 3.1), x: -0.18, e: 1.1 + 0.25 * s(t * 4.3) }, l: { z: 0.18 + 0.06 * s(t * 2.3 + 1), x: 0.14, e: 0.7 }, head: { y: 0.08 * s(t * 1.3), z: 0.04 * s(t * 2.1) } };
    case 'point':
      return { r: { z: 1.5, x: -0.12, e: 0.05 }, l: { z: 0.05, x: 0.1, e: 0.25 }, head: { z: 0.04 } };
    case 'wave':
      return { r: { z: 0.25, x: -2.6, e: 0.55 + 0.5 * s(t * 9) }, head: { z: 0.06 } };
    case 'crossed':
      return { r: { z: 0.8, x: 0.5, e: 2.0 }, l: { z: 0.8, x: -0.5, e: 2.0 }, head: { y: 0.05 * s(t * 0.7) } };
    case 'nod':
      return { r: { z: 0.05, x: -0.08, e: 0.25 }, l: { z: 0.05, x: 0.08, e: 0.25 }, head: { z: -0.22 * Math.max(0, s(t * 6)) } };
    case 'lookout':
      return { r: { z: 1.25, x: -0.55, e: 2.3 }, l: { z: 0.05, x: 0.1, e: 0.3 }, head: { y: 0.55 * s(t * 0.9), z: 0.08 } };
    case 'shrug':
      return { r: { z: 0.3, x: -0.4, e: 1.4 + 0.1 * s(t * 3) }, l: { z: 0.3, x: 0.4, e: 1.4 + 0.1 * s(t * 3) }, head: { x: 0.15 * s(t * 1.5) } };
    case 'thumbs':
      return { r: { z: 1.1, x: -0.12, e: 1.5 }, head: { z: -0.05 } };
    case 'beckon':
      return { r: { z: 1.1, x: -0.25, e: 0.6 + 0.7 * Math.max(0, s(t * 5)) } };
    default:
      return {};
  }
}

const mix = (a: number, b: number, w: number) => a + (b - a) * w;

/** Layer a pose over whatever the rig's animation set this frame (w: 0 none to 1 full). */
export function applyPose(j: PoseJoints, pose: Pose, t: number, w: number): void {
  if (pose === 'none' || w <= 0) return;
  const g = target(pose, t);
  for (const [arm, elbow, a] of [[j.armR, j.elbowR, g.r], [j.armL, j.elbowL, g.l]] as const) {
    if (!a) continue;
    arm.rotation.z = mix(arm.rotation.z, a.z, w);
    arm.rotation.x = mix(arm.rotation.x, a.x, w);
    elbow.rotation.z = mix(elbow.rotation.z, a.e, w);
  }
  if (g.head) {
    j.head.rotation.y = mix(j.head.rotation.y, g.head.y ?? 0, w);
    j.head.rotation.z = mix(j.head.rotation.z, g.head.z ?? 0, w);
    j.head.rotation.x = mix(j.head.rotation.x, g.head.x ?? 0, w);
  }
}

/** Fade state for a rig's pose: call tick() every frame, then applyPose(..., pose, t, weight). */
export class PoseState {
  pose: Pose = 'none';
  t = 0;
  weight = 0;
  private shown: Pose = 'none';
  tick(dt: number): void {
    this.t += dt;
    if (this.pose !== this.shown) {
      // Fade the old gesture out, then the new one in.
      this.weight = Math.max(0, this.weight - dt * 6);
      if (this.weight === 0) {
        this.shown = this.pose;
        this.t = 0;
      }
    } else if (this.pose !== 'none') this.weight = Math.min(1, this.weight + dt * 4);
  }
  get active(): Pose {
    return this.shown;
  }
}
