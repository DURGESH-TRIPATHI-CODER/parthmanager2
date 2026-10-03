import { useCallback, useEffect, useState } from "react";
import type { DiscoveryResult, Settings, TemplateVarChip } from "@shared/types";
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch";
import type { Theme } from "@/components/arc/theme-switch/theme-switch";
import { SetupScreen } from "./screens/SetupScreen";
import { Dashboard } from "./screens/Dashboard";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TemplatesScreen } from "./screens/TemplatesScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { ImportScreen } from "./screens/ImportScreen";

export type Screen = "dashboard" | "import" | "templates" | "queue" | "settings";

export interface QueueHandoff {
  roster: Array<{ name: string; phone: string }>;
  sourceFile: string;
}

/**
 * One discovery scan at a time, shared by concurrent callers: React's
 * StrictMode double-mount and the settings effect both join the same flight
 * instead of triggering duplicate scans (keeps first dashboard paint fast).
 */
let discoveryFlight: Promise<DiscoveryResult | { error: string }> | null = null;
function kickDiscovery(): Promise<DiscoveryResult | { error: string }> {
  if (!discoveryFlight) {
    discoveryFlight = window.parthseva
      .discoverToday()
      .finally(() => {
        discoveryFlight = null;
      });
  }
  return discoveryFlight;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueHandoff | null>(null);
  const [varChips, setVarChips] = useState<TemplateVarChip[]>([]);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("ps-theme") as Theme) || "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ps-theme", theme);
  }, [theme]);

  const refreshDiscovery = useCallback(async () => {
    const res = await kickDiscovery();
    if ("error" in res) {
      setError(res.error ?? "Discovery failed.");
      setDiscovery(null);
    } else if (res.notConfigured) {
      return res; // first run — no root folder yet, nothing to show or report
    } else {
      setError(null);
      setDiscovery(res);
    }
    return res;
  }, []);

  useEffect(() => {
    // Discovery starts immediately, in parallel with the settings read, so the
    // dashboard's file-status card is populated on (or right after) first paint.
    void refreshDiscovery();
    window.parthseva
      .getSettings()
      .then((r) => {
        setSettings(r.settings);
        setLoaded(true);
      })
      .catch((e) => {
        setError(String(e));
        setLoaded(true);
      });
  }, [refreshDiscovery]);

  useEffect(() => {
    // Re-scan whenever the configured root folder changes (initial load joins
    // the flight started above via kickDiscovery's dedupe).
    if (settings?.rootFolder) void refreshDiscovery();
  }, [settings?.rootFolder, refreshDiscovery]);

  if (!loaded) return <div className="center-note">Loading…</div>;
  if (!settings) return <div className="center-note">Could not load settings.</div>;

  if (!settings.rootFolder) {
    return (
      <>
        <div className="theme-corner">
          <ThemeSwitch
            theme={theme}
            iconOnly
            onThemeChange={(next) => setTheme(next)}
          />
        </div>
        <SetupScreen onDone={(f) => setSettings({ rootFolder: f })} />
      </>
    );
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">ParthSeva Manager</div>
        <ThemeSwitch theme={theme} iconOnly onThemeChange={(next) => setTheme(next)} />
        {(
          [
            ["dashboard", "Dashboard"],
            ["import", "Today's File"],
            ["templates", "Templates"],
            ["queue", "Send Queue"],
            ["settings", "Settings"],
          ] as Array<[Screen, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={"nav-btn" + (screen === id ? " active" : "")}
            onClick={() => setScreen(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="content">
        {screen === "dashboard" && (
          <Dashboard
            settings={settings}
            discovery={discovery}
            error={error}
            onRefresh={() => void refreshDiscovery()}
            onOpenFile={() => setScreen("import")}
            onOpenSettings={() => setScreen("settings")}
          />
        )}
        {screen === "import" && (
          <ImportScreen
            discovery={discovery}
            onQueueReady={(roster, sourceFile) => {
              setQueue({ roster, sourceFile });
              setScreen("queue");
            }}
            onVarChipsChange={setVarChips}
          />
        )}
        {screen === "templates" && <TemplatesScreen chips={varChips} />}
        {screen === "queue" && (
          <QueueScreen roster={queue?.roster} sourceFile={queue?.sourceFile} />
        )}
        {screen === "settings" && (
          <SettingsScreen
            settings={settings}
            onSaved={(f) => {
              setSettings({ rootFolder: f });
              setScreen("dashboard");
            }}
          />
        )}
      </main>
    </div>
  );
}
