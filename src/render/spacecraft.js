// 太空船模型：本體、高增益天線、太陽能板、主引擎，以及點火時的尾焰。

import * as THREE from 'three';
import { glowTexture } from './textures.js';

export function createSpacecraft() {
  const group = new THREE.Group();
  const model = new THREE.Group();
  group.add(model);
  // 模型以公尺為單位建模，之後依最小像素尺寸縮放；前進方向為 +Z
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.2, roughness: 0.5 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1d3570, metalness: 0.4, roughness: 0.35, emissive: 0x050a1a });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.8, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 16), gold);
  body.rotation.x = Math.PI / 2;
  model.add(body);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 8, 0, Math.PI * 2, 0, 0.9), white);
  dish.rotation.x = -Math.PI / 2;
  dish.position.z = 1.9;
  model.add(dish);
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 16, 1, true), dark);
  nozzle.rotation.x = -Math.PI / 2;
  nozzle.position.z = -1.8;
  model.add(nozzle);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.1), dark);
    arm.position.x = s * 1.4;
    model.add(arm);
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 1.5), panel);
    p.position.x = s * 3.8;
    model.add(p);
  }
  const plumeTex = new THREE.CanvasTexture(glowTexture([
    [0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,210,140,0.85)'], [0.5, 'rgba(255,140,60,0.3)'], [1, 'rgba(255,90,20,0)'],
  ]));
  plumeTex.colorSpace = THREE.SRGBColorSpace;
  const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: plumeTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  plume.position.z = -3.2;
  plume.scale.set(3.2, 3.2, 1);
  plume.visible = false;
  model.add(plume);

  const MODEL_SIZE_M = 11; // 太陽能板翼展
  const tmpQ = new THREE.Quaternion();
  const fwd = new THREE.Vector3(0, 0, 1);

  return {
    group, model, plume,
    /**
     * @param {THREE.Vector3} dir 前進方向（場景座標，單位向量）
     * @param {number} worldPerPx 每像素公里數
     * @param {number} minPx 最小顯示像素
     * @param {number} burn 0–1 點火強度
     */
    update(dir, worldPerPx, minPx, burn, time) {
      const trueKm = MODEL_SIZE_M / 1000;
      const displayKm = Math.max(trueKm, worldPerPx * minPx);
      model.scale.setScalar(displayKm / MODEL_SIZE_M);
      if (dir && dir.lengthSq() > 0) {
        tmpQ.setFromUnitVectors(fwd, dir);
        model.quaternion.slerp(tmpQ, 0.25);
      }
      plume.visible = burn > 0;
      if (burn > 0) {
        const f = 0.85 + 0.15 * Math.sin(time * 40) + 0.08 * Math.sin(time * 97);
        plume.scale.set(3.2 * f * (0.6 + burn), 3.2 * f * (0.6 + burn), 1);
      }
    },
  };
}
