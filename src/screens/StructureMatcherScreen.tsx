import { useEffect, useMemo, useState } from "react";
import type { FileInfo, SheetSummary, WorkbookInfo } from "@shared/types";
import {
  analyzeStructureMatch,
  buildMatcherOutput,
  normalizeName,
  suggestNameColumn,
  type StructureMatchAnalysis,
  type MatcherOutput,
} from "@shared/structureMatcher";
import { suggestMapping } from "@shared/headers";

const PREVIEW_ROWS = 8;
const PREVIEW_COLUMNS = 10;
const RESULT_ROWS = 150;

function isBooleanOnlyColumn(rows: string[][], columnIndex: number): boolean {
  const values = rows
    .map((row) => normalizeName(row[columnIndex]))
    .filter(Boolean);
  return values.length > 0 && values.every((value) => value === "true" || value === "false");
}

interface SideState {
  file: FileInfo | null;
  workbook: WorkbookInfo | null;
  sheet: SheetSummary | null;
  nameColumn: number | null;
  noHeader: boolean;
}

const EMPTY_SIDE: SideState = {
  file: null,
  workbook: null,
  sheet: null,
  nameColumn: null,
  noHeader: true,
};

interface FilePanelProps {
  side: "a" | "b";
  title: string;
  description: string;
  state: SideState;
  onStateChange: (next: SideState) => void;
}

