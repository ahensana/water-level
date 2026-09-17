import { ORG_INFO } from "../config";

/**
 * Official identity strip above the app header — the standard top band on
 * Indian government/PSU portals (organisation line + utility actions), kept
 * to real, sourced facts only: MeECL's own name/tagline from config.ts. No
 * emblem, seal, or department name is asserted here since none was supplied.
 */
export function MastheadBar() {
  return (
    <div className="border-b border-primary-900/40 bg-primary-900 px-4 py-1.5 text-primary-100 print:hidden sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-360 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-[11px] font-medium">
        <p className="tracking-wide">
          {ORG_INFO.name} <span className="text-primary-300">·</span> {ORG_INFO.tagline}
        </p>
        <p className="tracking-wide text-primary-300">Real-Time Departmental Monitoring Portal</p>
      </div>
    </div>
  );
}
