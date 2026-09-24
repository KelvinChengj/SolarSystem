// 行星、月球的 3D 物件：扁球體網格、自轉定向、土星環、地球雲層與大氣輝光。

import * as THREE from 'three';
import { BODIES } from '../physics/constants.js';
import { saturnRingTexture } from './textures.js';

const atmosphereVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const atmosphereFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uPower;
uniform float uStrength;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), uPower);
  float lit = smoothstep(-0.25, 0.45, dot(n, normalize(uSunDir)));
  float a = rim * lit * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

function makeAtmosphere(color, strength = 1.2, power = 2.6) {
  return new THREE.ShaderMaterial({
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uStrength: { value: strength },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/** 將 RingGeometry 的 UV 改為徑向（u = 內緣 0 → 外緣 1）。 */
function radialRingGeometry(inner, outer, segments = 256) {
  const g = new THREE.RingGeometry(inner, outer, segments, 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  g.rotateX(-Math.PI / 2); // 置於赤道面（局部 xz 平面）
  return g;
}

const BASE_COLORS = {
  mercury: '#8f877d', venus: '#e2c98d', earth: '#2d5b8f', moon: '#9b978f', mars: '#b8603a',
  jupiter: '#cdb08c', saturn: '#dcc795', uranus: '#9fd6dc', neptune: '#4a70d9', pluto: '#c3a585',
};

/**
 * 建立天體物件。
 * 結構：group（位置 + 最小像素縮放）→ spin（自轉定向，body→黃道矩陣）→ mesh（扁球）
 */
export function createBody(id) {
  const b = BODIES[id];
  const group = new THREE.Group();
  group.name = id;
  const spin = new THREE.Group();
  spin.matrixAutoUpdate = false;
  group.add(spin);

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(BASE_COLORS[id] ?? '#999999'),
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
  mesh.scale.set(b.eqRadius, b.polarRadius, b.eqRadius);
  mesh.userData.bodyId = id;
  spin.add(mesh);

  const extras = {};
  if (id === 'earth') {
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.9, depthWrite: false, roughness: 1, color: 0xffffff, alphaTest: 0.01 }),
    );
    clouds.scale.set(b.eqRadius * 1.006, b.polarRadius * 1.006, b.eqRadius * 1.006);
    clouds.visible = false;
    spin.add(clouds);
    extras.clouds = clouds;
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), makeAtmosphere('#6fb4ff', 1.35, 2.4));
    atm.scale.setScalar(b.eqRadius * 1.03);
    group.add(atm);
    extras.atmosphere = atm;
  }
  if (id === 'venus') {
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), makeAtmosphere('#ffe1a8', 0.8, 3.0));
    atm.scale.setScalar(b.eqRadius * 1.02);
    group.add(atm);
    extras.atmosphere = atm;
  }
  if (id === 'mars') {
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), makeAtmosphere('#ffb08a', 0.45, 3.2));
    atm.scale.setScalar(b.eqRadius * 1.015);
    group.add(atm);
    extras.atmosphere = atm;
  }
  if (['jupiter', 'saturn', 'uranus', 'neptune'].includes(id)) {
    const col = { jupiter: '#ffe2b8', saturn: '#fff0c4', uranus: '#bff6ff', neptune: '#9cc0ff' }[id];
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), makeAtmosphere(col, 0.55, 3.5));
    atm.scale.set(b.eqRadius * 1.012, b.polarRadius * 1.012, b.eqRadius * 1.012);
    spin.add(atm);
    extras.atmosphere = atm;
  }
  if (id === 'saturn') {
    const { canvas, inner, outer } = saturnRingTexture();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ring = new THREE.Mesh(
      radialRingGeometry(inner, outer),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xd9d2c2 }),
    );
    spin.add(ring);
    extras.ring = ring;
  }
  if (id === 'uranus') {
    const ring = new THREE.Mesh(
      radialRingGeometry(41800, 51200, 128),
      new THREE.MeshBasicMaterial({ color: 0x8aa0a8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    spin.add(ring);
    extras.ring = ring;
  }

  return {
    id, group, spin, mesh, material, ...extras,
    setTexture(canvas, anisotropy = 4) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      material.map = tex;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    },
    setCloudTexture(canvas) {
      if (!extras.clouds) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      extras.clouds.material.map = tex;
      extras.clouds.material.needsUpdate = true;
      extras.clouds.visible = true;
    },
  };
}

/** 影響球（SOI）泡泡：以 Fresnel 邊緣亮度呈現。 */
export function createSoiBubble(color) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: atmosphereVertex,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vWorldNormal);
        vec3 v = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - abs(dot(n, v)), 3.0);
        float a = 0.04 + rim * 0.5;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  m.visible = false;
  return m;
}
