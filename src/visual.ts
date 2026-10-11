import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * "Lagos dusk" visual style: an original illustrated look for the whole game.
 *  - Cel lighting: every standard material gets a two-step light ramp instead of a smooth falloff
 *    (a shader-chunk patch, so it costs nothing extra and also covers imported map tiles).
 *  - A golden-hour sky: indigo and teal above, magenta and coral clouds, an amber horizon and a low sun.
 *  - Ink outlines from the depth buffer and a soft glow on neon signs and lamps (post effects that
 *    the quality setting can turn off).
 * Colours are tuned so roads, pavements, markers, people and vehicles stay easy to tell apart.
 */
export const PALETTE = {
  zenith: '#123a5a', // deep teal
  indigo: '#2d2f72',
  magenta: '#b8468f',
  coral: '#f06f7c',
  horizon: '#ffb072', // warm amber
  haze: '#e58f86', // distance fog: coral haze between the horizon and the clouds
  sunLight: '#ffbe86',
  skyFill: '#7f9fe0', // hemisphere sky (cool teal-blue fill in shadows)
  groundFill: '#5b3a68', // hemisphere ground (indigo-violet bounce)
  ink: '#1b1233', // outline colour
};

/** Low sun in the west-north-west: long shadows and warm faces on east-facing walls. */
export const SUN_DIR = new THREE.Vector3(-0.62, 0.36, -0.7).normalize();

let celInstalled = false;
/** Two-band toon ramp on direct light for every MeshStandardMaterial (call once, before rendering). */
export function installCelShading(): void {
  if (celInstalled) return;
  celInstalled = true;
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const from = 'vec3 irradiance = dotNL * directLight.color;';
  if (!chunk.includes(from)) {
    console.warn('Cel shading: three.js light chunk changed; keeping smooth lighting.');
    return;
  }
  const spec = 'reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );';
  THREE.ShaderChunk.lights_physical_pars_fragment = chunk
    .replace(
      from,
      // Shadowed side, a lit band and a bright band, with narrow soft edges so it doesn't shimmer.
      'float celNL = smoothstep( 0.0, 0.06, dotNL ) * 0.68 + smoothstep( 0.34, 0.42, dotNL ) * 0.32;\n\tvec3 irradiance = celNL * directLight.color;',
    )
    // Sun highlights only on glossy things (cars, glass, water, wet-look roads), not on dusty pavements.
    .replace(spec, spec.replace('irradiance *', 'irradiance * ( 1.0 - smoothstep( 0.45, 0.8, material.roughness ) ) *'));
}

const SKY_VERT = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 indigo; uniform vec3 magenta; uniform vec3 coral; uniform vec3 horizon; uniform vec3 sun;
varying vec3 vD;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.15; }
void main(){
  vec3 d = normalize(vD);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(horizon, coral, smoothstep(0.0, 0.07, h));
  c = mix(c, magenta, smoothstep(0.05, 0.2, h));
  c = mix(c, indigo, smoothstep(0.18, 0.5, h));
  c = mix(c, zenith, smoothstep(0.45, 1.0, h));
  float s = max(dot(d, sun), 0.0);
  // Warm glow round the sun, then the disc itself.
  c += horizon * pow(s, 8.0) * 0.45;
  // Long streaky clouds, lit pink underneath and gold towards the sun.
  // Clouds on a flat "ceiling" seen in perspective: seamless all round, streaks stretched along x.
  vec2 cp = d.xz / (h + 0.06) * vec2(0.9, 2.6);
  float band = smoothstep(0.03, 0.1, h) * (1.0 - smoothstep(0.28, 0.5, h));
  float cl = smoothstep(0.6, 0.82, fbm(cp + vec2(fbm(cp * 0.5) * 2.0, 0.0))) * band;
  vec3 cloud = mix(vec3(1.0, 0.52, 0.66), vec3(1.0, 0.8, 0.55), pow(s, 3.0));
  cloud = mix(cloud, indigo * 1.3, smoothstep(0.32, 0.6, h) * 0.6);
  c = mix(c, cloud, cl * 0.75);
  float disc = smoothstep(0.9975, 0.9988, s);
  c = mix(c, vec3(1.25, 1.08, 0.7), disc);
  // Below the horizon: fade into the haze.
  if (d.y < 0.0) c = mix(horizon, coral * 0.8, clamp(-d.y * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (hex: string) => new THREE.Color(hex); // THREE.Color stores linear values (ColorManagement)

/** The dusk sky dome. Follows the camera; drawn behind everything. */
export function makeSky(): THREE.Mesh {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: lin(PALETTE.zenith) },
        indigo: { value: lin(PALETTE.indigo) },
        magenta: { value: lin(PALETTE.magenta) },
        coral: { value: lin(PALETTE.coral) },
        horizon: { value: lin(PALETTE.horizon) },
        sun: { value: SUN_DIR.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/** Image-based light from the sky (soft coloured fill and sunset reflections on cars, roads and water). */
export function skyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const dome = makeSky();
  dome.scale.setScalar(0.05);
  s.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02, 0.1, 100);
  pm.dispose();
  return rt.texture;
}

// ---------- Quality ----------
export type Quality = 'high' | 'medium' | 'low';
export type QualityChoice = 'auto' | Quality;
const QKEY = 'gangs-of-lagos/graphics';

/** The player's graphics choice. It belongs to this device, not to the save, so it is kept separately. */
export function loadQualityChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(QKEY);
    if (v === 'auto' || v === 'high' || v === 'medium' || v === 'low') return v;
  } catch {
    /* storage blocked: use auto */
  }
  return 'auto';
}
export function storeQualityChoice(q: QualityChoice): void {
  try {
    localStorage.setItem(QKEY, q);
  } catch {
    /* storage blocked */
  }
}

