import { useEffect, useRef, useState } from "react";
import type { MessageTemplate, TemplateVarChip } from "@shared/types";
import { ActionButton } from "@/components/arc/action-button/action-button";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";

/** Chips shown when no spreadsheet has been classified yet. */
const BASE_CHIPS: TemplateVarChip[] = [
  { name: "name", label: "Name", count: null },
  { name: "phone", label: "Phone", count: null },
  { name: "date", label: "Today's date", count: null },
];

export function TemplatesScreen({ chips }: { chips?: TemplateVarChip[] }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.parthseva
      .listTemplates()
      .then((list) => {
        setTemplates(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const startNew = () => {
    setEditing(null);
    setName("");
    setBody("");
  };

  const startEdit = (t: MessageTemplate) => {
    setEditing(t);
    setName(t.name);
    setBody(t.body);
  };

  const save = async (): Promise<void> => {
    setErr(null);
    const res = await window.parthseva.saveTemplate({ id: editing?.id, name, body });
    if (res.ok) {
      setMsg(res.message);
      setTemplates(await window.parthseva.listTemplates());
      startNew();
    } else {
      setErr(res.message);
      throw new Error(res.message); // so ActionButton shows its error state
    }
  };

  const remove = async (id: string): Promise<void> => {
    await window.parthseva.deleteTemplate(id);
    setTemplates(await window.parthseva.listTemplates());
    if (editing?.id === id) startNew();
  };

  /** Insert {variable} at the caret (or append) when a chip is clicked. */
  const insertVar = (name: string) => {
    const token = `{${name}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const activeChips = chips && chips.length > 0 ? chips : BASE_CHIPS;

  return (
    <section>
      <h2>Message Templates</h2>
      <div className="two-col">
        <div className="card wide">
          <div className="card-label">{editing ? `Edit: ${editing.name}` : "New template"}</div>
          <input
            className="input"
            placeholder="Template name (e.g. Birthday)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            ref={bodyRef}
            className="input template-body"
            rows={6}
            placeholder={"Happy Birthday {name}! 🎂\n\nWishing you a wonderful day ahead."}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="chip-row" aria-label="Insert variable">
            {activeChips.map((c) => (
              <button
                key={c.name}
                type="button"
                className="chip"
                title={
                  c.count === null
                    ? `Insert {${c.name}}`
                    : `${c.count} contact${c.count === 1 ? "" : "s"} have data in this column — click to insert {${c.name}}`
                }
                onClick={() => insertVar(c.name)}
              >
                {c.label}
                {c.count !== null && <span className="chip-count">{c.count}</span>}
                <code className="chip-token">{`{${c.name}}`}</code>
              </button>
            ))}
            {chips && chips.length > 0 && (
              <span className="chip-note">columns with data — click to insert</span>
            )}
          </div>
          <div className="hint">
            Replaced per contact. Unknown variables are highlighted in the preview,
            never silently removed.
          </div>
          <div className="btn-row">
            <ActionButton
              label="Save Template"
              pendingLabel="Saving"
              successLabel="Saved"
              disabled={!name.trim() || !body.trim()}
              onAction={save}
              onActionError={(e) => setErr(e instanceof Error ? e.message : String(e))}
            />
            {editing && <button className="btn" onClick={startNew}>Cancel Edit</button>}
          </div>
          {msg && <div className="ok-box">{msg}</div>}
          {err && <div className="error-box">{err}</div>}
        </div>

        <div className="card wide">
          <div className="card-label">Saved templates</div>
          {!loaded ? (
            <div className="center-note">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="empty-box">
              No templates yet. Create one on the left — nothing is generated for you,
              you write the message yourself.
            </div>
          ) : (
            <ul className="tpl-list">
              {templates.map((t) => (
                <li key={t.id}>
                  <div className="tpl-head">
                    <b>{t.name}</b>
                    <span className="btn-row">
                      <button className="btn link" onClick={() => startEdit(t)}>Edit</button>
                      <ConfirmMorph
                        tone="danger"
                        label="Delete"
                        prompt={<>Delete “{t.name}”?</>}
                        confirmLabel="Delete"
                        cancelLabel="Keep"
                        doneLabel="Deleted"
                        errorLabel="Couldn’t delete"
                        confirmTimeout={0}
                        resultTimeout={2500}
                        onConfirm={() => remove(t.id)}
                      />
                    </span>
                  </div>
                  <pre className="tpl-body">{t.body}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
