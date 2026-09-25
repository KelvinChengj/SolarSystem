// 二體問題（克卜勒運動）：克卜勒方程式、軌道根數 ↔ 狀態向量、普適變數 (universal variable) 傳播。

import { vcross, vdot, vnorm } from './vec.js';

const TWO_PI = 2 * Math.PI;

export function wrapTwoPi(x) {
  const y = x % TWO_PI;
  return y < 0 ? y + TWO_PI : y;
}

export function wrapPi(x) {
  return wrapTwoPi(x + Math.PI) - Math.PI;
}

/** 解橢圓克卜勒方程式 M = E − e sin E（弧度），牛頓法。 */
export function solveKepler(M, e) {
  M = wrapPi(M);
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - M;
    const dE = f / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

/** 解雙曲線克卜勒方程式 M = e sinh H − H。 */
export function solveKeplerHyperbolic(M, e) {
  let H = Math.asinh(M / e);
  for (let k = 0; k < 80; k++) {
    const f = e * Math.sinh(H) - H - M;
    const dH = f / (e * Math.cosh(H) - 1);
    H -= dH;
    if (Math.abs(dH) < 1e-13 * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

/** Stumpff 函數 C(z)、S(z)。 */
export function stumpffC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}

export function stumpffS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/**
 * 普適變數法傳播二體軌道：給定 r0, v0 (km, km/s)，經過 dt 秒後的狀態。
 * 適用橢圓、拋物線與雙曲線軌道（Vallado, Algorithm 8）。
 */
export function propagateKepler(r0, v0, dt, mu) {
  if (dt === 0) return { r: r0.slice(), v: v0.slice() };
  const sqrtMu = Math.sqrt(mu);
  const r0n = vnorm(r0);
  const v0n = vnorm(v0);
  const rdotv = vdot(r0, v0);
  const alpha = 2 / r0n - (v0n * v0n) / mu; // = 1/a

  let dtEff = dt;
  let chi;
  if (alpha > 1e-15) {
    // 橢圓：先以週期取餘數以維持數值穩定
    const period = TWO_PI / (sqrtMu * Math.pow(alpha, 1.5));
    if (Math.abs(dtEff) > period) dtEff = dtEff % period;
    chi = sqrtMu * dtEff * alpha;
  } else if (alpha < -1e-15) {
    const a = 1 / alpha;
    const s = Math.sign(dtEff);
    const num = -2 * mu * alpha * dtEff;
    const den = rdotv + s * Math.sqrt(-mu * a) * (1 - r0n * alpha);
    chi = s * Math.sqrt(-a) * Math.log(Math.max(num / den, 1e-12));
    if (!Number.isFinite(chi)) chi = s * Math.sqrt(-a);
  } else {
    const h = vcross(r0, v0);
    const p = vdot(h, h) / mu;
    const sAng = 0.5 * Math.atan(1 / (3 * Math.sqrt(mu / (p * p * p)) * dtEff));
    const w = Math.atan(Math.cbrt(Math.tan(sAng)));
    chi = Math.sqrt(p) * 2 / Math.tan(2 * w);
  }

  // 普適克卜勒方程式 F(χ) = √μ·Δt − t(χ) 對 χ 單調遞減（dF/dχ = −r < 0），
  // 因此以「牛頓法 + 二分法保護」求根：牛頓步跳出夾擠區間時改用二分。
  const k1 = rdotv / sqrtMu;
  const kepF = (x) => {
    const ps = x * x * alpha;
    const C = stumpffC(ps), S = stumpffS(ps);
    return {
      F: sqrtMu * dtEff - x * x * x * S - k1 * x * x * C - r0n * x * (1 - ps * S),
      r: x * x * C + k1 * x * (1 - ps * S) + r0n * (1 - ps * C),
    };
  };
  let lo, hi;
  if (alpha > 1e-15) {
    const lim = (2 * Math.PI) / Math.sqrt(alpha);
    lo = -lim; hi = lim;
  } else if (dtEff > 0) {
    lo = 0;
    hi = Math.max(Math.abs(chi), 1e-3) * 2;
    for (let k = 0; k < 200 && kepF(hi).F > 0; k++) { lo = hi; hi *= 2; }
  } else {
    hi = 0;
    lo = -Math.max(Math.abs(chi), 1e-3) * 2;
    for (let k = 0; k < 200 && kepF(lo).F < 0; k++) { hi = lo; lo *= 2; }
  }
  if (!(chi > lo && chi < hi)) chi = 0.5 * (lo + hi);

  let r = r0n;
  for (let k = 0; k < 200; k++) {
    const ev = kepF(chi);
    r = ev.r;
    if (ev.F > 0) lo = chi; else hi = chi;
    let next = chi + ev.F / ev.r;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    const dchi = next - chi;
    chi = next;
    if (Math.abs(dchi) <= 1e-13 * Math.max(1, Math.abs(chi)) || hi - lo <= 1e-15 * Math.max(1, Math.abs(chi))) break;
  }
  const psi = chi * chi * alpha;
  const c2 = stumpffC(psi);
  const c3 = stumpffS(psi);
  r = chi * chi * c2 + k1 * chi * (1 - psi * c3) + r0n * (1 - psi * c2);
  const f = 1 - (chi * chi / r0n) * c2;
  const g = dtEff - (chi * chi * chi / sqrtMu) * c3;
  const rv = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]];
  const rn = vnorm(rv);
  const gdot = 1 - (chi * chi / rn) * c2;
  const fdot = (sqrtMu / (rn * r0n)) * chi * (psi * c3 - 1);
  const vv = [fdot * r0[0] + gdot * v0[0], fdot * r0[1] + gdot * v0[1], fdot * r0[2] + gdot * v0[2]];
  return { r: rv, v: vv };
}

/** 近焦點座標系 → 慣性座標系旋轉矩陣（列優先）。 */
export function perifocalMatrix(i, raan, argp) {
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(i), si = Math.sin(i);
  return [
    cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si,
    sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si,
    sw * si, cw * si, ci,
  ];
}

/**
 * 狀態向量 → 古典軌道根數。
 * 回傳 a (km；雙曲線為負)、e、i、raan、argp、nu (弧度)、p、rp、ra、period (s)、energy 等。
 */
export function stateToElements(r, v, mu) {
  const rn = vnorm(r);
  const vn = vnorm(v);
  const h = vcross(r, v);
  const hn = vnorm(h);
  const nvec = [-h[1], h[0], 0];
  const nn = Math.hypot(nvec[0], nvec[1]);
  const rv = vdot(r, v);
  const evec = [
    ((vn * vn - mu / rn) * r[0] - rv * v[0]) / mu,
    ((vn * vn - mu / rn) * r[1] - rv * v[1]) / mu,
    ((vn * vn - mu / rn) * r[2] - rv * v[2]) / mu,
  ];
  const e = vnorm(evec);
  const energy = (vn * vn) / 2 - mu / rn;
  const p = (hn * hn) / mu;
  const a = Math.abs(e - 1) > 1e-12 ? -mu / (2 * energy) : Infinity;
  const i = Math.acos(Math.min(1, Math.max(-1, h[2] / hn)));
  const eps = 1e-11;

  let raan = 0;
  if (nn > eps * hn) {
    raan = Math.acos(Math.min(1, Math.max(-1, nvec[0] / nn)));
    if (nvec[1] < 0) raan = TWO_PI - raan;
  }

  let argp = 0;
  if (e > eps) {
    if (nn > eps * hn) {
      argp = Math.acos(Math.min(1, Math.max(-1, vdot(nvec, evec) / (nn * e))));
      if (evec[2] < 0) argp = TWO_PI - argp;
    } else {
      // 赤道軌道：以近點經度代替
      argp = Math.atan2(evec[1], evec[0]);
      if (h[2] < 0) argp = -argp;
      argp = wrapTwoPi(argp);
    }
  }

  let nu;
  if (e > eps) {
    nu = Math.acos(Math.min(1, Math.max(-1, vdot(evec, r) / (e * rn))));
    if (rv < 0) nu = TWO_PI - nu;
  } else if (nn > eps * hn) {
    // 圓軌道：緯度幅角
    nu = Math.acos(Math.min(1, Math.max(-1, vdot(nvec, r) / (nn * rn))));
    if (r[2] < 0) nu = TWO_PI - nu;
  } else {
    nu = wrapTwoPi(Math.atan2(r[1], r[0]) * (h[2] < 0 ? -1 : 1));
  }

  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const period = e < 1 ? TWO_PI * Math.sqrt((a * a * a) / mu) : Infinity;

  let M = null;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M = wrapTwoPi(E - e * Math.sin(E));
  } else if (e > 1) {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    M = e * Math.sinh(H) - H;
  }

  return { a, e, i, raan, argp, nu, M, p, rp, ra, period, energy, h: hn, hvec: h, evec };
}

/** 古典軌道根數 → 狀態向量。 */
export function elementsToState({ a, e, i, raan, argp, nu }, mu) {
  const p = Math.abs(e - 1) < 1e-12 ? NaN : a * (1 - e * e);
  const cnu = Math.cos(nu), snu = Math.sin(nu);
  const rpf = p / (1 + e * cnu);
  const rP = [rpf * cnu, rpf * snu, 0];
  const k = Math.sqrt(mu / p);
  const vP = [-k * snu, k * (e + cnu), 0];
  const Q = perifocalMatrix(i, raan, argp);
  return {
    r: [
      Q[0] * rP[0] + Q[1] * rP[1],
      Q[3] * rP[0] + Q[4] * rP[1],
      Q[6] * rP[0] + Q[7] * rP[1],
    ],
    v: [
      Q[0] * vP[0] + Q[1] * vP[1],
      Q[3] * vP[0] + Q[4] * vP[1],
      Q[6] * vP[0] + Q[7] * vP[1],
    ],
  };
}

/** 平近點角 → 真近點角（橢圓或雙曲線）。 */
export function trueAnomalyFromMean(M, e) {
  if (e < 1) {
    const E = solveKepler(M, e);
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  }
  const H = solveKeplerHyperbolic(M, e);
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
}
