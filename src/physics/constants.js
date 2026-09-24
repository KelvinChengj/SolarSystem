// 物理常數與天體資料
// 單位：距離 km、時間 s、重力參數 GM 以 km^3/s^2 表示（取自 JPL DE440）。

export const AU_KM = 149597870.7; // 天文單位 (IAU 2012)
export const DAY_S = 86400;
export const J2000_JD = 2451545.0; // 2000-01-01 12:00 TT
export const JULIAN_YEAR_DAYS = 365.25;
export const JULIAN_CENTURY_DAYS = 36525;
export const C_KM_S = 299792.458; // 光速
export const G0_KM_S2 = 9.80665e-3; // 標準重力加速度，用於火箭方程式
export const OBLIQUITY_J2000_DEG = 23.4392911; // J2000 平黃赤交角 (IAU 1976)

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const GM_SUN = 132712440041.279419;

/**
 * 天體資料表。
 * gm: 重力參數 (km^3/s^2)；radius: 平均半徑；eqRadius/polarRadius: 赤道/極半徑 (km)
 * pole: IAU WGCCRE 自轉軸指向 (J2000 赤道座標，度) 與本初子午線角 W = w0 + wd·d (d 為 J2000 起算日數)
 * color: 介面與軌道線使用的識別色
 */
export const BODIES = {
  sun: {
    id: 'sun', name: '太陽', en: 'Sun', type: 'star',
    gm: GM_SUN, radius: 695700, eqRadius: 695700, polarRadius: 695700,
    pole: { ra: 286.13, dec: 63.87, w0: 84.176, wd: 14.1844 },
    color: '#ffcf6b',
  },
  mercury: {
    id: 'mercury', name: '水星', en: 'Mercury', type: 'planet',
    gm: 22031.868551, radius: 2439.7, eqRadius: 2440.5, polarRadius: 2438.3,
    pole: { ra: 281.0103, dec: 61.4155, w0: 329.5988, wd: 6.1385108 },
    color: '#b3aca4', parkingAlt: 400,
  },
  venus: {
    id: 'venus', name: '金星', en: 'Venus', type: 'planet',
    gm: 324858.592, radius: 6051.8, eqRadius: 6051.8, polarRadius: 6051.8,
    pole: { ra: 272.76, dec: 67.16, w0: 160.2, wd: -1.4813688 },
    color: '#e9c77b', parkingAlt: 400,
  },
  earth: {
    id: 'earth', name: '地球', en: 'Earth', type: 'planet',
    gm: 398600.435507, radius: 6371.0, eqRadius: 6378.137, polarRadius: 6356.752,
    pole: { ra: 0, dec: 90, w0: 190.147, wd: 360.9856235 },
    color: '#5b9bff', parkingAlt: 200,
  },
  moon: {
    id: 'moon', name: '月球', en: 'Moon', type: 'moon', parent: 'earth',
    gm: 4902.800118, radius: 1737.4, eqRadius: 1738.1, polarRadius: 1736.0,
    pole: { ra: 269.9949, dec: 66.5392, w0: 38.3213, wd: 13.17635815 },
    color: '#cfcfcf', parkingAlt: 100,
  },
  mars: {
    id: 'mars', name: '火星', en: 'Mars', type: 'planet',
    gm: 42828.375816, radius: 3389.5, eqRadius: 3396.19, polarRadius: 3376.2,
    pole: { ra: 317.68143, dec: 52.8865, w0: 176.63, wd: 350.89198226 },
    color: '#e8663d', parkingAlt: 400,
  },
  jupiter: {
    id: 'jupiter', name: '木星', en: 'Jupiter', type: 'planet',
    gm: 126712764.1, radius: 69911, eqRadius: 71492, polarRadius: 66854,
    pole: { ra: 268.056595, dec: 64.495303, w0: 284.95, wd: 870.536 },
    color: '#d9a878', parkingAlt: 10000,
  },
  saturn: {
    id: 'saturn', name: '土星', en: 'Saturn', type: 'planet',
    gm: 37940584.8418, radius: 58232, eqRadius: 60268, polarRadius: 54364,
    pole: { ra: 40.589, dec: 83.537, w0: 38.9, wd: 810.7939024 },
    color: '#e6d08f', parkingAlt: 20000,
  },
  uranus: {
    id: 'uranus', name: '天王星', en: 'Uranus', type: 'planet',
    gm: 5794556.4, radius: 25362, eqRadius: 25559, polarRadius: 24973,
    pole: { ra: 257.311, dec: -15.175, w0: 203.81, wd: -501.1600928 },
    color: '#93dbe0', parkingAlt: 5000,
  },
  neptune: {
    id: 'neptune', name: '海王星', en: 'Neptune', type: 'planet',
    gm: 6836527.10058, radius: 24622, eqRadius: 24764, polarRadius: 24341,
    pole: { ra: 299.36, dec: 43.46, w0: 249.978, wd: 541.1397757 },
    color: '#6a8cff', parkingAlt: 5000,
  },
  pluto: {
    id: 'pluto', name: '冥王星', en: 'Pluto', type: 'dwarf',
    gm: 975.5, radius: 1188.3, eqRadius: 1188.3, polarRadius: 1188.3,
    pole: { ra: 132.993, dec: -6.163, w0: 302.695, wd: 56.3625225 },
    color: '#cdb59c', parkingAlt: 300,
  },
};

/** 繞太陽運行、具有 JPL 軌道根數的天體（地球以地月質心根數推算）。 */
export const PLANET_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

/** 可作為任務目的地的天體。 */
export const TARGET_IDS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

/** N 體積分時納入重力的天體（太陽另計為中心天體）。 */
export const GRAVITY_IDS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

export const GM_EARTH_MOON = BODIES.earth.gm + BODIES.moon.gm;
/** 月球質量 / 地月系統總質量，用於由地月質心推算地球位置。 */
export const MOON_MASS_FRACTION = BODIES.moon.gm / GM_EARTH_MOON;

/** 發射場 (緯度決定最小停泊軌道傾角) */
export const LAUNCH_SITES = {
  ksc: { name: '甘迺迪太空中心 (美國)', lat: 28.573, lon: -80.649 },
  wenchang: { name: '文昌航天發射場 (中國)', lat: 19.614, lon: 110.951 },
  kourou: { name: '庫魯太空中心 (法屬圭亞那)', lat: 5.239, lon: -52.768 },
  tanegashima: { name: '種子島宇宙中心 (日本)', lat: 30.4, lon: 130.97 },
  baikonur: { name: '拜科努爾太空發射場 (哈薩克)', lat: 45.965, lon: 63.305 },
};
