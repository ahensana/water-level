import { ANALYTICS_CONFIG, ORG_INFO, SITE_CONFIG } from "../config";
import {
  classifyBattery,
  classifySignal,
  computeFaultBreakdown,
  computePeriodStats,
  computeSurfaceDisturbance,
  computeTrend,
  computeUptimeStats,
  csqToDbm,
  deriveAlertEvents,
  projectThresholdEta,
} from "./analytics";
import { getCalibrationTrim } from "./calibration";
import { FAULT_CODE_LABEL } from "./sensorQuality";
import { ALERT_LEVEL_LABEL } from "./waterLevel";
import type { DerivedReading, MonitorQualityState, RawWaterMonitorReading, SessionHistoryPoint } from "../types";

export interface ReportInput {
  reading: DerivedReading | null;
  history: SessionHistoryPoint[];
  rawHistory: RawWaterMonitorReading[];
  quality: MonitorQualityState;
}

const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MARGIN = 40;
const PAGE_WIDTH = 595; // A4 @ 72dpi (jsPDF 'pt' unit)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** Builds and downloads a text-based (not screenshot) operations report PDF. */
export async function downloadOperationsReport(input: ReportInput): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const now = Date.now();

  const ctx: Ctx = { doc, y: MARGIN };

  drawLetterhead(ctx, now);
  drawCurrentStatus(ctx, input);
  drawPeriodSummary(ctx, input, now);
  drawAlertEvents(ctx, input);
  drawDeviceHealth(ctx, input, now);
  drawQualitySummary(ctx, input, now);
  drawFooterDisclaimer(ctx);

  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  doc.save(`water-level-operations-report-${stamp}.pdf`);
}

interface Ctx {
  doc: import("jspdf").jsPDF;
  y: number;
}

function ensureSpace(ctx: Ctx, needed: number) {
  const pageHeight = 842; // A4 pt
  if (ctx.y + needed > pageHeight - MARGIN) {
    ctx.doc.addPage();
    ctx.y = MARGIN;
  }
}

function heading(ctx: Ctx, text: string) {
  ensureSpace(ctx, 30);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.setTextColor(15, 98, 254);
  ctx.doc.text(text, MARGIN, ctx.y);
  ctx.doc.setDrawColor(15, 98, 254);
  ctx.doc.setLineWidth(0.75);
  ctx.doc.line(MARGIN, ctx.y + 4, MARGIN + CONTENT_WIDTH, ctx.y + 4);
  ctx.doc.setTextColor(20, 20, 20);
  ctx.y += 20;
}

// Each cell stacks a label line and a bold value line (~9-9.5pt each), which
// needs about 22-24pt of vertical room total - a tighter row pitch than that
// makes the next row's label overlap the previous row's value.
const TWO_COL_ROW_HEIGHT = 27;
const TWO_COL_LABEL_TO_VALUE_GAP = 12;

function twoCol(ctx: Ctx, pairs: [string, string][]) {
  const colWidth = CONTENT_WIDTH / 2;
  const rowsCount = Math.ceil(pairs.length / 2);
  ensureSpace(ctx, rowsCount * TWO_COL_ROW_HEIGHT + 4);
  for (let i = 0; i < pairs.length; i++) {
    const col = i % 2;
    const r = Math.floor(i / 2);
    const x = MARGIN + col * colWidth;
    const y = ctx.y + r * TWO_COL_ROW_HEIGHT;
    const [label, value] = pairs[i];
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(90, 90, 90);
    ctx.doc.text(label, x, y);
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(9.5);
    ctx.doc.setTextColor(20, 20, 20);
    ctx.doc.text(value, x, y + TWO_COL_LABEL_TO_VALUE_GAP);
  }
  ctx.y += rowsCount * TWO_COL_ROW_HEIGHT + 10;
}

function paragraph(ctx: Ctx, text: string) {
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(8.5);
  ctx.doc.setTextColor(110, 110, 110);
  const lines: string[] = ctx.doc.splitTextToSize(text, CONTENT_WIDTH);
  ensureSpace(ctx, lines.length * 11 + 6);
  ctx.doc.text(lines, MARGIN, ctx.y);
  ctx.y += lines.length * 11 + 10;
}

