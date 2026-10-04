import { useEffect, useState } from "react";

interface PairState {
  paired: boolean;
  connected: boolean;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  endpoint: string | null;
  error: string | null;
}
const initial: PairState = { paired: false, connected: false, pairingCode: null, pairingExpiresAt: null, endpoint: null, error: null };

export function ParthSenderPanel() {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => window.parthseva.senderGetState().then((value) => { if (active) setState(value as PairState); }).catch(() => undefined);
    void refresh();
    const unsubscribe = window.parthseva.onSenderEvent((event) => {
      if (event.type === "state") setState(event.payload as PairState);
      if (event.type === "error") setNotice("ParthSender reported a sending error.");
    });
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => { active = false; window.clearInterval(timer); unsubscribe(); };
  }, []);

  const connect = async () => {
    setBusy(true); setNotice("");
    try { setState(await window.parthseva.senderPair() as PairState); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Could not start pairing."); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setNotice("");
    try { await window.parthseva.senderDisconnect(); setState(initial); }
    catch { setNotice("Could not disconnect ParthSender."); }
    finally { setBusy(false); }
  };

  return <div className="card sender-panel" aria-live="polite">
    <b>ParthSender</b>
    <div>{state.connected ? "● Connected" : state.pairingCode ? "● Connecting…" : state.paired ? "● Not Connected · Reconnecting…" : "● Not Connected"}</div>
    {state.paired && <div className="hint">Device: ParthSender Chrome Extension</div>}
    {state.pairingCode && <div className="pairing-box">
      <div>Enter this code in ParthSender:</div>
      <strong className="pairing-code">{state.pairingCode}</strong>
      <div className="hint">Waiting for connection…</div>
      <button className="btn" disabled={busy} onClick={() => void window.parthseva.senderCancelPair()}>Cancel</button>
    </div>}
    {state.error && <div className="error-box">{state.error}</div>}
    {notice && <div className="error-box">{notice}</div>}
    <div className="btn-row">
      {!state.paired && !state.pairingCode && <button className="btn primary" onClick={() => void connect()} disabled={busy}>Connect ParthSender</button>}
      {state.paired && <>
        <button className="btn" disabled={busy} onClick={() => void window.parthseva.senderPing().then((ok) => setNotice(ok ? "Connection test sent." : "Extension not connected."))}>Test Connection</button>
        {!state.connected && <button className="btn" disabled={busy} onClick={() => void window.parthseva.senderPing().then((ok) => setNotice(ok ? "Connected." : "Connection lost. Trying to reconnect…"))}>Reconnect</button>}
        <button className="btn" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
      </>}
    </div>
    {import.meta.env.DEV && <details className="hint"><summary>Developer diagnostics</summary>
      <div>Electron WebSocket: {state.endpoint ? "✅" : "❌"}</div>
      <div>Local server: {state.endpoint ? "✅" : "❌"}</div>
      <div>ParthSender paired: {state.paired ? "✅" : "❌"}</div>
      <div>ParthSender connected: {state.connected ? "✅" : "❌"}</div>
      <div>Protocol version: 1</div>
      <div>Endpoint: {state.endpoint ?? "Unavailable"}</div>
    </details>}
  </div>;
}
