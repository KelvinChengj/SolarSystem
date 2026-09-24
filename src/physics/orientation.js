// 天體自轉定向（IAU WGCCRE 模型）：自轉軸指向 (α0, δ0) 與本初子午線角 W。

import { BODIES, DEG, J2000_JD, JULIAN_CENTURY_DAYS, OBLIQUITY_J2000_DEG } from './constants.js';
import { mmul, mtranspose, mvec, rotX, rotZ } from './vec.js';

const EPS = OBLIQUITY_J2000_DEG * DEG;
const EQ_TO_ECL = rotX(EPS); // J2000 赤道 → 黃道
const ECL_TO_EQ = mtranspose(EQ_TO_ECL);

export function equatorialToEcliptic(v) {
  return mvec(EQ_TO_ECL, v);
}

export function eclipticToEquatorial(v) {
  return mvec(ECL_TO_EQ, v);
}

function poleAngles(id, jd) {
  const p = BODIES[id].pole;
  const T = (jd - J2000_JD) / JULIAN_CENTURY_DAYS;
  let ra = p.ra, dec = p.dec;
  // 地球與火星的自轉軸歲差（IAU 線性項）
  if (id === 'earth') { ra += -0.641 * T; dec += -0.557 * T; }
  if (id === 'mars') { ra += -0.1061 * T; dec += -0.0609 * T; }
  return { ra: ra * DEG, dec: dec * DEG };
}

/** 自轉軸（北極）單位向量，J2000 黃道座標。 */
export function poleVector(id, jd = J2000_JD) {
  const { ra, dec } = poleAngles(id, jd);
  const c = Math.cos(dec);
  return equatorialToEcliptic([c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)]);
}

/**
 * 本初子午線角 W（弧度）。
 * 地球改用地球自轉角 ERA（IERS 2003，以 UT1 ≈ TT − 69.184 s 近似）：W = ERA − 90°，
 * 因 IAU 將 W 自「天體赤道與 ICRF 赤道的升交點」（地球為赤經 90°）起算。
 */
export function primeMeridian(id, jd) {
  if (id === 'earth') {
    const du = jd - J2000_JD - 69.184 / 86400;
    const turns = 0.779057273264 + 0.00273781191135448 * du + du;
    return (((turns % 1) + 1) % 1) * 2 * Math.PI - Math.PI / 2;
  }
  const p = BODIES[id].pole;
  const d = jd - J2000_JD;
  return (((p.w0 + p.wd * d) % 360) + 360) % 360 * DEG;
}

/**
 * 天體固定座標系 → J2000 黃道座標的旋轉矩陣（列優先 3×3）。
 * 天體固定座標：x 指向本初子午線（經度 0°），z 指向北極，y 指向東經 90°。
 */
export function bodyToEclipticMatrix(id, jd) {
  const { ra, dec } = poleAngles(id, jd);
  const W = primeMeridian(id, jd);
  const icrfToBody = mmul(rotZ(W), mmul(rotX(Math.PI / 2 - dec), rotZ(Math.PI / 2 + ra)));
  return mmul(EQ_TO_ECL, mtranspose(icrfToBody));
}

/** 地表某經緯度（度）在 J2000 黃道座標中的地心位置 (km)。 */
export function surfacePoint(id, latDeg, lonDeg, jd, altitudeKm = 0) {
  const R = BODIES[id].eqRadius + altitudeKm;
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const v = [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
  return mvec(bodyToEclipticMatrix(id, jd), v);
}
