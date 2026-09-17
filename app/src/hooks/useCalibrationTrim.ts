import { useSyncExternalStore } from "react";
import {
  getCalibrationTrim,
  subscribeToCalibrationTrim,
  type CalibrationTrim,
} from "../lib/calibration";

/**
 * Subscribes to the operator calibration trim.
 *
 * The trim lives outside React because `distanceToWaterLevelFt` — a pure
 * function called from the pipeline, analytics and exports — has to read it
 * synchronously. `useSyncExternalStore` is what keeps the UI honest about that
 * external value instead of caching a stale copy in component state.
 */
export function useCalibrationTrim(): CalibrationTrim {
  return useSyncExternalStore(subscribeToCalibrationTrim, getCalibrationTrim, getCalibrationTrim);
}
