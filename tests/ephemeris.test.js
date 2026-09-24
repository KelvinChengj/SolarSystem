import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  embPosition, heliocentricPosition, heliocentricState, meanElements, positionFromElements,
} from '../src/physics/ephemeris.js';
import { moonGeocentric } from '../src/physics/moon.js';

// JPL DE421 參考星曆（由 scripts/gen_de421_fixtures.py 產生），1950–2049 年共 48 個時刻
const fixture = JSON.parse(readFileSync(new URL('./fixtures/de421.json', import.meta.url), 'utf8'));

const ARCSEC = 206264.806;
const angleArcsec = (a, b) => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.min(1, c)) * ARCSEC;
};

function maxError(get, key) {
  let ang = 0, dist = 0;
  for (const ep of fixture.epochs) {
    const ref = ep.bodies[key].r;
    const r = get(ep.jd);
    ang = Math.max(ang, angleArcsec(r, ref));
    dist = Math.max(dist, Math.abs(Math.hypot(...r) - Math.hypot(...ref)));
  }
  return { ang, dist };
}

describe('行星星曆與 JPL DE421 比對（JPL 近似根數表 1，1800–2050）', () => {
  // 容許值依 Standish 公布的誤差等級：類地行星數十角秒，木星/土星約 10 角分
  const limits = {
    mercury: 25, venus: 30, earth: 25, mars: 90, jupiter: 600, saturn: 650, uranus: 150, neptune: 80, pluto: 80,
  };
  for (const [id, lim] of Object.entries(limits)) {
    it(`${id} 日心方向誤差 < ${lim}″`, () => {
      const { ang } = maxError((jd) => heliocentricPosition(id, jd), id);
      expect(ang).toBeLessThan(lim);
    });
  }

  it('地月質心與地球差距（月球造成的擺動）', () => {
    const { ang } = maxError((jd) => embPosition(jd), 'emb');
    expect(ang).toBeLessThan(25);
    for (const ep of fixture.epochs.slice(0, 10)) {
      const e = heliocentricPosition('earth', ep.jd);
      const ref = ep.bodies.earth.r;
      expect(Math.hypot(e[0] - ref[0], e[1] - ref[1], e[2] - ref[2])).toBeLessThan(20000);
    }
  });

  it('地球日心速度誤差 < 5 m/s', () => {
    for (const ep of fixture.epochs) {
      const { v } = heliocentricState('earth', ep.jd);
      const ref = ep.bodies.earth.v;
      expect(Math.hypot(v[0] - ref[0], v[1] - ref[1], v[2] - ref[2])).toBeLessThan(0.005);
    }
  });
});

describe('JPL 近似根數表 2（西元前 3000 – 西元 3000 年）', () => {
  const limits = { mercury: 25, venus: 45, emb: 45, mars: 200, jupiter: 700, saturn: 1400, uranus: 800, neptune: 400, pluto: 300 };
  for (const [id, lim] of Object.entries(limits)) {
    it(`${id} 方向誤差 < ${lim}″`, () => {
      const { ang } = maxError((jd) => positionFromElements(meanElements(id, jd, 'table2')), id);
      expect(ang).toBeLessThan(lim);
    });
  }
});

describe('月球（Meeus 第 47 章）', () => {
  it('地心方向誤差 < 10″、距離誤差 < 15 km', () => {
    const { ang, dist } = maxError((jd) => moonGeocentric(jd), 'moon_geo');
    expect(ang).toBeLessThan(10);
    expect(dist).toBeLessThan(15);
  });
});
