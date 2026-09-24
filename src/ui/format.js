// 數值與時間的中文格式化。

import { AU_KM, C_KM_S, DAY_S } from '../physics/constants.js';
import { formatJdDate, formatJdUtc, ttToUTC } from '../physics/time.js';

const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const F0 = nf(0), F1 = nf(1), F2 = nf(2), F3 = nf(3);

export const fmt = {
  n0: (x) => F0.format(x),
  n1: (x) => F1.format(x),
  n2: (x) => F2.format(x),
  n3: (x) => F3.format(x),
};

/** 距離：小於 1000 萬 km 用 km，其餘用 AU。 */
export function fmtDistance(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 1e4) return `${F1.format(km)} km`;
  if (km < 1e7) return `${F0.format(km)} km`;
  return `${F3.format(km / AU_KM)} AU`;
}

export function fmtKm(km) {
  if (!Number.isFinite(km)) return '—';
  if (km >= 1e6) return `${F2.format(km / 1e6)} 百萬 km`;
  if (km >= 1e4) return `${F1.format(km / 1e4)} 萬 km`;
  return `${F0.format(km)} km`;
}

export function fmtSpeed(kms) {
  return Number.isFinite(kms) ? `${F3.format(kms)} km/s` : '—';
}

/** 天數 → 「X 天」或「X 年 Y 天」。 */
export function fmtDays(days) {
  if (!Number.isFinite(days)) return '—';
  const d = Math.abs(days);
  if (d < 1) return `${F1.format(d * 24)} 小時`;
  if (d < 730) return `${F1.format(d)} 天`;
  const y = Math.floor(d / 365.25);
  return `${y} 年 ${F0.format(d - y * 365.25)} 天`;
}

/** 秒數 → 「T+ 12 天 04:32:10」格式。 */
export function fmtDuration(sec, withSign = true) {
  if (!Number.isFinite(sec)) return '—';
  const sign = sec < 0 ? '−' : '+';
  let s = Math.abs(sec);
  const d = Math.floor(s / DAY_S);
  s -= d * DAY_S;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s - m * 60);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const body = d > 0 ? `${d} 天 ${hms}` : hms;
  return withSign ? `${sign} ${body}` : body;
}

/** 以 TT 儒略日輸出 UTC 日期時間字串。 */
export function fmtDateTime(jdTT, seconds = false) {
  return `${formatJdUtc(ttToUTC(jdTT), { seconds })} UTC`;
}

export function fmtDate(jdTT) {
  return formatJdDate(ttToUTC(jdTT));
}

export function lightTimeText(km) {
  const s = km / C_KM_S;
  if (s < 60) return `${F1.format(s)} 秒`;
  if (s < 3600) return `${F1.format(s / 60)} 分鐘`;
  return `${F2.format(s / 3600)} 小時`;
}