/** Auto picks Low on software rendering (no GPU) and High otherwise. */
export function autoQuality(renderer: THREE.WebGLRenderer): Quality {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
  } catch {
    /* unknown GPU: assume it can cope */
  }
  return 'high';
}

export const QUALITY_INFO: Record<Quality, { outline: boolean; bloom: boolean; env: boolean; shadow: number; maxRatio: number; label: string }> = {
  high: { outline: true, bloom: true, env: true, shadow: 2048, maxRatio: 1.75, label: 'High: ink outlines, neon glow, sky reflections' },
  medium: { outline: true, bloom: false, env: true, shadow: 2048, maxRatio: 1.5, label: 'Medium: ink outlines and sky reflections, no glow' },
  low: { outline: false, bloom: false, env: false, shadow: 1024, maxRatio: 1, label: 'Low: no post effects, smaller shadows' },
};

const OUTLINE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1500 },
    ink: { value: lin(PALETTE.ink) },
    strength: { value: 0.85 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 texel; uniform float cameraNear; uniform float cameraFar;
    uniform vec3 ink; uniform float strength; varying vec2 vUv;
    // 1/distance is linear across the screen for flat surfaces, so its second difference is ~0 on
    // walls and roads and spikes at silhouettes and creases.
    float inv(vec2 uv){ return 1.0 / max(-perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar), 1e-3); }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      float c = inv(vUv);
      float l = inv(vUv - vec2(texel.x, 0.0)), r = inv(vUv + vec2(texel.x, 0.0));
      float u = inv(vUv + vec2(0.0, texel.y)), d = inv(vUv - vec2(0.0, texel.y));
      float lap = (abs(l + r - 2.0 * c) + abs(u + d - 2.0 * c)) / c;
      float dist = 1.0 / c;
      float edge = smoothstep(0.01, 0.035, lap) * (1.0 - smoothstep(90.0, 260.0, dist));
      col.rgb = mix(col.rgb, ink, edge * strength);
      gl_FragColor = col;
    }`,
};

/**
 * Post effects: scene -> ink outlines -> neon glow -> tone mapping. With quality Low the game renders
 * straight to the screen instead (no extra passes).
 */
export class PostFX {
  private composer: EffectComposer;
  private outline: ShaderPass;
  private bloom: UnrealBloomPass;
  /** The scene renders here first (colour + its own depth texture), so no pass ever reads the depth it draws into. */
  private sceneTarget: THREE.WebGLRenderTarget;
  private lines = true;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.sceneTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4) });
    this.composer = new EffectComposer(renderer);
    // 'tSource' instead of the default 'tDiffuse' binding: the outline pass reads the scene target, not the composer buffer.
    this.outline = new ShaderPass(OUTLINE_SHADER, 'tSource');
    const m = this.outline.material as THREE.ShaderMaterial;
    m.depthTest = false;
    m.depthWrite = false;
    this.outline.uniforms.tDiffuse.value = this.sceneTarget.texture;
    this.outline.uniforms.tDepth.value = this.sceneTarget.depthTexture;
    this.composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 1.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  configure(q: Quality): void {
    const info = QUALITY_INFO[q];
    this.enabled = info.outline || info.bloom;
    this.lines = info.outline;
    this.bloom.enabled = info.bloom;
  }

  /** Turn the glow off on its own (adaptive quality on slow machines). */
  dropBloom(): boolean {
    if (!this.enabled || !this.bloom.enabled) return false;
    this.bloom.enabled = false;
    this.enabled = this.lines;
    return true;
  }

  setSize(w: number, h: number, ratio: number): void {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.sceneTarget.setSize(Math.max(1, Math.floor(w * ratio)), Math.max(1, Math.floor(h * ratio)));
    // Lines about one CSS pixel wide whatever the resolution.
    this.outline.uniforms.texel.value.set(ratio / Math.max(1, w * ratio), ratio / Math.max(1, h * ratio));
  }

  render(dt: number): void {
    const u = this.outline.uniforms;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.strength.value = this.lines ? 0.85 : 0;
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.composer.render(dt);
  }

  get state(): { outline: boolean; bloom: boolean } {
    return { outline: this.enabled && this.lines, bloom: this.enabled && this.bloom.enabled };
  }
}

// ---------- Neon signs ----------
const NEON = ['#ff4fa3', '#3ff0ff', '#ffb43c', '#b46cff', '#5dff9a', '#ff6a4d'];

/** Canvas for a glowing shop sign: dark board, a neon border and glowing letters. */
function neonCanvas(text: string, colour: string, sub?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  if (colour === 'street') {
    // Green street-name plate with a white border and lettering.
    g.fillStyle = '#16603f';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#f4efe6';
    g.lineWidth = 8;
    g.strokeRect(10, 10, 492, 108);
    let size = 66;
    g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    while (g.measureText(text).width > 450 && size > 24) g.font = `800 ${(size -= 4)}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f4efe6';
    g.fillText(text, 256, 68);
    return c;
  }
  g.fillStyle = '#140d26';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = colour;
  g.lineWidth = 5;
  g.shadowColor = colour;
  g.shadowBlur = 14;
  g.strokeRect(10, 10, 492, 108);
  let size = 64;
  g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  while (g.measureText(text).width > 460 && size > 24) g.font = `800 ${(size -= 4)}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.shadowBlur = 18;
  g.fillText(text, 256, sub ? 54 : 66);
  g.fillStyle = colour;
  g.shadowBlur = 6;
  g.fillText(text, 256, sub ? 54 : 66);
  if (sub) {
    g.font = '700 22px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.fillStyle = '#f7e9d0';
    g.shadowBlur = 0;
    g.fillText(sub, 256, 100);
  }
  return c;
}

/**
 * Collects neon shop signs and builds one instanced mesh per sign design (a handful of draw calls
 * for the whole district). Signs are unlit and slightly over-bright so the glow pass catches them.
 */
export class NeonSigns {
  private byText = new Map<string, { colour: string; sub?: string; mats: THREE.Matrix4[] }>();
  private tmp = new THREE.Object3D();
  /** Where every sign went (tests and debugging). */
  readonly placed: { text: string; x: number; y: number; z: number; yaw: number }[] = [];

  /** A sign `w` by `h` metres centred at (x, y, z), facing direction `yaw` (0 = +z). colour 'street' = green street plate (lit normally). */
  add(text: string, x: number, y: number, z: number, w: number, h: number, yaw: number, colour?: string, sub?: string): void {
    this.placed.push({ text, x, y, z, yaw });
    const key = `${text}|${sub ?? ''}`;
    let e = this.byText.get(key);
    if (!e) {
      e = { colour: colour ?? NEON[this.byText.size % NEON.length], sub, mats: [] };
      this.byText.set(key, e);
    }
    this.tmp.position.set(x, y, z);
    this.tmp.rotation.set(0, yaw, 0);
    this.tmp.scale.set(w, h, 1);
    this.tmp.updateMatrix();
    e.mats.push(this.tmp.matrix.clone());
  }

  build(scene: THREE.Scene): number {
    const quad = new THREE.PlaneGeometry(1, 1);
    let n = 0;
    for (const [key, e] of this.byText) {
      const tex = new THREE.CanvasTexture(neonCanvas(key.split('|')[0], e.colour, e.sub));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const street = e.colour === 'street';
      const m = street ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }) : new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.9, 1.9, 1.9) });
      const im = new THREE.InstancedMesh(quad, m, e.mats.length);
      e.mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
      n += e.mats.length;
    }
    return n;
  }
}
