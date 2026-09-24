import { describe, expect, it } from 'vitest';
import {
  defaultSearchRange, departureGeometry, designTransfer, findBestWindow, hohmann, massRatio,
  nextHohmannWindow, simulateFreeFlight, simulateMission,
} from '../src/physics/mission.js';
import { sphereOfInfluence } from '../src/physics/nbody.js';
import { jdFromCalendar, utcToTT } from '../src/physics/time.js';
import { vdot, vnorm, vunit } from '../src/physics/vec.js';

const JD0 = utcToTT(jdFromCalendar(2026, 9, 24));

describe('Hohmann 轉移（教科書數值）', () => {
  it('地球 → 火星：約 259 天、日心 Δv ≈ 2.94 + 2.65 km/s', () => {
    const h = hohmann('earth', 'mars');
    expect(h.tofDays).toBeGreaterThan(255);
    expect(h.tofDays).toBeLessThan(262);
    expect(h.vinfDep).toBeCloseTo(2.94, 1);
    expect(h.vinfArr).toBeCloseTo(2.65, 1);
    expect(h.phaseDeg).toBeCloseTo(44.3, 0);
    expect(h.synodicDays).toBeCloseTo(780, -1);
  });

  it('地球 → 木星：約 2.7 年', () => {
    expect(hohmann('earth', 'jupiter').tofDays / 365.25).toBeCloseTo(2.73, 1);
  });

  it('影響球半徑：地球約 92.5 萬 km、火星約 57.7 萬 km', () => {
    expect(sphereOfInfluence('earth')).toBeCloseTo(924600, -4);
    expect(sphereOfInfluence('mars')).toBeCloseTo(577000, -4);
  });

  it('火箭方程式：Δv = Isp·g0 時質量比為 e', () => {
    expect(massRatio(450 * 9.80665e-3, 450)).toBeCloseTo(Math.E, 10);
  });
});

describe('Lambert 轉移與發射窗口', () => {
  it('2026 年底火星窗口：C3 約 9–11 km²/s²', async () => {
    const nw = nextHohmannWindow('earth', 'mars', JD0);
    expect(nw - JD0).toBeGreaterThan(30);
    expect(nw - JD0).toBeLessThan(120);
    const range = defaultSearchRange('mars', JD0);
    const best = await findBestWindow({ to: 'mars', ...range, parkingAlt: 200, arrivalAlt: 400, arrivalMode: 'capture' });
    const t = best.transfer;
    expect(t.c3).toBeGreaterThan(8);
    expect(t.c3).toBeLessThan(12);
    expect(t.jdDep - JD0).toBeLessThan(120);
    expect(t.dvTotal).toBeLessThan(6.2);
  });

  it('停泊軌道面包含 v∞ 方向，且近拱點點火 Δv 符合活力公式', () => {
    const t = designTransfer({ to: 'mars', jdDep: JD0 + 40, tofDays: 300 });
    const g = departureGeometry(t.vinfDepVec, t.jdDep, { parkingAlt: 200, siteLat: 28.573 });
    expect(Math.abs(vdot(g.hhat, vunit(t.vinfDepVec)))).toBeLessThan(1e-12);
    expect(g.dv).toBeCloseTo(t.dvDep, 9);
    expect(g.inclination).toBeGreaterThanOrEqual(Math.abs(g.dla) - 1e-9);
  });
});

