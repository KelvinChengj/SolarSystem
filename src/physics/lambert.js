// Lambert 問題：已知兩個位置與飛行時間，求連接兩點的克卜勒軌道（出發/抵達速度）。
// 實作 D. Izzo (2015) "Revisiting Lambert's problem"（零圈解），以 Householder 迭代求解。

import { vcross, vnorm } from './vec.js';

function hypergeometricF(z, tol) {
  let Sj = 1, Cj = 1, err = 1, j = 0;
  while (err > tol && j < 1000) {
    const Cj1 = (Cj * (3 + j) * (1 + j)) / (2.5 + j) * z / (j + 1);
    Sj += Cj1;
    err = Math.abs(Cj1);
    Cj = Cj1;
    j++;
  }
  return Sj;
}

// Lagrange 形式的無因次飛行時間
function x2tofLagrange(x, N, lambda) {
  const a = 1 / (1 - x * x);
  if (a > 0) {
    const alfa = 2 * Math.acos(x);
    let beta = 2 * Math.asin(Math.sqrt((lambda * lambda) / a));
    if (lambda < 0) beta = -beta;
    return (a * Math.sqrt(a) * ((alfa - Math.sin(alfa)) - (beta - Math.sin(beta)) + 2 * Math.PI * N)) / 2;
  }
  const alfa = 2 * Math.acosh(x);
  let beta = 2 * Math.asinh(Math.sqrt((-lambda * lambda) / a));
  if (lambda < 0) beta = -beta;
  return (-a * Math.sqrt(-a) * ((beta - Math.sinh(beta)) - (alfa - Math.sinh(alfa)))) / 2;
}

/** 無因次飛行時間 T(x)：依 x 與 1 的距離選用 Battin 級數、Lagrange 或 Lancaster 形式。 */
export function x2tof(x, N, lambda) {
  const battin = 0.01;
  const lagrange = 0.2;
  const dist = Math.abs(x - 1);
  if (dist < lagrange && dist > battin) return x2tofLagrange(x, N, lambda);
  const K = lambda * lambda;
  const E = x * x - 1;
  const rho = Math.abs(E);
  const z = Math.sqrt(1 + K * E);
  if (dist < battin) {
    const eta = z - lambda * x;
    const S1 = 0.5 * (1 - lambda - x * eta);
    const Q = (4 / 3) * hypergeometricF(S1, 1e-11);
    return (eta * eta * eta * Q + 4 * lambda * eta) / 2 + (N * Math.PI) / Math.pow(rho, 1.5);
  }
  const y = Math.sqrt(rho);
  const g = x * z - lambda * E;
  let d;
  if (E < 0) {
    d = N * Math.PI + Math.acos(Math.min(1, Math.max(-1, g)));
  } else {
    const f = y * (z - lambda * x);
    d = Math.log(f + g);
  }
  return (x - lambda * z - d / y) / E;
}

function dTdx(x, T, lambda) {
  const l2 = lambda * lambda;
  const l3 = l2 * lambda;
  const umx2 = 1 - x * x;
  const y = Math.sqrt(1 - l2 * umx2);
  const y2 = y * y;
  const y3 = y2 * y;
  const DT = (1 / umx2) * (3 * T * x - 2 + (2 * l3 * x) / y);
  const DDT = (1 / umx2) * (3 * T + 5 * x * DT + (2 * (1 - l2) * l3) / y3);
  const DDDT = (1 / umx2) * (7 * x * DDT + 8 * DT - (6 * (1 - l2) * l2 * l3 * x) / y3 / y2);
  return [DT, DDT, DDDT];
}

function householder(T, x0, N, lambda, eps, maxIter) {
  let x = x0;
  let err = 1;
  let it = 0;
  while (err > eps && it < maxIter) {
    const tof = x2tof(x, N, lambda);
    const [DT, DDT, DDDT] = dTdx(x, tof, lambda);
    const delta = tof - T;
    const DT2 = DT * DT;
    const xnew = x - (delta * (DT2 - (delta * DDT) / 2)) / (DT * (DT2 - delta * DDT) + (DDDT * delta * delta) / 6);
    if (!Number.isFinite(xnew)) break;
    err = Math.abs(x - xnew);
    x = xnew;
    it++;
  }
  return { x, iterations: it, converged: err <= eps };
}