function FilePanel({ side, title, description, state, onStateChange }: FilePanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const applySheet = (sheet: SheetSummary, noHeader: boolean, base: SideState) => {
    const suggested = noHeader
      ? suggestNameColumn(sheet.rows)
      : (suggestMapping(sheet.headers).find((c) => c.field === "name")?.columnIndex ?? null);
    onStateChange({
      ...base,
      sheet,
      noHeader,
      nameColumn: suggested,
    });
  };

  const loadSheet = async (fullPath: string, sheetIndex: number, noHeader: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.parthseva.matcherReadFile({ fullPath, sheetIndex, noHeader });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      applySheet(res as SheetSummary, noHeader, state);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadWorkbook = async (file: FileInfo) => {
    onStateChange({ file, workbook: null, sheet: null, nameColumn: null, noHeader: true });
    const wb = await window.parthseva.matcherReadFile({ fullPath: file.fullPath });
    if ("error" in wb) {
      setError(wb.error);
      return;
    }
    const workbook = wb as WorkbookInfo;
    onStateChange({ file, workbook, sheet: null, nameColumn: null, noHeader: true });
    if (workbook.sheets.length === 0) {
      setError("This workbook has no worksheets.");
      return;
    }
    const res = await window.parthseva.matcherReadFile({
      fullPath: file.fullPath,
      sheetIndex: workbook.sheets[0].index,
      noHeader: true,
    });
    if ("error" in res) {
      setError(res.error);
      return;
    }
    applySheet(res as SheetSummary, true, {
      file,
      workbook,
      sheet: null,
      nameColumn: null,
      noHeader: true,
    });
  };

  const chooseFile = async () => {
    setError(null);
    setBusy(true);
    try {
      const pick = await window.parthseva.matcherPickFile(side);
      if (pick.canceled) return;
      if (pick.error || !pick.file) {
        setError(pick.error ?? "Could not open that file.");
        return;
      }
      await loadWorkbook(pick.file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;
    setError(null);
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) {
      setError("Drop a single XLSX, XLS or CSV file.");
      return;
    }
    const fullPath = window.parthseva.getPathForFile(dropped);
    if (!fullPath) {
      setError("Could not read that dropped file. Use the button below instead.");
      return;
    }
    setBusy(true);
    try {
      const opened = await window.parthseva.matcherOpenPath({ fullPath });
      if (opened.canceled) return;
      if (opened.error || !opened.file) {
        setError(opened.error ?? "Could not open that file.");
        return;
      }
      await loadWorkbook(opened.file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const previewRows = state.sheet ? state.sheet.rows.slice(0, PREVIEW_ROWS) : [];
  const nameCellFilled =
    state.sheet && state.nameColumn !== null &&
    state.sheet.rows.some((r) => String(r[state.nameColumn!] ?? "").trim() !== "");

  return (
    <div className="card">
      <div className="card-label">{title}</div>
      <p className="hint" style={{ marginTop: 0 }}>{description}</p>
      <div
        className={"drop-zone" + (dragActive ? " drag-active" : "")}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        {state.file ? (
          <div className="card-sub" style={{ marginTop: 0 }}>
            <span className="status-pill ok">{state.file.filename}</span>{" "}
            <span className="status-pill">{state.file.kind.toUpperCase()}</span>
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 0 }}>
            Drag & drop an XLSX, XLS or CSV file here — or choose one below.
          </div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={() => void chooseFile()} disabled={busy}>
            {busy ? "Opening…" : state.file ? "Choose another file" : `Choose ${side === "a" ? "File A" : "File B"} `}
          </button>
        </div>
      </div>

      {state.workbook && state.workbook.sheets.length > 1 && (
        <label className="hint" style={{ display: "block", marginTop: 10 }}>
          Worksheet
          <select
            className="input"
            value={state.sheet ? state.sheet.index : 0}
            onChange={(e) => void loadSheet(state.file!.fullPath, Number(e.target.value), state.noHeader)}
            disabled={busy}
          >
            {state.workbook.sheets.map((s) => (
              <option key={s.index} value={s.index}>
                {s.name} ({s.rowCount} rows)
              </option>
            ))}
          </select>
        </label>
      )}
      {state.sheet && (
        <label style={{ display: "block", marginTop: 10, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={state.noHeader}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked;
              void loadSheet(state.file!.fullPath, state.sheet!.index, next);
            }}
          />{" "}
          First row is data — this file has no header row
        </label>
      )}
      {state.sheet && (
        <label className="hint" style={{ display: "block", marginTop: 10 }}>
          Name column (used for matching)
          <select
            className="input"
            value={state.nameColumn ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              onStateChange({
                ...state,
                nameColumn: value === "" ? null : Number(value),
              });
            }}
          >
            <option value="">Select a column…</option>
            {state.sheet.headers.map((h, i) =>
              isBooleanOnlyColumn(state.sheet!.rows, i) ? null : (
                <option key={i} value={i}>{h}</option>
              ),
            )}
          </select>
        </label>
      )}
      {state.sheet && state.nameColumn !== null && !nameCellFilled && (
        <div className="warn-box">
          The selected Name column has no values in the data rows. Choose a column that contains
          the record names.
        </div>
      )}
      {state.sheet && (
        <div className="table-scroll sm-preview">
          <table className="data-table">
            <thead>
              <tr>
                {state.sheet.headers.slice(0, PREVIEW_COLUMNS).map((h, i) => (
                  <th key={i} className={i === state.nameColumn ? "name-col" : undefined}>{h}</th>
                ))}
                {state.sheet.headers.length > PREVIEW_COLUMNS && <th>…</th>}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, r) => (
                <tr key={r}>
                  {row.slice(0, PREVIEW_COLUMNS).map((cell, c) => (
                    <td key={c} className={c === state.nameColumn ? "name-col" : undefined}>{cell}</td>
                  ))}
                  {state.sheet!.headers.length > PREVIEW_COLUMNS && <td>…</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.sheet && (
        <div className="hint">
          {state.sheet.rows.length} data rows
          {state.noHeader
            ? " — no header row: every row is treated as a record."
            : `, detected header on spreadsheet row ${state.sheet.headerRowIndex}.`}
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

function defaultExportName(filename: string | undefined): string {
  const base = (filename ?? "Source").replace(/\.[^.]+$/, "");
  return `${base} - Reordered`;
}

interface ProcessedResult {
  analysis: StructureMatchAnalysis;
  output: MatcherOutput;
  moved: ReadonlySet<number>;
}

export function StructureMatcherScreen() {
  const [a, setA] = useState<SideState>(EMPTY_SIDE);
  const [b, setB] = useState<SideState>(EMPTY_SIDE);
  const [movedSelection, setMovedSelection] = useState<Set<number>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [processed, setProcessed] = useState<ProcessedResult | null>(null);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => () => setProcessed(null), []);

  const resetOutput = () => {
    setProcessed(null);
    setExportMessage(null);
    setExportError(null);
  };

  const updateA = (next: SideState) => {
    setA(next);
    resetOutput();
  };
  const updateB = (next: SideState) => {
    setB(next);
    resetOutput();
  };

  const reset = () => {
    setA(EMPTY_SIDE);
    setB(EMPTY_SIDE);
    setMovedSelection(new Set());
    setAnchorIndex(null);
    setNameFilter("");
    setExportFormat("xlsx");
    setExporting(false);
    resetOutput();
  };

  const bSheet = b.sheet;
  const ready = Boolean(a.sheet && bSheet && a.nameColumn !== null && b.nameColumn !== null);

  const analysis = useMemo(() => {
    if (!ready || !a.sheet || !bSheet) return null;
    return analyzeStructureMatch({
      aRows: a.sheet.rows,
      aNameColumn: a.nameColumn!,
      bRows: bSheet.rows,
      bNameColumn: b.nameColumn!,
    });
  }, [ready, a.sheet, a.nameColumn, b.sheet, b.nameColumn]);

  useEffect(() => {
    setMovedSelection(new Set());
    setAnchorIndex(null);
    setProcessed(null);
    setExportMessage(null);
    setExportError(null);
  }, [analysis]);

  const visibleARows = useMemo(() => {
    if (!a.sheet || a.nameColumn === null) return [];
    const needle = normalizeName(nameFilter);
    const matchedByA = new Map((analysis?.matched ?? []).map((match) => [match.aIndex, match]));
    const duplicateAIndexes = new Set(
      (analysis?.duplicateGroups ?? []).flatMap((group) => group.aRows),
    );

    return a.sheet.rows
      .map((row, aIndex) => {
        const name = String(row[a.nameColumn!] ?? "").trim();
        const match = matchedByA.get(aIndex);
        const status = !name
          ? "No name"
          : !analysis
            ? "Load File B"
            : match
              ? `File B row ${match.bIndex + (b.noHeader ? 1 : 2)}`
              : duplicateAIndexes.has(aIndex)
                ? "Duplicate name"
                : "No exact match in File B";
        return { aIndex, name, match, status, hasData: row.some((cell) => String(cell ?? "").trim()) };
      })
      .filter(({ name, hasData }) => hasData && (!needle || normalizeName(name).includes(needle)));
  }, [a.sheet, a.nameColumn, analysis, b.noHeader, nameFilter]);

  const selectedMatchCount = analysis
    ? analysis.matched.filter((match) => movedSelection.has(match.aIndex)).length
    : 0;
  const canProcess = Boolean(
    analysis &&
    a.sheet &&
    bSheet &&
    selectedMatchCount > 0 &&
    a.sheet.rows.some((r) => String(r[a.nameColumn!] ?? "").trim() !== "") &&
    bSheet.rows.some((r) => String(r[b.nameColumn!] ?? "").trim() !== ""),
  );

  const buildOutput = (): MatcherOutput | null => {
    if (!analysis || !bSheet) return null;
    return buildMatcherOutput(bSheet.rows, analysis, movedSelection, [], true);
  };

  const selectRow = (aIndex: number, event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!analysis?.matched.some((match) => match.aIndex === aIndex)) return;
    const additive = event.ctrlKey || event.metaKey;

    if (event.shiftKey && anchorIndex !== null) {
      const [start, end] = anchorIndex <= aIndex ? [anchorIndex, aIndex] : [aIndex, anchorIndex];
      const next = additive ? new Set(movedSelection) : new Set<number>();
      for (const match of analysis.matched) {
        if (match.aIndex >= start && match.aIndex <= end) next.add(match.aIndex);
      }
      setMovedSelection(next);
    } else if (additive) {
      const next = new Set(movedSelection);
      if (next.has(aIndex)) next.delete(aIndex);
      else next.add(aIndex);
      setMovedSelection(next);
      setAnchorIndex(aIndex);
    } else {
      setMovedSelection(new Set([aIndex]));
      setAnchorIndex(aIndex);
    }
    resetOutput();
  };

  const selectAll = () => {
    if (!analysis) return;
    setMovedSelection(new Set(analysis.matched.map((m) => m.aIndex)));
    resetOutput();
  };

  const selectVisible = () => {
    const next = new Set(movedSelection);
    for (const { match } of visibleARows) {
      if (match) next.add(match.aIndex);
    }
    setMovedSelection(next);
    resetOutput();
  };

  const preview = () => {
    const output = buildOutput();
    if (!analysis || !output) return;
    setProcessed({ analysis, moved: new Set(movedSelection), output });
    setExportMessage(null);
    setExportError(null);
  };

  const saveOutput = async (output: MatcherOutput) => {
    if (!bSheet) return;
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const res = await window.parthseva.matcherExport({
        format: exportFormat,
        defaultName: defaultExportName(b.file?.filename),
        sheetName: "Matched Output",
        headers: bSheet.headers,
        rows: output.rows,
      });
      if (res.canceled) return;
      if (res.filePath) {
        setExportMessage(
          `Saved: ${res.filePath}` + (res.openError ? ` (Could not open automatically: ${res.openError})` : ""),
        );
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const reorderAndSave = async () => {
    const output = buildOutput();
    if (!analysis || !output) return;
    setProcessed({ analysis, moved: new Set(movedSelection), output });
    await saveOutput(output);
  };

  const resultLabels = useMemo(() => {
    if (!processed) return [];
    const { analysis: processedAnalysis, output, moved } = processed;
    const movedPos = new Map<number, number>();
    let k = 0;
    for (const m of processedAnalysis.matched) {
      if (moved.has(m.aIndex)) movedPos.set(m.bIndex, ++k);
    }
    const matchedByB = new Map(processedAnalysis.matched.map((m) => [m.bIndex, m]));
    const unnamed = new Set(processedAnalysis.unnamedBRows);
    const ambiguous = new Set(processedAnalysis.ambiguousBIndices);
    return output.sourceIndices.map((bIndex) => {
      const m = matchedByB.get(bIndex);
      if (m && movedPos.has(bIndex)) return `Moved to end — #${movedPos.get(bIndex)}`;
      if (m) return "Matched — not selected, kept in place";
      if (unnamed.has(bIndex)) return "No name — kept in place";
      if (ambiguous.has(bIndex)) return "Duplicate — kept in place";
      return "Extra in B — kept in place";
    });
  }, [processed]);

  const showSheet = processed !== null;
  const displayedRows = showSheet && processed ? processed.output.rows.slice(0, RESULT_ROWS) : [];
  const resultColumns = showSheet && bSheet ? Math.min(bSheet.headers.length, PREVIEW_COLUMNS + 2) : 0;

  return (
    <section>
      <div className="screen-head">
        <h2>Structure Matcher</h2>
        <button className="btn link danger" onClick={reset}>Reset</button>
      </div>
      <p className="hint">
        Reorganizes File B using File A's order. Only exact name matches are used.
      </p>

      <div className="two-col">
        <FilePanel side="a" title="1 · File A — Reference order" description="Defines the required row sequence." state={a} onStateChange={updateA} />
        <FilePanel side="b" title="2 · File B — Rows to reorder" description="Records that will be reorganized." state={b} onStateChange={updateB} />
      </div>

      {a.sheet && a.nameColumn !== null && (
        <div className="card" id="sm-selection">
          <div className="card-label">3 · Select rows from File A</div>
          <p className="hint" style={{ marginTop: 0 }}>
            Select the File A names that should control File B. Click one row, Ctrl+Click to add or remove rows,
            and Shift+Click to select a range—just like Excel. Each selected matching row is removed from its
            current position in File B and appended at the bottom in File A order.
          </p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <input
              className="input"
              value={nameFilter}
              placeholder="Search File A names…"
              onChange={(e) => setNameFilter(e.target.value)}
              style={{ flex: "1 1 240px", margin: 0 }}
            />
            <button className="btn link" onClick={selectAll} disabled={!analysis || analysis.matchedCount === 0}>
              Select all ready rows
            </button>
            <button className="btn link" onClick={selectVisible} disabled={!visibleARows.some((row) => row.match)}>
              Select visible
            </button>
            <button
              className="btn link"
              onClick={() => { setMovedSelection(new Set()); setAnchorIndex(null); resetOutput(); }}
              disabled={movedSelection.size === 0}
            >
              Clear
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {selectedMatchCount} selected {analysis ? `· ${analysis.matchedCount} ready to move` : "· load File B to find matches"}
          </div>
          <div className="table-scroll sm-preview" style={{ maxHeight: 380 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th />
                  <th>File A row</th>
                  <th>Name from File A</th>
                  <th>File B match</th>
                </tr>
              </thead>
              <tbody>
                {visibleARows.map(({ aIndex, name, match, status }) => {
                  const selected = movedSelection.has(aIndex);
                  return (
                    <tr
                      key={aIndex}
                      className={(match ? "selectable" : "") + (selected ? " row-selected" : "")}
                      onClick={(event) => selectRow(aIndex, event)}
                      title={match ? "Click: select one. Ctrl+Click: add/remove. Shift+Click: select a range." : status}
                    >
                      <td className="tick">{selected ? "✓" : ""}</td>
                      <td>{aIndex + (a.noHeader ? 1 : 2)}</td>
                      <td>{name || "—"}</td>
                      <td>
                        <span className={"status-pill " + (match ? "ok" : "warn")}>
                          {match ? `Ready · ${status}` : status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visibleARows.length === 0 && (
            <div className="empty-box">No File A names match this search.</div>
          )}
          {analysis && analysis.matchedCount === 0 && (
            <div className="warn-box">
              No exact names match yet. Confirm that both Name columns contain names. TRUE/FALSE columns are not used.
            </div>
          )}
        </div>
      )}

      {analysis && (
        <div className="card">
          <div className="card-label">4 · Move selected rows to the bottom</div>
          <p className="hint" style={{ marginTop: 0 }}>
            {selectedMatchCount > 0
              ? `${selectedMatchCount} File B row(s) will be removed from their current positions and appended after the last remaining row in File A order.`
              : "Select at least one File A row marked Ready."}
            {" "}All other File B rows stay in their original order.
          </p>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <label className="hint" style={{ marginTop: 0 }}>
              Format
              <select
                className="input"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value === "csv" ? "csv" : "xlsx")}
                style={{ width: "auto", display: "inline-block", margin: "0 0 0 8px" }}
              >
                <option value="xlsx">Excel workbook (.xlsx)</option>
                <option value="csv">CSV file (.csv)</option>
              </select>
            </label>
            <button className="btn primary" onClick={() => void reorderAndSave()} disabled={!canProcess || exporting}>
              {exporting ? "Saving…" : "Move to bottom & save"}
            </button>
            <button className="btn" onClick={preview} disabled={!canProcess}>
              Preview
            </button>
          </div>
          {exportMessage && <div className="ok-box">{exportMessage}</div>}
          {exportError && <div className="error-box">{exportError}</div>}
        </div>
      )}

      {processed && bSheet && (
        <>
          <div className="card wide">
            <div className="card-label">Result — final row order</div>
            <div className="ok-box" style={{ marginTop: 0 }}>
              {processed.output.rows.length} rows in the output: {processed.output.segments[1].end - processed.output.segments[1].start} moved to the end in File A order.
            </div>
            <div className="table-scroll sm-preview">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    {bSheet.headers.slice(0, resultColumns).map((h, i) => <th key={i}>{h}</th>)}
                    {bSheet.headers.length > resultColumns && <th>…</th>}
                  </tr>
                </thead>
                <tbody>
                  <SegmentRow label={`Kept in place (${processed.output.segments[0].end})`} visible={processed.output.segments[0].end > 0} columns={resultColumns + 2} />
                  {displayedRows.slice(0, processed.output.segments[0].end).map((row, r) => (
                    <ResultRow key={r} row={row} index={r} label={resultLabels[r]} columns={resultColumns} extra={bSheet.headers.length > resultColumns} />
                  ))}
                  <SegmentRow label={`Moved to end — File A order (${processed.output.segments[1].end - processed.output.segments[1].start})`} visible={processed.output.segments[1].end > processed.output.segments[1].start} columns={resultColumns + 2} />
                  {displayedRows.slice(processed.output.segments[0].end).map((row, r) => (
                    <ResultRow key={processed.output.segments[0].end + r} row={row} index={processed.output.segments[0].end + r} label={resultLabels[processed.output.segments[0].end + r]} columns={resultColumns} extra={bSheet.headers.length > resultColumns} />
                  ))}
                </tbody>
              </table>
            </div>
            {processed.output.rows.length > RESULT_ROWS && (
              <div className="hint">Showing the first {RESULT_ROWS} of {processed.output.rows.length} rows — the export includes every row.</div>
            )}
          </div>

          <div className="card wide">
            <div className="card-label">Save this result</div>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <button className="btn primary" onClick={() => processed && void saveOutput(processed.output)} disabled={exporting}>
                {exporting ? "Saving…" : `Save as ${exportFormat === "csv" ? "CSV" : "Excel"} `}
              </button>
              <span className="hint" style={{ marginTop: 0 }}>
                A new file is created — File A and File B are never modified. All original columns and cell values are preserved.
              </span>
            </div>
            {exportMessage && <div className="ok-box">{exportMessage}</div>}
            {exportError && <div className="error-box">{exportError}</div>}
          </div>
        </>
      )}
    </section>
  );
}

function SegmentRow({ label, visible, columns }: { label: string; visible: boolean; columns: number }) {
  if (!visible) return null;
  return <tr className="segment"><td colSpan={columns}>{label}</td></tr>;
}

function ResultRow({ row, index, label, columns, extra }: { row: string[]; index: number; label: string; columns: number; extra: boolean }) {
  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <span className={"status-pill " + (label.startsWith("Moved") ? "ok" : "warn")}>
          {label}
        </span>
      </td>
      {row.slice(0, columns).map((cell, c) => <td key={c}>{cell}</td>)}
      {extra && <td>…</td>}
    </tr>
  );
}
