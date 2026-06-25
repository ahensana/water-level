import { useState } from "react";
import { AlertPanel } from "./components/AlertPanel";
import { Footer } from "./components/Footer";
import { GaugeCard } from "./components/GaugeCard";
import { Header } from "./components/Header";
import { HeroStats } from "./components/HeroStats";
import { SensorCard } from "./components/SensorCard";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBanner } from "./components/StatusBanner";
import { TrendChart } from "./components/TrendChart";
import { useSiteConfig } from "./hooks/useSiteConfig";
import { useTheme } from "./hooks/useTheme";
import { useWaterMonitor } from "./hooks/useWaterMonitor";

function App() {
  const siteConfig = useSiteConfig();
  const { loadState, errorMessage, reading, history, connection } = useWaterMonitor(siteConfig.config);
  const { theme, toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensorOpen, setSensorOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-500 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <Header
        connection={connection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSensor={() => setSensorOpen(true)}
      />
      <StatusBanner loadState={loadState} errorMessage={errorMessage} connection={connection} />

      <main id="main-content" className="mx-auto w-full max-w-360 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <section aria-label="Key performance indicators">
            <HeroStats reading={reading} loadState={loadState} />
          </section>

          <section aria-label="Real-time water level visualization">
            <GaugeCard
              reading={reading}
              connection={connection}
              loadState={loadState}
              siteConfig={siteConfig.config}
            />
          </section>

          <section aria-label="Water level trend analytics">
            <TrendChart history={history} loadState={loadState} siteConfig={siteConfig.config} />
          </section>

          <section aria-label="Alert monitoring">
            <AlertPanel reading={reading} history={history} loadState={loadState} />
          </section>
        </div>
      </main>

      <Footer />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={siteConfig.config}
        source={siteConfig.source}
        saving={siteConfig.saving}
        saveError={siteConfig.saveError}
        onSave={siteConfig.save}
      />

      <SensorCard
        open={sensorOpen}
        onClose={() => setSensorOpen(false)}
        reading={reading}
        connection={connection}
        loadState={loadState}
        siteConfig={siteConfig.config}
      />
    </div>
  );
}

export default App;
