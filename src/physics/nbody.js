// N 體重力模型：太空船（質量可忽略）在太陽與各行星、月球重力下的運動。
// 座標為日心 J2000 黃道座標；因太陽本身受行星吸引而加速，日心座標系為非慣性系，
// 因此每個天體都包含「間接項」−μ_b · r_b/|r_b|³。

import { BODIES, DAY_S, GRAVITY_IDS, GM_SUN, J2000_JD } from './constants.js';
import { heliocentricState } from './ephemeris.js';
import { integrateDopri5, hermite } from './integrator.js';

// 各天體星曆快取節點間距（天）：依公轉角速度選擇，使三次 Hermite 插值誤差 < 1 km
const NODE_SPACING_DAYS = {
  mercury: 0.25, venus: 0.5, earth: 0.25, moon: 0.125, mars: 1,
  jupiter: 4, saturn: 8, uranus: 8, neptune: 8, pluto: 8,
};

/** 影響球半徑 (km)：r_SOI = a (m/M)^(2/5)。月球相對地球。 */
export function sphereOfInfluence(id) {
  const semiMajor = {
    mercury: 57909050, venus: 108208000, earth: 149598023, moon: 384399, mars: 227939200,
    jupiter: 778570000, saturn: 1433530000, uranus: 2875040000, neptune: 4500000000, pluto: 5906380000,
  }[id];
  if (!semiMajor) return Infinity;
  const central = id === 'moon' ? BODIES.earth.gm : GM_SUN;
  return semiMajor * Math.pow(BODIES[id].gm / central, 0.4);
}

/**
 * 天體位置快取：在固定時間節點計算星曆狀態，並以三次 Hermite 插值取得任意時刻位置。
 * 時間座標為 J2000 起算秒數 (TT)。
 */
export class EphemerisCache {
  constructor(ids = GRAVITY_IDS) {
    this.ids = ids;
    this.nodes = new Map(ids.map((id) => [id, new Map()]));
  }

  node(id, k) {
    const m = this.nodes.get(id);
    let nd = m.get(k);
    if (!nd) {
      const h = NODE_SPACING_DAYS[id] ?? 1;
      const jd = J2000_JD + k * h;
      nd = heliocentricState(id, jd);
      m.set(k, nd);
    }
    return nd;
  }

  /** 天體日心位置 (km) 寫入 out；若提供 outV 一併寫入速度 (km/s)。 */
  position(id, tSec, out, outV) {
    const h = NODE_SPACING_DAYS[id] ?? 1;
    const td = tSec / DAY_S;
    const k = Math.floor(td / h);
    const a = this.node(id, k);
    const b = this.node(id, k + 1);
    hermite(k * h * DAY_S, a.r, a.v, (k + 1) * h * DAY_S, b.r, b.v, tSec, out, outV);
    return out;
  }
}

/**
 * 建立加速度函數（供積分器使用）。y = [x, y, z, vx, vy, vz]。
 * @param {EphemerisCache} cache
 * @param {string[]} ids 施加重力的天體（太陽固定納入）
 * @param {{id:string, radius:number}} [mask] 太空船位於此天體 radius 範圍內時略去其直接引力
 *   （打靶時讓目標在影響球內「無質量」，以直線逼近代表入射漸近線）
 */
export function makeDerivative(cache, ids, mask = null) {
  const gms = ids.map((id) => BODIES[id].gm);
  const masked = ids.map((id) => (mask && mask.id === id ? mask.radius * mask.radius : -1));
  const rb = new Float64Array(3);
  return function deriv(t, y, dy) {
    const x = y[0], yy = y[1], z = y[2];
    const r2 = x * x + yy * yy + z * z;
    const r3 = r2 * Math.sqrt(r2);
    let ax = (-GM_SUN * x) / r3;
    let ay = (-GM_SUN * yy) / r3;
    let az = (-GM_SUN * z) / r3;
    for (let i = 0; i < ids.length; i++) {
      cache.position(ids[i], t, rb);
      const dx = rb[0] - x, dyy = rb[1] - yy, dz = rb[2] - z;
      const d2 = dx * dx + dyy * dyy + dz * dz;
      const d3 = d2 * Math.sqrt(d2);
      const b2 = rb[0] * rb[0] + rb[1] * rb[1] + rb[2] * rb[2];
      const b3 = b2 * Math.sqrt(b2);
      const mu = gms[i];
      if (d2 < masked[i]) {
        ax -= (mu * rb[0]) / b3;
        ay -= (mu * rb[1]) / b3;
        az -= (mu * rb[2]) / b3;
        continue;
      }
      ax += mu * (dx / d3 - rb[0] / b3);
      ay += mu * (dyy / d3 - rb[1] / b3);
      az += mu * (dz / d3 - rb[2] / b3);
    }
    dy[0] = y[3]; dy[1] = y[4]; dy[2] = y[5];
    dy[3] = ax; dy[4] = ay; dy[5] = az;
  };
}

