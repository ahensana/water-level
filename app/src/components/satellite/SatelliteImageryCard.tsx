import { useState } from "react";
import clsx from "clsx";
import type { ImagerySnapshot, JobStatus } from "../../lib/satellite";
import { Card, CardBody, CardHeader, CardTitle } from "../ui/Card";
import { Attribution, NotYet } from "./parts";
import { fmtDate } from "./format";

type Kind = "s1" | "s2";

const TABS: { key: Kind; label: string; caption: string }[] = [
  { key: "s1", label: "Radar", caption: "Sentinel-1 radar. Water is dark, land is bright. Works through cloud and at night." },
  { key: "s2", label: "Optical", caption: "Sentinel-2 true colour, the newest pass with the reservoir mostly cloud free." },
];

export function SatelliteImageryCard({ imagery, job }: { imagery: ImagerySnapshot | null; job?: JobStatus }) {
  const [tab, setTab] = useState<Kind>("s1");
  const active = imagery?.[tab] ?? null;
  const fallback: Kind = tab === "s1" ? "s2" : "s1";
  const shown = active ? tab : imagery?.[fallback] ? fallback : tab;
  const image = imagery?.[shown];
  const caption = TABS.find((t) => t.key === shown)!.caption;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest Satellite View</CardTitle>
        <div role="tablist" aria-label="Image type" className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={shown === t.key}
              disabled={!imagery?.[t.key]}
              onClick={() => setTab(t.key)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                shown === t.key
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardBody>
        {!image ? (
          <NotYet job={job} what="satellite images" />
        ) : (
          <figure>
            <img
              src={image.url}
              alt={`${TABS.find((t) => t.key === shown)!.label} satellite image of the reservoir, ${fmtDate(image.t)}`}
              className="aspect-[4/3] w-full rounded-lg bg-neutral-100 object-contain dark:bg-neutral-800"
              loading="lazy"
            />
            <figcaption className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-medium text-neutral-700 dark:text-neutral-200">{fmtDate(image.t)}</span>
              {image.clear != null && ` · ${Math.round(image.clear * 100)}% cloud free`} · {caption}
            </figcaption>
          </figure>
        )}
        <Attribution>Contains modified Copernicus Sentinel data {new Date().getFullYear()}, processed with Google Earth Engine.</Attribution>
      </CardBody>
    </Card>
  );
}
