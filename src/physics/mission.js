// 行星際任務設計：Hohmann 轉移、Lambert 轉移（圓錐曲線拼接）、Porkchop 發射窗口圖、
// 發射場 → 停泊軌道 → 逃逸雙曲線幾何、N 體軌道修正（打靶法）與捕獲/飛掠分析。

import {
  BODIES, DAY_S, DEG, G0_KM_S2, GM_SUN, GRAVITY_IDS, J2000_JD, LAUNCH_SITES, RAD,
} from './constants.js';
import { heliocentricState, meanElements, planetElements } from './ephemeris.js';
import { propagateKepler, stateToElements, wrapPi } from './kepler.js';
import { solveLambert } from './lambert.js';
import { EphemerisCache, propagateNBody, sphereOfInfluence } from './nbody.js';
import { bodyToEclipticMatrix, eclipticToEquatorial, poleVector } from './orientation.js';
import {
  mvec, solve3, vadd, vangle, vcross, vdot, vnorm, vscale, vsub, vunit,
} from './vec.js';

const secOf = (jd) => (jd - J2000_JD) * DAY_S;
const jdOf = (s) => J2000_JD + s / DAY_S;

/** Tsiolkovsky 火箭方程式：質量比 m0/mf = exp(Δv / (Isp·g0))。 */
export function massRatio(dvKmS, ispS) {
  return Math.exp(dvKmS / (ispS * G0_KM_S2));
}

/** 圓形停泊軌道出發（近拱點點火）所需 Δv (km/s)。 */
export function departureDeltaV(vinf, mu, rp) {
  return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu / rp);
}

/** 抵達後於近拱點減速進入圓軌道所需 Δv (km/s)。 */
export function captureDeltaV(vinf, mu, rp) {
  return Math.sqrt(vinf * vinf + (2 * mu) / rp) - Math.sqrt(mu / rp);
}

/** 理想 Hohmann 轉移（圓形共面軌道近似，使用平均半長軸）。 */
export function hohmann(fromId, toId, jd = J2000_JD) {
  const a1 = planetElements(fromId, jd).a;
  const a2 = planetElements(toId, jd).a;
  const mu = GM_SUN;
  const at = (a1 + a2) / 2;
  const tof = Math.PI * Math.sqrt((at ** 3) / mu);
  const v1 = Math.sqrt(mu / a1), v2 = Math.sqrt(mu / a2);
  const vDepart = Math.sqrt(mu * (2 / a1 - 1 / at));
  const vArrive = Math.sqrt(mu * (2 / a2 - 1 / at));
  const n1 = Math.sqrt(mu / a1 ** 3), n2 = Math.sqrt(mu / a2 ** 3);
  const phase = wrapPi(Math.PI - n2 * tof);
  const vinfDep = Math.abs(vDepart - v1);
  const vinfArr = Math.abs(v2 - vArrive);
  const from = BODIES[fromId], to = BODIES[toId];
  const rpDep = from.eqRadius + (from.parkingAlt ?? 200);
  const rpArr = to.eqRadius + (to.parkingAlt ?? 400);
  const dvDep = departureDeltaV(vinfDep, from.gm, rpDep);
  const dvArr = captureDeltaV(vinfArr, to.gm, rpArr);
  return {
    tofDays: tof / DAY_S,
    semiMajorAxis: at,
    vinfDep, vinfArr,
    c3: vinfDep * vinfDep,
    dvHelioDep: vinfDep, dvHelioArr: vinfArr,
    dvDep, dvArr, dvTotal: dvDep + dvArr,
    phaseDeg: phase * RAD,
    synodicDays: (2 * Math.PI) / Math.abs(n1 - n2) / DAY_S,
  };
}

/** 兩天體日心黃經差（目標 − 出發地），弧度，範圍 (−π, π]。 */
export function phaseAngle(fromId, toId, jd) {
  const a = heliocentricState(fromId, jd).r;
  const b = heliocentricState(toId, jd).r;
  return wrapPi(Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]));
}

/** 依 Hohmann 相位角估計下一個發射窗口（儒略日）。 */
export function nextHohmannWindow(fromId, toId, jdStart) {
  const h = hohmann(fromId, toId, jdStart);
  const target = h.phaseDeg * DEG;
  const f = (jd) => wrapPi(phaseAngle(fromId, toId, jd) - target);
  const step = Math.min(5, h.synodicDays / 60);
  let jd = jdStart;
  let prev = f(jd);
  const limit = jdStart + h.synodicDays * 1.2 + 10;
  while (jd < limit) {
    const jn = jd + step;
    const cur = f(jn);
    if (Math.sign(cur) !== Math.sign(prev) && Math.abs(cur - prev) < Math.PI) {
      let a = jd, b = jn, fa = prev;
      for (let k = 0; k < 50; k++) {
        const m = 0.5 * (a + b);
        const fm = f(m);
        if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
      }
      return 0.5 * (a + b);
    }
    jd = jn;
    prev = cur;
  }
  return null;
}

/**
 * 以 Lambert 問題設計一次轉移（圓錐曲線拼接近似）。
 * @param {object} p
 * @param {string} [p.from='earth']
 * @param {string} p.to 目的地
 * @param {number} p.jdDep 出發儒略日 (TT)
 * @param {number} p.tofDays 飛行時間（天）
 * @param {number} [p.parkingAlt=200] 地球停泊軌道高度 (km)
 * @param {number} [p.arrivalAlt] 目標近拱點高度 (km)
 * @param {'capture'|'flyby'} [p.arrivalMode='capture']
 */
