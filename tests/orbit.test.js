import { describe, expect, it } from 'vitest';
import { GM_SUN, DAY_S } from '../src/physics/constants.js';
import { elementsToState, propagateKepler, solveKepler, stateToElements } from '../src/physics/kepler.js';
import { solveLambert } from '../src/physics/lambert.js';
import { integrateDopri5 } from '../src/physics/integrator.js';
import { propagateNBody } from '../src/physics/nbody.js';

const MU_EARTH = 398600.4418;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('克卜勒方程式與軌道根數', () => {
  it('解克卜勒方程式（含高離心率）', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99]) {
      for (const M of [-3, -1, 0.001, 1, 2.5, 3.1]) {
        const E = solveKepler(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 12);
      }
    }
  });

  it('根數 ↔ 狀態向量往返', () => {
    const el = { a: 26600, e: 0.74, i: 1.1, raan: 0.6, argp: 4.5, nu: 2.1 };
    const s = elementsToState(el, MU_EARTH);
    const back = stateToElements(s.r, s.v, MU_EARTH);
    expect(back.a).toBeCloseTo(el.a, 6);
    expect(back.e).toBeCloseTo(el.e, 10);
    expect(back.i).toBeCloseTo(el.i, 10);
    expect(back.raan).toBeCloseTo(el.raan, 10);
    expect(back.argp).toBeCloseTo(el.argp, 9);
    expect(back.nu).toBeCloseTo(el.nu, 9);
  });

  it('普適變數傳播：Curtis 例 3.7，並與數值積分及能量守恆比對', () => {
    const r0 = [7000, -12124, 0];
    const v0 = [2.6679, 4.621, 0];
    const { r, v } = propagateKepler(r0, v0, 3600, MU_EARTH);
    expect(r[0]).toBeCloseTo(-3297.8, 0);
    expect(r[1]).toBeCloseTo(7413.4, 0);
    expect(v[0]).toBeCloseTo(-8.2976, 3);
    // 課本以四捨五入後的 f、g 係數得到 −0.96309；以高精度數值積分驗證正確值
    const f = (t, y, dy) => {
      const k = -MU_EARTH / Math.hypot(y[0], y[1], y[2]) ** 3;
      dy[0] = y[3]; dy[1] = y[4]; dy[2] = y[5];
      dy[3] = k * y[0]; dy[4] = k * y[1]; dy[5] = k * y[2];
    };
    const num = integrateDopri5(f, 0, Float64Array.from([...r0, ...v0]), 3600, { rtol: 1e-13, atol: new Float64Array(6).fill(1e-12) });
    expect(dist(r, num.y.slice(0, 3))).toBeLessThan(1e-4);
    expect(dist(v, num.y.slice(3, 6))).toBeLessThan(1e-7);
    const energy = (rr, vv) => (vv[0] ** 2 + vv[1] ** 2 + vv[2] ** 2) / 2 - MU_EARTH / Math.hypot(...rr);
    expect(energy(r, v)).toBeCloseTo(energy(r0, v0), 9);
  });

  it('雙曲線軌道來回傳播回到原點', () => {
    const r0 = [7000, 0, 0];
    const v0 = [0, 12.5, 1];
    const fwd = propagateKepler(r0, v0, 5 * DAY_S, MU_EARTH);
    const back = propagateKepler(fwd.r, fwd.v, -5 * DAY_S, MU_EARTH);
    expect(dist(back.r, r0)).toBeLessThan(1e-3);
  });
});

describe('Lambert 求解器 (Izzo 2015)', () => {
  it('Curtis 例 5.2', () => {
    const s = solveLambert([5000, 10000, 2100], [-14600, 2500, 7000], 3600, 398600);
    expect(s.v1[0]).toBeCloseTo(-5.9925, 3);
    expect(s.v1[1]).toBeCloseTo(1.9254, 3);
    expect(s.v1[2]).toBeCloseTo(3.2456, 3);
    expect(s.v2[0]).toBeCloseTo(-3.3125, 3);
    expect(s.v2[1]).toBeCloseTo(-4.1966, 3);
    expect(s.v2[2]).toBeCloseTo(-0.38529, 4);
  });

  it('Vallado 例 7-5', () => {
    const s = solveLambert([15945.34, 0, 0], [12214.83899, 10249.46731, 0], 76 * 60, 398600.4418);
    expect(s.v1[0]).toBeCloseTo(2.058913, 5);
    expect(s.v1[1]).toBeCloseTo(2.915965, 5);
    expect(s.v2[0]).toBeCloseTo(-3.451565, 5);
    expect(s.v2[1]).toBeCloseTo(0.910315, 5);
  });

  it('隨機行星際轉移：以二體傳播驗證抵達位置', () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let worst = 0;
    for (let k = 0; k < 3000; k++) {
      const R1 = (0.3 + rnd() * 40) * 1.496e8, R2 = (0.3 + rnd() * 40) * 1.496e8;
      const a1 = rnd() * 2 * Math.PI, a2 = rnd() * 2 * Math.PI;
      const r1 = [R1 * Math.cos(a1), R1 * Math.sin(a1), R1 * (rnd() - 0.5) * 0.4];
      const r2 = [R2 * Math.cos(a2), R2 * Math.sin(a2), R2 * (rnd() - 0.5) * 0.4];
      const tof = (5 + rnd() * 15000) * DAY_S;
      const s = solveLambert(r1, r2, tof, GM_SUN, { retrograde: rnd() < 0.2 });
      expect(s).not.toBeNull();
      if (Math.hypot(...s.v1) > 150) continue; // 排除不具物理意義的超高速解
      const p = propagateKepler(r1, s.v1, tof, GM_SUN);
      worst = Math.max(worst, dist(p.r, r2) / Math.hypot(...r2));
    }
    expect(worst).toBeLessThan(1e-7);
  });
});

describe('數值積分', () => {
  it('DOPRI5 解簡諧振子', () => {
    const f = (t, y, dy) => { dy[0] = y[1]; dy[1] = -y[0]; };
    const res = integrateDopri5(f, 0, Float64Array.from([1, 0]), 20, { rtol: 1e-12, atol: [1e-12, 1e-12] });
    expect(res.y[0]).toBeCloseTo(Math.cos(20), 9);
    expect(res.y[1]).toBeCloseTo(-Math.sin(20), 9);
  });

  it('僅太陽重力時 N 體傳播與克卜勒解析解一致（800 天誤差 < 1 km）', () => {
    const r0 = [1.2e8, 0.5e8, 1e6];
    const v0 = [-10, 28, 0.5];
    const res = propagateNBody({ t0: 0, r0, v0, t1: 800 * DAY_S, gravity: [], record: false, detectEvents: false });
    const k = propagateKepler(r0, v0, 800 * DAY_S, GM_SUN);
    expect(dist(res.final.r, k.r)).toBeLessThan(1);
  });
});
