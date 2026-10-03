import type { DiscoveryResult, Settings } from "@shared/types";

interface Props {
  settings: Settings;
  discovery: DiscoveryResult | null;
  error: string | null;
  onRefresh: () => void;
  onOpenFile: () => void;
  onOpenSettings: () => void;
}

export function Dashboard({ settings, discovery, error, onRefresh, onOpenFile, onOpenSettings }: Props) {
  const today = new Date();

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
      </div>
    </section>
  );
}
