// 背景星空：程序化恆星，密度集中於銀河面（使用 J2000 銀道座標旋轉矩陣定位銀河）。

import * as THREE from 'three';
import { OBLIQUITY_J2000_DEG } from '../physics/constants.js';
import { mulberry32 } from './noise.js';

// 赤道 (ICRS) → 銀道座標旋轉矩陣 A；銀道 → 赤道為 Aᵀ
const A = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.44482963, 0.7469822445,
  -0.867666149, -0.1980763734, 0.4559837762,
];

function galacticToScene(l, b) {
  const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  const eq = [
    A[0] * g[0] + A[3] * g[1] + A[6] * g[2],
    A[1] * g[0] + A[4] * g[1] + A[7] * g[2],
    A[2] * g[0] + A[5] * g[1] + A[8] * g[2],
  ];
  const e = (OBLIQUITY_J2000_DEG * Math.PI) / 180;
  const ecl = [eq[0], Math.cos(e) * eq[1] + Math.sin(e) * eq[2], -Math.sin(e) * eq[1] + Math.cos(e) * eq[2]];
  return [ecl[0], ecl[2], -ecl[1]];
}

const vertexShader = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uPixelRatio;
void main() {
  vColor = color;
  gl_PointSize = size * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * a, a);
}`;

export function createStarfield({ stars = 9000, dust = 36000, radius = 1e9 } = {}) {
  const rand = mulberry32(20260924);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const total = stars + dust;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const palette = [
    [0.66, 0.76, 1.0], [0.84, 0.89, 1.0], [1.0, 1.0, 1.0], [1.0, 0.95, 0.86], [1.0, 0.86, 0.68], [1.0, 0.74, 0.52],
  ];
  const weights = [0.08, 0.2, 0.3, 0.2, 0.14, 0.08];
  const pickColor = () => {
    let x = rand();
    for (let k = 0; k < weights.length; k++) {
      if (x < weights[k]) return palette[k];
      x -= weights[k];
    }
    return palette[2];
  };
  for (let k = 0; k < total; k++) {
    let l, b;
    const isDust = k >= stars;
    if (isDust) {
      // 銀河帶：銀緯常態分布，銀心方向較密
      l = (rand() < 0.45 ? gauss() * 0.75 : rand() * 2 * Math.PI - Math.PI);
      b = gauss() * (0.07 + 0.08 * Math.exp(-Math.abs(l) / 0.6));
    } else if (rand() < 0.3) {
      l = rand() * 2 * Math.PI;
      const s = rand() < 0.5 ? -1 : 1;
      b = s * -Math.log(1 - rand()) * 0.2;
    } else {
      l = rand() * 2 * Math.PI;
      b = Math.asin(rand() * 2 - 1);
    }
    const p = galacticToScene(l, b);
    pos[3 * k] = p[0] * radius;
    pos[3 * k + 1] = p[1] * radius;
    pos[3 * k + 2] = p[2] * radius;
    if (isDust) {
      const c = rand() < 0.5 ? [0.75, 0.8, 1.0] : [1.0, 0.9, 0.78];
      const a = 0.05 + rand() * 0.1;
      col.set([c[0] * a, c[1] * a, c[2] * a], 3 * k);
      size[k] = 1.4 + rand() * 1.4;
    } else {
      const mag = Math.pow(rand(), 3.2);
      const c = pickColor();
      const a = 0.25 + 0.75 * mag;
      col.set([c[0] * a, c[1] * a, c[2] * a], 3 * k);
      size[k] = 1.1 + 2.9 * mag;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}
