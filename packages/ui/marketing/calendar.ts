export type CalendarDay = { key: string; day: number; inMonth: boolean };

const zone = "America/Sao_Paulo";

export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, number - 1, 1)));
}

export function calendarDays(month: string): CalendarDay[] {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const mondayPadding = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const count = Math.ceil((mondayPadding + daysInMonth) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, index - mondayPadding + 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return { key, day: date.getUTCDate(), inMonth: date.getUTCMonth() === number - 1 };
  });
}

export function plannedDay(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function plannedTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function inputDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function localDateTimeToIso(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return "";
  const [, year, month, day, hour, minute] = parts.map(Number);
  let instant = Date.UTC(year, month - 1, day, hour, minute);
  for (let pass = 0; pass < 3; pass++) {
    const wall = inputDateTime(new Date(instant).toISOString());
    const wallParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
    if (!wallParts) return "";
    const [, wallYear, wallMonth, wallDay, wallHour, wallMinute] = wallParts.map(Number);
    const wallUtc = Date.UTC(wallYear, wallMonth - 1, wallDay, wallHour, wallMinute);
    const requestedUtc = Date.UTC(year, month - 1, day, hour, minute);
    instant += requestedUtc - wallUtc;
  }
  const iso = new Date(instant).toISOString();
  return inputDateTime(iso) === value ? iso : "";
}
