/** Slot dates are college-local calendar days ("YYYY-MM-DD") and times are minutes from midnight. */
export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h > 23 || mm > 59 ? NaN : h * 60 + mm;
};
export const fromMin = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const slotInstant = (dateStr, min, tzOffsetMinutes = 330) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, min - tzOffsetMinutes));
};
export const todayStr = (tzOffsetMinutes = 330, now = new Date()) =>
  new Date(now.getTime() + tzOffsetMinutes * 60000).toISOString().slice(0, 10);

export function eachDate(from, to) {
  const out = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
export const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
