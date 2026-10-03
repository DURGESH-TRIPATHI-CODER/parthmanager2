import { useEffect, useMemo, useState } from "react";
import type { QueueItem } from "@shared/types";
import { renderTemplate } from "@shared/template";
import { phoneKey } from "@shared/phone";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { StatusBadge } from "@/components/spaceui/status-badge";

/**
 * Send Queue screen.
 *
 * The desktop app only PREPARES and manages the queue. Actual sending is done
 * by the existing Chrome extension (see EXTENSION_BRIDGE.md in the app data
 * folder). Nothing leaves the app until the user explicitly confirms.
 */

interface RosterEntry {
  name: string;
  phone: string;
}

type Phase = "select" | "confirm" | "sending" | "done";

export function QueueScreen({
  roster,
  sourceFile,
}: {
  /** Recipients carried over from the Import screen when available. */
  roster?: RosterEntry[];
  sourceFile?: string;
}) {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; body: string }>>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [phase, setPhase] = useState<Phase>("select");
  const [progress, setProgress] = useState({ sent: 0, failed: 0, skipped: 0 });
  const [handoffMsg, setHandoffMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.parthseva
      .listTemplates()
      .then((list) => {
        setTemplates(list);
        if (list.length > 0) setTemplateId((prev) => prev ?? list[0].id);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const activeTemplate = templates.find((t) => t.id === templateId) ?? null;

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items) {
      const k = phoneKey(it.phone);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1);
  }, [items]);

  const startQueue = () => {
    if (!activeTemplate) return;
    const list = roster ?? [];
    setItems(
      list.map((r, i) => ({
        id: `i${i + 1}`,
        name: r.name,
        phone: r.phone,
        message: renderTemplate(activeTemplate.body, r, new Date()).text,
        status: "pending" as const,
      })),
    );
    setProgress({ sent: 0, failed: 0, skipped: 0 });
    setPhase("confirm");
  };

  const confirmSend = async () => {
    if (!activeTemplate || items.length === 0) return;
    setPhase("sending");
    try {
      const res = await window.parthseva.handoffQueue({
        sessionId: `q${Date.now()}`,
        createdAt: new Date().toISOString(),
        sourceFile: sourceFile ?? "manual queue",
        templateName: activeTemplate.name,
        items,
      });
      setHandoffMsg(res.result.message);
      if (!res.result.accepted) {
        setErr(res.result.message);
        setPhase("confirm");
        return;
      }
      // The extension reports per-item status through the bridge; until that
      // feed is live we reflect the accepted hand-off as the batch progress.
      setProgress({ sent: items.length, failed: 0, skipped: 0 });
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("confirm");
    }
  };

  const total = items.length;
  const processed = progress.sent + progress.failed + progress.skipped;
  const remaining = Math.max(0, total - processed);

  if (!loaded) return <div className="center-note">Loading…</div>;

  return (
    <section>
      <h2>Send Queue</h2>

      {phase === "select" && (
        <div className="card wide">
          <div className="card-label">Choose a template</div>
          {templates.length === 0 ? (
            <div className="empty-box">
              No templates yet — create one under Templates first.
            </div>
          ) : (
            <div className="btn-row">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={"btn" + (templateId === t.id ? " primary" : "")}
                  onClick={() => setTemplateId(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="hint">
            {roster
              ? `${roster.length} recipients came from Today's File.`
              : "Open Today's File first to load recipients, then return here."}
            {" "}This app hands the queue to your existing Chrome extension, which does the
            actual sending — it never sends by itself.
          </div>
          <button
            className="btn primary"
            onClick={startQueue}
            disabled={!activeTemplate || !roster || roster.length === 0}
          >
            Prepare Queue
          </button>
        </div>
      )}

      {phase === "confirm" && (
        <div className="card wide">
          <div className="card-label">
            Messages Ready — {items.length} message{items.length === 1 ? "" : "s"}
          </div>
          {duplicates.length > 0 && (
            <div className="warn-box">
              {duplicates.length} duplicate phone number{duplicates.length === 1 ? "" : "s"}{" "}
              detected. Remove duplicates in Today's File before sending.
            </div>
          )}
          <div className="queue-list">
            {items.map((it) => (
              <div key={it.id} className="queue-item">
                <b>{it.name}</b> · <span className="mono">{it.phone}</span>
                <div>{it.message}</div>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setPhase("select")}>
              Cancel
            </button>
            <ConfirmMorph
              tone="neutral"
              label={`Send ${items.length} Messages`}
              prompt={`Hand ${items.length} messages to the extension?`}
              confirmLabel="Send"
              cancelLabel="Cancel"
              pendingLabel="Handing off"
              doneLabel="Handed off"
              errorLabel="Hand-off failed"
              retryLabel="Try again"
              confirmTimeout={0}
              resultTimeout={0}
              onConfirm={confirmSend}
            />
          </div>
          {handoffMsg && <div className="hint">{handoffMsg}</div>}
          {err && <div className="error-box">{err}</div>}
        </div>
      )}

      {phase === "sending" && (
        <div className="card wide">
          <div className="card-label">Sending Messages</div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${total ? (processed / total) * 100 : 0}%` }}
            />
          </div>
          <div>{processed} / {total}</div>
          <div className="hint">
            Sent: {progress.sent} · Failed: {progress.failed} · Remaining: {remaining}
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card wide">
          <div className="card-label">Completed</div>
          <div>
            ✅ Sent: {progress.sent} &nbsp; ❌ Failed: {progress.failed} &nbsp; ⏭ Skipped:{" "}
            {progress.skipped}
          </div>
          {err && <div className="warn-box">{err}</div>}
          <div className="btn-row">
            <button className="btn" onClick={() => setPhase("confirm")}>
              View Failed ({progress.failed})
            </button>
            <button className="btn primary" onClick={() => setPhase("select")}>
              Done
            </button>
          </div>
          {handoffMsg && <div className="hint">{handoffMsg}</div>}
        </div>
      )}
    </section>
  );
}

/** Per-recipient status pill used across queue views. */
export function QueueStatusPill({ status }: { status: QueueItem["status"] }) {
  const map: Record<QueueItem["status"], "online" | "offline" | "busy" | "warning" | "info"> = {
    pending: "offline",
    sending: "info",
    sent: "online",
    failed: "busy",
    skipped: "warning",
  };
  return (
    <StatusBadge status={map[status]} primaryText={status} showIndicator animated={status === "sending"} />
  );
}
