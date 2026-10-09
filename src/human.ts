import * as THREE from 'three';
import { printTexture } from './outfits';
import { part } from './placeholders';

/** PLACEHOLDER person: stacked shapes with swinging legs and arms. Faces +X locally. */
export interface HumanLook {
  shirt: string;
  pants?: string;
  skin?: string;
  headwrap?: string;
  tray?: boolean;
  stripe?: boolean;
  /** Milestone 3 clothing options (player customization). */
  top?: 'tee' | 'kaftan' | 'jacket';
  pattern?: boolean;
  hat?: 'fila' | 'cap' | 'bucket' | 'danfo';
}

let printMat: THREE.MeshStandardMaterial | null = null;
function patterned(): THREE.MeshStandardMaterial {
  if (!printMat) printMat = new THREE.MeshStandardMaterial({ map: printTexture(), roughness: 0.85 });
  return printMat;
}

export class HumanRig {
  readonly root = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = 0;
  /** Meshes that belong to the current outfit (removed when re-dressing). */
  private worn: THREE.Mesh[] = [];
  /** Phase 4: 0 arms down, 1 one arm raised (pistol, pipe), 2 both arms on a long gun. */
  aim: 0 | 1 | 2 = 0;
  /** Seconds left in a melee swing. */
  swing = 0;
  private held: THREE.Object3D | null = null;
  private posed = false;

  constructor(look: HumanLook) {
    this.legL.position.set(0, 0.9, 0.1);
    this.legR.position.set(0, 0.9, -0.1);
    this.armL.position.set(0, 1.5, 0.29);
    this.armR.position.set(0, 1.5, -0.29);
    this.root.add(this.legL, this.legR, this.armL, this.armR);
    this.dress(look);
  }

  /** Rebuild the body and clothes for a new look (used by the wardrobe). */
  dress(look: HumanLook): void {
    for (const m of this.worn) m.removeFromParent();
    this.worn = [];
    const add = (parent: THREE.Object3D, ...args: Parameters<typeof part> extends [unknown, ...infer R] ? R : never) => {
      const m = part(parent, ...args);
      this.worn.push(m);
      return m;
    };
    const pants = look.pants ?? '#1f2430';
    const skin = look.skin ?? '#5a3a26';
    const cloth: string | THREE.Material = look.pattern ? patterned() : look.shirt;
    for (const leg of [this.legL, this.legR]) {
      add(leg, 'box', pants, [0, -0.44, 0], [0.18, 0.88, 0.17]);
      add(leg, 'box', '#1a1a1a', [0.05, -0.86, 0], [0.26, 0.07, 0.15]);
    }
    const top = look.top ?? 'tee';
    if (top === 'kaftan') {
      add(this.root, 'box', cloth, [0, 1.07, 0], [0.3, 0.92, 0.48]);
      add(this.root, 'box', '#e9e1c8', [0.155, 1.42, 0], [0.01, 0.2, 0.08], [0, 0, 0], false); // neckline trim
    } else if (top === 'jacket') {
      add(this.root, 'box', cloth, [0, 1.21, 0], [0.31, 0.66, 0.48]);
      add(this.root, 'box', '#f0efe9', [0.156, 1.26, 0], [0.01, 0.5, 0.1], [0, 0, 0], false); // shirt under open front
    } else {
      add(this.root, 'box', cloth, [0, 1.22, 0], [0.26, 0.62, 0.44]);
    }
    if (look.stripe) add(this.root, 'box', '#111111', [0, top === 'tee' ? 1.22 : 1.21, 0], [top === 'tee' ? 0.27 : 0.32, 0.62, 0.09]);
    for (const arm of [this.armL, this.armR]) {
      add(arm, 'box', cloth, [0, top === 'tee' ? -0.18 : -0.24, 0], [0.13, top === 'tee' ? 0.36 : 0.48, 0.13]);
      add(arm, 'box', skin, [0, -0.48, 0], [0.11, 0.26, 0.11]);
    }
    add(this.root, 'box', skin, [0, 1.56, 0], [0.1, 0.1, 0.1]);
    add(this.root, 'sph', skin, [0.01, 1.69, 0], [0.24, 0.28, 0.24]);
    // Eyes and mouth so you can tell which way someone is facing.
    for (const z of [-0.05, 0.05]) add(this.root, 'box', '#141010', [0.12, 1.72, z], [0.02, 0.035, 0.035], [0, 0, 0], false);
    add(this.root, 'box', '#3a1d14', [0.122, 1.63, 0], [0.02, 0.02, 0.07], [0, 0, 0], false);
    if (look.headwrap) {
      add(this.root, 'sph', look.headwrap, [-0.02, 1.8, 0], [0.34, 0.24, 0.4]);
      add(this.root, 'box', look.headwrap, [-0.05, 1.89, 0], [0.12, 0.12, 0.34], [0.5, 0, 0]);
    }
    const hatColour: string | THREE.Material = look.pattern ? patterned() : look.shirt;
    switch (look.hat) {
      case 'fila':
        add(this.root, 'sph', hatColour, [-0.01, 1.8, 0], [0.27, 0.14, 0.27]);
        add(this.root, 'box', hatColour, [-0.03, 1.86, 0.06], [0.2, 0.08, 0.18], [0.35, 0, 0]);
        break;
      case 'cap':
      case 'danfo': {
        const c = look.hat === 'danfo' ? '#f2c21a' : hatColour;
        add(this.root, 'sph', c, [0, 1.79, 0], [0.27, 0.14, 0.27]);
        add(this.root, 'box', c, [0.15, 1.76, 0], [0.16, 0.03, 0.22]);
        if (look.hat === 'danfo') add(this.root, 'box', '#111111', [0, 1.83, 0], [0.275, 0.04, 0.275], [0, 0, 0], false);
        break;
      }
      case 'bucket':
        add(this.root, 'cyl', '#8a7a55', [0, 1.79, 0], [0.36, 0.04, 0.36]);
        add(this.root, 'cyl', '#8a7a55', [0, 1.85, 0], [0.26, 0.14, 0.26]);
        break;
    }
    if (look.tray) {
      add(this.root, 'box', '#7a5a2b', [0, 1.87, 0], [0.62, 0.05, 0.62]);
      const goods = ['#d9481b', '#f2c14e', '#e8e0c8', '#3a7d2a'];
      goods.forEach((c, i) => add(this.root, 'box', c, [-0.15 + (i % 2) * 0.3, 1.94, -0.15 + Math.floor(i / 2) * 0.3], [0.22, 0.1, 0.22]));
      this.armL.rotation.x = -2.8;
      this.armR.rotation.x = 2.8;
    }
  }

  /** Put a (placeholder) weapon in the right hand, or empty it with null. */
  hold(obj: THREE.Object3D | null): void {
    this.held?.removeFromParent();
    this.held = obj;
    if (obj) {
      obj.position.set(0, -0.58, 0);
      this.armL.add(obj);
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
    // Weapon poses override the arm swing (armL is the right hand: the rig faces +X, so +Z is its right).
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
    }
  }
}