/** 各天體對太空船的直接重力加速度 (km/s²)，供遙測顯示「重力效應」。 */
export function gravityBreakdown(cache, tSec, r) {
  const out = [{ id: 'sun', accel: GM_SUN / (r[0] ** 2 + r[1] ** 2 + r[2] ** 2), dist: Math.hypot(r[0], r[1], r[2]) }];
  const rb = new Float64Array(3);
  for (const id of cache.ids) {
    cache.position(id, tSec, rb);
    const d = Math.hypot(r[0] - rb[0], r[1] - rb[1], r[2] - rb[2]);
    out.push({ id, accel: BODIES[id].gm / (d * d), dist: d });
  }
  return out.sort((a, b) => b.accel - a.accel);
}

/** 軌跡：依時間排序的狀態樣本，可用 Hermite 插值取任意時刻狀態。 */
export class Trajectory {
  constructor() {
    this.t = [];
    this.r = [];
    this.v = [];
  }

  push(t, r, v) {
    this.t.push(t);
    this.r.push(r[0], r[1], r[2]);
    this.v.push(v[0], v[1], v[2]);
  }

  get length() { return this.t.length; }
  get tStart() { return this.t[0]; }
  get tEnd() { return this.t[this.t.length - 1]; }

  indexAt(t) {
    const ts = this.t;
    let lo = 0, hi = ts.length - 1;
    if (t <= ts[0]) return 0;
    if (t >= ts[hi]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** 插值取得時間 t 的 { r, v }；超出範圍回傳 null。 */
  stateAt(t) {
    const n = this.t.length;
    if (n === 0 || t < this.t[0] || t > this.t[n - 1]) return null;
    if (n === 1) return { r: this.r.slice(0, 3), v: this.v.slice(0, 3) };
    const i = this.indexAt(t);
    const r = [0, 0, 0], v = [0, 0, 0];
    hermite(
      this.t[i], this.r.slice(3 * i, 3 * i + 3), this.v.slice(3 * i, 3 * i + 3),
      this.t[i + 1], this.r.slice(3 * i + 3, 3 * i + 6), this.v.slice(3 * i + 3, 3 * i + 6),
      t, r, v,
    );
    return { r, v };
  }
}

/**
 * N 體軌道傳播。
 * @param {object} p
 * @param {number} p.t0 起始時間（J2000 起算秒數, TT）
 * @param {number[]} p.r0 起始日心位置 (km)
 * @param {number[]} p.v0 起始日心速度 (km/s)
 * @param {number} p.t1 結束時間
 * @param {EphemerisCache} [p.cache]
 * @param {string[]} [p.gravity] 施加重力的天體
 * @param {boolean} [p.record=true] 是否記錄軌跡樣本
 * @param {boolean} [p.detectEvents=true] 偵測撞擊與最接近點
 * @param {number} [p.rtol=1e-11]
 * @param {(t:number, r:number[], v:number[])=>boolean} [p.stopWhen] 自訂停止條件
 */
export function propagateNBody({
  t0, r0, v0, t1,
  cache = new EphemerisCache(),
  gravity = GRAVITY_IDS,
  record = true,
  detectEvents = true,
  rtol = 1e-11,
  maxSteps = 400000,
  stopWhen = null,
  mask = null,
}) {
  const deriv = makeDerivative(cache, gravity, mask);
  const y0 = Float64Array.from([...r0, ...v0]);
  const atol = Float64Array.from([1e-4, 1e-4, 1e-4, 1e-10, 1e-10, 1e-10]);
  const traj = record ? new Trajectory() : null;
  if (traj) traj.push(t0, r0, v0);

  const watch = detectEvents ? gravity : [];
  const approaches = {};
  const rb = new Float64Array(3), vb = new Float64Array(3);
  const prev = { t: t0, r: r0.slice(), v: v0.slice(), s: {} };
  // 初始相對徑向速度符號
  for (const id of watch) {
    cache.position(id, t0, rb, vb);
    const dx = r0[0] - rb[0], dy = r0[1] - rb[1], dz = r0[2] - rb[2];
    prev.s[id] = dx * (v0[0] - vb[0]) + dy * (v0[1] - vb[1]) + dz * (v0[2] - vb[2]);
  }
  let impact = null;

  // 在單一步內插值：太空船狀態 (Hermite) 與天體位置
  const scR = [0, 0, 0], scV = [0, 0, 0];
  function relAt(id, ta, ra, va, tb, rbEnd, vbEnd, t) {
    hermite(ta, ra, va, tb, rbEnd, vbEnd, t, scR, scV);
    cache.position(id, t, rb, vb);
    const d = [scR[0] - rb[0], scR[1] - rb[1], scR[2] - rb[2]];
    const w = [scV[0] - vb[0], scV[1] - vb[1], scV[2] - vb[2]];
    return { d, w, dist: Math.hypot(d[0], d[1], d[2]), s: d[0] * w[0] + d[1] * w[1] + d[2] * w[2] };
  }

  // 步長上限：依與最近天體的「接近時間尺度」d/|v_rel| 限制，避免跳過飛掠
  const hLimit = (t, y) => {
    let cap = Infinity;
    const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2];
    const v2 = y[3] * y[3] + y[4] * y[4] + y[5] * y[5];
    cap = Math.min(cap, 0.05 * Math.sqrt(r2 / Math.max(v2, 1e-12)));
    for (const id of gravity) {
      cache.position(id, t, rb, vb);
      const dx = y[0] - rb[0], dy = y[1] - rb[1], dz = y[2] - rb[2];
      const wx = y[3] - vb[0], wy = y[4] - vb[1], wz = y[5] - vb[2];
      const d = Math.hypot(dx, dy, dz);
      const w = Math.hypot(wx, wy, wz) + Math.sqrt(BODIES[id].gm / d);
      cap = Math.min(cap, 0.1 * d / w);
    }
    return Math.max(cap, 1);
  };

  const onStep = (t, y) => {
    const r = [y[0], y[1], y[2]];
    const v = [y[3], y[4], y[5]];
    if (detectEvents && Math.hypot(r[0], r[1], r[2]) < BODIES.sun.radius && !impact) {
      impact = { id: 'sun', t, r, v };
    }
    if (detectEvents) {
      for (const id of watch) {
        cache.position(id, t, rb, vb);
        const dx = r[0] - rb[0], dy = r[1] - rb[1], dz = r[2] - rb[2];
        const s = dx * (v[0] - vb[0]) + dy * (v[1] - vb[1]) + dz * (v[2] - vb[2]);
        const dist = Math.hypot(dx, dy, dz);
        const R = BODIES[id].radius;
        let tMin = null, dMin = dist;
        if (prev.s[id] < 0 && s >= 0) {
          // 此步內通過最接近點：二分法求 d·v_rel = 0
          let a = prev.t, b = t;
          for (let k = 0; k < 40; k++) {
            const m = 0.5 * (a + b);
            const q = relAt(id, prev.t, prev.r, prev.v, t, r, v, m);
            if (q.s < 0) a = m; else b = m;
          }
          tMin = 0.5 * (a + b);
          const q = relAt(id, prev.t, prev.r, prev.v, t, r, v, tMin);
          dMin = q.dist;
          const rec = approaches[id];
          if (!rec || dMin < rec.dist) {
            approaches[id] = { t: tMin, dist: dMin, vrel: Math.hypot(q.w[0], q.w[1], q.w[2]) };
          }
        } else {
          const rec = approaches[id];
          if (!rec || dist < rec.dist) approaches[id] = { t, dist, vrel: Math.hypot(v[0] - vb[0], v[1] - vb[1], v[2] - vb[2]), edge: true };
        }
        prev.s[id] = s;
        if (dMin < R && !impact) {
          // 撞擊：在 [prev.t, tMin 或 t] 之間求 |d| = R
          let a = prev.t, b = tMin ?? t;
          for (let k = 0; k < 50; k++) {
            const m = 0.5 * (a + b);
            const q = relAt(id, prev.t, prev.r, prev.v, t, r, v, m);
            if (q.dist > R) a = m; else b = m;
          }
          const ti = 0.5 * (a + b);
          hermite(prev.t, prev.r, prev.v, t, r, v, ti, scR, scV);
          impact = { id, t: ti, r: scR.slice(), v: scV.slice() };
        }
      }
    }
    if (impact) {
      if (traj) traj.push(impact.t, impact.r, impact.v);
      return true;
    }
    if (traj) traj.push(t, r, v);
    prev.t = t; prev.r = r; prev.v = v;
    if (stopWhen && stopWhen(t, r, v)) return true;
    return false;
  };

  const res = integrateDopri5(deriv, t0, y0, t1, { rtol, atol, onStep, hLimit, maxSteps });
  const final = impact
    ? { t: impact.t, r: impact.r, v: impact.v }
    : { t: res.t, r: [res.y[0], res.y[1], res.y[2]], v: [res.y[3], res.y[4], res.y[5]] };
  return {
    trajectory: traj,
    final,
    impact,
    approaches,
    steps: res.steps,
    rejected: res.rejected,
    status: impact ? 'impact' : res.status,
  };
}
