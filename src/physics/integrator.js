// 自適應步長 Dormand–Prince 5(4) Runge–Kutta 積分器（FSAL），用於太空船的 N 體軌道傳播。

const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
// 誤差係數 = 五階解 − 四階解
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

/**
 * 以 DOPRI5 積分 y' = f(t, y)，y 為長度 n 的 Float64Array。
 * @param {(t:number, y:Float64Array, out:Float64Array)=>void} f 導數函數
 * @param {number} t0 起始時間
 * @param {Float64Array} y0 起始狀態
 * @param {number} t1 結束時間（可小於 t0 以反向積分）
 * @param {object} opts
 * @param {number} [opts.rtol=1e-11] 相對容許誤差
 * @param {number[]|Float64Array} [opts.atol] 各分量絕對容許誤差
 * @param {number} [opts.h0] 初始步長
 * @param {number} [opts.hMax=Infinity] 最大步長
 * @param {number} [opts.maxSteps=200000]
 * @param {(t:number, y:Float64Array, dy:Float64Array, h:number)=>boolean|void} [opts.onStep]
 *   每接受一步後呼叫；回傳 true 表示提前停止。
 * @returns {{t:number, y:Float64Array, steps:number, rejected:number, stopped:boolean, status:string}}
 */
export function integrateDopri5(f, t0, y0, t1, opts = {}) {
  const n = y0.length;
  const rtol = opts.rtol ?? 1e-11;
  const atol = opts.atol ?? new Float64Array(n).fill(1e-9);
  const hMax = opts.hMax ?? Infinity;
  const maxSteps = opts.maxSteps ?? 200000;
  const dir = t1 >= t0 ? 1 : -1;

  const y = Float64Array.from(y0);
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n);
  const k4 = new Float64Array(n), k5 = new Float64Array(n), k6 = new Float64Array(n), k7 = new Float64Array(n);
  const yt = new Float64Array(n), ynew = new Float64Array(n);

  let t = t0;
  f(t, y, k1);
  let h = opts.h0 ?? Math.min(Math.abs(t1 - t0) / 100, hMax);
  if (!(h > 0)) h = 1;
  h = Math.min(h, hMax);
  let steps = 0, rejected = 0, status = 'ok';
  let errOld = 1e-4;
  // hLimit：依物理情境限制步長（例如接近行星時避免一步跨過近拱點）
  let hCap = opts.hLimit ? opts.hLimit(t, y) : Infinity;

  while (dir * (t1 - t) > 0) {
    if (steps + rejected >= maxSteps) { status = 'maxsteps'; break; }
    let hs = Math.min(h, hCap, Math.abs(t1 - t)) * dir;

    for (let i = 0; i < n; i++) yt[i] = y[i] + hs * A21 * k1[i];
    f(t + C2 * hs, yt, k2);
    for (let i = 0; i < n; i++) yt[i] = y[i] + hs * (A31 * k1[i] + A32 * k2[i]);
    f(t + C3 * hs, yt, k3);
    for (let i = 0; i < n; i++) yt[i] = y[i] + hs * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    f(t + C4 * hs, yt, k4);
    for (let i = 0; i < n; i++) yt[i] = y[i] + hs * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    f(t + C5 * hs, yt, k5);
    for (let i = 0; i < n; i++) yt[i] = y[i] + hs * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    f(t + hs, yt, k6);
    for (let i = 0; i < n; i++) ynew[i] = y[i] + hs * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
    f(t + hs, ynew, k7);

    let err = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol[i] + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
      const e = (hs * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i])) / sc;
      err += e * e;
    }
    err = Math.sqrt(err / n);

    if (!Number.isFinite(err)) {
      h *= 0.25;
      rejected++;
      if (h < 1e-9) { status = 'stepsize'; break; }
      continue;
    }

    if (err <= 1) {
      t += hs;
      for (let i = 0; i < n; i++) { y[i] = ynew[i]; k1[i] = k7[i]; }
      steps++;
      // PI 步長控制（Hairer–Wanner）
      const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.17) * Math.pow(errOld, 0.04)));
      errOld = Math.max(err, 1e-4);
      const hUsed = Math.abs(hs);
      h = Math.min(hMax, hUsed * fac);
      if (opts.hLimit) hCap = opts.hLimit(t, y);
      if (opts.onStep && opts.onStep(t, y, k1, hUsed)) {
        return { t, y, steps, rejected, stopped: true, status: 'stopped' };
      }
    } else {
      rejected++;
      h = Math.abs(hs) * Math.max(0.2, 0.9 * Math.pow(err, -0.2));
      if (h < 1e-9) { status = 'stepsize'; break; }
    }
  }
  return { t, y, steps, rejected, stopped: false, status };
}

/**
 * 三次 Hermite 插值（位置 + 速度）。
 * 回傳時間 t 的位置與速度，p0/v0 位於 t0，p1/v1 位於 t1。
 */
export function hermite(t0, p0, v0, t1, p1, v1, t, outR, outV) {
  const h = t1 - t0;
  const s = (t - t0) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  // 導數
  const d00 = (6 * s2 - 6 * s) / h;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = (-6 * s2 + 6 * s) / h;
  const d11 = 3 * s2 - 2 * s;
  for (let i = 0; i < 3; i++) {
    outR[i] = h00 * p0[i] + h10 * h * v0[i] + h01 * p1[i] + h11 * h * v1[i];
    if (outV) outV[i] = d00 * p0[i] + d10 * v0[i] + d01 * p1[i] + d11 * v1[i];
  }
}
