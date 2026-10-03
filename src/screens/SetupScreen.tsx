import { useState } from "react";

export function SetupScreen({ onDone }: { onDone: (folder: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setErr(null);
    try {
      const folder = await window.parthseva.pickFolder();
      if (!folder) return;
      const res = await window.parthseva.setRootFolder(folder);
      if (res.ok) onDone(folder);
      else setErr(res.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        <h1>Welcome to ParthSeva Manager</h1>
        <p>
          Select the folder that contains your monthly ParthSeva folders
          (January, February, …). Everything stays on this computer.
        </p>
        <button className="btn primary" onClick={() => void pick()} disabled={busy}>
          {busy ? "Waiting…" : "Select ParthSeva Folder"}
        </button>
        {err && <div className="error-box">{err}</div>}
      </div>
    </div>
  );
}
