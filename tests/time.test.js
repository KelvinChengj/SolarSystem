import { describe, expect, it } from 'vitest';
import {
  calendarFromJd, formatJdUtc, jdFromCalendar, jdFromUnixMs, leapSeconds, parseUtcString,
  ttMinusUtc, ttToUTC, utcToTT,
} from '../src/physics/time.js';

describe('儒略日與曆法換算', () => {
  it('J2000.0 = 2000-01-01 12:00 = JD 2451545.0', () => {
    expect(jdFromCalendar(2000, 1, 1, 12, 0, 0)).toBeCloseTo(2451545.0, 9);
  });

  it('Unix 紀元 = JD 2440587.5', () => {
    expect(jdFromUnixMs(0)).toBe(2440587.5);
  });

  it('Meeus 例 7.a：1957-10-04.81 → JD 2436116.31', () => {
    const jd = jdFromCalendar(1957, 10, 4, 19, 26, 24);
    expect(jd).toBeCloseTo(2436116.31, 2);
  });

  it('日期往返換算一致（含西元 1 世紀）', () => {
    for (const [y, m, d] of [[2026, 9, 24], [1969, 7, 20], [45, 3, 15], [2400, 2, 29]]) {
      const c = calendarFromJd(jdFromCalendar(y, m, d, 6, 30, 15));
      expect([c.year, c.month, c.day, c.hour, c.minute, Math.round(c.second)]).toEqual([y, m, d, 6, 30, 15]);
    }
  });

  it('解析 UTC 字串', () => {
    expect(parseUtcString('2026-11-01T10:37')).toBeCloseTo(jdFromCalendar(2026, 11, 1, 10, 37, 0), 9);
    expect(parseUtcString('2026-11-01')).toBeCloseTo(jdFromCalendar(2026, 11, 1), 9);
    expect(parseUtcString('not a date')).toBeNull();
    expect(formatJdUtc(jdFromCalendar(2026, 9, 24, 13, 5, 9))).toBe('2026-09-24 13:05:09');
  });
});

describe('時間尺度', () => {
  it('閏秒表：1972 年 10 s、2017 年起 37 s', () => {
    expect(leapSeconds(jdFromCalendar(1972, 3, 1))).toBe(10);
    expect(leapSeconds(jdFromCalendar(2016, 12, 31, 23, 59, 59))).toBe(36);
    expect(leapSeconds(jdFromCalendar(2017, 1, 1))).toBe(37);
    expect(leapSeconds(jdFromCalendar(1960, 1, 1))).toBeNull();
  });

  it('TT − UTC = 69.184 s（2017 年後）', () => {
    expect(ttMinusUtc(jdFromCalendar(2026, 9, 24))).toBeCloseTo(69.184, 6);
  });

  it('1900 年 ΔT 約 −2.8 s、1800 年約 13.7 s（Espenak–Meeus）', () => {
    expect(ttMinusUtc(jdFromCalendar(1900, 1, 1))).toBeCloseTo(-2.79, 1);
    expect(ttMinusUtc(jdFromCalendar(1800, 1, 1))).toBeCloseTo(13.72, 1);
  });

  it('UTC ↔ TT 往返', () => {
    const jd = jdFromCalendar(2026, 9, 24, 12);
    expect(ttToUTC(utcToTT(jd))).toBeCloseTo(jd, 10);
  });
});
