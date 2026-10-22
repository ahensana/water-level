import { useEffect, useState } from "react";
import { subscribeToSatellite, type SatelliteState } from "../lib/satellite";

const INITIAL: SatelliteState = {
  status: "loading",
  weather: null,
  rainfall: null,
  reservoir: null,
  imagery: null,
  jobs: {},
  site: {},
};

/** Live view of everything the satellite and weather functions publish. */
export function useSatellite(): SatelliteState {
  const [state, setState] = useState<SatelliteState>(INITIAL);
  useEffect(() => subscribeToSatellite((patch) => setState((s) => ({ ...s, ...patch }))), []);
  return state;
}
