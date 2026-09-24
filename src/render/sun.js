// 太陽：米粒組織雜訊 + 臨邊昏暗的著色器球體、加法混合光暈，以及位於太陽的點光源。

import * as THREE from 'three';
import { glowTexture } from './textures.js';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
void main() {
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  vec3 p = normalize(vPos);
  float g = fbm(p * 38.0 + vec3(0.0, uTime * 0.05, 0.0));
  float spots = smoothstep(0.72, 0.8, fbm(p * 6.0 + 11.0)) * 0.35;
  float limb = 0.28 + 0.72 * pow(mu, 0.45);
  vec3 hot = vec3(1.0, 0.95, 0.78);
  vec3 warm = vec3(1.0, 0.56, 0.16);
  vec3 col = mix(warm, hot, limb) * (0.82 + 0.3 * g) * (1.0 - spots);
  gl_FragColor = vec4(col * 1.35, 1.0);
}`;

export function createSun(radiusKm) {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { uTime: { value: 0 } } });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material);
  mesh.scale.setScalar(radiusKm);
  group.add(mesh);

  const glowTex = new THREE.CanvasTexture(glowTexture());
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff,
  }));
  group.add(glow);
  const coronaTex = new THREE.CanvasTexture(glowTexture([
    [0, 'rgba(255,220,160,0.5)'], [0.3, 'rgba(255,170,90,0.12)'], [1, 'rgba(255,120,40,0)'],
  ]));
  coronaTex.colorSpace = THREE.SRGBColorSpace;
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coronaTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6,
  }));
  group.add(corona);

  const light = new THREE.PointLight(0xfff4e6, 3.2, 0, 0);
  group.add(light);

  return {
    group, mesh, glow, corona, light, material,
    /** displayRadius：畫面上使用的半徑（km），worldPerPx：每像素對應的公里數 */
    update(timeSec, displayRadius, worldPerPx) {
      material.uniforms.uTime.value = timeSec;
      mesh.scale.setScalar(displayRadius);
      const g = Math.max(displayRadius * 7, worldPerPx * 110);
      glow.scale.setScalar(g);
      corona.scale.setScalar(Math.max(displayRadius * 22, worldPerPx * 300));
    },
  };
}
