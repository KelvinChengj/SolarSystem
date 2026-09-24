// 三維向量與 3×3 矩陣小工具（以一般陣列 [x, y, z] 表示，雙精度）。

export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vnorm = (a) => Math.hypot(a[0], a[1], a[2]);
export const vunit = (a) => {
  const n = vnorm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};
/** a + b·s */
export const vaxpy = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vangle = (a, b) => {
  const c = vdot(a, b) / (vnorm(a) * vnorm(b));
  return Math.acos(Math.min(1, Math.max(-1, c)));
};

/** 3×3 矩陣以列優先 (row-major) 的長度 9 陣列表示。 */
export function mmul(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    }
  }
  return C;
}

export function mvec(A, v) {
  return [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ];
}

export function mtranspose(A) {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}

// 座標系旋轉矩陣（被動旋轉：將向量表示於旋轉後的座標系）
export function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
export function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

/** 以 3×3 線性方程組 A x = b 求解（Cramer 法則），A 為列優先陣列。 */
export function solve3(A, b) {
  const det = A[0] * (A[4] * A[8] - A[5] * A[7])
    - A[1] * (A[3] * A[8] - A[5] * A[6])
    + A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const dx = b[0] * (A[4] * A[8] - A[5] * A[7])
    - A[1] * (b[1] * A[8] - A[5] * b[2])
    + A[2] * (b[1] * A[7] - A[4] * b[2]);
  const dy = A[0] * (b[1] * A[8] - A[5] * b[2])
    - b[0] * (A[3] * A[8] - A[5] * A[6])
    + A[2] * (A[3] * b[2] - b[1] * A[6]);
  const dz = A[0] * (A[4] * b[2] - b[1] * A[7])
    - A[1] * (A[3] * b[2] - b[1] * A[6])
    + b[0] * (A[3] * A[7] - A[4] * A[6]);
  return [dx / det, dy / det, dz / det];
}
