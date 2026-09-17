import { SITE_CONFIG, ORG_INFO } from "../config";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mx-auto max-w-360 px-4 py-3 text-xs text-neutral-500 sm:px-6 lg:px-8 dark:text-neutral-400">
        <p className="leading-relaxed">
          Data shown is collected automatically from a calibrated A01NYUB ultrasonic sensor
          (site elevation {SITE_CONFIG.sensorElevationFt.toFixed(2)} ft) and is intended for
          operational monitoring. For decisions of record, cross-verify against the manual
          staff-gauge logbook maintained on site.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-neutral-700 dark:text-neutral-200">
              {ORG_INFO.projectName}
            </span>
            <span aria-hidden="true">&middot;</span>
            <span>{ORG_INFO.version}</span>
            <span aria-hidden="true">&middot;</span>
            <span>{ORG_INFO.name}</span>
            <span aria-hidden="true">&middot;</span>
            <span>{ORG_INFO.tagline}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a href={`mailto:${ORG_INFO.supportEmail}`} className="hover:text-primary-600 hover:underline">
              {ORG_INFO.supportEmail}
            </a>
            <span aria-hidden="true">&middot;</span>
            <a href={`tel:${ORG_INFO.supportPhone}`} className="hover:text-primary-600 hover:underline">
              {ORG_INFO.supportPhone}
            </a>
            <span aria-hidden="true">&middot;</span>
            <span>&copy; {year} {ORG_INFO.name}. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
