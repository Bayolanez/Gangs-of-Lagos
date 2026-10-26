// Gangs of Lagos base human on the Quaternius Universal Animation Library skeleton (CC0, Unreal-style bone names).
// We keep the UAL armature and its 43 animations, drop the wooden mannequin mesh, and build:
//   - a smooth skinned body (torso, arms, legs, hands with fingers, neck) in the skeleton's T-pose bind space,
//   - a head with a face (rigid on the Head bone) with swappable hair and beard,
//   - skinned clothing pieces (tee, shirt, senator kaftan, trousers, jeans, shorts, shoes, sandals) + hats.
// Every piece gets bone weights from the same rules, so clothes follow the body in every animation.
// Units metres, faces +Z, feet at y = 0.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- small helpers
const V = (a) => new THREE.Vector3(...a);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function interp(P, y) { // P sorted by first value ascending: [[key, value], ...]
  if (y <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (y <= P[i][0]) { const [a, va] = P[i - 1], [b, vb] = P[i]; return va + (vb - va) * (y - a) / (b - a); }
  return P[P.length - 1][1];
}
function rnd(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function gridGeo(rows, cols, fn, closedCols = true) { // fn(j/rows, i/cols) -> [x,y,z]
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { pos.push(...fn(j / rows, i / cols)); uv.push(i / cols, j / rows); }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  void closedCols;
  return g;
}

// ---------------------------------------------------------------- body proportions (bind / T-pose space)
// Torso cross-sections: half-width, half-depth and depth-centre by height.
const BUILD_DEFAULT = { chest: 1, belly: 1, hips: 1, arms: 1, legs: 1, shoulders: 1 };
function torsoProfile(b, female = false) {
  if (female) {
    const W = [[0.84, 0.168 * b.hips], [0.9, 0.182 * b.hips], [0.96, 0.176 * b.hips], [1.04, 0.136 * b.belly], [1.12, 0.128 * b.belly], [1.22, 0.138 * b.chest], [1.32, 0.15 * b.chest], [1.4, 0.163 * b.shoulders], [1.445, 0.153 * b.shoulders], [1.475, 0.118], [1.5, 0.07], [1.52, 0.052]];
    const D = [[0.84, 0.104 * b.hips], [0.9, 0.116 * b.hips], [0.96, 0.112 * b.hips], [1.04, 0.09 * b.belly ** 1.6], [1.12, 0.092 * b.belly ** 1.4], [1.22, 0.1 * b.chest], [1.32, 0.102 * b.chest], [1.4, 0.09], [1.445, 0.08], [1.475, 0.064], [1.5, 0.052], [1.52, 0.047]];
    const Z = [[0.84, -0.034], [0.92, -0.038], [1.0, -0.024], [1.08, -0.014 + 0.02 * (b.belly - 1)], [1.2, -0.004], [1.3, 0.0], [1.42, -0.022], [1.52, -0.012]];
    return { W, D, Z, bust: 0.034 * b.chest, butt: 0.2 };
  }
  const W = [[0.84, 0.155 * b.hips], [0.9, 0.165 * b.hips], [0.96, 0.163 * b.hips], [1.04, 0.145 * b.belly], [1.12, 0.148 * b.belly], [1.22, 0.158 * b.chest], [1.32, 0.17 * b.chest], [1.4, 0.183 * b.shoulders], [1.445, 0.172 * b.shoulders], [1.475, 0.13], [1.5, 0.075], [1.52, 0.056]];
  const D = [[0.84, 0.1 * b.hips], [0.9, 0.11 * b.hips], [0.96, 0.108 * b.hips], [1.04, 0.098 * b.belly ** 1.6], [1.12, 0.104 * b.belly ** 1.4], [1.22, 0.11 * b.chest], [1.32, 0.114 * b.chest], [1.4, 0.098], [1.445, 0.085], [1.475, 0.068], [1.5, 0.056], [1.52, 0.05]];
  const Z = [[0.84, -0.03], [0.92, -0.032], [1.0, -0.02], [1.08, -0.01 + 0.02 * (b.belly - 1)], [1.2, 0.0], [1.3, 0.004], [1.42, -0.022], [1.52, -0.012]];
  return { W, D, Z, bust: 0, butt: 0.12 };
}
/** Point on the torso surface: angle a (0 = front, +pi/2 = wearer's left (+x)), height y, outward offset. */
function torsoPoint(T, a, y, off = 0) {
  const hw = interp(T.W, y) + off, hd = interp(T.D, y) + off, zc = interp(T.Z, y);
  // flatten the back a little and push the chest/butt forms
  let z = Math.cos(a) * hd;
  const x = Math.sin(a) * hw;
  if (Math.cos(a) < 0) z *= 0.92 + (T.butt ?? 0.12) * Math.exp(-((y - 0.9) ** 2) / 0.004);  // buttocks
  else if (T.bust) z += (T.bust + off * 0.3) * Math.exp(-((y - 1.3) ** 2) / 0.0035) * Math.exp(-((Math.abs(x) - 0.07) ** 2) / 0.0028) * Math.cos(a) ** 1.5;
  return [x, y, zc + z];
}
const ARM_R = [[0.13, 0.064], [0.2, 0.059], [0.28, 0.051], [0.4, 0.045], [0.466, 0.041], [0.55, 0.04], [0.68, 0.031], [0.745, 0.028]];
const ARM_Y = 1.441, ARM_Z = -0.066;
const LEG_R = [[0.08, 0.036], [0.15, 0.04], [0.3, 0.051], [0.4, 0.058], [0.5, 0.056], [0.56, 0.058], [0.7, 0.073], [0.82, 0.08], [0.9, 0.076], [0.96, 0.066]];
const LEG_X = 0.089;

// ---------------------------------------------------------------- skinning rules
// Each bone is a segment from its head to a child (or a fixed tip). A vertex is weighted to nearby segments
// (inverse distance^4, top 4), but only among the bones its body region is allowed to use.
function segments(bp) {
  const S = {};
  const add = (b, c) => { S[b] = [V(bp[b]), Array.isArray(c) ? V(c) : V(bp[c])]; };
  add('pelvis', 'spine_01'); add('spine_01', 'spine_02'); add('spine_02', 'spine_03'); add('spine_03', 'neck_01');
  add('neck_01', 'Head'); add('Head', [bp.Head[0], bp.Head[1] + 0.22, bp.Head[2] + 0.02]);
  for (const s of ['l', 'r']) {
    add(`clavicle_${s}`, `upperarm_${s}`); add(`upperarm_${s}`, `lowerarm_${s}`); add(`lowerarm_${s}`, `hand_${s}`); add(`hand_${s}`, `middle_01_${s}`);
    for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) { add(`${f}_01_${s}`, `${f}_02_${s}`); add(`${f}_02_${s}`, `${f}_03_${s}`); add(`${f}_03_${s}`, `${f}_04_leaf_${s}`); }
    add(`thigh_${s}`, `calf_${s}`); add(`calf_${s}`, `foot_${s}`); add(`foot_${s}`, `ball_${s}`); add(`ball_${s}`, `ball_leaf_${s}`);
  }
  return S;
}
const tmp = new THREE.Vector3(), ab = new THREE.Vector3();
function segDist(p, [a, b]) { ab.subVectors(b, a); const t = clamp01(tmp.subVectors(p, a).dot(ab) / ab.lengthSq()); return tmp.copy(a).addScaledVector(ab, t).distanceTo(p); }

/** Candidate bones (with bias) for a vertex of a given region. */
function candidates(region, p) {
  const x = p.x, y = p.y, s = x >= 0 ? 'l' : 'r', ax = Math.abs(x);
  const C = [];
  const add = (n, w = 1) => { if (w > 0.001) C.push([n, w]); };
  switch (region) {
    case 'torso':
      add('pelvis'); add('spine_01'); add('spine_02'); add('spine_03'); add('neck_01', smooth(1.44, 1.5, y));
      add(`clavicle_${s}`, smooth(0.06, 0.15, ax) * smooth(1.3, 1.42, y) * 0.9);
      add(`upperarm_${s}`, smooth(0.13, 0.19, ax) * smooth(1.36, 1.43, y) * 0.8);
      add(`thigh_${s}`, smooth(0.97, 0.86, y) * smooth(0.0, 0.07, ax) * 1.2);
      break;
    case 'arm':
      add(`clavicle_${s}`, smooth(0.24, 0.16, ax)); add(`upperarm_${s}`); add(`lowerarm_${s}`); add(`hand_${s}`); add('spine_03', smooth(0.2, 0.14, ax) * 0.6);
      break;
    case 'leg':
      add(`thigh_${s}`); add(`calf_${s}`); add(`foot_${s}`, smooth(0.2, 0.1, y)); add('pelvis', smooth(0.86, 0.97, y) * 1.2);
      break;
    case 'foot':
      add(`calf_${s}`, smooth(0.1, 0.16, y)); add(`foot_${s}`); add(`ball_${s}`);
      break;
    case 'neck':
      add('spine_03', smooth(1.5, 1.44, y)); add('neck_01'); add('Head', smooth(1.56, 1.62, y));
      break;
    case 'hand':
      add(`hand_${s}`); add(`lowerarm_${s}`, smooth(0.76, 0.72, ax) * 0.8);
      break;
    default:
      if (region.startsWith('finger:')) { const f = region.slice(7); add(`hand_${s}`, 0.6); for (const k of ['01', '02', '03']) add(`${f}_${k}_${s}`); }
  }
  return C;
}
function autoSkin(geo, region, ctx, custom) {
  const p = geo.attributes.position, n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i);
    let list;
    if (custom) list = custom(v);
    else {
      list = candidates(typeof region === 'function' ? region(v) : region, v).map(([name, bias]) => {
        const d = segDist(v, ctx.seg[name]);
        return [name, bias / Math.pow(d + 0.012, 4)];
      });
    }
    list.sort((a, b) => b[1] - a[1]);
    const top = list.slice(0, 4), sum = top.reduce((s, t) => s + t[1], 0) || 1;
    top.forEach(([name, w], k) => { si[i * 4 + k] = ctx.idx[name]; sw[i * 4 + k] = w / sum; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

/** Weights for skirts, tunics and robes below the waist. */
function skirtWeights(T, v, { legShare = 0.65, calf = false } = {}) {
  const sideL = smooth(-0.06, 0.06, v.x), drop = smooth(0.86, 0.62, v.y);
  const front = smooth(-0.06, 0.08, v.z - interp(T.Z, 0.9));
  const share = drop * (0.25 + legShare * front + (calf ? 0.15 : 0));
  const calfK = calf ? smooth(0.62, 0.3, v.y) * 0.55 : 0;
  const th = share * (1 - calfK), cf = share * calfK;
  return [['pelvis', 1 - share], ['thigh_l', th * sideL + 1e-6], ['thigh_r', th * (1 - sideL) + 1e-6], ['calf_l', cf * sideL + 1e-6], ['calf_r', cf * (1 - sideL) + 1e-6]];
}
function skirtShell(T, yTop, yBot, flareTop, flareBot, rows = 26, cols = 60) {
  return gridGeo(rows, cols, (t, u) => {
    const y = yTop + (yBot - yTop) * t, a = u * Math.PI * 2, f = flareTop + (flareBot - flareTop) * Math.pow(t, 1.2);
    const yy = Math.max(y, 0.86);
    const hw = interp(T.W, Math.min(yy, 0.92)) + f + 0.012, hd = Math.max(interp(T.D, Math.min(yy, 0.92)), 0.112) + f * 0.9 + 0.03;
    let z = Math.cos(a) * hd; if (Math.cos(a) < 0) z *= 0.95 + 0.06 * (1 - t);
    return [Math.sin(a) * hw, y, interp(T.Z, 0.9) + z];
  });
}

// ---------------------------------------------------------------- generic sweeps
/** Sweep circles (optionally elliptical) along a straight axis. axis 'x' (arms) or 'y' (legs). */
function limbSweep({ axis, from, to, side = 1, radius, cx = 0, cy = 0, cz = 0, rows = 28, cols = 22, flat = 1 }) {
  return gridGeo(rows, cols, (t, u) => {
    const a = u * Math.PI * 2;
    if (axis === 'x') { const x = from + (to - from) * t, r = radius(x); return [side * x, cy + Math.sin(a) * r, cz + Math.cos(a) * r * flat]; }
    const y = from + (to - from) * t, r = radius(y);
    return [cx + Math.sin(a) * r * side, y, cz + Math.cos(a) * r * flat];
  });
}
function capsuleBetween(a, b, r, seg = 10) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 4, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function fanCap(T, y, off) { // close the bottom of a torso-like shell
  const cols = 32, pos = [0, y, interp(T.Z, y)], idx = [];
  for (let i = 0; i <= cols; i++) pos.push(...torsoPoint(T, (i / cols) * Math.PI * 2, y, off));
  for (let i = 1; i <= cols; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cols + 2) * 2), 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- materials
export const SKIN_TONES = { deep: '#4a2a1a', dark: '#5e3622', brown: '#7a4a2e', warm: '#94603e', caramel: '#b07650', light: '#cf9f7a' };
function skinMat(hex) {
  const r = rnd(7);
  const t = canvasTex(128, 128, (g, w, h) => { g.fillStyle = hex; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,220,200'},${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); } }, [3, 3]);
  return new THREE.MeshStandardMaterial({ name: `skin_${hex}`, map: t, roughness: 0.5 });
}
function fabric(name, hex, { rough = 0.85, weave = 0.05, repeat = [8, 8], draw = null, side = THREE.DoubleSide } = {}) {
  const r = rnd(name.length * 31 + 5);
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = hex; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * weave})`; g.fillRect(r() * w, r() * h, 2, 1); }
    if (draw) draw(g, w, h);
  }, repeat);
  return new THREE.MeshStandardMaterial({ name, map: t, roughness: rough, side });
}
/** Ankara-style wax print: bold original motifs (circles, leaves, dots) in a few colours. */
function ankara(name, colors, repeat = [4, 4]) {
  const [bg, a, b, c] = colors;
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const [cx, cy] of [[64, 64], [192, 192], [192, 64], [64, 192]]) {
      const big = (cx + cy) % 256 === 128;
      for (let r = big ? 52 : 34, k = 0; r > 6; r -= 10, k++) { g.fillStyle = [a, b, c, bg][k % 4]; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = c;
    for (const [cx, cy, rot] of [[128, 20, 0], [128, 236, Math.PI], [20, 128, -Math.PI / 2], [236, 128, Math.PI / 2], [128, 128, Math.PI / 4]]) {
      g.save(); g.translate(cx, cy); g.rotate(rot); g.beginPath(); g.ellipse(0, 0, 9, 22, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.fillStyle = b; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc((i * 47) % 256, (i * 89) % 256, 3, 0, Math.PI * 2); g.fill(); }
  }, repeat);
  return new THREE.MeshStandardMaterial({ name, map: t, roughness: 0.7, side: THREE.DoubleSide });
}
const denim = (hex) => fabric(`denim_${hex}`, hex, { weave: 0.09, repeat: [10, 14], draw: (g, w, h) => { for (let y = 0; y < h; y += 3) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, 0, 1, h); } } });

// ---------------------------------------------------------------- head (rigid on the Head bone)
let HEAD_FEMALE = false;
function headShape(nx, ny, nz) {
  const fs = HEAD_FEMALE ? 0.955 : 1;
  let x = nx * 0.088 * fs, y = ny * 0.118 * (HEAD_FEMALE ? 0.97 : 1), z = nz * 0.098 * fs;
  if (ny < 0) { const t = -ny; x *= 1 - (HEAD_FEMALE ? 0.38 : 0.32) * Math.pow(t, 1.3); z *= 1 - 0.08 * t; if (nz > 0) z += 0.014 * t * nz; y -= 0.01 * t; }
  if (nz < 0 && ny > -0.3) z *= 1.06;
  if (ny > 0.15 && nz > 0.5) z *= 0.975;
  z += 0.005 * Math.exp(-((ny + 0.05) ** 2) / 0.02) * Math.exp(-((Math.abs(nx) - 0.55) ** 2) / 0.03) * Math.max(0, nz);
  z += (HEAD_FEMALE ? 0.002 : 0.006) * Math.exp(-((ny - 0.18) ** 2) / 0.006) * Math.max(0, nz) ** 2; // brow ridge
  return [x, y, z];
}
function buildHead(o, M) {
  HEAD_FEMALE = !!o.female;
  const F = HEAD_FEMALE;
  const head = new THREE.Group(); head.name = 'head_rig';
  const g = new THREE.SphereGeometry(1, 56, 42), pos = g.attributes.position, unit = pos.array.slice();
  for (let i = 0; i < pos.count; i++) { const [x, y, z] = headShape(unit[i * 3], unit[i * 3 + 1], unit[i * 3 + 2]); pos.setXYZ(i, x, y, z); }
  g.computeVertexNormals();
  const add = (name, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(...p); m.rotation.set(...r); if (s) m.scale.set(...s); head.add(m); return m; };
  add('head_skin', g, M.skin);
  const probe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const faceZ = (x, y) => { ray.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)); const h = ray.intersectObject(probe, false)[0]; return h ? h.point.z : 0.08; };
  const tube = (pts, r, seg = 20) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V(p))), seg, r, 8, false);
  for (const s of [-1, 1]) {
    const ex = 0.034 * s, ey = 0.006;
    const eye = new THREE.Group(); eye.position.set(ex, ey, faceZ(ex, ey) - 0.009); head.add(eye);
    const e = (n, geo, mat, p = [0, 0, 0], r = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.name = n; m.position.set(...p); m.rotation.set(...r); eye.add(m); };
    e('eye_white', new THREE.SphereGeometry(0.0178, 20, 14), M.eyeWhite);
    e('iris', new THREE.SphereGeometry(0.018, 20, 10, 0, Math.PI * 2, 0, 0.6), M.iris, [0, 0, 0], [Math.PI / 2, 0, 0]);
    e('pupil', new THREE.SphereGeometry(0.0182, 16, 6, 0, Math.PI * 2, 0, 0.24), M.pupil, [0, 0, 0], [Math.PI / 2, 0, 0]);
    e('eye_shine', new THREE.SphereGeometry(0.0017, 6, 4), M.shine, [0.004, 0.005, 0.017]);
    const lid = new THREE.Group(); lid.rotation.x = 0.35; eye.add(lid);
    const lm = new THREE.Mesh(new THREE.SphereGeometry(0.0192, 20, 10, 0, Math.PI * 2, 0, 1.0), M.skin); lm.name = 'lid_upper'; lid.add(lm);
    if (F) { const lash = new THREE.Mesh(new THREE.TorusGeometry(0.0192 * Math.sin(1.0), 0.0016, 6, 24, Math.PI), M.hair); lash.name = 'lashes'; lash.position.y = 0.0192 * Math.cos(1.0); lash.rotation.set(Math.PI / 2, 0, Math.PI); lash.scale.set(1.05, 1.05, 1); lid.add(lash); const flick = new THREE.Mesh(new THREE.ConeGeometry(0.0022, 0.008, 5), M.hair); flick.position.set(0.019 * s, 0.006, -0.002); flick.rotation.z = -1.1 * s; eye.add(flick); }
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6, bx = (0.012 + t * 0.046) * s, by = 0.037 + Math.sin(t * Math.PI * 0.85) * 0.009 - t * 0.004; pts.push([bx, by, faceZ(bx, by) + 0.002]); }
    add('brow', tube(F ? pts.map(([bx, by, bz], i) => [bx, by + 0.003 + Math.sin((i / 6) * Math.PI) * 0.003, bz]) : pts, F ? 0.0031 : 0.0048), M.hair);
    if (o.earrings) { const hoop = add('earring', new THREE.TorusGeometry(F ? 0.014 : 0.006, 0.0016, 6, 24), M.gold, [0.09 * s, F ? -0.042 : -0.03, -0.004], [0, Math.PI / 2, 0]); void hoop; }
    add('ear', new THREE.SphereGeometry(1, 16, 12), M.skin, [0.087 * s, 0.0, -0.01], [0, 0.35 * s, 0], [0.011, 0.025, 0.017]);
  }
  const nz = faceZ(0, -0.035);
  add('nose_bridge', new THREE.CapsuleGeometry(0.0075, 0.022, 4, 10), M.skin, [0, -0.01, faceZ(0, -0.01) - 0.003], [0.12, 0, 0]);
  add('nose_tip', new THREE.SphereGeometry(1, 18, 14), M.skin, [0, -0.034, nz - 0.001], [0, 0, 0], F ? [0.015, 0.012, 0.013] : [0.018, 0.014, 0.015]);
  for (const s of [-1, 1]) add('nostril_wing', new THREE.SphereGeometry(1, 12, 10), M.skin, [0.013 * s, -0.04, nz - 0.009], [0, 0, 0], [0.0085, 0.0075, 0.008]);
  const curve = (yb, lift, w, dz) => { const p = []; for (let i = 0; i <= 10; i++) { const t = (i / 10) * 2 - 1, x = t * w, y = yb + lift * t * t; p.push([x, y, faceZ(x, y) + dz]); } return p; };
  add('lip_upper', tube(curve(-0.064, 0.005, F ? 0.024 : 0.026, 0), F ? 0.0064 : 0.0056), M.lips);
  add('lip_lower', tube(curve(F ? -0.0725 : -0.071, 0.004, F ? 0.021 : 0.022, -0.001), F ? 0.0078 : 0.0066), M.lips);
  // hair
  const hairCap = (hairline, thick, mat, bumps = 0, seed = 3) => {
    const hg = new THREE.SphereGeometry(1, 48, 36), hp = hg.attributes.position, u = hp.array.slice(), R = rnd(seed);
    for (let i = 0; i < hp.count; i++) {
      const nx = u[i * 3], ny = u[i * 3 + 1], nz2 = u[i * 3 + 2];
      let [x, y, z] = headShape(nx, ny, nz2);
      const k = 1 + thick + (bumps ? bumps * (0.6 + 0.4 * Math.sin(nx * 23 + ny * 17) * Math.cos(nz2 * 19) + 0.2 * R()) : 0);
      x *= k; y = y * k + thick * 0.02; z *= k;
      hp.setXYZ(i, x, y, z);
    }
    const keep = (i) => { const nx = u[i * 3], ny = u[i * 3 + 1], nz2 = u[i * 3 + 2]; const front = nz2 > 0.35 ? hairline : nz2 < -0.3 ? -0.35 : hairline - 0.45 * (0.35 - nz2) / 0.65; return ny > front - (Math.abs(nx) > 0.8 ? 0.15 : 0); };
    const idx = hg.index.array, nid = [];
    for (let t = 0; t < idx.length; t += 3) if (keep(idx[t]) && keep(idx[t + 1]) && keep(idx[t + 2])) nid.push(idx[t], idx[t + 1], idx[t + 2]);
    hg.setIndex(nid); hg.computeVertexNormals();
    return hg;
  };
  if (o.hair === 'lowcut') add('hair_lowcut', hairCap(0.38, 0.03, M.hairShort), M.hairShort);
  if (o.hair === 'afro') add('hair_afro', hairCap(0.36, 0.33, M.hairAfro, 0.05, 9), M.hairAfro);
  if (o.hair === 'waves') add('hair_waves', hairCap(0.4, 0.04, M.hairWaves), M.hairWaves);
  if (o.hair === 'braids' || o.hair === 'bun') add('hair_base', hairCap(0.42, 0.035, M.hairCorn), M.hairCorn);
  if (o.hair === 'bun') add('hair_bun', new THREE.SphereGeometry(0.05, 20, 14), M.hairShort, [0, 0.105, -0.06], [0, 0, 0], [1, 0.85, 1]);
  if (o.hair === 'braids') {
    // long box braids: rooted on the scalp, falling down the back (rigid with the head)
    const R = rnd(21), strands = [], beads = [];
    for (let k = 0; k < 70; k++) {
      const th = (k / 70) * Math.PI * 2, ny0 = 0.25 + 0.45 * R();
      const nx = Math.cos(th) * Math.sqrt(1 - ny0 * ny0), nz0 = Math.sin(th) * Math.sqrt(1 - ny0 * ny0);
      if (nz0 > 0.55) continue; // keep the face clear
      const [x0, y0, z0] = headShape(nx, ny0, nz0);
      const out = new THREE.Vector3(x0, 0, z0).normalize();
      const L = 0.26 + 0.08 * R();
      const pts = [V([x0 * 1.03, y0, z0 * 1.03]), V([x0 * 1.25 + out.x * 0.02, y0 - 0.05, z0 * 1.2 - 0.015]), V([x0 * 1.15 + out.x * 0.04, y0 - L * 0.55, Math.min(z0, 0.02) * 1.1 - 0.05]), V([x0 * 1.05 + out.x * 0.045, y0 - L, Math.min(z0, 0.0) - 0.07])];
      strands.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.0055, 5, false));
      if (k % 3 === 0) beads.push(new THREE.CylinderGeometry(0.0072, 0.0072, 0.012, 8).translate(pts[3].x, pts[3].y + 0.012, pts[3].z));
    }
    add('hair_braids', mergeGeometries(strands), M.hairBraid);
    if (beads.length) add('braid_cuffs', mergeGeometries(beads), M.gold);
  }
  if (o.beard === 'goatee' || o.beard === 'full') {
    add('moustache', tube(curve(-0.055, 0.004, 0.022, 0.003), 0.003), M.hair);
    add('goatee', new THREE.SphereGeometry(1, 16, 12), M.hair, [0, -0.1, faceZ(0, -0.095) - 0.01], [0.25, 0, 0], [0.02, 0.022, 0.014]);
  }
  if (o.beard === 'full') {
    const bg = new THREE.SphereGeometry(1, 40, 30), bp2 = bg.attributes.position, u = bp2.array.slice();
    for (let i = 0; i < bp2.count; i++) { const [x, y, z] = headShape(u[i * 3], u[i * 3 + 1], u[i * 3 + 2]); bp2.setXYZ(i, x * 1.03, y * 1.02, z * 1.04); }
    const keep = (i) => { const ny = u[i * 3 + 1], nz2 = u[i * 3 + 2], nx = u[i * 3]; return ny < -0.25 && nz2 > -0.4 && Math.abs(nx) > 0.05 - ny * 0.0 && !(nz2 > 0.6 && ny > -0.62 && Math.abs(nx) < 0.32); };
    const idx = bg.index.array, nid = [];
    for (let t = 0; t < idx.length; t += 3) if (keep(idx[t]) && keep(idx[t + 1]) && keep(idx[t + 2])) nid.push(idx[t], idx[t + 1], idx[t + 2]);
    bg.setIndex(nid); bg.computeVertexNormals();
    add('beard_full', bg, M.hairShort);
  }
  return head;
}

// ---------------------------------------------------------------- hats (rigid on the Head bone, head-local coords)
function hat(kind, color) {
  const g = new THREE.Group(); g.name = `hat_${kind}`;
  const m = (geo, hex, p = [0, 0, 0], r = [0, 0, 0], s) => { const x = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 })); x.position.set(...p); x.rotation.set(...r); if (s) x.scale.set(...s); g.add(x); return x; };
  if (kind === 'cap') {
    m(new THREE.SphereGeometry(0.097, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), color, [0, 0.035, -0.004], [0, 0, 0], [1, 0.85, 1.08]);
    m(new THREE.CylinderGeometry(0.085, 0.085, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), color, [0, 0.038, 0.07], [0.12, 0, 0], [0.95, 1, 0.95]);
    m(new THREE.SphereGeometry(0.009, 8, 6), color, [0, 0.118, -0.004]);
  } else if (kind === 'fila') {
    m(new THREE.CylinderGeometry(0.093, 0.098, 0.09, 28, 1, true), color, [0, 0.07, -0.008], [0.05, 0, -0.12]);
    m(new THREE.SphereGeometry(0.093, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), color, [0.018, 0.11, -0.008], [0.05, 0, -0.35], [1, 0.35, 1]);
  } else if (kind === 'gele' || kind === 'scarf') {
    // gele: a tall, sculpted head-tie with pleated fans; scarf: a simple low wrap
    const mat = typeof color === 'object' ? color : new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide });
    const mm = (geo, p = [0, 0, 0], r = [0, 0, 0], s) => { const x = new THREE.Mesh(geo, mat); x.position.set(...p); x.rotation.set(...r); if (s) x.scale.set(...s); g.add(x); return x; };
    mm(new THREE.SphereGeometry(0.096, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), [0, 0.04, -0.01], [-0.22, 0, 0], [1.03, 1.2, 1.12]);
    mm(new THREE.TorusGeometry(0.09, 0.014, 10, 36).rotateX(Math.PI / 2), [0, 0.052, -0.012], [-0.22, 0, 0], [1.02, 1, 1.12]);
    if (kind === 'gele') {
      for (let k = 0; k < 7; k++) {
        const a = -0.9 + k * 0.3;
        const fan = new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI, 0, Math.PI / 2);
        mm(fan, [Math.sin(a) * 0.05, 0.14 + Math.cos(a * 1.3) * 0.02, -0.04 + Math.cos(a) * 0.01], [-0.4 + Math.abs(a) * 0.3, a * 0.9, a * 0.6], [1.2, 1.5, 0.35]);
      }
      mm(new THREE.TorusKnotGeometry(0.028, 0.009, 48, 8, 2, 3), [0.05, 0.17, 0.0], [0.6, 0.4, 0]);
    }
  } else if (kind === 'beanie') {
    m(new THREE.SphereGeometry(0.1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), color, [0, 0.025, -0.004], [0, 0, 0], [1, 1.05, 1.08]);
    m(new THREE.TorusGeometry(0.094, 0.012, 8, 32).rotateX(Math.PI / 2), color, [0, 0.03, -0.004], [0, 0, 0], [1, 1, 1.08]);
  }
  return g;
}

// ---------------------------------------------------------------- clothing builders (bind space)
function shirtTorso(T, y0, y1, off, rows = 34, cols = 56, flare = null) {
  return gridGeo(rows, cols, (t, u) => {
    const y = y0 + (y1 - y0) * t, a = u * Math.PI * 2;
    const extra = flare ? flare(y) : 0;
    return torsoPoint(T, a, y, off + extra);
  });
}
function sleeve(side, x0, x1, off, flareEnd = 0, armScale = 1) {
  return limbSweep({ axis: 'x', from: x0, to: x1, side, cy: ARM_Y, cz: ARM_Z, rows: 22, cols: 20, radius: (x) => interp(ARM_R, x) * armScale + off + flareEnd * smooth(x0, x1, x) });
}
function trouserLeg(side, y0, y1, fitFn) {
  return limbSweep({ axis: 'y', from: y1, to: y0, side, cx: side * LEG_X, cz: 0, rows: 34, cols: 22, radius: fitFn });
}

// shoes: extruded side profiles (sole + upper) placed under the foot bone
function shoeGeos(side, kind) {
  const ex = (shape, depth, bevel) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 }); g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); return g; };
  const place = (g) => g.translate(side * LEG_X, 0.0, -0.03);
  const out = [];
  const chunky = kind === 'sneaker' || kind === 'skate';
  if (kind === 'heel') {
    const sole = new THREE.Shape(); sole.moveTo(-0.06, 0.07); sole.quadraticCurveTo(0.06, 0.06, 0.12, 0.0); sole.lineTo(0.22, 0.0); sole.quadraticCurveTo(0.24, 0.0, 0.236, 0.012); sole.lineTo(0.12, 0.014); sole.quadraticCurveTo(0.06, 0.075, -0.06, 0.082); sole.closePath();
    out.push(['sole', place(ex(sole, 0.07, 0.003))]);
    out.push(['heel', place(new THREE.CylinderGeometry(0.008, 0.012, 0.07, 10).translate(0, 0.035, -0.05))]);
    const up = new THREE.Shape(); up.moveTo(0.12, 0.012); up.quadraticCurveTo(0.17, 0.05, 0.235, 0.014); up.lineTo(0.12, 0.012);
    out.push(['upper', place(ex(up, 0.07, 0.006))]);
    const back = new THREE.Shape(); back.moveTo(-0.065, 0.078); back.lineTo(-0.065, 0.12); back.lineTo(-0.03, 0.115); back.lineTo(-0.03, 0.08); back.closePath();
    out.push(['upper', place(ex(back, 0.07, 0.006))]);
    return out;
  }
  const sole = new THREE.Shape();
  sole.moveTo(-0.07, 0.0); sole.lineTo(0.21, 0.0); sole.quadraticCurveTo(0.245, 0.0, 0.243, chunky ? 0.03 : 0.014); sole.lineTo(-0.074, chunky ? 0.03 : 0.014); sole.closePath();
  out.push(['sole', place(ex(sole, chunky ? (kind === 'skate' ? 0.094 : 0.088) : 0.08, 0.005))]);
  if (kind === 'slipper') {
    const strap = new THREE.Shape(); strap.moveTo(0.04, 0.012); strap.quadraticCurveTo(0.09, 0.06, 0.15, 0.012); strap.lineTo(0.04, 0.012);
    out.push(['strap', place(ex(strap, 0.086, 0.005))]);
    return out;
  }
  if (kind === 'sandal') {
    const strap = new THREE.Shape(); strap.moveTo(0.06, 0.012); strap.quadraticCurveTo(0.1, 0.07, 0.14, 0.012); strap.lineTo(0.12, 0.012); strap.quadraticCurveTo(0.1, 0.045, 0.08, 0.012); strap.closePath();
    out.push(['strap', place(ex(strap, 0.084, 0.004))]);
    return out;
  }
  const up = new THREE.Shape();
  const top = kind === 'skate' ? 0.125 : kind === 'sneaker' ? 0.118 : 0.1;
  up.moveTo(-0.066, 0.012); up.bezierCurveTo(-0.076, 0.05, -0.074, top - 0.015, -0.062, top);
  up.quadraticCurveTo(-0.01, top + 0.006, 0.035, top + 0.002); up.quadraticCurveTo(0.09, 0.075, 0.14, 0.06);
  up.quadraticCurveTo(0.21, 0.05, 0.238, 0.024); up.lineTo(0.238, 0.012); up.lineTo(-0.066, 0.012);
  out.push(['upper', place(ex(up, kind === 'skate' ? 0.08 : kind === 'sneaker' ? 0.074 : 0.066, 0.012))]);
  return out;
}

// ---------------------------------------------------------------- outfits
export const FITS = {
  street: {
    label: 'Street', top: { kind: 'tee', color: '#f1f1ee', print: 'EKO' }, bottom: { kind: 'jeans', color: '#2c4a7e' },
    shoes: { kind: 'sneaker', color: '#f6f6f6', sole: '#d23b2f' }, hat: { kind: 'cap', color: '#b3261e' }, hair: 'lowcut', beard: 'none',
  },
  senator: {
    label: 'Senator', top: { kind: 'kaftan', color: '#1f5a46', trim: '#d9b35a' }, bottom: { kind: 'trousers', color: '#1f5a46', wide: true },
    shoes: { kind: 'loafer', color: '#5a3a22', sole: '#2a1a10' }, hat: { kind: 'fila', color: '#1f5a46' }, hair: 'lowcut', beard: 'goatee',
  },
  office: {
    label: 'Office', top: { kind: 'shirt', color: '#f3f5f8', tie: '#7a1f2b' }, bottom: { kind: 'trousers', color: '#2f3237' },
    shoes: { kind: 'loafer', color: '#111113', sole: '#1b1b1b' }, hat: null, hair: 'waves', beard: 'full', belt: '#141414',
  },
  agbada: {
    label: 'Agbada', top: { kind: 'kaftan', color: '#e9e2d0', trim: '#c9a24a' }, bottom: { kind: 'trousers', color: '#e9e2d0', wide: true },
    agbada: { color: '#1c3f8c', embroidery: '#d9b35a' }, shoes: { kind: 'loafer', color: '#2a1a10', sole: '#1a100a' }, hat: { kind: 'fila', color: '#1c3f8c' }, hair: 'lowcut', beard: 'goatee',
  },
  blk_kng: {
    label: 'BLK KNG', top: { kind: 'sweatshirt', color: '#1d2a4f', print: 'BLK KNG', printColor: '#e8c25a' }, bottom: { kind: 'shorts', color: '#151517' },
    socks: { color: '#f2f2ef', stripes: ['#1d2a4f', '#c62828'] }, shoes: { kind: 'skate', color: '#c62828', sole: '#f4f4f2', stripe: '#f4f4f2' },
    hat: null, hair: 'lowcut', beard: 'none', chain: '#d4a640', earrings: true, skin: '#8a5434',
  },
  ankara: {
    label: 'Ankara dress', body: 'female', top: { kind: 'dress', print: ['#c2381f', '#f2b134', '#1e5f8a', '#1d1d1b'], length: 0.42 },
    shoes: { kind: 'heel', color: '#c2381f', sole: '#2a1a12' }, hat: { kind: 'gele', print: true }, hair: 'bun', earrings: true,
  },
  buba: {
    label: 'Buba and wrapper', body: 'female', top: { kind: 'blouse', color: '#f2ece0', lace: true }, bottom: { kind: 'wrapper', print: ['#5b2a6e', '#e2a63b', '#2f8a6a', '#f1e7d0'] },
    shoes: { kind: 'slipper', color: '#3a2a1e', sole: '#2a1a12' }, hat: { kind: 'scarf', color: '#5b2a6e' }, hair: 'braids', earrings: true,
  },
  street_f: {
    label: 'Street (women)', body: 'female', top: { kind: 'tee', color: '#141416', print: 'EKO', printColor: '#f2f2ee' }, bottom: { kind: 'jeans', color: '#5b7fb8' },
    shoes: { kind: 'sneaker', color: '#f6f6f6', sole: '#1e6b52' }, hat: null, hair: 'braids', earrings: true,
  },
  okada: {
    label: 'Okada rider', top: { kind: 'tee', color: '#e2b32a', print: '' }, bottom: { kind: 'shorts', color: '#3a3f2c' },
    shoes: { kind: 'sandal', color: '#2a2a2a', sole: '#3a2a1c' }, hat: { kind: 'beanie', color: '#1d1d1f' }, hair: 'lowcut', beard: 'none',
  },
};
export const BUILDS = {
  slim: { chest: 0.95, belly: 0.92, hips: 0.95, arms: 0.92, legs: 0.95, shoulders: 0.97 },
  average: BUILD_DEFAULT,
  athletic: { chest: 1.1, belly: 0.95, hips: 1.0, arms: 1.15, legs: 1.08, shoulders: 1.1 },
  heavy: { chest: 1.15, belly: 1.35, hips: 1.15, arms: 1.15, legs: 1.12, shoulders: 1.05 },
};

/**
 * Build a dressed human. ual = loaded gltf of UAL1_Standard.glb (its animations drive the result).
 * o = { fit, skin, build, hair, beard }   (fit can also be a full outfit object)
 */
export function buildHuman(ual, o = {}) {
  const fit = typeof o.fit === 'object' ? o.fit : FITS[o.fit || 'street'];
  const build = typeof o.build === 'object' ? o.build : BUILDS[o.build || 'average'];
  const root = SkeletonUtils.clone(ual.scene);
  root.name = `HUMAN_${(o.name || fit.label).replace(/\W+/g, '_').toUpperCase()}`;
  const base = []; root.traverse((m) => { if (m.isSkinnedMesh) base.push(m); });
  const ref = base[0], sk = ref.skeleton, parent = ref.parent;
  for (const m of base) m.parent.remove(m);
  // bind-space bone positions
  const bp = {}, idx = {};
  sk.bones.forEach((b, i) => { idx[b.name] = i; const m = new THREE.Matrix4().copy(sk.boneInverses[i]).invert().premultiply(ref.bindMatrix); bp[b.name] = new THREE.Vector3().setFromMatrixPosition(m).toArray(); });
  const ctx = { seg: segments(bp), idx };
  const female = (o.body || fit.body) === 'female';
  const T = torsoProfile(build, female);
  const armS = build.arms * (female ? 0.86 : 1), legS = build.legs * (female ? 1.02 : 1);
  const skinHex = SKIN_TONES[o.skin || fit.skin || 'brown'] || o.skin || fit.skin;
  const M = {
    skin: skinMat(skinHex), lips: new THREE.MeshStandardMaterial({ name: 'lips', color: new THREE.Color(skinHex).multiplyScalar(0.75), roughness: 0.45 }),
    eyeWhite: new THREE.MeshStandardMaterial({ name: 'eye_white', color: '#f3efe8', roughness: 0.15 }), iris: new THREE.MeshStandardMaterial({ name: 'iris', color: '#2b1a10', roughness: 0.2 }),
    pupil: new THREE.MeshStandardMaterial({ name: 'pupil', color: '#060505', roughness: 0.1 }), shine: new THREE.MeshStandardMaterial({ name: 'eye_shine', color: '#fff', emissive: '#fff', emissiveIntensity: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ name: 'hair', color: '#120e0c', roughness: 0.9 }),
    hairShort: fabric('hair_short', '#141110', { weave: 0.25, repeat: [6, 6], rough: 1, side: THREE.FrontSide }),
    hairAfro: fabric('hair_afro', '#16110e', { weave: 0.35, repeat: [10, 10], rough: 1, side: THREE.FrontSide }),
    gold: new THREE.MeshStandardMaterial({ name: 'gold', color: '#d4a640', metalness: 1, roughness: 0.25 }),
    hairBraid: fabric('hair_braid', '#17110e', { weave: 0.18, repeat: [2, 20], rough: 0.6, side: THREE.FrontSide, draw: (g, w, h) => { for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y, w, 3); } } }),
    hairCorn: fabric('hair_cornrow', '#130f0d', { weave: 0.2, repeat: [6, 2], rough: 0.8, side: THREE.FrontSide, draw: (g, w, h) => { for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, 0, 5, h); } } }),
    hairWaves: fabric('hair_waves', '#121010', { weave: 0.2, repeat: [3, 3], rough: 0.7, side: THREE.FrontSide, draw: (g, w, h) => { g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3; for (let k = 0; k < 14; k++) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, k * 18 + Math.sin(x * 0.12) * 4); g.stroke(); } } }),
  };
  const out = new THREE.Group(); out.name = 'human_parts'; parent.add(out);
  const skinned = (name, geo, region, mat, custom) => {
    autoSkin(geo, region, ctx, custom);
    const m = new THREE.SkinnedMesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    out.add(m); m.bind(sk, ref.bindMatrix); return m;
  };
  const top = fit.top || {}, bottom = fit.bottom || {};
  const covered = { torsoLow: false, torsoHigh: false };

  // ---- body (only what clothes don't fully cover): under long skirts, the thighs are not built at all
  const hemY = top.kind === 'dress' ? (top.length || 0.42) : bottom.kind === 'wrapper' ? 0.09 : fit.agbada ? 0.5 : null;
  const legTop = hemY == null ? 0.95 : Math.min(0.95, hemY + 0.07);
  skinned('body_torso', shirtTorso(T, 0.84, 1.52, 0, 30, 48), 'torso', M.skin);
  skinned('body_hips_cap', fanCap(T, 0.84, 0), 'torso', M.skin);
  for (const s of [1, -1]) {
    const sd = s > 0 ? 'l' : 'r';
    skinned(`body_arm_${sd}`, sleeve(s, 0.12, 0.75, 0, 0, armS), 'arm', M.skin);
    skinned(`body_leg_${sd}`, limbSweep({ axis: 'y', from: legTop, to: 0.07, side: 1, cx: s * LEG_X, rows: 34, cols: 20, radius: (y) => interp(LEG_R, y) * legS }), 'leg', M.skin);
    skinned(`body_shoulder_${sd}`, new THREE.SphereGeometry(0.058 * armS, 20, 14).translate(s * 0.15, ARM_Y - 0.008, ARM_Z + 0.018), 'arm', M.skin);
    // hand: palm + fingers along the finger bones
    const palm = new THREE.SphereGeometry(1, 18, 12).scale(0.062, 0.021, 0.047).translate(s * 0.8, ARM_Y - 0.004, -0.07);
    skinned(`body_hand_${sd}`, palm, 'hand', M.skin);
    for (const [f, r] of [['index', 0.0095], ['middle', 0.0098], ['ring', 0.0092], ['pinky', 0.0082], ['thumb', 0.0108]]) {
      const pts = ['01', '02', '03', '04_leaf'].map((k) => V(bp[`${f}_${k}_${sd}`]));
      if (f !== 'thumb') pts[0].lerp(V(bp[`hand_${sd}`]), 0.25);
      const parts = []; for (let k = 0; k < 3; k++) parts.push(capsuleBetween(pts[k], pts[k + 1], r * (1 - k * 0.08)));
      for (const pg of parts) skinned(`body_finger_${f}_${sd}`, pg, `finger:${f}`, M.skin);
    }
    // feet (bare feet show in sandals)
    const foot = new THREE.SphereGeometry(1, 18, 12).scale(0.043, 0.035, 0.12).translate(s * LEG_X, 0.04, 0.05);
    skinned(`body_foot_${sd}`, foot, 'foot', M.skin);
  }
  skinned('body_neck', limbSweep({ axis: 'y', from: 1.42, to: 1.64, side: 1, cx: 0, cz: -0.005, rows: 10, cols: 20, radius: (y) => 0.052 + 0.02 * smooth(1.5, 1.42, y) }), 'neck', M.skin);

  // ---- head on the Head bone (rigid)
  const head = buildHead({ hair: o.hair || fit.hair || 'lowcut', beard: female ? 'none' : (o.beard || fit.beard || 'none'), female, earrings: o.earrings ?? fit.earrings }, M);
  const headBone = sk.bones[idx.Head];
  root.updateMatrixWorld(true);
  const headBind = new THREE.Matrix4().copy(sk.boneInverses[idx.Head]).invert().premultiply(ref.bindMatrix);
  const want = new THREE.Matrix4().makeTranslation(bp.Head[0], bp.Head[1] + 0.105, bp.Head[2] + 0.018);
  // the child sits under the Head bone; at bind its world = headBind * local, so local = inverse(headBind) * want
  new THREE.Matrix4().copy(headBind).invert().multiply(want).decompose(head.position, head.quaternion, head.scale);
  headBone.add(head);
  if (fit.hat) {
    const hatColor = fit.hat.print ? ankara(`gele_print`, fit.top.print || fit.bottom.print, [2, 2]) : fit.hat.color;
    const h = hat(fit.hat.kind, hatColor);
    new THREE.Matrix4().copy(headBind).invert().multiply(want).decompose(h.position, h.quaternion, h.scale);
    headBone.add(h);
  }

  // ---- tops
  if (top.kind) {
    const off = top.kind === 'kaftan' ? 0.02 : top.kind === 'sweatshirt' ? 0.018 : top.kind === 'blouse' ? 0.02 : 0.012;
    const y0 = top.kind === 'kaftan' ? 0.84 : top.kind === 'shirt' ? 0.9 : top.kind === 'blouse' ? 0.8 : top.kind === 'dress' ? 0.84 : top.kind === 'sweatshirt' ? 0.9 : 0.86;
    let mat;
    const isPrint = top.kind === 'dress';
    if ((top.kind === 'tee' || top.kind === 'sweatshirt') && top.print) {
      const sweat = top.kind === 'sweatshirt';
      mat = fabric(`${top.kind}_${top.color}`, top.color, { repeat: [1, 1], weave: sweat ? 0.07 : 0.04, draw: (g, w, h) => {
        // print on the chest: u = 0 at the front seam, so draw at both edges of the texture
        g.fillStyle = top.printColor || '#1a1a1a'; g.textAlign = 'center';
        for (const cx of [0, w]) {
          if (sweat) { g.font = 'bold 24px DejaVu Sans, Arial'; const [l1, l2] = top.print.split(' '); g.fillText(l1, cx, h * 0.36); g.fillText(l2 || '', cx, h * 0.47); }
          else { g.font = 'bold 26px DejaVu Sans, Arial'; g.fillText(top.print, cx, h * 0.38); g.fillRect(cx - 34, h * 0.42, 68, 4); g.font = 'bold 12px DejaVu Sans, Arial'; g.fillText('LAGOS', cx, h * 0.48); }
        }
      } });
      mat.map.wrapS = THREE.RepeatWrapping;
    } else if (isPrint) {
      mat = ankara(`dress_print`, top.print, [5, 5]);
    } else if (top.kind === 'blouse') {
      mat = fabric(`blouse_${top.color}`, top.color, { weave: 0.03, repeat: [5, 5], rough: 0.6, draw: top.lace ? (g, w, h) => { g.strokeStyle = 'rgba(160,140,110,0.45)'; g.lineWidth = 2; for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) { g.beginPath(); g.arc(x + ((y / 32) % 2) * 16, y, 9, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x + ((y / 32) % 2) * 16, y, 3, 0, Math.PI * 2); g.stroke(); } } : null });
    } else if (top.kind === 'kaftan') {
      mat = fabric(`kaftan_${top.color}`, top.color, { weave: 0.04, repeat: [6, 6], rough: 0.7 });
    } else mat = fabric(`${top.kind}_${top.color}`, top.color, { weave: 0.04, repeat: [8, 8] });
    const sleeveMat = (top.kind === 'tee' || top.kind === 'sweatshirt') && top.print ? fabric(`${top.kind}_plain_${top.color}`, top.color, { weave: top.kind === 'sweatshirt' ? 0.07 : 0.04, repeat: [6, 6] }) : mat;
    const neckTop = top.kind === 'dress' || top.kind === 'blouse' ? 1.485 : 1.505;
    if (top.kind === 'blouse') skinned(`top_blouse_body`, shirtTorso(T, 0.86, neckTop, off), 'torso', mat);
    else skinned(`top_${top.kind}_body`, shirtTorso(T, Math.max(y0, 0.84), neckTop, off), 'torso', mat);
    const sleeveEnd = top.kind === 'tee' ? 0.33 : top.kind === 'dress' ? 0.3 : top.kind === 'blouse' ? 0.5 : top.kind === 'sweatshirt' ? 0.715 : 0.735;
    for (const s of [1, -1]) {
      const sd = s > 0 ? 'l' : 'r';
      const flare = top.kind === 'tee' ? 0.008 : top.kind === 'kaftan' ? 0.012 : top.kind === 'dress' ? 0.022 : top.kind === 'blouse' ? 0.035 : top.kind === 'sweatshirt' ? 0.01 : 0.004;
      skinned(`top_${top.kind}_sleeve_${sd}`, sleeve(s, 0.11, sleeveEnd, off + 0.004, flare, armS), 'arm', sleeveMat);
      skinned(`top_${top.kind}_shoulder_${sd}`, new THREE.SphereGeometry(0.058 * armS + off + 0.002, 20, 14).translate(s * 0.15, ARM_Y - 0.008, ARM_Z + 0.018), 'arm', sleeveMat);
      if (top.kind === 'sweatshirt') skinned(`top_cuff_${sd}`, limbSweep({ axis: 'x', from: 0.7, to: 0.745, side: s, cy: ARM_Y, cz: ARM_Z, rows: 4, cols: 20, radius: (x) => interp(ARM_R, x) * armS + 0.012 }), 'arm', sleeveMat);
      else if (top.kind !== 'tee' && top.kind !== 'dress' && top.kind !== 'blouse') skinned(`top_cuff_${sd}`, limbSweep({ axis: 'x', from: sleeveEnd - 0.03, to: sleeveEnd, side: s, cy: ARM_Y, cz: ARM_Z, rows: 3, cols: 20, radius: (x) => interp(ARM_R, x) * armS + off + 0.008 }), 'arm', sleeveMat);
    }
    // neckline band
    const band = (yy, offB, r, mat2, name) => {
      const pts = []; for (let k = 0; k <= 40; k++) pts.push(V(torsoPoint(T, (k / 40) * Math.PI * 2, yy, offB)));
      skinned(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, r, 8, true), 'torso', mat2);
    };
    band(neckTop - 0.005, off + 0.002, top.kind === 'sweatshirt' ? 0.013 : 0.009, sleeveMat, 'top_neck_band');
    if (top.kind === 'sweatshirt') {
      // ribbed hem band
      const hem = shirtTorso(T, 0.88, 0.93, off + 0.006, 3, 56);
      skinned('top_sweatshirt_hem', hem, 'torso', sleeveMat);
    }
    if (top.kind === 'dress' || top.kind === 'blouse') {
      // flared skirt (dress, to below the knee) or peplum hem (buba blouse, to the hip)
      const yBot = top.kind === 'dress' ? (top.length || 0.42) : 0.74;
      const sk = skirtShell(T, 0.88, yBot, off + (top.kind === 'blouse' ? 0.035 : 0.006), top.kind === 'dress' ? 0.13 : 0.085);
      skinned(`top_${top.kind}_skirt`, sk, 'torso', mat, (v) => skirtWeights(T, v, { legShare: 0.7, calf: top.kind === 'dress' }));
      if (top.kind === 'dress') {
        // a waist sash in a solid colour from the print
        const pts = []; for (let k = 0; k <= 40; k++) pts.push(V(torsoPoint(T, (k / 40) * Math.PI * 2, 1.04, off + 0.006)));
        skinned('dress_sash', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.016, 6, true), 'torso', new THREE.MeshStandardMaterial({ name: 'sash', color: top.print[3] || '#1d1d1b', roughness: 0.6 }));
      }
    }
    if (top.kind === 'kaftan') {
      // long body below the waist: a tunic that follows the pelvis and half-follows the thighs
      const skirt = gridGeo(20, 56, (t, u) => {
        const y = 0.84 - 0.24 * t, a = u * Math.PI * 2;
        const hw = interp(T.W, 0.9) + 0.03 + 0.035 * t, hd = interp(T.D, 0.9) + 0.04 + 0.03 * t;
        return [Math.sin(a) * hw, y, interp(T.Z, 0.9) + Math.cos(a) * hd];
      });
      // front panel drapes over the thighs (sitting, driving), back panel hangs from the hips
      const skirtW = (v) => {
        const sideL = smooth(-0.06, 0.06, v.x), drop = smooth(0.86, 0.62, v.y);
        const front = smooth(-0.06, 0.08, v.z - interp(T.Z, 0.9));
        const share = drop * (0.25 + 0.65 * front);
        return [['pelvis', 1 - share], ['thigh_l', share * sideL + 1e-6], ['thigh_r', share * (1 - sideL) + 1e-6]];
      };
      if (!fit.agbada) skinned('top_kaftan_skirt', skirt, 'torso', mat, skirtW);
      // gold embroidery: around the neckline, down the placket, and at the hem
      const gold = new THREE.MeshStandardMaterial({ name: 'embroidery_gold', color: top.trim || '#d9b35a', metalness: 0.6, roughness: 0.35 });
      band(1.488, off + 0.006, 0.0045, gold, 'embroidery_neck');
      const plk = []; for (let k = 0; k <= 12; k++) { const yy = 1.49 - k * 0.022; plk.push(V(torsoPoint(T, 0, yy, off + 0.004))); }
      skinned('embroidery_placket', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(plk), 30, 0.004, 6), 'torso', gold);
      for (const sx of [-1, 1]) {
        const sw = []; for (let k = 0; k <= 16; k++) { const t = k / 16, a = sx * (0.05 + 0.32 * Math.sin(t * Math.PI)), yy = 1.47 - t * 0.2; sw.push(V(torsoPoint(T, a, yy, off + 0.004))); }
        skinned('embroidery_swirl', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sw), 30, 0.0032, 6), 'torso', gold);
      }
      const hemPts = []; for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; hemPts.push(V([Math.sin(a) * (interp(T.W, 0.9) + 0.066), 0.605, interp(T.Z, 0.9) + Math.cos(a) * (interp(T.D, 0.9) + 0.071)])); }
      if (!fit.agbada) skinned('embroidery_hem', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPts, true), 80, 0.004, 6, true), 'torso', gold, skirtW);
      for (let k = 0; k < 4; k++) { const yy = 1.44 - k * 0.055; const [x, y, z] = torsoPoint(T, 0, yy, off + 0.008); skinned('kaftan_button', new THREE.SphereGeometry(0.006, 10, 8).translate(x, y, z), 'torso', gold); }
    }
    if (top.kind === 'shirt') {
      // collar, buttons, tie
      const white = mat;
      for (const sx of [-1, 1]) {
        const c = new THREE.ConeGeometry(0.03, 0.055, 3).rotateX(Math.PI).scale(1, 1, 0.3);
        const [x, y, z] = torsoPoint(T, sx * 0.35, 1.49, off + 0.012);
        c.rotateZ(sx * 0.55).translate(x, y - 0.01, z);
        skinned('shirt_collar', c, 'torso', white);
      }
      const btn = new THREE.MeshStandardMaterial({ name: 'button', color: '#dddddd', roughness: 0.3 });
      for (let k = 0; k < 6; k++) { const yy = 1.42 - k * 0.085; const [x, y, z] = torsoPoint(T, 0.12, yy, off + 0.003); skinned('shirt_button', new THREE.SphereGeometry(0.0045, 8, 6).translate(x, y, z), 'torso', btn); }
      if (top.tie) {
        const tieM = fabric(`tie_${top.tie}`, top.tie, { weave: 0.06, repeat: [3, 3], rough: 0.4, draw: (g, w, h) => { g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 6; for (let k = -h; k < w; k += 26) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); } } });
        const pts = [], wid = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16, yy = 1.485 - t * 0.43; pts.push(torsoPoint(T, 0, yy, off + 0.008)); wid.push(0.016 + 0.024 * smooth(0.0, 0.85, t) - 0.035 * smooth(0.93, 1.0, t)); }
        const tg = gridGeo(16, 1, (t, u) => { const k = Math.round(t * 16), p = pts[k]; return [p[0] + (u - 0.5) * 2 * Math.max(0.001, wid[k]), p[1], p[2] + 0.002]; });
        skinned('tie', tg, 'torso', tieM);
        const [kx, ky, kz] = torsoPoint(T, 0, 1.488, off + 0.014);
        skinned('tie_knot', new THREE.SphereGeometry(1, 12, 10).scale(0.017, 0.019, 0.012).translate(kx, ky, kz), 'torso', tieM);
      }
    }
  }

  // ---- bottoms
  if (bottom.kind === 'wrapper') {
    const mat = ankara('wrapper_print', bottom.print, [5, 7]);
    skinned('bottom_wrapper', skirtShell(T, 1.0, 0.09, 0.012, 0.05, 32, 60), 'torso', mat, (v) => v.y > 0.9 ? [['pelvis', 0.6], ['spine_01', 0.4]] : skirtWeights(T, v, { legShare: 0.75, calf: true }));
    const knotPts = []; for (let k = 0; k <= 40; k++) knotPts.push(V(torsoPoint(T, (k / 40) * Math.PI * 2, 0.99, 0.042)));
    skinned('wrapper_tuck', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(knotPts, true), 60, 0.012, 6, true), 'torso', mat);
  } else if (bottom.kind) {
    const isJeans = bottom.kind === 'jeans', isShorts = bottom.kind === 'shorts';
    const mat = isJeans ? denim(bottom.color) : fabric(`${bottom.kind}_${bottom.color}`, bottom.color, { weave: 0.05, repeat: [8, 12] });
    const off = 0.014;
    skinned(`bottom_${bottom.kind}_hips`, shirtTorso(T, 0.82, top.kind === 'shirt' ? 1.02 : 0.99, off, 10, 56), 'torso', mat);
    skinned(`bottom_${bottom.kind}_crotch`, fanCap(T, 0.82, off), 'torso', mat);
    const yEnd = isShorts ? 0.5 : 0.075;
    for (const s of [1, -1]) {
      const sd = s > 0 ? 'l' : 'r';
      const fitR = (y) => {
        const body = interp(LEG_R, y) * legS;
        if (isJeans) return body + 0.012 + 0.004 * smooth(0.4, 0.1, y);
        if (bottom.wide) return Math.max(body + 0.022, 0.078 - 0.01 * smooth(0.6, 0.1, y));
        if (isShorts) return body + 0.02 + 0.01 * smooth(0.8, 0.5, y);
        return Math.max(body + 0.018, 0.068);
      };
      skinned(`bottom_${bottom.kind}_leg_${sd}`, trouserLeg(s, yEnd, 0.93, fitR), 'leg', mat);
      if (isJeans) {
        const seam = []; for (let k = 0; k <= 20; k++) { const y = 0.95 - k * 0.043; seam.push(V([s * (LEG_X + fitR(y) + 0.0015), y, 0])); }
        skinned('jeans_seam', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 40, 0.0018, 4), 'leg', new THREE.MeshStandardMaterial({ name: 'stitch_orange', color: '#c8893a', roughness: 0.8 }));
        skinned(`jeans_cuff_${sd}`, limbSweep({ axis: 'y', from: 0.11, to: 0.075, side: 1, cx: s * LEG_X, rows: 2, cols: 20, radius: (y) => fitR(y) + 0.004 }), 'leg', mat);
      }
    }
    if (fit.belt || isJeans) {
      const pts = []; for (let k = 0; k <= 40; k++) pts.push(V(torsoPoint(T, (k / 40) * Math.PI * 2, 0.965, off + 0.006)));
      const beltM = new THREE.MeshStandardMaterial({ name: 'belt', color: fit.belt || '#2a1d14', roughness: 0.4 });
      skinned('belt', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.014, 6, true), 'torso', beltM);
      const [x, y, z] = torsoPoint(T, 0, 0.965, off + 0.02);
      skinned('belt_buckle', new THREE.BoxGeometry(0.04, 0.03, 0.006).translate(x, y, z), 'torso', new THREE.MeshStandardMaterial({ name: 'buckle', color: '#c9ccd1', metalness: 1, roughness: 0.25 }));
    }
  }

  // ---- shoes
  if (fit.shoes) {
    const sh = fit.shoes;
    const upper = new THREE.MeshStandardMaterial({ name: `shoe_${sh.color}`, color: sh.color, roughness: sh.kind === 'loafer' ? 0.25 : 0.6, metalness: sh.kind === 'loafer' ? 0.1 : 0 });
    const sole = new THREE.MeshStandardMaterial({ name: `sole_${sh.sole}`, color: sh.sole, roughness: 0.7 });
    for (const s of [1, -1]) for (const [part, g] of shoeGeos(s, sh.kind)) skinned(`shoe_${part}_${s > 0 ? 'l' : 'r'}`, g, 'foot', part === 'sole' ? sole : upper);
    // original side detail: a straight double band along the side and a heel tab (no brand marks)
    if (sh.kind === 'sneaker' || sh.kind === 'skate') for (const s of [1, -1]) {
      const stripeM = sh.stripe ? new THREE.MeshStandardMaterial({ name: `stripe_${sh.stripe}`, color: sh.stripe, roughness: 0.5 }) : sole;
      for (const dy of [0, 0.014]) skinned('shoe_side_band', new THREE.BoxGeometry(0.003, 0.006, 0.17).translate(s * (LEG_X + (sh.kind === 'skate' ? 0.05 : 0.046)), 0.05 + dy, 0.02), 'foot', stripeM);
      skinned('shoe_heel_tab', new THREE.BoxGeometry(0.03, 0.04, 0.006).translate(s * LEG_X, 0.09, -0.108), 'foot', stripeM);
      for (let k = 0; k < 4; k++) skinned('shoe_lace', new THREE.BoxGeometry(0.04, 0.004, 0.006).rotateX(0.5).translate(s * LEG_X, 0.112 - k * 0.012, 0.0 + k * 0.03), 'foot', new THREE.MeshStandardMaterial({ name: 'lace', color: '#f4f4f2', roughness: 0.8 }));
    }
  }

  // ---- socks (striped crew socks)
  if (fit.socks) {
    const sk = fit.socks;
    const sockM = fabric(`sock_${sk.color}`, sk.color, { weave: 0.05, repeat: [1, 1], draw: (g, w, h) => { const [a, b] = sk.stripes || []; if (a) { g.fillStyle = a; g.fillRect(0, h * 0.06, w, h * 0.07); } if (b) { g.fillStyle = b; g.fillRect(0, h * 0.17, w, h * 0.07); } } });
    sockM.map.wrapS = sockM.map.wrapT = THREE.ClampToEdgeWrapping;
    for (const s of [1, -1]) skinned(`sock_${s > 0 ? 'l' : 'r'}`, limbSweep({ axis: 'y', from: 0.36, to: 0.06, side: 1, cx: s * LEG_X, rows: 14, cols: 20, radius: (y) => interp(LEG_R, y) * legS + 0.005 }), 'leg', sockM);
  }
  // ---- rope chain
  if (fit.chain) {
    const pts = []; for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; const dip = Math.max(0, Math.cos(a)); pts.push(V(torsoPoint(T, a, 1.475 - 0.11 * dip ** 2, 0.03 + 0.006 * dip))); }
    const chainM = new THREE.MeshStandardMaterial({ name: 'gold_chain', color: fit.chain, metalness: 1, roughness: 0.22 });
    const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.006, 6, true);
    const rp = rope.attributes.position, rn = rope.attributes.normal;
    for (let i = 0; i < rp.count; i++) { const k = 0.6 + 0.4 * Math.abs(Math.sin(i * 0.9)); rp.setXYZ(i, rp.getX(i) + rn.getX(i) * 0.002 * k, rp.getY(i) + rn.getY(i) * 0.002 * k, rp.getZ(i) + rn.getZ(i) * 0.002 * k); }
    rope.computeVertexNormals();
    skinned('chain_rope', rope, 'torso', chainM);
  }
  // ---- agbada: the wide outer robe. Front + back panels and a top strip, half on the arms, half on the body,
  //      so the big sleeves fold down over the body when the arms come down.
  if (fit.agbada) {
    const ag = fit.agbada, XW = 0.76, NU = 64, NV = 40;
    const yTop = (x) => { const ax = Math.abs(x); return ax < 0.1 ? 1.5 - 0.0 * ax : ARM_Y + 0.075 - 0.025 * smooth(0.2, XW, ax); };
    const yBot = (x) => { const ax = Math.abs(x); return ax < 0.3 ? 0.3 : 0.3 + (ARM_Y - 0.33 - 0.3) * smooth(0.3, XW, ax) ** 0.8; };
    const bodyZ = (x, y, sgn) => {
      const yy = Math.max(Math.min(y, 1.45), 0.86), hw = interp(T.W, yy) + 0.06, hd = interp(T.D, yy) + 0.06 + (y < 0.86 ? 0.025 * (0.86 - y) / 0.56 : 0);
      const zc = interp(T.Z, yy), q = Math.min(1, Math.abs(x) / hw);
      const zBody = zc + sgn * hd * Math.sqrt(Math.max(0.15, 1 - q * q));
      const zArm = ARM_Z + sgn * 0.17;
      const k = smooth(0.18, 0.34, Math.abs(x));
      return sgn > 0 ? Math.max(zBody * (1 - k) + zArm * k, sgn > 0 ? zc + 0.05 : -1) : Math.min(zBody * (1 - k) + zArm * k, zc - 0.05);
    };
    const tex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = ag.color; g.fillRect(0, 0, w, h);
      const R = rnd(13); for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * 0.05})`; g.fillRect(R() * w, R() * h, 2, 1); }
      g.strokeStyle = ag.embroidery; g.fillStyle = ag.embroidery; g.lineWidth = 4;
      // neckline embroidery (v = 1 is the top edge, so canvas y is flipped)
      const cx = w / 2, ny = h * 0.04;
      for (let r = 40; r <= 110; r += 18) { g.beginPath(); g.arc(cx, ny, r, 0, Math.PI); g.stroke(); }
      for (let k = 0; k < 14; k++) { const a = (k / 13) * Math.PI; g.beginPath(); g.arc(cx + Math.cos(a) * 128, ny + Math.sin(a) * 128, 7, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.moveTo(cx, ny + 110); g.lineTo(cx, h * 0.45); g.stroke();
      for (let k = 0; k < 8; k++) { const yy = ny + 130 + k * 22; g.beginPath(); g.moveTo(cx - 14, yy); g.quadraticCurveTo(cx, yy + 12, cx + 14, yy); g.stroke(); }
      // big embroidered pocket on the wearer's left chest
      const px = w * 0.66, py = h * 0.22; g.lineWidth = 3; g.strokeRect(px - 40, py, 80, 92);
      for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(px, py + 46, 10 + k * 9, 0, Math.PI * 2); g.stroke(); }
      // hem border
      g.lineWidth = 5; g.beginPath(); g.moveTo(0, h - 18); g.lineTo(w, h - 18); g.stroke();
    });
    const agM = new THREE.MeshStandardMaterial({ name: 'agbada', map: tex, roughness: 0.65, side: THREE.DoubleSide });
    const agPlain = fabric('agbada_plain', ag.color, { weave: 0.05, repeat: [6, 6], rough: 0.65 });
    const weightsAg = (v) => {
      const ax = Math.abs(v.x), sd = v.x >= 0 ? 'l' : 'r';
      const arm = Math.max(smooth(0.15, 0.29, ax) * smooth(0.5, 0.95, v.y), smooth(0.2, 0.3, ax) * smooth(ARM_Y - 0.14, ARM_Y - 0.02, v.y));
      const lower = smooth(0.4, 0.52, ax);
      const bodyList = skirtWeights(T, v, { legShare: 0.55 }).map(([n, w]) => [n, w * (1 - arm)]);
      if (v.y > 0.9) { bodyList.push(['spine_02', (1 - arm) * smooth(0.95, 1.25, v.y)]); bodyList.push(['spine_03', (1 - arm) * smooth(1.2, 1.45, v.y)]); }
      return [...bodyList, [`upperarm_${sd}`, arm * (1 - lower) + 1e-6], [`lowerarm_${sd}`, arm * lower + 1e-6], [`clavicle_${sd}`, arm * 0.15 * smooth(0.3, 0.15, ax) + 1e-6]];
    };
    const panel = (sgn) => gridGeo(NV, NU, (t, u) => {
      const x = (u * 2 - 1) * XW * sgn, yt = yTop(x), yb = yBot(x);
      let y = yb + (yt - yb) * t;
      if (sgn > 0 && Math.abs(x) < 0.1) y = Math.min(y, 1.42 + 0.08 * (Math.abs(x) / 0.1) ** 2); // front neckline dips
      return [x, y, bodyZ(x, y, sgn)];
    });
    skinned('agbada_front', panel(1), 'torso', agM, weightsAg);
    skinned('agbada_back', panel(-1), 'torso', agPlain, weightsAg);
    const strip = gridGeo(4, NU, (t, u) => { const x = (u * 2 - 1) * XW, y = yTop(x) + (Math.abs(x) < 0.1 ? 0 : 0.004); return [x, y, bodyZ(x, y, -1) + (bodyZ(x, y, 1) - bodyZ(x, y, -1)) * t]; });
    // keep the neck open: drop the strip where the neck passes
    const si = strip.index.array, keep = [], sp = strip.attributes.position;
    for (let k = 0; k < si.length; k += 3) { const cx = (sp.getX(si[k]) + sp.getX(si[k + 1]) + sp.getX(si[k + 2])) / 3; if (Math.abs(cx) > 0.085) keep.push(si[k], si[k + 1], si[k + 2]); }
    strip.setIndex(keep);
    skinned('agbada_shoulders', strip, 'torso', agPlain, weightsAg);
    const goldM = new THREE.MeshStandardMaterial({ name: 'agbada_trim', color: ag.embroidery, metalness: 0.5, roughness: 0.4 });
    for (const sgn of [1, -1]) {
      const edge = []; for (let k = 0; k <= 30; k++) { const x = sgn * (0.3 + (XW - 0.3) * k / 30); const y = yBot(x); edge.push(V([x, y, (bodyZ(x, y, 1) + bodyZ(x, y, -1)) / 2])); }
      skinned('agbada_sleeve_edge', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 40, 0.006, 5), 'torso', goldM, weightsAg);
    }
  }

  if (female) root.scale.setScalar(0.94);
  root.userData = { name: o.name || fit.label, fit: fit.label, skin: o.skin, build: o.build, rig: 'Quaternius UAL (Unreal-style bones)' };
  return root;
}
