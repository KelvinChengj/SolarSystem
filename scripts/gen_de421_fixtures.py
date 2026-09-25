"""產生測試用的 JPL DE421 參考星曆 (tests/fixtures/de421.json)。

用法：
    pip install jplephem numpy de421
    python scripts/gen_de421_fixtures.py

輸出為日心 J2000 黃道座標 (km, km/s)，時間為 TDB 儒略日；月球為地心座標。
"""
import json
import math
import os

import de421
from jplephem.ephem import Ephemeris  # 舊版 API：de421 PyPI 套件以 numpy 陣列存放 Chebyshev 係數

OBLIQUITY = math.radians(84381.448 / 3600.0)  # J2000 平黃赤交角
CE, SE = math.cos(OBLIQUITY), math.sin(OBLIQUITY)


def to_ecliptic(v):
    x, y, z = v
    return [x, CE * y + SE * z, -SE * y + CE * z]


def main():
    eph = Ephemeris(de421)
    earth_share = eph.earth_share  # 1 / (1 + EMRAT)

    def bary(target, jd):
        """太陽系質心 → 天體 (km, km/day)。火星以外的行星為行星系統質心。"""
        name = {'emb': 'earthmoon'}.get(target, target)
        if target in ('earth', 'moon'):
            p, v = eph.position_and_velocity('earthmoon', jd)
            mp, mv = eph.position_and_velocity('moon', jd)  # 地心月球
            k = -earth_share if target == 'earth' else (1 - earth_share)
            return [float(p[i][0] + k * mp[i][0]) for i in range(3)], [float(v[i][0] + k * mv[i][0]) for i in range(3)]
        p, v = eph.position_and_velocity(name, jd)
        return [float(x[0]) for x in p], [float(x[0]) for x in v]

    # 1950–2049 每約 2.3 年一筆，再加上數個特定日期
    jds = [2433282.5 + k * 850.3 for k in range(43)]
    jds += [2451545.0, 2459061.0, 2459263.5, 2461307.5, 2462500.25]
    bodies = ['mercury', 'venus', 'emb', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']
    out = {'source': 'JPL DE421 via jplephem', 'frame': 'heliocentric ecliptic J2000 (km, km/s); moon geocentric', 'epochs': []}
    for jd in jds:
        sun_p, sun_v = bary('sun', jd)
        row = {'jd': jd, 'bodies': {}}
        for b in bodies:
            p, v = bary(b, jd)
            r = to_ecliptic([p[i] - sun_p[i] for i in range(3)])
            vv = to_ecliptic([(v[i] - sun_v[i]) / 86400.0 for i in range(3)])
            row['bodies'][b] = {'r': r, 'v': vv}
        ep, ev = bary('earth', jd)
        mp, mv = bary('moon', jd)
        row['bodies']['moon_geo'] = {
            'r': to_ecliptic([mp[i] - ep[i] for i in range(3)]),
            'v': to_ecliptic([(mv[i] - ev[i]) / 86400.0 for i in range(3)]),
        }
        out['epochs'].append(row)

    path = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'de421.json')
    with open(path, 'w') as f:
        json.dump(out, f, indent=1)
    print('wrote', os.path.abspath(path), len(out['epochs']), 'epochs')


if __name__ == '__main__':
    main()
