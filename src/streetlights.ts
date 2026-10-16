import * as THREE from 'three';
import type { StreetProp } from './district';

/**
 * Street lights after dark. Every lamp head gets a warm halo and a pool of light on the pavement and
 * road below it (one draw call each for the whole town). The lamps nearest the camera also carry real
 * point lights, so cars, people and walls close to you are lit by them. Lamps a car has knocked down
 * go dark. By day all of it is off.
 */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  prop: StreetProp;
}

const POOL_R = 9;

export class StreetLights {
  readonly pools: THREE.InstancedMesh;
  readonly halos: THREE.Points;
  /** Real lights, moved to the nearest working lamps every frame. */
  readonly lights: THREE.PointLight[] = [];
  /** 0 by day .. 1 at night. */
  k = 0;
  private readonly kU = { value: 0 };
  private readonly haloAlpha: THREE.BufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly order: number[];
  private shownBroken: boolean[];

  constructor(scene: THREE.Scene, readonly lamps: Lamp[], count = 6) {
    const pool = new THREE.PlaneGeometry(POOL_R * 2, POOL_R * 2);
    pool.rotateX(-Math.PI / 2);
    const poolMat = new THREE.ShaderMaterial({
      uniforms: { k: this.kU },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float k; varying vec2 vUv; void main() { vec2 d = (vUv - 0.5) * 2.0; float f = max(0.0, 1.0 - dot(d, d)); gl_FragColor = vec4(vec3(1.0, 0.62, 0.26) * k * 0.55 * f * (0.35 + 0.65 * f), 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3,
    });
    this.pools = new THREE.InstancedMesh(pool, poolMat, lamps.length);
    lamps.forEach((l, i) => {
      this.m.makeTranslation(l.x, 0.05, l.z);
      this.pools.setMatrixAt(i, this.m);
    });
    this.pools.name = 'street-light-pools';
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 1;
    this.pools.visible = false;
    scene.add(this.pools);

    const pos = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => pos.set([l.x, l.y - 0.05, l.z], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.haloAlpha = new THREE.BufferAttribute(new Float32Array(lamps.length).fill(1), 1);
    g.setAttribute('alpha', this.haloAlpha);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { k: this.kU, scale: { value: 600 } },
      vertexShader: 'uniform float scale; attribute float alpha; varying float vA; void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 2.0 * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float k; varying float vA; void main() { vec2 d = gl_PointCoord - 0.5; float f = max(0.0, 1.0 - dot(d, d) * 4.0); gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * k * vA * f * f * 0.7, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.halos = new THREE.Points(g, haloMat);
    this.halos.name = 'street-light-halos';
    this.halos.frustumCulled = false;
    this.halos.visible = false;
    scene.add(this.halos);

    for (let i = 0; i < count; i++) {
      const p = new THREE.PointLight('#ffcf8a', 0, 26, 1.1);
      this.lights.push(p);
      scene.add(p);
    }
    this.order = lamps.map((_, i) => i);
    this.shownBroken = lamps.map(() => false);
  }

  /** k: how dark it is (0..1); (fx, fz): where the camera is looking; viewport height for halo size. */
  update(k: number, fx: number, fz: number, viewH: number): void {
    this.k = k;
    this.kU.value = k;
    const on = k > 0.01;
    this.pools.visible = on;
    this.halos.visible = on;
    (this.halos.material as THREE.ShaderMaterial).uniforms.scale.value = viewH * 0.9;
    // Knocked-down lamps go dark (and light up again when the town puts them back).
    let changed = false;
    this.lamps.forEach((l, i) => {
      if (l.prop.broken === this.shownBroken[i]) return;
      this.shownBroken[i] = l.prop.broken;
      this.m.makeTranslation(l.x, 0.05, l.z);
      if (l.prop.broken) this.m.scale(new THREE.Vector3(0, 0, 0));
      this.pools.setMatrixAt(i, this.m);
      this.haloAlpha.setX(i, l.prop.broken ? 0 : 1);
      changed = true;
    });
    if (changed) {
      this.pools.instanceMatrix.needsUpdate = true;
      this.haloAlpha.needsUpdate = true;
    }
    if (!on) {
      for (const p of this.lights) p.intensity = 0;
      return;
    }
    const d2 = (i: number) => (this.lamps[i].x - fx) ** 2 + (this.lamps[i].z - fz) ** 2;
    this.order.sort((a, b) => d2(a) - d2(b));
    let n = 0;
    for (const i of this.order) {
      if (n >= this.lights.length) break;
      const l = this.lamps[i];
      if (l.prop.broken) continue;
      const p = this.lights[n++];
      p.position.set(l.x, l.y - 0.4, l.z);
      p.intensity = k * 36;
    }
    for (; n < this.lights.length; n++) this.lights[n].intensity = 0;
  }

  /** Lamps lit right now (tests). */
  get litCount(): number {
    return this.k > 0.01 ? this.lamps.filter((l) => !l.prop.broken).length : 0;
  }
}
