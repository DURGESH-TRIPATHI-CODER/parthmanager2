import { useEffect, useMemo, useState } from "react";
import type {
  ClassificationResult,
  ColumnMapping,
  DiscoveryResult,
  FileInfo,
  MessageTemplate,
  SheetSummary,
  WorkbookInfo,
} from "@shared/types";
import { classifyRows } from "@shared/classify";
import { suggestMapping } from "@shared/headers";
import { phoneKey } from "@shared/phone";
import { ActionButton } from "@/components/arc/action-button/action-button";

interface Props {
  discovery: DiscoveryResult | null;
  /** Hands the confirmed message roster to the app so the Queue screen can use it. */
  onQueueReady: (roster: Array<{ name: string; phone: string }>, sourceFile: string) => void;
}

/**
 * Today's File screen: choose file (when several matched), choose worksheet,
 * confirm column mapping, review classified contacts. No sending here.
 */
export function ImportScreen({ discovery, onQueueReady }: Props) {
  const [file, setFile] = useState<FileInfo | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookInfo | null>(null);
  const [sheet, setSheet] = useState<SheetSummary | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [classified, setClassified] = useState<ClassificationResult | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "message" | "call" | "review">("all");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.parthseva
      .listTemplates()
      .then((list) => {
        setTemplates(list);
        if (list.length > 0) setTemplateId((prev) => prev ?? list[0].id);
      })
      .catch(() => undefined);
  }, []);

  // Auto-select when exactly one file matched (multi-match => user chooses).
  useEffect(() => {
    if (discovery && discovery.files.length === 1) {
      setFile(discovery.files[0]);
    }
  }, [discovery]);

  useEffect(() => {
    if (!file) return;
    setWorkbook(null);
    setSheet(null);
    setClassified(null);
    setErr(null);
    window.parthseva
      .readWorkbookInfo(file)
      .then((wb) => {
        if ("error" in wb) setErr(wb.error);
        else setWorkbook(wb);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [file]);

  const loadSheet = (idx: number) => {
    if (!file) return;
    setErr(null);
    setClassified(null);
    window.parthseva
      .readSheet(file, idx)
      .then((s) => {
        if ("error" in s) {
          setErr(s.error);
          return;
        }
        setSheet(s);
        // Saved mapping first (same structure => same mapping); else suggestions.
        window.parthseva
          .lookupMapping({ headers: s.headers, headerRowIndex: s.headerRowIndex })
          .then((saved) => {
            if (saved.mapping) {
              setMapping(saved.mapping);
            } else {
              const m: ColumnMapping = {};
              for (const c of suggestMapping(s.headers)) m[c.field] = c.columnIndex;
              setMapping(m);
            }
          })
          .catch(() => {
            const m: ColumnMapping = {};
            for (const c of suggestMapping(s.headers)) m[c.field] = c.columnIndex;
            setMapping(m);
          });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    if (workbook && workbook.sheets.length > 0) loadSheet(workbook.sheets[0].index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook]);

  const doClassify = () => {
    if (!sheet) return;
    setClassified(classifyRows(sheet.rows, mapping));
  };

  const messages = classified?.contacts.filter((c) => c.action === "message") ?? [];
  const calls = classified?.contacts.filter((c) => c.action === "call") ?? [];
  const review = classified?.contacts.filter((c) => c.action === "review") ?? [];

  const dupKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of classified?.duplicates ?? []) s.add(phoneKey(d.phone));
    return s;
  }, [classified]);

  const matchesSearch = (name: string, phone: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return name.toLowerCase().includes(q) || phone.includes(q);
  };

  const filteredMessages = messages.filter((c) => matchesSearch(c.name, c.phone));
  const filteredCalls = calls.filter((c) => matchesSearch(c.name, c.phone));
  const showMessages =
    (actionFilter === "all" || actionFilter === "message") && filteredMessages.length >= 0;
  const showCalls = (actionFilter === "all" || actionFilter === "call") && filteredCalls.length >= 0;

  const exportCSV = () => {
    const rows = [["Name", "Phone", "Action", "RawAction", "Birthday", "SheetMessage"]];
    for (const c of classified?.contacts ?? []) {
      rows.push([c.name, c.phone, c.action, c.rawAction, c.birthdayMD ?? "", c.sheetMessage ?? ""]);
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parthseva-normalized.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const prepareQueue = async (): Promise<void> => {
    if (messages.length === 0) return;
    onQueueReady(
      messages.map((c) => ({ name: c.name, phone: c.phone })),
      file?.filename ?? "manual queue",
    );
  };

  const mappingValid =
    mapping.name !== undefined &&
    mapping.name >= 0 &&
    mapping.phone !== undefined &&
    mapping.phone >= 0;

  if (!discovery) {
    return (
      <section>
        <h2>Today's File</h2>
        <div className="empty-box">
          No discovery result yet — go to the Dashboard and refresh.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Today's File</h2>

      {discovery.error && <div className="error-box">{discovery.error}</div>}
      {!discovery.error && discovery.files.length === 0 && (
        <div className="empty-box">
          Today's file not found. Place the file (today's date somewhere in the name) inside
          the <b>{discovery.monthName}</b> folder and refresh.
        </div>
      )}

      {!file && discovery.files.length > 1 && (
        <div className="card wide">
          <div className="card-label">
            {discovery.files.length} files match today — choose one (never guessed)
          </div>
          <ul className="file-list">
            {discovery.files.map((f) => (
              <li key={f.fullPath}>
                <button className="btn" onClick={() => setFile(f)}>
                  {f.filename}
                </button>
                <span className="card-sub">
                  {f.sizeBytes !== undefined ? `${(f.sizeBytes / 1024).toFixed(0)} KB` : ""} ·{" "}
                  {f.kind.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {file && (
        <div className="card wide">
          <div className="card-label">Selected file</div>
          <div className="card-value small mono">{file.filename}</div>
          {discovery.files.length > 1 && (
            <button
              className="btn link"
              onClick={() => {
                setFile(null);
                setWorkbook(null);
                setSheet(null);
                setClassified(null);
              }}
            >
              Choose a different file
            </button>
          )}
        </div>
      )}

      {workbook && workbook.sheets.length > 1 && sheet && (
        <div className="card wide">
          <div className="card-label">Worksheet</div>
          <select
            className="input"
            value={sheet.index}
            onChange={(e) => loadSheet(Number(e.target.value))}
          >
            {workbook.sheets.map((s) => (
              <option key={s.index} value={s.index}>
                {s.name} ({s.rowCount} rows)
              </option>
            ))}
          </select>
        </div>
      )}

      {sheet && (
        <div className="card wide">
          <div className="card-label">
            Column mapping — header row {sheet.headerRowIndex} (edit if suggestions are wrong)
          </div>
          <div className="map-grid">
            {(["name", "phone", "action", "birthday", "message"] as const).map((field) => (
              <label key={field}>
                {field[0].toUpperCase() + field.slice(1)}:
                <select
                  className="input"
                  value={mapping[field] ?? -1}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field]: Number(e.target.value) }))
                  }
                >
                  <option value={-1}>Not used</option>
                  {sheet.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="btn-row">
            <ActionButton
              label="Classify Rows"
              pendingLabel="Classifying"
              successLabel="Classified"
              disabled={!mappingValid}
              onAction={async () => {
                doClassify();
                await Promise.resolve();
              }}
            />
            <button
              className="btn"
              onClick={() =>
                void window.parthseva.saveMapping({
                  headers: sheet.headers,
                  headerRowIndex: sheet.headerRowIndex,
                  mapping,
                })
              }
            >
              Save Mapping
            </button>
          </div>
          {!mappingValid && (
            <div className="warn-box">Name and Phone columns must be mapped.</div>
          )}
        </div>
      )}

      {classified && (
        <div className="card wide">
          <div className="card-label">
            Messages: {messages.length} · Calls: {calls.length} · Needs Review:{" "}
            {review.length} · Issues: {classified.issues.length}
          </div>

          <div className="btn-row">
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input"
              style={{ maxWidth: 160 }}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
            >
              <option value="all">All actions</option>
              <option value="message">Messages</option>
              <option value="call">Calls</option>
              <option value="review">Needs review</option>
            </select>
          </div>

          {showMessages && (
            <>
              <div className="tab-label">Messages ({filteredMessages.length})</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMessages.map((c) => (
                    <tr
                      key={c.id}
                      className={dupKeys.has(phoneKey(c.phone)) ? "dup" : ""}
                      title={dupKeys.has(phoneKey(c.phone)) ? "Duplicate phone number" : ""}
                    >
                      <td>{c.name}</td>
                      <td className="mono">{c.phone}</td>
                      <td>
                        <span className="status-pill">pending</span>
                      </td>
                    </tr>
                  ))}
                  {filteredMessages.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-box">
                        No message rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {showCalls && (
            <>
              <div className="tab-label">Calls ({filteredCalls.length})</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCalls.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="mono">{c.phone}</td>
                      <td>
                        <span className="status-pill">pending</span>
                      </td>
                    </tr>
                  ))}
                  {filteredCalls.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-box">
                        No call rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {(actionFilter === "all" || actionFilter === "review") && (
            <>
              <div className="tab-label">Needs Review</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Issue</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {classified.issues.map((iss, i) => (
                    <tr key={i}>
                      <td>{iss.rowIndex || "—"}</td>
                      <td>{iss.kind}</td>
                      <td>{iss.detail}</td>
                    </tr>
                  ))}
                  {classified.issues.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-box">
                        No issues.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          <div className="btn-row">
            <select
              className="input"
              style={{ maxWidth: 220 }}
              value={templateId ?? ""}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">— choose template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ActionButton
              label="Prepare Send Queue"
              pendingLabel="Preparing"
              successLabel="Ready — open Send Queue"
              disabled={!templateId || messages.length === 0}
              onAction={prepareQueue}
            />
            <button className="btn" onClick={exportCSV}>
              Export CSV
            </button>
          </div>
          <div className="hint">
            Preparing a queue does not send anything. Review and confirm on the Send Queue
            screen.
          </div>
        </div>
      )}

      {err && <div className="error-box">{err}</div>}
    </section>
  );
}
