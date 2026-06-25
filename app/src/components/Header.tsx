import { useState } from "react";
import clsx from "clsx";
import meeclLogo from "../assets/MeECL-Official-LOGO-300x300-1.png";
import meeclLogoDark from "../assets/logo.png";
import { ORG_INFO } from "../config";
import { useClock } from "../hooks/useClock";
import type { ConnectionState } from "../types";

interface HeaderProps {
  connection: ConnectionState;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenSensor: () => void;
}

export function Header({ connection, theme, onToggleTheme, onOpenSettings, onOpenSensor }: HeaderProps) {
  const now = useClock();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const systemOnline = connection.firebaseConnected && connection.browserOnline;

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <div className="mx-auto flex h-16 max-w-360 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo + project name */}
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={theme === "dark" ? meeclLogoDark : meeclLogo}
            alt={`${ORG_INFO.shortName} logo`}
            className="h-10 w-10 shrink-0 rounded-lg object-contain"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-neutral-900 dark:text-white">
              {ORG_INFO.projectName}
            </p>
            <p className="truncate text-xs leading-tight text-neutral-500 dark:text-neutral-400">
              {ORG_INFO.name}
            </p>
          </div>
        </div>

        {/* Date/time + system status - hidden on small screens to save space */}
        <div className="hidden items-center gap-5 md:flex">
          <div className="text-right">
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{dateLabel}</p>
            <p className="font-mono text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {timeLabel}
            </p>
          </div>

          <div
            className={clsx(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
              systemOnline
                ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500"
                : "bg-critical-50 text-critical-700 dark:bg-critical-500/10 dark:text-critical-500",
            )}
            role="status"
            aria-live="polite"
          >
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                systemOnline ? "bg-success-500" : "bg-critical-500",
              )}
            />
            {systemOnline ? "System Online" : "Connection Lost"}
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onOpenSensor}
            aria-label="Sensor monitoring details"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <SensorIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Site configuration settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <GearIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            {theme === "light" ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Notifications"
              aria-expanded={notifOpen}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <BellIcon className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-critical-500 ring-2 ring-white dark:ring-neutral-900" />
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-lg border border-neutral-200 bg-white py-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                <p className="border-b border-neutral-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  Notifications
                </p>
                <p className="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No new notifications.
                </p>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              aria-label="User profile menu"
              aria-expanded={profileOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
            >
              OP
            </button>
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-neutral-200 bg-white py-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                <div className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">Site Operator</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Monitoring Role</p>
                </div>
                <button
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Account Settings
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 3 1 5 1.5 6H4.5C5 13 6 11 6 8Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SensorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
      <path d="M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14.2 2.8h-4l-.3 2.2a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4 1.9 1.5a7.7 7.7 0 0 0 0 3l-1.9 1.5 2 3.4 2.2-.9c.76.66 1.64 1.17 2.6 1.5l.3 2.2h4l.3-2.2a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4-1.9-1.5Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
