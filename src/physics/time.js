// 時間系統：UTC、TT（地球時）與儒略日 (Julian Date)。
// 行星星曆使用 TT/TDB（兩者差異 < 2 ms，此處視為相同）。
// TT − UTC = 32.184 s + 閏秒（1972 年起）；1972 年以前以 Espenak & Meeus 的 ΔT 多項式近似。

import { J2000_JD, DAY_S, JULIAN_CENTURY_DAYS } from './constants.js';

const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86400000;

// 閏秒生效日 (UTC, 當日 00:00 起) 與累計 TAI−UTC 秒數
const LEAP_SECONDS = [
  [1972, 1, 10], [1972, 7, 11], [1973, 1, 12], [1974, 1, 13], [1975, 1, 14],
  [1976, 1, 15], [1977, 1, 16], [1978, 1, 17], [1979, 1, 18], [1980, 1, 19],
  [1981, 7, 20], [1982, 7, 21], [1983, 7, 22], [1985, 7, 23], [1988, 1, 24],
  [1990, 1, 25], [1991, 1, 26], [1992, 7, 27], [1993, 7, 28], [1994, 7, 29],
  [1996, 1, 30], [1997, 7, 31], [1999, 1, 32], [2006, 1, 33], [2009, 1, 34],
  [2012, 7, 35], [2015, 7, 36], [2017, 1, 37],
].map(([y, m, s]) => [Date.UTC(y, m - 1, 1) / MS_PER_DAY + UNIX_EPOCH_JD, s]);

const JD_1972 = LEAP_SECONDS[0][0];

/** 以 JS 毫秒時間戳 (UTC) 轉儒略日。 */
export function jdFromUnixMs(ms) {
  return ms / MS_PER_DAY + UNIX_EPOCH_JD;
}

export function unixMsFromJd(jd) {
  return (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
}

/** 公曆日期 (UTC) → 儒略日。支援 0–99 年等 Date.UTC 會誤判的年份。 */
export function jdFromCalendar(year, month, day, hour = 0, minute = 0, second = 0) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, 0, 0);
  return jdFromUnixMs(d.getTime() + second * 1000);
}

/** 儒略日 → { year, month, day, hour, minute, second } (UTC)。 */
export function calendarFromJd(jd) {
  const ms = Math.round(unixMsFromJd(jd));
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000,
  };
}

/** 小數年份（用於 ΔT 多項式）。 */
function decimalYear(jd) {
  return 2000 + (jd - J2000_JD) / 365.25;
}

/** Espenak & Meeus (2006) ΔT = TT − UT 多項式近似（秒）。 */
export function deltaTPolynomial(year) {
  const y = year;
  let t, u;
  if (y < -500) {
    u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }
  if (y < 500) {
    u = y / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3
      - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
  }
  if (y < 1600) {
    u = (y - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3
      - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  if (y < 1700) {
    t = y - 1600;
    return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129;
  }
  if (y < 1800) {
    t = y - 1700;
    return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000;
  }
  if (y < 1860) {
    t = y - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4
      + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (y < 1900) {
    t = y - 1860;
    return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3
      - 0.0004473624 * t ** 4 + t ** 5 / 233174;
  }
  if (y < 1920) {
    t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y < 1941) {
    t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    t = y - 1950;
    return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547;
  }
  if (y < 1986) {
    t = y - 1975;
    return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y < 2050) {
    t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
  }
  if (y < 2150) {
    u = (y - 1820) / 100;
    return -20 + 32 * u * u - 0.5628 * (2150 - y);
  }
  u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** 累計閏秒 TAI − UTC（1972 年以前回傳 null）。 */
export function leapSeconds(jdUtc) {
  if (jdUtc < JD_1972) return null;
  let s = LEAP_SECONDS[0][1];
  for (const [jd, n] of LEAP_SECONDS) {
    if (jdUtc >= jd) s = n;
    else break;
  }
  return s;
}

/**
 * TT − UTC（秒）。1972 年後 = 32.184 + 閏秒；最後一次閏秒 (2017) 之後維持 69.184 s
 * （國際上已決議 2035 年前後停止加入閏秒）。1972 年以前使用 ΔT 多項式。
 */
export function ttMinusUtc(jdUtc) {
  const ls = leapSeconds(jdUtc);
  if (ls !== null) return 32.184 + ls;
  return deltaTPolynomial(decimalYear(jdUtc));
}

export function utcToTT(jdUtc) {
  return jdUtc + ttMinusUtc(jdUtc) / DAY_S;
}

export function ttToUTC(jdTT) {
  let jdUtc = jdTT - 69.184 / DAY_S;
  for (let i = 0; i < 3; i++) jdUtc = jdTT - ttMinusUtc(jdUtc) / DAY_S;
  return jdUtc;
}

/** J2000 起算的儒略世紀數 (TT)。 */
export function centuriesSinceJ2000(jdTT) {
  return (jdTT - J2000_JD) / JULIAN_CENTURY_DAYS;
}

/** J2000 起算秒數 (TT)，N 體積分使用的時間座標。 */
export function secondsSinceJ2000(jdTT) {
  return (jdTT - J2000_JD) * DAY_S;
}

export function jdFromSecondsSinceJ2000(s) {
  return J2000_JD + s / DAY_S;
}

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** 格式化 UTC 儒略日為 "YYYY-MM-DD HH:MM:SS"。 */
export function formatJdUtc(jdUtc, { seconds = true } = {}) {
  const c = calendarFromJd(jdUtc);
  const y = c.year < 0 ? '-' + pad(-c.year, 4) : pad(c.year, 4);
  const date = `${y}-${pad(c.month)}-${pad(c.day)}`;
  const time = `${pad(c.hour)}:${pad(c.minute)}` + (seconds ? `:${pad(c.second)}` : '');
  return `${date} ${time}`;
}

export function formatJdDate(jdUtc) {
  const c = calendarFromJd(jdUtc);
  const y = c.year < 0 ? '-' + pad(-c.year, 4) : pad(c.year, 4);
  return `${y}-${pad(c.month)}-${pad(c.day)}`;
}

/** 解析 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:MM[:SS]" (視為 UTC) → 儒略日。 */
export function parseUtcString(str) {
  const m = /^\s*(-?\d{1,6})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?\s*(?:UTC|Z)?\s*$/i.exec(str);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const month = +mo, day = +d;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return jdFromCalendar(+y, month, day, +h, +mi, +s);
}
