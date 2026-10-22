/** Formatting shared by the satellite cards. */

const HOUR = 3_600_000;

export function fmtTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtAgo(t: number, now: number): string {
  const h = (now - t) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtMm(v: number | null | undefined, digits = 1): string {
  return v == null ? "–" : `${v.toFixed(digits)} mm`;
}

export const axisTick = { fill: "var(--viz-axis)", fontSize: 11 };
