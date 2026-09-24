// 座標轉換：物理計算使用日心 J2000 黃道座標 (x, y, z)，z 指向黃道北極；
// Three.js 為 y 軸朝上，因此映射為 (x, z, −y)。場景單位為公里，並採「浮動原點」：
// 所有物件位置都減去目前焦點位置（以雙精度計算），避免 GPU 單精度在遠處造成抖動。

import * as THREE from 'three';

/** 黃道座標 (km) 減去原點後寫入 Three.js 向量。 */
export function toScene(out, r, origin) {
  return out.set(r[0] - origin[0], r[2] - origin[2], -(r[1] - origin[1]));
}

/** 黃道方向向量 → Three.js 向量（不減原點）。 */
export function dirToScene(out, v) {
  return out.set(v[0], v[2], -v[1]);
}

/** Three.js 向量 → 黃道座標陣列。 */
export function sceneToEcliptic(v) {
  return [v.x, -v.z, v.y];
}

/** 黃道座標系下的 3×3 旋轉矩陣（列優先）→ Three.js Matrix4（P·M·Pᵀ）。 */
export function eclipticMatrixToScene(M, out = new THREE.Matrix4()) {
  // P: (x, y, z) → (x, z, −y)
  const m = [
    M[0], M[2], -M[1],
    M[6], M[8], -M[7],
    -M[3], -M[5], M[4],
  ];
  return out.set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1,
  );
}
