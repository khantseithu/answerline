import type { AgentConfig } from "./agent-config.ts";

type Hours = NonNullable<AgentConfig["hours"]>;

function dateString(parts: Intl.DateTimeFormatPart[]) {
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) {
    return;
  }
  return hour * 60 + minute;
}

function rangeFor(hours: Hours, day: string, weekday: number) {
  const holiday = hours.holidays.find((entry) => entry.date === day);
  if (holiday) {
    return holiday.hours;
  }
  if (weekday >= 1 && weekday <= 5) {
    return hours.weekdays;
  }
  return hours.weekends;
}

function weekdayFor(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined) {
    return -1;
  }
  return new Date(Date.UTC(year, month - 1, date, 12)).getUTCDay();
}

function includes(hours: string | undefined, current: number, overnightOnly = false) {
  if (!hours) {
    return false;
  }
  const [startValue, endValue] = hours.split("-");
  if (!(startValue && endValue)) {
    return false;
  }
  const start = minutes(startValue);
  const end = minutes(endValue);
  if (start === undefined || end === undefined || start === end) {
    return false;
  }
  if (start < end) {
    return !overnightOnly && start <= current && current < end;
  }
  return overnightOnly ? current < end : current >= start;
}

export function isWithinCallingHours(hours: Hours, now = new Date()) {
  try {
    const day = dateString(
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        month: "2-digit",
        timeZone: hours.timezone,
        year: "numeric",
      }).formatToParts(now)
    );
    const localTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: hours.timezone,
    }).formatToParts(now);
    const current = minutes(
      `${localTime.find(({ type }) => type === "hour")?.value}:${localTime.find(({ type }) => type === "minute")?.value}`
    );
    if (current === undefined) {
      return false;
    }

    const todayHours = rangeFor(hours, day, weekdayFor(day));
    if (includes(todayHours, current)) {
      return true;
    }

    const yesterday = shiftDate(day, -1);
    return includes(rangeFor(hours, yesterday, weekdayFor(yesterday)), current, true);
  } catch {
    return false;
  }
}
