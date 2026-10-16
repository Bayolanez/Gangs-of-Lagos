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
/**
 * Art style. 'clean' (the default) is a bright, soft isometric-illustration look: pale sky, high
 * sun, smooth shading, pastel buildings, mauve-grey roads, no ink lines; vehicles and people keep
 * their full colours so they stand out. 'dusk' is the original "Lagos dusk" look described above.
 * The choice belongs to this device (like graphics quality) and applies when the game loads.
 */
export type ArtStyle = 'clean' | 'dusk';
const SKEY = 'gangs-of-lagos/style';
export function loadStyle(): ArtStyle {
  try {
    if (localStorage.getItem(SKEY) === 'dusk') return 'dusk';
  } catch {
    /* storage blocked: default */
  }
  return 'clean';
}
export function storeStyle(s: ArtStyle): void {
  try {
    localStorage.setItem(SKEY, s);
  } catch {
    /* storage blocked */
  }
}
export const STYLE: ArtStyle = loadStyle();

const DUSK = {
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
  cloudLow: [1.0, 0.52, 0.66], // clouds lit pink underneath...
  cloudSun: [1.0, 0.8, 0.55], // ...and gold towards the sun
};
const CLEAN: typeof DUSK = {
  zenith: '#86b6e6',
  indigo: '#a9cbee',
  magenta: '#cfe1f5',
  coral: '#e8eef8',
  horizon: '#f6f2ee',
  haze: '#e4e9f2', // soft pale distance
  sunLight: '#fff4e6',
  skyFill: '#e4ecff', // light blue-lavender fill: soft, light shadows
  groundFill: '#d2c9de',
  ink: '#5b5f7a',
  cloudLow: [1.0, 1.0, 1.0],
  cloudSun: [1.0, 0.98, 0.93],
};
export const PALETTE = STYLE === 'clean' ? CLEAN : DUSK;

/** Dusk: a low sun in the west-north-west (long shadows). Clean: a high sun, short soft shadows. */
export const SUN_DIR = STYLE === 'clean' ? new THREE.Vector3(-0.42, 0.8, -0.45).normalize() : new THREE.Vector3(-0.62, 0.36, -0.7).normalize();

/** Clean style: building and street colours become calmer pastels (less saturated, a little lighter). */
export function styleColor(hex: string): string {
  if (STYLE !== 'clean') return hex;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.72, hsl.l + (1 - hsl.l) * 0.16);
  return `#${c.getHexString()}`;
}

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
      STYLE === 'clean'
        ? // Clean: smooth light, slightly flattened so each face reads as one calm tone.
          'float celNL = 0.18 + 0.82 * smoothstep( 0.0, 0.85, dotNL );\n\tvec3 irradiance = celNL * directLight.color;'
        : // Dusk: shadowed side, a lit band and a bright band, with narrow soft edges so it doesn't shimmer.
          'float celNL = smoothstep( 0.0, 0.06, dotNL ) * 0.68 + smoothstep( 0.34, 0.42, dotNL ) * 0.32;\n\tvec3 irradiance = celNL * directLight.color;',
    )
    // Sun highlights only on glossy things (cars, glass, water, wet-look roads), not on dusty pavements.
    .replace(spec, 'reflectedLight.directSpecular += min( irradiance * ( 1.0 - smoothstep( 0.45, 0.8, material.roughness ) ) * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ), vec3( 1.2 ) );'); // capped: a crisp glint, not a blinding bloom
}