/**
 * 解 Lambert 問題（零圈、單一解）。
 * @param {number[]} r1 出發位置 (km)
 * @param {number[]} r2 抵達位置 (km)
 * @param {number} tof 飛行時間 (s)
 * @param {number} mu 中心天體重力參數 (km^3/s^2)
 * @param {{retrograde?: boolean}} [opts] retrograde=true 表示逆行（以 +z 為基準順時針）轉移
 * @returns {{v1:number[], v2:number[], x:number, lambda:number, converged:boolean}|null}
 */
export function solveLambert(r1, r2, tof, mu, { retrograde = false } = {}) {
  if (!(tof > 0)) return null;
  const c = [r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]];
  const cn = vnorm(c);
  const R1 = vnorm(r1);
  const R2 = vnorm(r2);
  const s = (cn + R1 + R2) / 2;
  const ir1 = [r1[0] / R1, r1[1] / R1, r1[2] / R1];
  const ir2 = [r2[0] / R2, r2[1] / R2, r2[2] / R2];
  let ih = vcross(ir1, ir2);
  const ihn = vnorm(ih);
  if (ihn < 1e-12) {
    // 0° 或 180° 轉移：軌道平面不定，改以黃道北極決定平面
    ih = [0, 0, 1];
  } else {
    ih = [ih[0] / ihn, ih[1] / ihn, ih[2] / ihn];
  }
  const lambda2 = 1 - cn / s;
  let lambda = Math.sqrt(Math.max(0, lambda2));
  let it1, it2;
  if (ih[2] < 0) {
    // 轉移角大於 180°
    lambda = -lambda;
    it1 = vcross(ir1, ih);
    it2 = vcross(ir2, ih);
  } else {
    it1 = vcross(ih, ir1);
    it2 = vcross(ih, ir2);
  }
  const n1 = vnorm(it1), n2 = vnorm(it2);
  it1 = [it1[0] / n1, it1[1] / n1, it1[2] / n1];
  it2 = [it2[0] / n2, it2[1] / n2, it2[2] / n2];
  if (retrograde) {
    lambda = -lambda;
    it1 = [-it1[0], -it1[1], -it1[2]];
    it2 = [-it2[0], -it2[1], -it2[2]];
  }

  const T = Math.sqrt((2 * mu) / (s * s * s)) * tof;
  const l = lambda;
  const T00 = Math.acos(l) + l * Math.sqrt(1 - l * l);
  const T1 = (2 / 3) * (1 - l * l * l);
  let x0;
  if (T >= T00) x0 = -(T - T00) / (T - T00 + 4);
  else if (T <= T1) x0 = (T1 * (T1 - T)) / ((2 / 5) * (1 - Math.pow(l, 5)) * T) + 1;
  else x0 = Math.pow(T / T00, 0.69314718055994531 / Math.log(T1 / T00)) - 1;

  const { x, converged } = householder(T, x0, 0, l, 1e-11, 25);
  if (!Number.isFinite(x)) return null;

  const gamma = Math.sqrt((mu * s) / 2);
  const rho = (R1 - R2) / cn;
  const sigma = Math.sqrt(Math.max(0, 1 - rho * rho));
  const y = Math.sqrt(1 - lambda2 + lambda2 * x * x);
  const vr1 = (gamma * ((l * y - x) - rho * (l * y + x))) / R1;
  const vr2 = (-gamma * ((l * y - x) + rho * (l * y + x))) / R2;
  const vt = gamma * sigma * (y + l * x);
  const vt1 = vt / R1;
  const vt2 = vt / R2;
  const v1 = [vr1 * ir1[0] + vt1 * it1[0], vr1 * ir1[1] + vt1 * it1[1], vr1 * ir1[2] + vt1 * it1[2]];
  const v2 = [vr2 * ir2[0] + vt2 * it2[0], vr2 * ir2[1] + vt2 * it2[1], vr2 * ir2[2] + vt2 * it2[2]];
  if (!v1.every(Number.isFinite) || !v2.every(Number.isFinite)) return null;
  return { v1, v2, x, lambda: l, converged };
}
