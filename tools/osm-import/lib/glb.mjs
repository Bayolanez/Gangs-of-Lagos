/**
 * Minimal glTF 2.0 binary (.glb) writer: one mesh with POSITION, NORMAL and COLOR_0 (vertex colours)
 * and 32-bit indices, using one matte material. Enough for flat-shaded grey-box tiles; no dependencies.
 * Not compressed yet (no Draco or meshopt).
 */
export function writeGlb({ positions, normals, colors, indices }, name = 'tile') {
  const vcount = positions.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  // Colours are authored in sRGB; glTF vertex colours are linear.
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const pos = new Float32Array(positions), nor = new Float32Array(normals), col = new Float32Array(colors.map(toLinear)), idx = new Uint32Array(indices);
  const views = [pos, nor, col, idx];
  let offset = 0;
  const bufferViews = views.map((v, i) => {
    const bv = { buffer: 0, byteOffset: offset, byteLength: v.byteLength, target: i === 3 ? 34963 : 34962 };
    offset += v.byteLength;
    return bv;
  });
  const json = {
    asset: { version: '2.0', generator: 'gangs-of-lagos tools/osm-import' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'placeholder', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.92 } }],
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: vcount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vcount, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: vcount, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
  };
  const pad4 = (n) => (n + 3) & ~3;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(offset);
  const out = Buffer.alloc(12 + 8 + jsonLen + 8 + binLen);
  out.writeUInt32LE(0x46546c67, 0); // 'glTF'
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const b = 20 + jsonLen;
  out.writeUInt32LE(binLen, b);
  out.writeUInt32LE(0x004e4942, b + 4); // 'BIN'
  let p = b + 8;
  for (const v of views) {
    Buffer.from(v.buffer, v.byteOffset, v.byteLength).copy(out, p);
    p += v.byteLength;
  }
  return out;
}
