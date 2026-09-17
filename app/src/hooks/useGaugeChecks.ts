import { useSyncExternalStore } from "react";
import { getGaugeChecks, subscribeToGaugeChecks, type GaugeCheck } from "../lib/gaugeChecks";

/** Subscribes to the persisted register of manual staff-gauge readings. */
export function useGaugeChecks(): GaugeCheck[] {
  return useSyncExternalStore(subscribeToGaugeChecks, getGaugeChecks, getGaugeChecks);
}
