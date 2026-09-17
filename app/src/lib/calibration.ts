/**
 * Operator calibration trim — a small, bounded correction added on top of the
 * fitted `SITE_CONFIG.sensorElevationFt`.
 *
 * The fitted constant is deliberately not editable: it comes from a multi-day
 * least-squares fit against the staff-gauge register and should only change
 * when that fit is re-run. But a reservoir sensor does drift between
 * re-calibrations — mount settling, silt on the stilling well, a gauge plate
 * being reset — and the site needs to bring the dashboard back in line with the
 * official manual reading without waiting for a code change.
 *
 * So the trim is separate and visible: capped at ±`MAX_OFFSET_FT`, always
 * badged in the UI while non-zero, stamped with who set it and when, and reset
 * in one click. Anything larger than the cap is not a trim — it is a broken
 * mount or a bad fit, and should be diagnosed rather than dialled out.
 *
 * Stored per-browser. It is a local correction to a shared reading, so it is
 * deliberately NOT written back to Firebase: one operator's trim silently
 * changing the level every other site sees is far worse than each station
 * setting its own.
 */

import { createLocalStore } from "./localStore";

/** Beyond this, the problem is not a trim (ft). */
export const MAX_OFFSET_FT = 1;

export interface CalibrationTrim {
  /** Correction added to the derived level, in feet. */
  offsetFt: number;
  /** When it was applied (ms since epoch), or null if never set. */
  setAtMs: number | null;
  /** Free-text note — typically what the trim was matched against. */
  note: string;
}

const EMPTY: CalibrationTrim = { offsetFt: 0, setAtMs: null, note: "" };

const store = createLocalStore<CalibrationTrim>("meecl.calibrationTrim.v1", EMPTY, (raw) => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<CalibrationTrim>;
  if (typeof value.offsetFt !== "number" || !Number.isFinite(value.offsetFt)) return null;
  return {
    offsetFt: clampOffset(value.offsetFt),
    setAtMs: typeof value.setAtMs === "number" ? value.setAtMs : null,
    note: typeof value.note === "string" ? value.note : "",
  };
});

export function clampOffset(ft: number): number {
  if (!Number.isFinite(ft)) return 0;
  return Math.min(MAX_OFFSET_FT, Math.max(-MAX_OFFSET_FT, ft));
}

/** Read synchronously — called on every level derivation, so it must be cheap. */
export function getCalibrationTrim(): CalibrationTrim {
  return store.get();
}

export function getCalibrationOffsetFt(): number {
  return store.get().offsetFt;
}

export function setCalibrationTrim(offsetFt: number, note = ""): void {
  store.set({
    offsetFt: clampOffset(offsetFt),
    setAtMs: Date.now(),
    note: note.slice(0, 160),
  });
}

export function clearCalibrationTrim(): void {
  store.set(EMPTY);
}

export function subscribeToCalibrationTrim(fn: () => void): () => void {
  return store.subscribe(fn);
}