const SKY_VERT = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 indigo; uniform vec3 magenta; uniform vec3 coral; uniform vec3 horizon; uniform vec3 sun; uniform vec3 cloudLow; uniform vec3 cloudSun; uniform float sunGlow;
uniform float cover; uniform vec3 overcastCol; uniform float overcast; uniform float stars; uniform vec3 discCol; uniform float flash;
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
  c += horizon * pow(s, 8.0) * sunGlow;
  // Long streaky clouds, lit pink underneath and gold towards the sun.
  // Clouds on a flat "ceiling" seen in perspective: seamless all round, streaks stretched along x.
  vec2 cp = d.xz / (h + 0.06) * vec2(0.9, 2.6);
  float band = smoothstep(0.03, 0.1, h) * (1.0 - smoothstep(0.28 + cover * 0.7, 0.5 + cover * 0.7, h));
  float cl = smoothstep(0.6 - cover * 0.5, 0.82 - cover * 0.32, fbm(cp + vec2(fbm(cp * 0.5) * 2.0, 0.0))) * band;
  // Night: a field of small stars, hidden by cloud.
  vec2 sp = floor(d.xz / (h + 0.25) * 140.0);
  c += vec3(step(0.9965, hash(sp)) * stars * smoothstep(0.08, 0.35, h) * (1.0 - cover));
  vec3 cloud = mix(cloudLow, cloudSun, pow(s, 3.0));
  cloud = mix(cloud, indigo * 1.3, smoothstep(0.32, 0.6, h) * 0.6);
  c = mix(c, cloud, cl * 0.75);
  float disc = smoothstep(0.9975, 0.9988, s) * (1.0 - overcast * 0.9);
  c = mix(c, discCol, disc);
  // Weather: an even grey overcast, and lightning.
  c = mix(c, overcastCol, overcast * smoothstep(-0.02, 0.15, d.y + 0.1));
  c += vec3(0.85, 0.88, 1.0) * flash;
  // Below the horizon: fade into the haze.
  if (d.y < 0.0) c = mix(horizon, coral * 0.8, clamp(-d.y * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lin = (hex: string) => new THREE.Color(hex); // THREE.Color stores linear values (ColorManagement)

/** Sky shader inputs (the environment changes them with the time of day and the weather). */
export function skyUniforms(): Record<string, THREE.IUniform> {
  return {
    zenith: { value: lin(PALETTE.zenith) },
    indigo: { value: lin(PALETTE.indigo) },
    magenta: { value: lin(PALETTE.magenta) },
    coral: { value: lin(PALETTE.coral) },
    horizon: { value: lin(PALETTE.horizon) },
    sun: { value: SUN_DIR.clone() },
    cloudLow: { value: new THREE.Color().setRGB(...(PALETTE.cloudLow as [number, number, number])) },
    cloudSun: { value: new THREE.Color().setRGB(...(PALETTE.cloudSun as [number, number, number])) },
    sunGlow: { value: STYLE === 'clean' ? 0.15 : 0.45 },
    cover: { value: 0 },
    overcastCol: { value: new THREE.Color(0.55, 0.58, 0.62) },
    overcast: { value: 0 },
    stars: { value: 0 },
    discCol: { value: new THREE.Color(1.25, 1.08, 0.7) },
    flash: { value: 0 },
  };
}

/** The sky dome. Follows the camera; drawn behind everything. Pass shared uniforms to keep two domes in step. */
export function makeSky(uniforms: Record<string, THREE.IUniform> = skyUniforms()): THREE.Mesh {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/** Image-based light from the sky (soft coloured fill and sunset reflections on cars, roads and water). */
export function skyEnvironment(renderer: THREE.WebGLRenderer, uniforms?: Record<string, THREE.IUniform>): THREE.Texture {
  const s = new THREE.Scene();
  const dome = makeSky(uniforms);
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

const INK = STYLE === 'dusk';
export const QUALITY_INFO: Record<Quality, { outline: boolean; bloom: boolean; env: boolean; shadow: number; maxRatio: number; label: string }> = {
  high: { outline: INK, bloom: true, env: true, shadow: 2048, maxRatio: 1.75, label: INK ? 'High: ink outlines, neon glow, sky reflections' : 'High: soft glow on lights, sky reflections' },
  medium: { outline: INK, bloom: false, env: true, shadow: 2048, maxRatio: 1.5, label: INK ? 'Medium: ink outlines and sky reflections, no glow' : 'Medium: sky reflections, no glow' },
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
  /** While set, the handle of every sign added is collected here (props group their signs). */
  capture: number[] | null = null;
  private handles: { key: string; i: number; m: THREE.Matrix4 }[] = [];
  private meshes = new Map<string, THREE.InstancedMesh>();

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
    this.capture?.push(this.handles.length);
    this.handles.push({ key, i: e.mats.length, m: this.tmp.matrix.clone() });
    e.mats.push(this.tmp.matrix.clone());
  }

  /** Hide or show one sign (signs on a pole that has been knocked down). */
  setHidden(handle: number, hidden: boolean): void {
    const h = this.handles[handle];
    const im = h && this.meshes.get(h.key);
    if (!im) return;
    im.setMatrixAt(h.i, hidden ? new THREE.Matrix4().makeScale(0, 0, 0) : h.m);
    im.instanceMatrix.needsUpdate = true;
  }

  build(scene: THREE.Scene): number {
    const quad = new THREE.PlaneGeometry(1, 1);
    let n = 0;
    for (const [key, e] of this.byText) {
      const tex = new THREE.CanvasTexture(neonCanvas(key.split('|')[0], e.colour, e.sub));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const street = e.colour === 'street';
      const glow = STYLE === 'clean' ? 1.15 : 1.9; // daylight: signs read as painted boards, not neon
      const m = street ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }) : new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(glow, glow, glow) });
      const im = new THREE.InstancedMesh(quad, m, e.mats.length);
      e.mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
      this.meshes.set(key, im);
      n += e.mats.length;
    }
    return n;
  }
}
