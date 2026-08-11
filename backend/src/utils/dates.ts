import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ATTENDANCE_TYPE_WEEKDAY, WEEKDAY_NAMES, type AttendanceType } from '../types/enums';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export { dayjs };

/**
 * Attendance, offerings and celebrations are *calendar day* concepts, not instants.
 * They are normalised to UTC midnight so that a record created at 23:00 in Lagos and
 * one created at 01:00 the same civil day compare equal.
 */
export function toCalendarDate(value: Date | string): Date {
  const d = dayjs.utc(typeof value === 'string' ? value.slice(0, 10) : value);
  if (!d.isValid()) throw new Error(`Invalid date: ${String(value)}`);
  return d.startOf('day').toDate();
}

export function calendarDateString(value: Date | string): string {
  return dayjs.utc(value).format('YYYY-MM-DD');
}

export function weekdayOf(value: Date | string): number {
  return dayjs.utc(toCalendarDate(value)).day();
}

export function weekdayName(value: Date | string): string {
  return WEEKDAY_NAMES[weekdayOf(value)];
}

/** SRS 6.8 / BR-005..BR-007. */
export function isValidAttendanceDate(type: AttendanceType, date: Date | string): boolean {
  return weekdayOf(date) === ATTENDANCE_TYPE_WEEKDAY[type];
}

export function requiredWeekdayName(type: AttendanceType): string {
  return WEEKDAY_NAMES[ATTENDANCE_TYPE_WEEKDAY[type]];
}

/** SRS 7.2 / BR-008: Homecell offerings are Sunday-only. */
export function isSunday(date: Date | string): boolean {
  return weekdayOf(date) === 0;
}

export function startOfMonth(ref: Date = new Date()): Date {
  return dayjs.utc(ref).startOf('month').toDate();
}

export function endOfMonth(ref: Date = new Date()): Date {
  return dayjs.utc(ref).endOf('month').toDate();
}

export function addDays(ref: Date, days: number): Date {
  return dayjs.utc(ref).add(days, 'day').toDate();
}

/** Month/day pair used to match birthdays and anniversaries regardless of year. */
export function monthDay(value: Date | string): { month: number; day: number } {
  const d = dayjs.utc(value);
  return { month: d.month() + 1, day: d.date() };
}

export function ageFromDob(dob: Date | string, ref: Date = new Date()): number {
  return dayjs.utc(ref).diff(dayjs.utc(dob), 'year');
}

/** Inclusive list of `{month, day}` pairs for the next `days` days starting today. */
export function upcomingMonthDays(days: number, from: Date = new Date()) {
  const out: { month: number; day: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    out.push(monthDay(dayjs.utc(from).add(i, 'day').toDate()));
  }
  return out;
}

/**
 * Resolves a `from`/`to` filter pair into an inclusive UTC range.
 * Missing bounds fall back to a wide-open range so callers can always spread the result.
 */
export function dateRange(from?: string | Date, to?: string | Date) {
  return {
    $gte: from ? toCalendarDate(from) : new Date(0),
    $lte: to ? dayjs.utc(toCalendarDate(to)).endOf('day').toDate() : new Date(8640000000000000),
  };
}
