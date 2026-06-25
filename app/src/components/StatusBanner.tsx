import type { ConnectionState } from "../types";

interface StatusBannerProps {
  loadState: "loading" | "ready" | "error";
  errorMessage: string | null;
  connection: ConnectionState;
}

export function StatusBanner({ loadState, errorMessage, connection }: StatusBannerProps) {
  if (!connection.browserOnline) {
    return (
      <Banner tone="critical">
        You are offline. Showing the last data received before the connection was lost.
      </Banner>
    );
  }

  if (loadState === "error") {
    return (
      <Banner tone="critical">
        Unable to reach Firebase{errorMessage ? `: ${errorMessage}` : "."} Retrying automatically…
      </Banner>
    );
  }

  if (!connection.firebaseConnected) {
    return <Banner tone="warning">Reconnecting to the real-time database…</Banner>;
  }

  return null;
}

function Banner({ tone, children }: { tone: "warning" | "critical"; children: React.ReactNode }) {
  const styles =
    tone === "critical"
      ? "bg-critical-50 text-critical-700 border-critical-100 dark:bg-critical-500/10 dark:text-critical-400 dark:border-critical-500/20"
      : "bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-500/10 dark:text-warning-400 dark:border-warning-500/20";

  return (
    <div role="alert" className={`border-b px-4 py-2 text-center text-sm font-medium sm:px-6 lg:px-8 ${styles}`}>
      {children}
    </div>
  );
}
