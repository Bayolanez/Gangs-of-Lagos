import * as THREE from 'three';
import { part } from './placeholders';

/** PLACEHOLDER person: stacked shapes with swinging legs and arms. Faces +X locally. */
export interface HumanLook {
  shirt: string;
  pants?: string;
  skin?: string;
  headwrap?: string;
  tray?: boolean;
  stripe?: boolean;
}

export class HumanRig {
  readonly root = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = 0;

  constructor(look: HumanLook) {
    const pants = look.pants ?? '#1f2430';
    const skin = look.skin ?? '#5a3a26';
    for (const [leg, z] of [[this.legL, 0.1], [this.legR, -0.1]] as const) {
      leg.position.set(0, 0.9, z);
      part(leg, 'box', pants, [0, -0.44, 0], [0.18, 0.88, 0.17]);
      part(leg, 'box', '#1a1a1a', [0.05, -0.86, 0], [0.26, 0.07, 0.15]);
      this.root.add(leg);
    }
    part(this.root, 'box', look.shirt, [0, 1.22, 0], [0.26, 0.62, 0.44]);
    if (look.stripe) part(this.root, 'box', '#111111', [0, 1.22, 0], [0.27, 0.62, 0.09]);
    for (const [arm, z] of [[this.armL, 0.29], [this.armR, -0.29]] as const) {
      arm.position.set(0, 1.5, z);
      part(arm, 'box', look.shirt, [0, -0.18, 0], [0.13, 0.36, 0.13]);
      part(arm, 'box', skin, [0, -0.48, 0], [0.11, 0.26, 0.11]);
      this.root.add(arm);
    }
    part(this.root, 'box', skin, [0, 1.56, 0], [0.1, 0.1, 0.1]);
    part(this.root, 'sph', skin, [0.01, 1.69, 0], [0.24, 0.28, 0.24]);
    if (look.headwrap) {
      part(this.root, 'sph', look.headwrap, [-0.02, 1.8, 0], [0.34, 0.24, 0.4]);
      part(this.root, 'box', look.headwrap, [-0.05, 1.89, 0], [0.12, 0.12, 0.34], [0.5, 0, 0]);
    }
    if (look.tray) {
      part(this.root, 'box', '#7a5a2b', [0, 1.87, 0], [0.62, 0.05, 0.62]);
      const goods = ['#d9481b', '#f2c14e', '#e8e0c8', '#3a7d2a'];
      goods.forEach((c, i) => part(this.root, 'box', c, [-0.15 + (i % 2) * 0.3, 1.94, -0.15 + Math.floor(i / 2) * 0.3], [0.22, 0.1, 0.22]));
      this.armL.rotation.x = -2.8;
      this.armR.rotation.x = 2.8;
    }
  }

  /** speed in m/s drives the walk cycle. */
  animate(dt: number, speed: number, airborne = false): void {
    if (speed > 0.1 && !airborne) {
      this.phase += dt * (4 + speed * 1.6);
      const amp = Math.min(0.75, 0.25 + speed * 0.1);
      const s = Math.sin(this.phase) * amp;
      this.legL.rotation.z = s;
      this.legR.rotation.z = -s;
      if (this.armL.rotation.x === 0) {
        this.armL.rotation.z = -s * 0.8;
        this.armR.rotation.z = s * 0.8;
      }
    } else {
      const k = Math.min(1, dt * 10);
      this.legL.rotation.z += ((airborne ? 0.4 : 0) - this.legL.rotation.z) * k;
      this.legR.rotation.z += ((airborne ? -0.2 : 0) - this.legR.rotation.z) * k;
      this.armL.rotation.z -= this.armL.rotation.z * k;
      this.armR.rotation.z -= this.armR.rotation.z * k;
    }
  }
}
