import * as THREE from 'three';

/**
 * Facade detail for building walls (shader patch, no extra geometry): window rows every floor
 * (3.2 m), window bays every 2.6 m, frames, sills, and glass whose tint varies per window, with
 * a few panes catching the light. Applied to Harbour Bend's building blocks and to the extruded
 * buildings in imported map tiles. Only vertical faces above `minY` get windows, so roads, kerbs
 * and low props stay plain.
 */
export function addFacadeDetail(material: THREE.MeshStandardMaterial, minY = 2.2): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facadeMinY = { value: minY };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 facadeWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          facadeWorld = instanceMatrix * facadeWorld;
        #endif
        facadeWorld = modelMatrix * facadeWorld;
        vFacadePos = facadeWorld.xyz;
        vFacadeNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;\nuniform float facadeMinY;\nfloat facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vFacadeNormal);
          if (abs(n.y) < 0.25 && vFacadePos.y > facadeMinY) {
            float along = abs(n.x) > abs(n.z) ? vFacadePos.z : vFacadePos.x;
            float fy = mod(vFacadePos.y - 0.4, 3.2);
            float fx = mod(along, 2.6);
            vec2 cell = vec2(floor(along / 2.6), floor((vFacadePos.y - 0.4) / 3.2));
            float inWin = step(0.95, fy) * step(fy, 2.55) * step(0.45, fx) * step(fx, 2.15);
            float frame = inWin * (1.0 - step(1.0, fy) * step(fy, 2.5) * step(0.5, fx) * step(fx, 2.1));
            float r = facadeHash(cell + floor(vFacadePos.xz * 0.01));
            vec3 glass = mix(vec3(0.10, 0.13, 0.16), vec3(0.22, 0.28, 0.33), r);
            glass = mix(glass, vec3(0.62, 0.58, 0.45), step(0.93, r)); // a few panes catch the light
            vec3 sill = diffuseColor.rgb * 0.72;
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, inWin * (1.0 - frame));
            diffuseColor.rgb = mix(diffuseColor.rgb, sill, frame);
            // Floor line between storeys
            float band = step(fy, 0.12);
            diffuseColor.rgb *= 1.0 - band * 0.18;
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => `facade-${minY}`;
  return material;
}
