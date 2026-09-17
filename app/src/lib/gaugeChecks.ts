import { createLocalStore } from "./localStore";

/**
 * Manual staff-gauge readings entered by the operator, kept so the sensor can be
 * verified against them repeatedly rather than one point at a time.
 *
 * A single matched hour is a weak basis for calibration: the sensor carries a
 * known ~0.119 ft daily oscillation the register does not record, so any one
 * comparison can be off by that much even when both instruments are working.
 * Several readings spread across hours average that out, and — more useful in
 * practice — they show the *spread*, which is what tells you whether the sensor
 * is tracking the reservoir or drifting.
 *
 * Persisted per-browser, alongside the trim it informs.
 */
export interface GaugeCheck {
  /** Stable key for list rendering and edits. */
  id: string;
  /** When the manual reading was taken (ms since epoch). */
  atMs: number;
  /** What the staff gauge read (ft). */
  gaugeFt: number;
}

const store = createLocalStore<GaugeCheck[]>("meecl.gaugeChecks.v1", [], (raw) => {
  if (!Array.isArray(raw)) return null;
  const revived = raw.flatMap((entry): GaugeCheck[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const value = entry as Partial<GaugeCheck>;
    if (typeof value.atMs !== "number" || !Number.isFinite(value.atMs)) return [];
    if (typeof value.gaugeFt !== "number" || !Number.isFinite(value.gaugeFt)) return [];
    return [
      {
        id: typeof value.id === "string" && value.id ? value.id : newId(),
        atMs: value.atMs,
        gaugeFt: value.gaugeFt,
      },
    ];
  });
  return revived.sort((a, b) => a.atMs - b.atMs);
});

function newId(): string {
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getGaugeChecks(): GaugeCheck[] {
  return store.get();
}

export function subscribeToGaugeChecks(fn: () => void): () => void {
  return store.subscribe(fn);
}

export function addGaugeCheck(atMs: number, gaugeFt: number): void {
  const next = [...store.get(), { id: newId(), atMs, gaugeFt }].sort((a, b) => a.atMs - b.atMs);
  store.set(next);
}

export function updateGaugeCheck(id: string, patch: Partial<Omit<GaugeCheck, "id">>): void {
  store.set(
    store
      .get()
      .map((check) => (check.id === id ? { ...check, ...patch } : check))
      .sort((a, b) => a.atMs - b.atMs),
  );
}

export function removeGaugeCheck(id: string): void {
  store.set(store.get().filter((check) => check.id !== id));
}

export function clearGaugeChecks(): void {
  store.set([]);
}
