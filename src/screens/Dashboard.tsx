import { useState } from "react";
import type { DiscoveryResult, Settings } from "@shared/types";

interface Props {
  settings: Settings;
  discovery: DiscoveryResult | null;
  error: string | null;
  onRefresh: () => void;
  onOpenFile: () => void;
  onStartAutomation: () => void;
  onOpenSettings: () => void;
}

export function Dashboard({ settings, discovery, error, onRefresh, onOpenFile, onStartAutomation, onOpenSettings }: Props) {
  const [extensionMessage, setExtensionMessage] = useState("");
  const [downloading, setDownloading] = useState(false);
  const today = new Date();

  const downloadExtension = async () => {
    setDownloading(true);
    setExtensionMessage("");
    try {
      const result = await window.parthseva.downloadParthSenderExtension();
      if (!result.canceled && result.filePath) setExtensionMessage(`Extension ZIP saved to ${result.filePath}`);
    } catch (e) {
      setExtensionMessage(e instanceof Error ? e.message : "Could not save the extension ZIP.");
    } finally {
      setDownloading(false);
    }
  };

  const fileStatus = () => {
    if (error) return <span className="status-pill error">Error</span>;
    if (!discovery) return <span className="status-pill">Checking…</span>;
    if (discovery.error) return <span className="status-pill error">Folder problem</span>;
    if (discovery.files.length === 0) return <span className="status-pill warn">Not found</span>;
    if (discovery.files.length === 1) return <span className="status-pill ok">Found</span>;
    return <span className="status-pill warn">{discovery.files.length} files — choose one</span>;
  };

  return (
    <section>
      <div className="screen-head">
        <h2>Dashboard</h2>
        <button className="btn" onClick={onRefresh}>Refresh</button>
      </div>

      <div className="card wide dashboard-start-card">
        <div>
          <div className="card-label">Birthday messaging</div>
          <div className="card-value">Ready to start?</div>
          <div className="card-sub">Review today’s recipients and messages before confirming the send.</div>
        </div>
        <button className="btn primary" onClick={onStartAutomation}>Start Automation</button>
      </div>

      <div className="card-grid">
        <div className="card">
          <div className="card-label">Today</div>
          <div className="card-value">
            {today.toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Month folder</div>
          <div className="card-value">
            {discovery ? discovery.monthName : today.toLocaleString("en-IN", { month: "long" })}
          </div>
          {discovery?.monthFolder && <div className="card-sub">{discovery.monthFolder}</div>}
        </div>

        <div className="card">
          <div className="card-label">ParthSeva folder</div>
          <div className="card-value small mono">{settings.rootFolder}</div>
          <button className="btn link" onClick={onOpenSettings}>Change</button>
        </div>

        <div className="card wide">
          <div className="card-label">Today's file</div>
          <div className="card-value">{fileStatus()}</div>
          {discovery && !discovery.error && discovery.files.length > 0 && (
            <ul className="file-list">
              {discovery.files.map((f) => (
                <li key={f.fullPath}>
                  <span className="mono">{f.filename}</span>
                  <span className="card-sub">
                    {(f.sizeBytes! / 1024).toFixed(0)} KB · {f.kind.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {discovery && !discovery.error && discovery.files.length === 1 && (
            <button className="btn primary" onClick={onOpenFile}>
              Open today's file
            </button>
          )}
          {discovery && !discovery.error && discovery.files.length === 0 && (
            <div className="empty-box">
              Today's file not found. Place the file (with today's date in the name) inside
              the <b>{discovery.monthName}</b> folder, then refresh.
            </div>
          )}
        </div>

        <div className="card wide extension-setup-card">
          <div className="card-label">ParthSender Chrome extension · v1.0.0</div>
          <p>Download and load the extension once to connect Chrome with ParthSeva Manager.</p>
          <button className="btn primary" disabled={downloading} onClick={() => void downloadExtension()}>
            {downloading ? "Preparing download…" : "Download Latest Extension (ZIP)"}
          </button>
          {extensionMessage && <div className="hint" role="status">{extensionMessage}</div>}
          <ol className="extension-steps">
            <li>Extract the downloaded <b>parthsender.zip</b> file.</li>
            <li>In Chrome, open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.</li>
            <li>Click <b>Load unpacked</b> and select the extracted <b>parthsender</b> folder containing <code>manifest.json</code>.</li>
            <li>Open WhatsApp Web in that Chrome profile, then connect using the ParthSender panel in this app.</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
