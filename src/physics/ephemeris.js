// 行星星曆：JPL「Keplerian Elements for Approximate Positions of the Major Planets」(E. M. Standish)。
// 1800–2050 年使用表 1；其餘年份（西元前 3000 年–西元 3000 年）使用表 2a/2b（含木星至冥王星的長週期修正）。
// 輸出為日心 J2000 黃道座標 (km, km/s)。地球由地月質心 (EM Bary) 扣除月球造成的偏移求得。

import { AU_KM, DAY_S, DEG, J2000_JD, JULIAN_CENTURY_DAYS, MOON_MASS_FRACTION, BODIES } from './constants.js';
import { solveKepler, wrapPi } from './kepler.js';
import { moonGeocentric } from './moon.js';

// [a (AU), e, I (deg), L (deg), 近日點經度 ϖ (deg), 升交點經度 Ω (deg)] 與其每儒略世紀變化率
const TABLE1 = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  emb: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
  pluto: [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]],
};

const TABLE2 = {
  mercury: [[0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819],
    [0.0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182]],
  venus: [[0.72332102, 0.00676399, 3.39777545, 181.9797085, 131.76755713, 76.67261496],
    [-0.00000026, -0.00005107, 0.00043494, 58517.8156026, 0.05679648, -0.27274174]],
  emb: [[1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389],
    [-0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.3179526, -0.24123856]],
  mars: [[1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984],
    [0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431]],
  jupiter: [[5.20248019, 0.0485359, 1.29861416, 34.33479152, 14.27495244, 100.29282654],
    [-0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619]],
  saturn: [[9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702],
    [-0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002]],
  uranus: [[19.18797948, 0.0468574, 0.77298127, 314.20276625, 172.43404441, 73.96250215],
    [-0.00020455, -0.0000155, -0.00180155, 428.49512595, 0.09266985, 0.05739699]],
  neptune: [[30.06952752, 0.00895439, 1.7700552, 304.22289287, 46.68158724, 131.78635853],
    [0.00006447, 0.00000818, 0.000224, 218.46515314, 0.01009938, -0.00606302]],
  pluto: [[39.48686035, 0.24885238, 17.1410426, 238.96535011, 224.09702598, 110.30167986],
    [0.00449751, 0.00006016, 0.00000501, 145.18042903, -0.00968827, -0.00809981]],
};

// 表 2b：M = L − ϖ + b·T² + c·cos(f·T) + s·sin(f·T)
const TABLE2B = {
  jupiter: [-0.00012452, 0.0606406, -0.35635438, 38.35125],
  saturn: [0.00025899, -0.13434469, 0.87320147, 38.35125],
  uranus: [0.00058331, -0.97731848, 0.17689245, 7.67025],
  neptune: [-0.00041348, 0.68346318, -0.10162547, 7.67025],
  pluto: [-0.01262724, 0, 0, 0],
};

const JD_1800 = 2378496.5;
const JD_2050 = 2470172.5;

/** 回傳在該時刻採用的星曆表名稱。 */
export function ephemerisTableFor(jd) {
  return jd >= JD_1800 && jd <= JD_2050 ? 'table1' : 'table2';
}

/**
 * JPL 近似軌道根數（平均根數）在 jd (TT) 的值。角度為弧度、a 為 km。
 * @param {'table1'|'table2'} [table] 強制指定星曆表（預設依日期自動選擇）
 */
export function meanElements(key, jd, table) {
  const useT1 = table ? table === 'table1' : jd >= JD_1800 && jd <= JD_2050;
  const [el, rate] = (useT1 ? TABLE1 : TABLE2)[key];
  const T = (jd - J2000_JD) / JULIAN_CENTURY_DAYS;
  const a = (el[0] + rate[0] * T) * AU_KM;
  const e = el[1] + rate[1] * T;
  const I = (el[2] + rate[2] * T) * DEG;
  const L = el[3] + rate[3] * T;
  const varpi = el[4] + rate[4] * T;
  const Omega = el[5] + rate[5] * T;
  let Mdeg = L - varpi;
  if (!useT1 && TABLE2B[key]) {
    const [b, c, s, f] = TABLE2B[key];
    Mdeg += b * T * T + c * Math.cos(f * T * DEG) + s * Math.sin(f * T * DEG);
  }
  return {
    a, e, i: I,
    raan: Omega * DEG,
    argp: (varpi - Omega) * DEG,
    M: wrapPi(Mdeg * DEG),
    lonPeri: varpi * DEG,
    meanLon: L * DEG,
    // 平均運動（rad/s），用於速度與繪製軌道
    n: (rate[3] * DEG) / (JULIAN_CENTURY_DAYS * DAY_S),
  };
}