describe('N 體任務模擬', () => {
  it('火星捕獲：打靶後實際近拱點高度與設定值相差 < 10 km', async () => {
    const range = defaultSearchRange('mars', JD0);
    const best = await findBestWindow({ to: 'mars', ...range, parkingAlt: 200, arrivalAlt: 400, arrivalMode: 'capture' });
    const m = await simulateMission(best.transfer);
    expect(m.status).toBe('captured');
    expect(Math.abs(m.capture.altitude - 400)).toBeLessThan(10);
    expect(m.targeting.uncorrectedMiss).toBeGreaterThan(1e4); // 未修正的圓錐曲線拼接解會錯過火星
    expect(m.launch.jdLiftoff).toBeLessThan(m.launch.jdTMI);
    // 停泊軌道 → 點火後軌跡的位置連續（0.02 秒內移動 < 1 km）
    const s1 = m.stateAt(m.tTMI - 0.01);
    const s2 = m.stateAt(m.tTMI + 0.01);
    expect(vnorm([s2.r[0] - s1.r[0], s2.r[1] - s1.r[1], s2.r[2] - s1.r[2]])).toBeLessThan(1);
    // 點火瞬間速度增量 = TMI Δv
    expect(vnorm([s2.v[0] - s1.v[0], s2.v[1] - s1.v[1], s2.v[2] - s1.v[2]])).toBeCloseTo(m.dvTMI, 2);
    expect(m.stateAt(m.capture.t + 86400).phase).toBe('orbit');
  });

  it('土星飛掠：重力助推提升日心速度', async () => {
    const range = defaultSearchRange('saturn', JD0);
    const best = await findBestWindow({ to: 'saturn', ...range, parkingAlt: 200, arrivalAlt: 20000, arrivalMode: 'flyby' });
    const m = await simulateMission(best.transfer, { postFlybyDays: 400 });
    expect(m.status).toBe('flyby');
    expect(Math.abs(m.flyby.altitude - 20000)).toBeLessThan(100);
    expect(m.flyby.vHelioOut).toBeGreaterThan(m.flyby.vHelioIn);
  });

  it('自由飛行：v∞ = 2.9 km/s 順行出發，遠日點約 1.5 AU', async () => {
    const f = await simulateFreeFlight({ jd: JD0, vinf: 2.9, azimuthDeg: 0, durationDays: 100 });
    expect(f.orbitStart.ra / 1.496e8).toBeGreaterThan(1.4);
    expect(f.orbitStart.ra / 1.496e8).toBeLessThan(1.6);
    expect(f.events.some((e) => e.key === 'soi-out' && e.body === 'earth')).toBe(true);
  });
});

describe('捕獲軌道形狀', () => {
  it('橢圓捕獲比圓軌道省 Δv；遠拱點趨近無限大時等於逃逸速度差', async () => {
    const { captureDeltaV } = await import('../src/physics/mission.js');
    const mu = 126712764.1, rp = 71492 + 4000, vinf = 5.6;
    const circ = captureDeltaV(vinf, mu, rp);
    const ell = captureDeltaV(vinf, mu, rp, 8e6);
    const inf = captureDeltaV(vinf, mu, rp, 1e15);
    expect(ell).toBeLessThan(circ);
    expect(inf).toBeCloseTo(Math.sqrt(vinf ** 2 + (2 * mu) / rp) - Math.sqrt((2 * mu) / rp), 6);
    expect(captureDeltaV(vinf, mu, rp, rp)).toBeCloseTo(Math.sqrt(vinf ** 2 + (2 * mu) / rp) - Math.sqrt(mu / rp), 12);
  });

  it('木星大橢圓捕獲：N 體模擬後近拱點高度與遠拱點符合設定', async () => {
    const range = defaultSearchRange('jupiter', JD0);
    const best = await findBestWindow({ to: 'jupiter', ...range, parkingAlt: 200, arrivalAlt: 10000, arrivalMode: 'capture', captureApo: 0.25 });
    expect(best.transfer.dvArr).toBeLessThan(1.5);
    const m = await simulateMission(best.transfer);
    expect(m.status).toBe('captured');
    expect(Math.abs(m.capture.altitude - 10000)).toBeLessThan(50);
    expect(m.capture.ra / sphereOfInfluence('jupiter')).toBeCloseTo(0.25, 6);
    expect(m.capture.period / 86400).toBeGreaterThan(20);
  });
});