export function designTransfer({
  from = 'earth', to, jdDep, tofDays, parkingAlt = 200, arrivalAlt, arrivalMode = 'capture',
  depState, arrState,
}) {
  const jdArr = jdDep + tofDays;
  const s1 = depState ?? heliocentricState(from, jdDep);
  const s2 = arrState ?? heliocentricState(to, jdArr);
  const sol = solveLambert(s1.r, s2.r, tofDays * DAY_S, GM_SUN);
  if (!sol) return null;
  const vinfDepVec = vsub(sol.v1, s1.v);
  const vinfArrVec = vsub(sol.v2, s2.v);
  const vinfDep = vnorm(vinfDepVec);
  const vinfArr = vnorm(vinfArrVec);
  const fromB = BODIES[from], toB = BODIES[to];
  const alt = arrivalAlt ?? toB.parkingAlt ?? 400;
  const rpDep = fromB.eqRadius + parkingAlt;
  const rpArr = toB.eqRadius + alt;
  const dvDep = departureDeltaV(vinfDep, fromB.gm, rpDep);
  const dvArr = arrivalMode === 'capture' ? captureDeltaV(vinfArr, toB.gm, rpArr) : 0;
  const eq = eclipticToEquatorial(vunit(vinfDepVec));
  const dla = Math.asin(Math.max(-1, Math.min(1, eq[2]))) * RAD;
  const rla = ((Math.atan2(eq[1], eq[0]) * RAD) + 360) % 360;
  const orbit = stateToElements(s1.r, sol.v1, GM_SUN);
  // 轉移角（順行方向）
  const h = vcross(s1.r, s2.r);
  let transferAngle = vangle(s1.r, s2.r) * RAD;
  if (h[2] < 0) transferAngle = 360 - transferAngle;
  return {
    from, to, jdDep, jdArr, tofDays,
    r1: s1.r, r2: s2.r, v1: sol.v1, v2: sol.v2,
    depPlanetState: s1, arrPlanetState: s2,
    vinfDepVec, vinfArrVec, vinfDep, vinfArr,
    c3: vinfDep * vinfDep,
    dla, rla,
    parkingAlt, arrivalAlt: alt, arrivalMode,
    dvDep, dvArr, dvTotal: dvDep + dvArr,
    transferAngle,
    type: transferAngle < 180 ? 'I' : 'II',
    orbit,
    converged: sol.converged,
  };
}

/** 讓出主執行緒，保持介面流暢。 */
export const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * 計算 Porkchop 圖網格（出發日期 × 飛行時間）。
 * @returns {Promise<object>} { nx, ny, jdDep[], tof[], c3, vinfArr, dvDep, dvArr, dvTotal, best }
 */
export async function computePorkchop({
  from = 'earth', to, jdStart, jdEnd, tofMin, tofMax, nx = 120, ny = 90,
  parkingAlt = 200, arrivalAlt, arrivalMode = 'capture', onProgress, signal,
}) {
  const fromB = BODIES[from], toB = BODIES[to];
  const alt = arrivalAlt ?? toB.parkingAlt ?? 400;
  const rpDep = fromB.eqRadius + parkingAlt;
  const rpArr = toB.eqRadius + alt;
  const jdDep = Array.from({ length: nx }, (_, i) => jdStart + ((jdEnd - jdStart) * i) / (nx - 1));
  const tof = Array.from({ length: ny }, (_, j) => tofMin + ((tofMax - tofMin) * j) / (ny - 1));
  const depStates = jdDep.map((jd) => heliocentricState(from, jd));
  const N = nx * ny;
  const c3 = new Float32Array(N).fill(NaN);
  const vinfArr = new Float32Array(N).fill(NaN);
  const dvDep = new Float32Array(N).fill(NaN);
  const dvArr = new Float32Array(N).fill(NaN);
  const dvTotal = new Float32Array(N).fill(NaN);
  let best = null;
  let lastYield = performance.now();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const s1 = depStates[i];
      const jdArr = jdDep[i] + tof[j];
      const s2 = heliocentricState(to, jdArr);
      const sol = solveLambert(s1.r, s2.r, tof[j] * DAY_S, GM_SUN);
      if (!sol) continue;
      const vd = vnorm(vsub(sol.v1, s1.v));
      const va = vnorm(vsub(sol.v2, s2.v));
      const k = j * nx + i;
      c3[k] = vd * vd;
      vinfArr[k] = va;
      dvDep[k] = departureDeltaV(vd, fromB.gm, rpDep);
      dvArr[k] = arrivalMode === 'capture' ? captureDeltaV(va, toB.gm, rpArr) : 0;
      dvTotal[k] = dvDep[k] + dvArr[k];
      if (!best || dvTotal[k] < best.dvTotal) best = { i, j, jdDep: jdDep[i], tofDays: tof[j], dvTotal: dvTotal[k], c3: c3[k] };
    }
    if (performance.now() - lastYield > 24) {
      if (signal?.aborted) return null;
      onProgress?.((j + 1) / ny);
      await yieldToUI();
      lastYield = performance.now();
    }
  }
  onProgress?.(1);
  return {
    from, to, nx, ny, jdDep, tof, c3, vinfArr, dvDep, dvArr, dvTotal, best,
    parkingAlt, arrivalAlt: alt, arrivalMode, jdStart, jdEnd, tofMin, tofMax,
  };
}

