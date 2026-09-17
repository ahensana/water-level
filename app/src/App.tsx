import { useState } from "react";
import { AlertHistoryCard } from "./components/AlertHistoryCard";
import { AlertPanel } from "./components/AlertPanel";
import { DeviceHealthCard } from "./components/DeviceHealthCard";
import { DiurnalProfileCard } from "./components/DiurnalProfileCard";
import { EnvironmentalCard } from "./components/EnvironmentalCard";
import { Footer } from "./components/Footer";
import { GaugeCard } from "./components/GaugeCard";
import { Header } from "./components/Header";
import { HeroStats } from "./components/HeroStats";
import { HourlyGaugeCard } from "./components/HourlyGaugeCard";
import { MastheadBar } from "./components/MastheadBar";
import { QualityAnalyticsCard } from "./components/QualityAnalyticsCard";
import { ReadingHistoryPanel } from "./components/ReadingHistoryPanel";
import { ReliabilityCalendarCard } from "./components/ReliabilityCalendarCard";
import { ReportPanel } from "./components/ReportPanel";
import { SensorCard } from "./components/SensorCard";
import { StatusBanner } from "./components/StatusBanner";
import { TrendChart } from "./components/TrendChart";
import { TrendForecastCard } from "./components/TrendForecastCard";
import { useTheme } from "./hooks/useTheme";
import { useWaterMonitor } from "./hooks/useWaterMonitor";

function App() {
  const { loadState, errorMessage, reading, history, rawHistory, connection, quality } = useWaterMonitor();
  const { theme, toggleTheme } = useTheme();
  const [sensorOpen, setSensorOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-500 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <MastheadBar />
      <Header
        connection={connection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSensor={() => setSensorOpen(true)}
        onOpenReport={() => setReportOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        reading={reading}
        history={history}
        rawHistory={rawHistory}
        quality={quality}
      />
      <StatusBanner
        loadState={loadState}
        errorMessage={errorMessage}
        connection={connection}
        reading={reading}
        quality={quality}
      />

      <main id="main-content" className="mx-auto w-full max-w-360 flex-1 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4">
          <section aria-label="Key performance indicators">
            <HeroStats reading={reading} loadState={loadState} quality={quality} />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-label="Real-time water level visualization">
              <GaugeCard reading={reading} connection={connection} loadState={loadState} />
            </section>

            <section aria-label="Trend and forecast">
              <TrendForecastCard reading={reading} history={history} loadState={loadState} />
            </section>
          </div>

          <section aria-label="Hourly staff-gauge register">
            <HourlyGaugeCard
              reading={reading}
              history={history}
              loadState={loadState}
              onOpenReport={() => setReportOpen(true)}
            />
          </section>

          <section aria-label="Water level trend analytics">
            <TrendChart history={history} loadState={loadState} />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-label="Alert monitoring">
              <AlertPanel
                reading={reading}
                history={history}
                loadState={loadState}
                quality={quality}
                onOpenHistory={() => setHistoryOpen(true)}
              />
            </section>

            <section aria-label="Threshold breach history">
              <AlertHistoryCard history={history} loadState={loadState} />
            </section>
          </div>

          <SectionDivider
            title="Technical & Engineering Diagnostics"
            subtitle="Device telemetry, sensor QA, and calibration reference for site engineers"
          />

          <section aria-label="Device and network health">
            <DeviceHealthCard reading={reading} history={history} rawHistory={rawHistory} loadState={loadState} />
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section aria-label="Sensor quality analytics and calibration">
              <QualityAnalyticsCard rawHistory={rawHistory} loadState={loadState} />
            </section>

            <section aria-label="Environmental diagnostics">
              <EnvironmentalCard history={history} loadState={loadState} />
            </section>
          </div>

          <SectionDivider
            title="Historical & Time-Based Analysis"
            subtitle="Patterns across the currently loaded history — daily rhythm and device reliability over time"
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section aria-label="Diurnal water level profile">
              <DiurnalProfileCard history={history} loadState={loadState} />
            </section>

            <section aria-label="Reporting reliability calendar">
              <ReliabilityCalendarCard rawHistory={rawHistory} loadState={loadState} />
            </section>
          </div>
        </div>
      </main>

      <Footer />

      <ReportPanel open={reportOpen} onClose={() => setReportOpen(false)} />

      <ReadingHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessionHistory={history}
      />

      <SensorCard
        open={sensorOpen}
        onClose={() => setSensorOpen(false)}
        reading={reading}
        connection={connection}
        loadState={loadState}
        quality={quality}
      />
    </div>
  );
}

function SectionDivider({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-2 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{title}</h2>
      <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</p>
    </div>
  );
}

export default App;