function drawLetterhead(ctx: Ctx, now: number) {
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(15);
  ctx.doc.setTextColor(15, 98, 254);
  ctx.doc.text(ORG_INFO.name, MARGIN, ctx.y);
  ctx.y += 16;
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(9);
  ctx.doc.setTextColor(90, 90, 90);
  ctx.doc.text(ORG_INFO.tagline, MARGIN, ctx.y);
  ctx.y += 22;
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(20, 20, 20);
  ctx.doc.text(`${ORG_INFO.projectName} — Operations Report`, MARGIN, ctx.y);
  ctx.y += 15;
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(8.5);
  ctx.doc.setTextColor(120, 120, 120);
  ctx.doc.text(
    `Generated ${new Date(now).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} · ${ORG_INFO.version}`,
    MARGIN,
    ctx.y,
  );
  ctx.y += 10;
  ctx.doc.setDrawColor(20, 20, 20);
  ctx.doc.setLineWidth(1.2);
  ctx.doc.line(MARGIN, ctx.y, MARGIN + CONTENT_WIDTH, ctx.y);
  ctx.y += 24;
}

function drawCurrentStatus(ctx: Ctx, { reading, quality }: ReportInput) {
  heading(ctx, "Current Status");
  if (!reading) {
    paragraph(ctx, "No trusted reading is currently available.");
    return;
  }
  twoCol(ctx, [
    ["Water Level", `${reading.waterLevelFt.toFixed(2)} ft / ${reading.waterLevelM.toFixed(2)} m`],
    ["Capacity", `${reading.capacityPct.toFixed(1)}% of ${SITE_CONFIG.fullCapacityFt} ft FRL`],
    ["Alert Level", ALERT_LEVEL_LABEL[reading.alertLevel]],
    ["Data Quality", quality.quality.toUpperCase()],
    ["Sensor Distance (trusted)", `${Math.round(reading.distanceMm)} mm`],
    ["Last Trusted Reading", new Date(reading.receivedAtMs).toLocaleString()],
  ]);
}

function drawPeriodSummary(ctx: Ctx, { reading, history }: ReportInput, now: number) {
  heading(ctx, "24-Hour Trend Summary");
  const stats = computePeriodStats(history, REPORT_WINDOW_MS, now);
  if (stats.count === 0) {
    paragraph(ctx, "No trusted readings in the last 24 hours.");
    return;
  }
  const trend = computeTrend(history, now);
  const projection = reading ? projectThresholdEta(reading.waterLevelFt, trend) : null;
  twoCol(ctx, [
    ["Min", `${stats.minFt!.toFixed(2)} ft`],
    ["Max", `${stats.maxFt!.toFixed(2)} ft`],
    ["Mean", `${stats.meanFt!.toFixed(2)} ft`],
    ["Net Change (24h)", `${stats.netChangeFt! >= 0 ? "+" : ""}${stats.netChangeFt!.toFixed(2)} ft`],
    [
      "Current Trend",
      trend.direction === "unknown"
        ? "Insufficient data"
        : trend.direction === "stable"
          ? "Stable"
          : `${trend.direction === "rising" ? "Rising" : "Falling"} ${Math.abs(trend.rateFtPerHour ?? 0).toFixed(3)} ft/hr`,
    ],
    [
      "Projected Next Crossing",
      projection ? `${projection.label} in ~${formatEta(projection.etaMs)}` : "None projected within 30 days",
    ],
  ]);
}

function drawAlertEvents(ctx: Ctx, { history }: ReportInput) {
  heading(ctx, "Threshold Breach History");
  const events = deriveAlertEvents(history).slice(0, 10);
  if (events.length === 0) {
    paragraph(ctx, "No Warning/Critical threshold crossings in the currently loaded history.");
    return;
  }
  ensureSpace(ctx, 14);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(8.5);
  ctx.doc.setTextColor(90, 90, 90);
  ctx.doc.text("LEVEL", MARGIN, ctx.y);
  ctx.doc.text("ENTERED", MARGIN + 110, ctx.y);
  ctx.doc.text("DURATION", MARGIN + 250, ctx.y);
  ctx.doc.text("PEAK", MARGIN + 350, ctx.y);
  ctx.y += 12;
  for (const ev of events) {
    ensureSpace(ctx, 14);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(20, 20, 20);
    ctx.doc.text(ALERT_LEVEL_LABEL[ev.level], MARGIN, ctx.y);
    ctx.doc.text(new Date(ev.enteredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), MARGIN + 110, ctx.y);
    ctx.doc.text(
      ev.durationMs !== null ? formatDuration(ev.durationMs) : `${formatDuration(Date.now() - ev.enteredAt)} (ongoing)`,
      MARGIN + 250,
      ctx.y,
    );
    ctx.doc.text(`${ev.peakFt.toFixed(2)} ft (${ev.peakCapacityPct.toFixed(1)}%)`, MARGIN + 350, ctx.y);
    ctx.y += 14;
  }
  ctx.y += 8;
}