export function positionFromElements(el) {
  const E = solveKepler(el.M, el.e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const xp = el.a * (cE - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * sE;
  const cw = Math.cos(el.argp), sw = Math.sin(el.argp);
  const cO = Math.cos(el.raan), sO = Math.sin(el.raan);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

const ELEMENT_KEY = {
  mercury: 'mercury', venus: 'venus', earth: 'emb', mars: 'mars', jupiter: 'jupiter',
  saturn: 'saturn', uranus: 'uranus', neptune: 'neptune', pluto: 'pluto',
};

/** 地月質心日心位置 (km)。 */
export function embPosition(jd) {
  return positionFromElements(meanElements('emb', jd));
}

/**
 * 天體日心位置（km，J2000 黃道座標）。
 * @param {string} id 天體代號
 * @param {number} jd 儒略日 (TT)
 */
export function heliocentricPosition(id, jd) {
  if (id === 'sun') return [0, 0, 0];
  if (id === 'earth' || id === 'moon') {
    const emb = embPosition(jd);
    const m = moonGeocentric(jd);
    if (id === 'earth') {
      return [emb[0] - MOON_MASS_FRACTION * m[0], emb[1] - MOON_MASS_FRACTION * m[1], emb[2] - MOON_MASS_FRACTION * m[2]];
    }
    const k = 1 - MOON_MASS_FRACTION;
    return [emb[0] + k * m[0], emb[1] + k * m[1], emb[2] + k * m[2]];
  }
  return positionFromElements(meanElements(ELEMENT_KEY[id], jd));
}

const VEL_DT_DAYS = 0.01;

/** 日心狀態 { r (km), v (km/s) }，速度以中央差分計算。 */
export function heliocentricState(id, jd) {
  const r = heliocentricPosition(id, jd);
  if (id === 'sun') return { r, v: [0, 0, 0] };
  const rp = heliocentricPosition(id, jd + VEL_DT_DAYS);
  const rm = heliocentricPosition(id, jd - VEL_DT_DAYS);
  const k = 1 / (2 * VEL_DT_DAYS * DAY_S);
  return { r, v: [(rp[0] - rm[0]) * k, (rp[1] - rm[1]) * k, (rp[2] - rm[2]) * k] };
}

/** 月球地心狀態 (km, km/s)。 */
export function moonGeocentricState(jd) {
  const r = moonGeocentric(jd);
  const h = 0.001;
  const rp = moonGeocentric(jd + h);
  const rm = moonGeocentric(jd - h);
  const k = 1 / (2 * h * DAY_S);
  return { r, v: [(rp[0] - rm[0]) * k, (rp[1] - rm[1]) * k, (rp[2] - rm[2]) * k] };
}

/** 軌道元素（供介面顯示/繪製軌道）。月球回傳地心密切根數由呼叫端另行計算。 */
export function planetElements(id, jd) {
  return meanElements(ELEMENT_KEY[id], jd);
}

/** 行星會合週期（天）。 */
export function synodicPeriodDays(idA, idB, jd = J2000_JD) {
  const nA = meanElements(ELEMENT_KEY[idA], jd).n;
  const nB = meanElements(ELEMENT_KEY[idB], jd).n;
  return (2 * Math.PI) / Math.abs(nA - nB) / DAY_S;
}

/** 以根數計算的恆星軌道週期（天）。 */
export function orbitalPeriodDays(id, jd = J2000_JD) {
  const el = meanElements(ELEMENT_KEY[id], jd);
  return (2 * Math.PI * Math.sqrt(el.a ** 3 / BODIES.sun.gm)) / DAY_S;
}
