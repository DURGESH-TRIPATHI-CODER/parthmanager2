import { useState } from "react";
import type { Settings } from "@shared/types";

export function SettingsScreen({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (folder: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const changeFolder = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const folder = await window.parthseva.pickFolder();
      if (!folder) return;
      const res = await window.parthseva.setRootFolder(folder);
      if (res.ok) {
        setMsg(res.message);
        onSaved(folder);
      } else {
        setErr(res.message);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Settings</h2>

      <div className="card wide">
        <div className="card-label">ParthSeva root folder</div>
        <div className="card-value small mono">{settings.rootFolder}</div>
        <p className="card-sub">
          Daily files are looked up inside a folder named after the current month
          (e.g. <b>October</b>).
        </p>
        <button className="btn primary" onClick={() => void changeFolder()} disabled={busy}>
          {busy ? "Waiting…" : "Change Folder"}
        </button>
        {msg && <div className="ok-box">{msg}</div>}
        {err && <div className="error-box">{err}</div>}
      </div>

      <div className="card wide">
        <div className="card-label">Data &amp; privacy</div>
        <p className="card-sub">
          ParthSeva Manager is fully offline. Your contacts, messages and templates are
          stored only on this computer. Nothing is sent to any server.
        </p>
      </div>
    </section>
  );
}