function drawDeviceHealth(ctx: Ctx, { reading, rawHistory }: ReportInput, now: number) {
  heading(ctx, "Device & Network Health");
  if (!reading) {
    paragraph(ctx, "No reading available.");
    return;
  }
  const uptime = computeUptimeStats(rawHistory, REPORT_WINDOW_MS, now);
  const surface = computeSurfaceDisturbance(rawHistory, ANALYTICS_CONFIG.surfaceDisturbanceWindowMs, now);
  twoCol(ctx, [
    ["Battery", reading.batteryVoltage !== null ? `${reading.batteryVoltage.toFixed(2)} V (${classifyBattery(reading.batteryVoltage).toUpperCase()})` : "—"],
    [
      "Signal",
      reading.signalStrength !== null
        ? `${reading.signalStrength}/31, ~ ${csqToDbm(reading.signalStrength)} dBm (${classifySignal(reading.signalStrength).toUpperCase()})`
        : "—",
    ],
    ["Reporting Completeness (24h)", `${uptime.completenessPct.toFixed(0)}% (${uptime.actualCount}/${uptime.expectedCount} readings)`],
    ["Surface Condition", surface.stdDevMm !== null ? `${surface.tier.toUpperCase()} (std dev ${surface.stdDevMm.toFixed(1)} mm)` : "Unknown"],
  ]);
}

function drawQualitySummary(ctx: Ctx, { rawHistory }: ReportInput, now: number) {
  heading(ctx, "Sensor QA & Calibration");
  const breakdown = computeFaultBreakdown(rawHistory, REPORT_WINDOW_MS, now);
  const faultSummary =
    Object.entries(breakdown.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => `${FAULT_CODE_LABEL[code as keyof typeof FAULT_CODE_LABEL]}: ${count}`)
      .join(" · ") || "None";
  const cal = SITE_CONFIG.calibration;
  const trim = getCalibrationTrim();
  twoCol(ctx, [
    ["Samples Rejected (24h)", `${breakdown.rejectedSamples} / ${breakdown.totalSamples} (${breakdown.rejectRatePct.toFixed(1)}%)`],
    ["Sensor Elevation", `${SITE_CONFIG.sensorElevationFt.toFixed(2)} ft`],
    ["Calibration Basis", cal.basis],
    [
      "Residual vs Logbook",
      `${cal.medianErrorFt >= 0 ? "+" : "-"}${Math.abs(cal.medianErrorFt).toFixed(3)} ft median, +/-${cal.residualStdFt.toFixed(3)} ft`,
    ],
    [
      "Worst Deviation",
      `${cal.worstDeviationFt.toFixed(2)} ft (acceptance limit ${SITE_CONFIG.crossCheckToleranceFt.toFixed(2)} ft)`,
    ],
    [
      "Operator Trim",
      trim.offsetFt === 0
        ? "None"
        : `${trim.offsetFt >= 0 ? "+" : "-"}${Math.abs(trim.offsetFt).toFixed(2)} ft (effective ${(SITE_CONFIG.sensorElevationFt + trim.offsetFt).toFixed(2)} ft)`,
    ],
  ]);
  paragraph(ctx, `Rejection causes: ${faultSummary}`);
  if (trim.offsetFt !== 0) {
    // A report that does not disclose its own correction is not evidence.
    paragraph(
      ctx,
      `Every level in this report includes a manual calibration trim of ` +
        `${trim.offsetFt >= 0 ? "+" : "-"}${Math.abs(trim.offsetFt).toFixed(2)} ft applied on the generating ` +
        `workstation${trim.setAtMs ? ` on ${new Date(trim.setAtMs).toLocaleString()}` : ""}` +
        `${trim.note ? ` (${trim.note})` : ""}. Uncorrected readings are ` +
        `${Math.abs(trim.offsetFt).toFixed(2)} ft ${trim.offsetFt >= 0 ? "lower" : "higher"}.`,
    );
  }
  paragraph(
    ctx,
    `Known limitation: the sensor shows a repeating ~${(cal.diurnalSwingFt * 304.8).toFixed(0)} mm ` +
      `(${cal.diurnalSwingFt.toFixed(3)} ft) daily oscillation peaking in the early evening that the manual ` +
      "staff-gauge register does not record. Sensor and logbook may therefore differ by about this much at " +
      "the daily extremes even when both are functioning correctly.",
  );
}

function drawFooterDisclaimer(ctx: Ctx) {
  ensureSpace(ctx, 40);
  ctx.y += 6;
  ctx.doc.setDrawColor(220, 220, 220);
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(MARGIN, ctx.y, MARGIN + CONTENT_WIDTH, ctx.y);
  ctx.y += 14;
  paragraph(
    ctx,
    "This report is generated automatically from the calibrated A01NYUB ultrasonic sensor feed and is intended for " +
      "operational monitoring. For decisions of record, cross-verify against the manual staff-gauge logbook maintained on site. " +
      `Support: ${ORG_INFO.supportEmail} · ${ORG_INFO.supportPhone}`,
  );
}

function formatEta(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} min`;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}