/** 以 Nelder–Mead 在 (出發日, 飛行時間) 平面細化最佳轉移。 */
export function refineTransfer(seed, opts, metric = 'dvTotal') {
  const f = ([jd, tof]) => {
    if (tof < 5) return Infinity;
    const t = designTransfer({ ...opts, jdDep: jd, tofDays: tof });
    return t ? t[metric] : Infinity;
  };
  let simplex = [
    [seed.jdDep, seed.tofDays],
    [seed.jdDep + Math.max(1, seed.tofDays * 0.02), seed.tofDays],
    [seed.jdDep, seed.tofDays + Math.max(1, seed.tofDays * 0.02)],
  ].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < 120; it++) {
    simplex.sort((a, b) => a.f - b.f);
    const [b, g, w] = simplex;
    if (Math.abs(w.f - b.f) < 1e-7 && Math.hypot(w.x[0] - b.x[0], w.x[1] - b.x[1]) < 1e-3) break;
    const c = [(b.x[0] + g.x[0]) / 2, (b.x[1] + g.x[1]) / 2];
    const xr = [c[0] + (c[0] - w.x[0]), c[1] + (c[1] - w.x[1])];
    const fr = f(xr);
    if (fr < b.f) {
      const xe = [c[0] + 2 * (c[0] - w.x[0]), c[1] + 2 * (c[1] - w.x[1])];
      const fe = f(xe);
      simplex[2] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < g.f) {
      simplex[2] = { x: xr, f: fr };
    } else {
      const xc = [c[0] + 0.5 * (w.x[0] - c[0]), c[1] + 0.5 * (w.x[1] - c[1])];
      const fc = f(xc);
      if (fc < w.f) simplex[2] = { x: xc, f: fc };
      else {
        simplex = simplex.map((s, k) => (k === 0 ? s : {
          x: [b.x[0] + 0.5 * (s.x[0] - b.x[0]), b.x[1] + 0.5 * (s.x[1] - b.x[1])],
          f: f([b.x[0] + 0.5 * (s.x[0] - b.x[0]), b.x[1] + 0.5 * (s.x[1] - b.x[1])]),
        }));
      }
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return designTransfer({ ...opts, jdDep: simplex[0].x[0], tofDays: simplex[0].x[1] });
}

/** 各目的地建議的 Porkchop 掃描範圍（天）。 */
export function defaultSearchRange(to, jdStart) {
  const h = hohmann('earth', to, jdStart);
  const T = h.tofDays;
  const span = Math.min(Math.max(h.synodicDays * 1.15, 420), 900);
  const ranges = {
    mercury: [60, 220], venus: [70, 320], mars: [110, 480],
    jupiter: [400, 1600], saturn: [900, 3600], uranus: [2200, 8000],
    neptune: [3500, 12000], pluto: [3500, 14000],
  };
  const [tofMin, tofMax] = ranges[to] ?? [T * 0.4, T * 1.6];
  return { jdStart, jdEnd: jdStart + span, tofMin, tofMax };
}

/** 在給定範圍搜尋最省 Δv 的發射窗口。 */
export async function findBestWindow(opts, { onProgress, signal } = {}) {
  const grid = await computePorkchop({ ...opts, nx: 90, ny: 70, onProgress, signal });
  if (!grid?.best) return null;
  const refined = refineTransfer(grid.best, {
    from: opts.from ?? 'earth', to: opts.to, parkingAlt: opts.parkingAlt,
    arrivalAlt: opts.arrivalAlt, arrivalMode: opts.arrivalMode,
  });
  return { grid, transfer: refined };
}

// ─────────────────────────────── 發射與出發幾何 ───────────────────────────────

/**
 * 由 v∞ 向量決定停泊軌道與逃逸雙曲線。
 * 軌道面須包含 v∞ 方向；傾角取 max(發射場緯度 + 0.5°, |DLA|)，使發射場每天兩次通過軌道面。
 */
export function departureGeometry(vinfVec, jd, { parkingAlt = 200, siteLat = 28.573, planet = 'earth' } = {}) {
  const P = BODIES[planet];
  const mu = P.gm;
  const rp = P.eqRadius + parkingAlt;
  const vinf = vnorm(vinfVec);
  const s = vunit(vinfVec);
  const k = poleVector(planet, jd);
  const sk = Math.max(-1, Math.min(1, vdot(s, k)));
  const dla = Math.asin(sk);
  const cosDla = Math.cos(dla);
  let u = vsub(k, vscale(s, sk));
  u = vnorm(u) > 1e-9 ? vunit(u) : vunit(vcross(s, [1, 0, 0]));
  const w = vcross(s, u);
  const incl = Math.max(Math.abs(siteLat) * DEG + 0.5 * DEG, Math.abs(dla));
  const phi = Math.acos(Math.max(-1, Math.min(1, Math.cos(incl) / Math.max(cosDla, 1e-9))));
  const hhat = vunit(vadd(vscale(u, Math.cos(phi)), vscale(w, Math.sin(phi))));
  const e = 1 + (rp * vinf * vinf) / mu;
  const thetaInf = Math.acos(-1 / e);
  const phat = vunit(vsub(vscale(s, Math.cos(thetaInf)), vscale(vcross(hhat, s), Math.sin(thetaInf))));
  const qhat = vcross(hhat, phat);
  const vp = Math.sqrt(vinf * vinf + (2 * mu) / rp);
  const vc = Math.sqrt(mu / rp);
  return {
    rp, vp, vc, dv: vp - vc, e, thetaInf,
    phat, qhat, hhat, n: vc / rp,
    inclination: Math.acos(Math.max(-1, Math.min(1, vdot(hhat, k)))),
    dla,
    rPeri: vscale(phat, rp),
    vPeri: vscale(qhat, vp),
  };
}

/**
 * 找出發射時刻：發射場隨地球自轉通過停泊軌道面的瞬間，
 * 並選擇「上升 + 滑行」後點火時刻最接近 tTarget 的一次。
 */
export function findLaunchTime(geom, jdTarget, site, { ascentMin = 10, downrangeDeg = 18 } = {}) {
  const planet = 'earth';
  const siteBody = [
    Math.cos(site.lat * DEG) * Math.cos(site.lon * DEG),
    Math.cos(site.lat * DEG) * Math.sin(site.lon * DEG),
    Math.sin(site.lat * DEG),
  ];
  const siteDir = (jd) => mvec(bodyToEclipticMatrix(planet, jd), siteBody);
  const g = (jd) => vdot(geom.hhat, siteDir(jd));
  const candidates = [];
  const step = 10 / 1440;
  let jd = jdTarget - 1.3;
  let prev = g(jd);
  while (jd < jdTarget + 0.6) {
    const jn = jd + step;
    const cur = g(jn);
    if (Math.sign(cur) !== Math.sign(prev)) {
      let a = jd, b = jn, fa = prev;
      for (let k = 0; k < 40; k++) {
        const m = 0.5 * (a + b);
        const fm = g(m);
        if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
      }
      candidates.push(0.5 * (a + b));
    }
    jd = jn;
    prev = cur;
  }
  const ascent = ascentMin / 1440;
  const period = (2 * Math.PI) / geom.n / DAY_S;
  let best = null;
  for (const tL of candidates) {
    const d = siteDir(tL);
    const thetaSite = Math.atan2(vdot(d, geom.qhat), vdot(d, geom.phat));
    const thetaInj = thetaSite + downrangeDeg * DEG;
    let coast = (((-thetaInj) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (coast < 10 * DEG) coast += 2 * Math.PI;
    const jdTMI = tL + ascent + (coast / (2 * Math.PI)) * period;
    const cand = { jdLiftoff: tL, jdInjection: tL + ascent, jdTMI, thetaSite, thetaInj, coastRad: coast };
    if (!best || Math.abs(jdTMI - jdTarget) < Math.abs(best.jdTMI - jdTarget)) best = cand;
  }
  return best;
}

// ─────────────────────────────── N 體任務模擬 ───────────────────────────────

/**
 * B 平面瞄準點。打靶時目標在影響球內「無質量」，太空船以進入影響球時的速度
 * V_e = √(v∞² + 2μ/r_SOI) 直線前進；真實雙曲線的撞擊參數 b = h / v∞，
 * 因此直線最接近距離應為 b·v∞/V_e。B 方向取目標自轉軸與入射方向的外積，使捕獲軌道為順行低傾角。
 */
function bPlaneAim(vinfArrVec, rpTarget, muTarget, targetId, jd) {
  const S = vunit(vinfArrVec);
  const vinf = vnorm(vinfArrVec);
  const b = rpTarget * Math.sqrt(1 + (2 * muTarget) / (rpTarget * vinf * vinf));
  const Ve = Math.sqrt(vinf * vinf + (2 * muTarget) / sphereOfInfluence(targetId));
  let T = vcross(S, poleVector(targetId, jd));
  if (vnorm(T) < 1e-6) T = vcross(S, [0, 0, 1]);
  T = vunit(T);
  return { B: vscale(T, (b * vinf) / Ve), b, S, T, R: vcross(S, T) };
}

/**
 * 完整任務模擬：
 * 1. 由發射場時刻決定停泊軌道與地球逃逸點火 (TMI) 時刻
 * 2. 以 N 體重力積分 + 牛頓法打靶，修正 v∞ 使太空船通過目標 B 平面瞄準點
 * 3. 最終完整 N 體積分，偵測近拱點、進行捕獲點火或飛掠分析
 */
export async function simulateMission(plan, {
  siteKey = 'ksc', onProgress, signal, postFlybyDays,
} = {}) {
  const { to } = plan;
  const earth = BODIES.earth;
  const target = BODIES[to];
  const site = LAUNCH_SITES[siteKey] ?? LAUNCH_SITES.ksc;
  const cache = new EphemerisCache();
  const report = (stage, frac) => onProgress?.(stage, frac);

  // 1) 發射時刻與 TMI 時刻
  const geom0 = departureGeometry(plan.vinfDepVec, plan.jdDep, { parkingAlt: plan.parkingAlt, siteLat: site.lat });
  const launch = findLaunchTime(geom0, plan.jdDep, site);
  const jdTMI = launch ? launch.jdTMI : plan.jdDep;
  // 以實際點火時刻重新求 Lambert 作為初始猜測
  const replanned = designTransfer({ ...plan, jdDep: jdTMI, tofDays: plan.jdArr - jdTMI }) ?? plan;
  const tTMI = secOf(jdTMI);
  const tArr = secOf(plan.jdArr);
  const rpTarget = target.eqRadius + plan.arrivalAlt;
  const aim = bPlaneAim(replanned.vinfArrVec, rpTarget, target.gm, to, plan.jdArr);

  const gravAll = GRAVITY_IDS;
  const targetMask = { id: to, radius: sphereOfInfluence(to) };
  const earthAt = (t) => {
    const r = [0, 0, 0], v = [0, 0, 0];
    cache.position('earth', t, r, v);
    return { r, v };
  };
  const eTMI = earthAt(tTMI);
  const startState = (vinfVec) => {
    const g = departureGeometry(vinfVec, jdTMI, { parkingAlt: plan.parkingAlt, siteLat: site.lat });
    return { r: vadd(eTMI.r, g.rPeri), v: vadd(eTMI.v, g.vPeri), geom: g };
  };
  const missAt = (vinfVec) => {
    const s = startState(vinfVec);
    const res = propagateNBody({
      t0: tTMI, r0: s.r, v0: s.v, t1: tArr, cache, gravity: gravAll, mask: targetMask, record: false, detectEvents: false,
    });
    const pt = [0, 0, 0];
    cache.position(to, tArr, pt);
    const rel = vsub(res.final.r, pt);
    return { f: vsub(rel, aim.B), rel };
  };

  // 2) 打靶：牛頓法 + 有限差分 Jacobian
  let vinf = replanned.vinfDepVec.slice();
  report('targeting', 0);
  let cur = missAt(vinf);
  const uncorrectedMiss = vnorm(cur.rel);
  const uncorrectedAimError = vnorm(cur.f);
  let iterations = 0;
  const h = 1e-5; // km/s
  for (; iterations < 12; iterations++) {
    if (vnorm(cur.f) < 0.5) break;
    if (signal?.aborted) return null;
    const J = new Array(9);
    for (let c = 0; c < 3; c++) {
      const vp = vinf.slice();
      vp[c] += h;
      const m = missAt(vp);
      for (let r = 0; r < 3; r++) J[r * 3 + c] = (m.f[r] - cur.f[r]) / h;
      report('targeting', (iterations + (c + 1) / 4) / 8);
      await yieldToUI();
    }
    const dx = solve3(J, cur.f);
    if (!dx) break;
    let lam = 1;
    let next = null;
    for (let ls = 0; ls < 6; ls++) {
      const trial = vsub(vinf, vscale(dx, lam));
      const m = missAt(trial);
      if (vnorm(m.f) < vnorm(cur.f)) { next = { v: trial, m }; break; }
      lam *= 0.5;
    }
    if (!next) break;
    vinf = next.v;
    cur = next.m;
    await yieldToUI();
  }
  const stage1AimError = vnorm(cur.f);

  // 2b) 精修：完整重力下，以接近目標時的密切雙曲線計算 B 平面參數 (B·T, B·R)，
  //     用 2×3 Jacobian 的最小範數牛頓更新，使實際近拱點高度符合設定。
  const soi = sphereOfInfluence(to);
  const rEval = Math.min(0.1 * soi, Math.max(50 * rpTarget, 1e5));
  const pr = [0, 0, 0], pv = [0, 0, 0];
  const evalB = (vinfVec) => {
    const st = startState(vinfVec);
    let hit = null;
    propagateNBody({
      t0: tTMI, r0: st.r, v0: st.v, t1: tArr + 60 * DAY_S, cache, gravity: gravAll, record: false, detectEvents: false,
      stopWhen: (t, r, v) => {
        cache.position(to, t, pr, pv);
        const rr = vsub(r, pr);
        if (vnorm(rr) < rEval) { hit = { r: rr, v: vsub(v, pv) }; return true; }
        return false;
      },
    });
    if (!hit) return null;
    const B = bVectorFromState(hit.r, hit.v, target.gm);
    if (!B) return null;
    // 以實際 v∞ 下的密切近拱點半徑為目標（v∞ 與 Lambert 值略有差異）
    const osc = stateToElements(hit.r, hit.v, target.gm);
    const rpErr = vdot(B, aim.T) > 0 ? osc.rp - rpTarget : -(osc.rp + rpTarget);
    return [rpErr, vdot(B, aim.R)];
  };
  let refineIters = 0;
  let fB = evalB(vinf);
  const hB = 2e-6;
  while (fB && refineIters < 6 && Math.hypot(fB[0], fB[1]) > Math.max(0.5, 1e-4 * rpTarget)) {
    if (signal?.aborted) return null;
    const J = [[], []];
    let ok = true;
    for (let c = 0; c < 3; c++) {
      const vp = vinf.slice();
      vp[c] += hB;
      const m = evalB(vp);
      if (!m) { ok = false; break; }
      J[0][c] = (m[0] - fB[0]) / hB;
      J[1][c] = (m[1] - fB[1]) / hB;
      report('refining', 0.75 + 0.03 * (refineIters * 3 + c));
      await yieldToUI();
    }
    if (!ok) break;
    // 最小範數解：Δ = −Jᵀ (J Jᵀ)⁻¹ f
    const a11 = vdot(J[0], J[0]), a12 = vdot(J[0], J[1]), a22 = vdot(J[1], J[1]);
    const det = a11 * a22 - a12 * a12;
    if (!(Math.abs(det) > 0)) break;
    const y0 = (a22 * fB[0] - a12 * fB[1]) / det;
    const y1 = (-a12 * fB[0] + a11 * fB[1]) / det;
    const dx = [J[0][0] * y0 + J[1][0] * y1, J[0][1] * y0 + J[1][1] * y1, J[0][2] * y0 + J[1][2] * y1];
    let lam = 1, accepted = false;
    for (let ls = 0; ls < 5; ls++) {
      const trial = vsub(vinf, vscale(dx, lam));
      const m = evalB(trial);
      if (m && Math.hypot(m[0], m[1]) < Math.hypot(fB[0], fB[1])) { vinf = trial; fB = m; accepted = true; break; }
      lam *= 0.5;
    }
    refineIters++;
    if (!accepted) break;
  }
  const finalAimError = fB ? Math.hypot(fB[0], fB[1]) : stage1AimError;
  report('propagating', 0.95);
  await yieldToUI();

  // 3) 完整 N 體積分（含目標重力）
  const start = startState(vinf);
  const geom = start.geom;
  const flybyExtra = postFlybyDays ?? Math.min(Math.max(plan.tofDays * 0.6, 120), 1500);
  const tEndMax = tArr + (plan.arrivalMode === 'flyby' ? flybyExtra : 20) * DAY_S;
  const rb = [0, 0, 0], vb = [0, 0, 0];
  let prevS = null;
  let tPeri = null;
  const stopWhen = (t, r, v) => {
    if (plan.arrivalMode === 'flyby') return false;
    cache.position(to, t, rb, vb);
    const d = vsub(r, rb);
    const s = vdot(d, vsub(v, vb));
    const close = vnorm(d) < sphereOfInfluence(to);
    const passed = close && prevS !== null && prevS < 0 && s >= 0;
    prevS = s;
    if (passed) { tPeri = t; return true; }
    return false;
  };
  const final = propagateNBody({
    t0: tTMI, r0: start.r, v0: start.v, t1: tEndMax, cache, gravity: gravAll, record: true, detectEvents: true, stopWhen,
  });
  const traj = final.trajectory;

  // 近拱點（最接近目標）
  const appr = final.approaches[to];
  let capture = null, flyby = null;
  const events = [];
  if (launch) {
    events.push({ t: secOf(launch.jdLiftoff), key: 'liftoff', label: `自${site.name}發射升空` });
    events.push({ t: secOf(launch.jdInjection), key: 'parking', label: `進入 ${plan.parkingAlt} km 停泊軌道` });
  }
  events.push({ t: tTMI, key: 'tmi', label: `逃逸點火（Δv ${geom.dv.toFixed(3)} km/s）` });

  const soiEvents = findSoiCrossings(traj, cache, ['earth', 'moon', to]);
  for (const ev of soiEvents) events.push(ev);
  for (const [id, a] of Object.entries(final.approaches)) {
    if (id === to || id === 'earth' || a.edge) continue;
    const soi = sphereOfInfluence(id);
    if (a.dist < Math.max(soi * 3, 1e6)) {
      events.push({ t: a.t, key: 'approach', body: id, label: `最接近${BODIES[id].name}：${fmtKm(a.dist)}` });
    }
  }

  let status = final.status;
  if (final.impact) {
    events.push({ t: final.impact.t, key: 'impact', body: final.impact.id, label: `撞擊${BODIES[final.impact.id].name}` });
  } else if (appr && !appr.edge && appr.dist < sphereOfInfluence(to)) {
    const tp = appr.t;
    const sc = traj.stateAt(tp);
    const pr = [0, 0, 0], pv = [0, 0, 0];
    cache.position(to, tp, pr, pv);
    const rRel = vsub(sc.r, pr);
    const vRel = vsub(sc.v, pv);
    const rp = vnorm(rRel);
    const hyp = stateToElements(rRel, vRel, target.gm);
    const vinfIn = Math.sqrt(Math.max(0, vnorm(vRel) ** 2 - (2 * target.gm) / rp));
    const pole = poleVector(to, jdOf(tp));
    const orbitIncl = Math.acos(Math.max(-1, Math.min(1, vdot(vunit(hyp.hvec), pole)))) * RAD;
    if (plan.arrivalMode === 'capture') {
      const vc = Math.sqrt(target.gm / rp);
      const vCirc = vscale(vunit(vRel), vc);
      const dv = vnorm(vRel) - vc;
      capture = {
        t: tp, rp, altitude: rp - target.eqRadius, dv, vinf: vinfIn,
        rRel, vRel: vCirc, mu: target.gm, period: (2 * Math.PI * rp) / vc, inclination: orbitIncl,
      };
      events.push({ t: tp, key: 'capture', label: `捕獲點火入軌（Δv ${dv.toFixed(3)} km/s，高度 ${fmtKm(rp - target.eqRadius)}）` });
      // 軌跡截斷於近拱點
      truncateTrajectory(traj, tp);
      status = 'captured';
    } else {
      flyby = analyzeFlyby(traj, cache, to, tp, { rp, vinf: vinfIn, e: hyp.e, inclination: orbitIncl });
      events.push({ t: tp, key: 'flyby', label: `飛掠${target.name}（高度 ${fmtKm(rp - target.eqRadius)}）` });
      status = 'flyby';
    }
  } else {
    status = 'missed';
  }
  events.sort((a, b) => a.t - b.t);

  const tLiftoff = launch ? secOf(launch.jdLiftoff) : tTMI;
  const tInj = launch ? secOf(launch.jdInjection) : tTMI;
  const mission = {
    plan: replanned,
    originalPlan: plan,
    site, siteKey,
    launch, geom,
    tLiftoff, tInjection: tInj, tTMI, tArrPlanned: tArr,
    targeting: {
      iterations,
      refineIterations: refineIters,
      stage1AimError,
      uncorrectedMiss,
      uncorrectedAimError,
      finalAimError,
      vinfLambert: replanned.vinfDepVec,
      vinfFinal: vinf,
      dvCorrection: vnorm(vsub(vinf, replanned.vinfDepVec)) * 1000, // m/s
      aimB: aim.b,
    },
    trajectory: traj,
    approaches: final.approaches,
    capture, flyby, impact: final.impact,
    status,
    events,
    cache,
    dvTMI: geom.dv,
    dvTotal: geom.dv + (capture?.dv ?? 0),
  };
  mission.stateAt = (t) => missionStateAt(mission, t);
  report('done', 1);
  return mission;
}

/** 由目標中心座標下的狀態計算 B 向量（入射漸近線與 B 平面交點）。 */
export function bVectorFromState(r, v, mu) {
  const rn = vnorm(r);
  const v2 = vdot(v, v);
  const vinf2 = v2 - (2 * mu) / rn;
  if (!(vinf2 > 0)) return null;
  const h = vcross(r, v);
  const hn = vnorm(h);
  const hhat = vscale(h, 1 / hn);
  const evec = vscale(vsub(vscale(r, v2 - mu / rn), vscale(v, vdot(r, v))), 1 / mu);
  const e = vnorm(evec);
  if (!(e > 1)) return null;
  const phat = vscale(evec, 1 / e);
  const qhat = vcross(hhat, phat);
  const S = vadd(vscale(phat, 1 / e), vscale(qhat, Math.sqrt(1 - 1 / (e * e))));
  const b = hn / Math.sqrt(vinf2);
  return vscale(vcross(S, hhat), b);
}

function fmtKm(km) {
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} 百萬 km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

function truncateTrajectory(traj, t) {
  const st = traj.stateAt(t);
  let n = traj.t.length;
  while (n > 1 && traj.t[n - 1] >= t) n--;
  traj.t.length = n;
  traj.r.length = 3 * n;
  traj.v.length = 3 * n;
  if (st) traj.push(t, st.r, st.v);
}

/** 掃描軌跡樣本，找出進出各天體影響球的時刻。 */
export function findSoiCrossings(traj, cache, ids) {
  const out = [];
  const rb = [0, 0, 0];
  for (const id of ids) {
    const soi = sphereOfInfluence(id);
    const rel = (t) => {
      const s = traj.stateAt(t);
      cache.position(id, t, rb);
      return vnorm(vsub(s.r, rb)) - soi;
    };
    let prev = null;
    for (let i = 0; i < traj.t.length; i++) {
      const t = traj.t[i];
      cache.position(id, t, rb);
      const d = Math.hypot(traj.r[3 * i] - rb[0], traj.r[3 * i + 1] - rb[1], traj.r[3 * i + 2] - rb[2]) - soi;
      if (prev !== null && Math.sign(d) !== Math.sign(prev.d)) {
        let a = prev.t, b = t, fa = prev.d;
        for (let k = 0; k < 40; k++) {
          const m = 0.5 * (a + b);
          const fm = rel(m);
          if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
        }
        const tc = 0.5 * (a + b);
        const entering = d < 0;
        out.push({
          t: tc, key: entering ? 'soi-in' : 'soi-out', body: id,
          label: `${entering ? '進入' : '離開'}${BODIES[id].name}影響球（${fmtKm(soi)}）`,
        });
      }
      prev = { t, d };
    }
  }
  return out;
}

/** 飛掠（重力助推）分析：比較進出目標影響球時的日心速度。 */
function analyzeFlyby(traj, cache, id, tp, info) {
  const soi = sphereOfInfluence(id);
  const cross = findSoiCrossings(traj, cache, [id]);
  const tin = cross.filter((c) => c.key === 'soi-in' && c.t <= tp).pop()?.t;
  const tout = cross.find((c) => c.key === 'soi-out' && c.t >= tp)?.t;
  const res = { ...info, soi, t: tp, altitude: info.rp - BODIES[id].eqRadius };
  res.turnAngle = 2 * Math.asin(Math.min(1, 1 / info.e)) * RAD;
  if (tin != null && tout != null) {
    const a = traj.stateAt(tin), b = traj.stateAt(tout);
    res.vHelioIn = vnorm(a.v);
    res.vHelioOut = vnorm(b.v);
    res.dvGravityAssist = vnorm(vsub(b.v, a.v));
    res.orbitBefore = stateToElements(a.r, a.v, GM_SUN);
    res.orbitAfter = stateToElements(b.r, b.v, GM_SUN);
  }
  return res;
}

/** 任務中任意時刻的太空船日心狀態（km, km/s）與飛行階段。 */
export function missionStateAt(m, t) {
  const earth = [0, 0, 0], earthV = [0, 0, 0];
  const g = m.geom;
  if (t < m.tLiftoff) {
    // 升空前一天起，火箭停在發射台上隨地球自轉
    if (!m.launch || t < m.tLiftoff - DAY_S) return null;
    m.cache.position('earth', t, earth, earthV);
    const jd = jdOf(t);
    const rel = mvec(bodyToEclipticMatrix('earth', jd), [
      Math.cos(m.site.lat * DEG) * Math.cos(m.site.lon * DEG) * BODIES.earth.eqRadius,
      Math.cos(m.site.lat * DEG) * Math.sin(m.site.lon * DEG) * BODIES.earth.eqRadius,
      Math.sin(m.site.lat * DEG) * BODIES.earth.eqRadius,
    ]);
    const k = poleVector('earth', jd);
    const omega = (2 * Math.PI) / 86164.0905;
    const vrot = vscale(vcross(k, rel), omega);
    return { r: vadd(earth, rel), v: vadd(earthV, vrot), phase: 'prelaunch', central: 'earth', rel, dir: vunit(rel) };
  }
  if (t < m.tTMI) {
    m.cache.position('earth', t, earth, earthV);
    if (t < m.tInjection && m.launch) {
      // 簡化上升段：在軌道面內由發射場升至停泊軌道（重力轉彎：由垂直逐漸轉為水平）
      const s = (t - m.tLiftoff) / (m.tInjection - m.tLiftoff);
      const theta = m.launch.thetaSite + (m.launch.thetaInj - m.launch.thetaSite) * s * s;
      const R = BODIES.earth.eqRadius + m.plan.parkingAlt * (1 - (1 - s) * (1 - s));
      const dir = vadd(vscale(g.phat, Math.cos(theta)), vscale(g.qhat, Math.sin(theta)));
      const tang = vadd(vscale(g.phat, -Math.sin(theta)), vscale(g.qhat, Math.cos(theta)));
      const r = vadd(earth, vscale(dir, R));
      const v = vadd(earthV, vscale(tang, g.vc * s));
      return { r, v, phase: 'ascent', central: 'earth', rel: vscale(dir, R), dir: vunit(vadd(vscale(dir, 1 - s), vscale(tang, s + 0.05))) };
    }
    // 停泊軌道滑行（圓軌道），於 tTMI 抵達近拱點方向 p̂
    const th = g.n * (t - m.tTMI);
    const dir = vadd(vscale(g.phat, Math.cos(th)), vscale(g.qhat, Math.sin(th)));
    const rel = vscale(dir, g.rp);
    const vrel = vscale(vadd(vscale(g.phat, -Math.sin(th)), vscale(g.qhat, Math.cos(th))), g.vc);
    return { r: vadd(earth, rel), v: vadd(earthV, vrel), phase: 'parking', central: 'earth', rel };
  }
  const traj = m.trajectory;
  if (t <= traj.tEnd) {
    const s = traj.stateAt(t);
    return { ...s, phase: 'cruise' };
  }
  if (m.capture) {
    const c = m.capture;
    const pr = [0, 0, 0], pv = [0, 0, 0];
    m.cache.position(m.plan.to, t, pr, pv);
    const k = propagateKepler(c.rRel, c.vRel, t - c.t, c.mu);
    return { r: vadd(pr, k.r), v: vadd(pv, k.v), phase: 'orbit', central: m.plan.to, rel: k.r };
  }
  if (m.impact) return null;
  // 飛掠後或錯過：以太陽二體運動外推
  const last = traj.stateAt(traj.tEnd);
  const k = propagateKepler(last.r, last.v, t - traj.tEnd, GM_SUN);
  return { r: k.r, v: k.v, phase: 'coast' };
}

/** 將 Porkchop 網格中某格轉成完整轉移設計。 */
export function transferFromGrid(grid, i, j) {
  return designTransfer({
    from: grid.from, to: grid.to, jdDep: grid.jdDep[i], tofDays: grid.tof[j],
    parkingAlt: grid.parkingAlt, arrivalAlt: grid.arrivalAlt, arrivalMode: grid.arrivalMode,
  });
}

/** 自由飛行實驗：從地球停泊軌道以指定 v∞ 出發，純 N 體積分。 */
export async function simulateFreeFlight({
  jd, vinf, azimuthDeg = 0, elevationDeg = 0, durationDays = 365, parkingAlt = 200, siteKey = 'ksc',
}) {
  const site = LAUNCH_SITES[siteKey] ?? LAUNCH_SITES.ksc;
  const cache = new EphemerisCache();
  const e = heliocentricState('earth', jd);
  // 以地球公轉速度方向為 0°，於黃道面內逆時針量方位角，仰角為離開黃道面的角度
  const vhat = vunit([e.v[0], e.v[1], 0]);
  const nhat = [0, 0, 1];
  const side = vcross(nhat, vhat);
  const az = azimuthDeg * DEG, el = elevationDeg * DEG;
  const dir = vadd(vadd(vscale(vhat, Math.cos(el) * Math.cos(az)), vscale(side, Math.cos(el) * Math.sin(az))), vscale(nhat, Math.sin(el)));
  const vinfVec = vscale(dir, vinf);
  const geom = departureGeometry(vinfVec, jd, { parkingAlt, siteLat: site.lat });
  const t0 = secOf(jd);
  await yieldToUI();
  const res = propagateNBody({
    t0, r0: vadd(e.r, geom.rPeri), v0: vadd(e.v, geom.vPeri), t1: t0 + durationDays * DAY_S, cache, gravity: GRAVITY_IDS,
  });
  const traj = res.trajectory;
  const events = [{ t: t0, key: 'tmi', label: `逃逸點火（Δv ${geom.dv.toFixed(3)} km/s，v∞ ${vinf.toFixed(2)} km/s）` }];
  for (const ev of findSoiCrossings(traj, cache, GRAVITY_IDS.filter((id) => id !== 'moon'))) {
    if (ev.body === 'earth' && ev.key === 'soi-in' && ev.t - t0 < 86400) continue;
    events.push(ev);
  }
  for (const [id, a] of Object.entries(res.approaches)) {
    if (a.edge || id === 'earth') continue;
    if (a.dist < sphereOfInfluence(id) * 2) events.push({ t: a.t, key: 'approach', body: id, label: `最接近${BODIES[id].name}：${fmtKm(a.dist)}` });
  }
  if (res.impact) events.push({ t: res.impact.t, key: 'impact', body: res.impact.id, label: `撞擊${BODIES[res.impact.id].name}` });
  events.sort((a, b) => a.t - b.t);
  const endState = traj.stateAt(traj.tEnd);
  const orbitStart = stateToElements(vadd(e.r, [0, 0, 0]), vadd(e.v, vinfVec), GM_SUN);
  const orbitEnd = stateToElements(endState.r, endState.v, GM_SUN);
  // 重力助推：找出日心能量變化最大的飛掠
  const assists = [];
  for (const [id, a] of Object.entries(res.approaches)) {
    if (a.edge || id === 'earth' || id === 'moon') continue;
    if (a.dist > sphereOfInfluence(id)) continue;
    const mu = BODIES[id].gm;
    const vinfFb = Math.sqrt(Math.max(0, a.vrel * a.vrel - (2 * mu) / a.dist));
    const fb = analyzeFlyby(traj, cache, id, a.t, { rp: a.dist, vinf: vinfFb, e: 1 + (a.dist * vinfFb * vinfFb) / mu, inclination: 0 });
    assists.push({ id, ...fb });
  }
  const mission = {
    kind: 'free',
    plan: { to: null, parkingAlt, jdDep: jd, tofDays: durationDays },
    site, siteKey, launch: null, geom,
    tLiftoff: t0, tInjection: t0, tTMI: t0, tArrPlanned: t0 + durationDays * DAY_S,
    trajectory: traj, approaches: res.approaches, capture: null, flyby: null, impact: res.impact,
    status: res.impact ? 'impact' : 'coast',
    events, cache, dvTMI: geom.dv, dvTotal: geom.dv, vinf, vinfVec,
    orbitStart, orbitEnd, assists,
  };
  mission.stateAt = (t) => missionStateAt(mission, t);
  return mission;
}

export { secOf as secondsFromJd, jdOf as jdFromSeconds, meanElements };
