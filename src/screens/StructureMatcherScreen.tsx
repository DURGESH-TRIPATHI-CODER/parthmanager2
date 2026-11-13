import { useEffect, useMemo, useState } from "react";
import type {
  FileInfo,
  SheetSummary,
  WorkbookInfo,
} from "@shared/types";
import {
  analyzeStructureMatch,
  buildMatcherOutput,
  type StructureMatchAnalysis,
  type MatcherOutput,
} from "@shared/structureMatcher";
import { suggestMapping } from "@shared/headers";

/**
 * Structure Matcher: reorganize File B rows to follow File A's sequence.
 * All matching runs locally on already-parsed sheet data (see
 * @shared/structureMatcher); the main process only reads and writes files.
 */

const PREVIEW_ROWS = 8; // rows shown in the per-file preview
const PREVIEW_COLUMNS = 10; // columns shown before a "…" column
const RESULT_ROWS = 150; // rows shown in the result preview (export includes all)

interface SideState {
  file: FileInfo | null;
  workbook: WorkbookInfo | null;
  sheet: SheetSummary | null;
  nameColumn: number | null;
  /** True when the sheet has no header row: the first row is already data. */
  noHeader: boolean;
}

const EMPTY_SIDE: SideState = {
  file: null,
  workbook: null,
  sheet: null,
  nameColumn: null,
  // Structure Matcher files typically start with names in row 1 (no headers).
  noHeader: true,
};

/** For headerless sheets: suggest the column with the most filled cells. */
function suggestNameColumnHeaderless(rows: string[][]): number | null {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  let best: number | null = null;
  let bestCount = 0;
  for (let c = 0; c < width; c++) {
    const count = rows.filter((r) => String(r[c] ?? "").trim() !== "").length;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

interface FilePanelProps {
  side: "a" | "b";
  title: string;
  description: string;
  state: SideState;
  onStateChange: (next: SideState) => void;
}

/** One upload panel: pick file, choose worksheet, choose the Name column, preview. */
function FilePanel({ side, title, description, state, onStateChange }: FilePanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applySheet = (sheet: SheetSummary, noHeader: boolean, base: SideState) => {
    const suggested = noHeader
      ? suggestNameColumnHeaderless(sheet.rows)
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
      const file = pick.file;
      onStateChange({ file, workbook: null, sheet: null, nameColumn: null, noHeader: true });
      const wb = await window.parthseva.matcherReadFile({ fullPath: file.fullPath });
      if ("error" in wb) {
        setError(wb.error);
        return;
      }
      const workbook = wb as WorkbookInfo;
      onStateChange({ file, workbook, sheet: null, nameColumn: null, noHeader: true });
      if (workbook.sheets.length > 0) {
        const res = await window.parthseva.matcherReadFile({
          fullPath: file.fullPath,
          sheetIndex: workbook.sheets[0].index,
          noHeader: true,
        });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        applySheet(res as SheetSummary, true, { file, workbook, sheet: null, nameColumn: null, noHeader: true });
      } else {
        setError("This workbook has no worksheets.");
      }
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
      {state.file && (
        <div className="card-sub">
          <span className="status-pill ok">{state.file.filename}</span>{" "}
          <span className="status-pill">{state.file.kind.toUpperCase()}</span>
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={() => void chooseFile()} disabled={busy}>
          {state.file ? "Choose another file" : `Choose ${side === "a" ? "File A" : "File B"}`}
        </button>
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
            {state.sheet.headers.map((h, i) => (
              <option key={i} value={i}>{h}</option>
            ))}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
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
  /** File A row indexes whose matched rows were moved (snapshot at process time). */
  moved: ReadonlySet<number>;
}

export function StructureMatcherScreen() {
  const [a, setA] = useState<SideState>(EMPTY_SIDE);
  const [b, setB] = useState<SideState>(EMPTY_SIDE);
  const [dupAck, setDupAck] = useState(false);
  const [movedSelection, setMovedSelection] = useState<Set<number>>(new Set());
  const [lastTickIndex, setLastTickIndex] = useState<number | null>(null);
  /** When true the final file contains only the selected names' rows. */
  const [onlySelected, setOnlySelected] = useState(true);
  const [processed, setProcessed] = useState<ProcessedResult | null>(null);
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Leaving the feature discards all in-memory spreadsheet data (nothing is
  // written to either input file at any point).
  useEffect(() => () => setProcessed(null), []);

  const updateA = (next: SideState) => {
    setA(next);
    setProcessed(null);
    setExportMessage(null);
  };
  const updateB = (next: SideState) => {
    setB(next);
    setProcessed(null);
    setExportMessage(null);
  };

  const reset = () => {
    setA(EMPTY_SIDE);
    setB(EMPTY_SIDE);
    setDupAck(false);
    setProcessed(null);
    setExportMessage(null);
    setExportError(null);
  };

  const ready = Boolean(a.sheet && b.sheet && a.nameColumn !== null && b.nameColumn !== null);

  const analysis = useMemo(() => {
    if (!ready || !a.sheet || !b.sheet) return null;
    return analyzeStructureMatch({
      aRows: a.sheet.rows,
      aNameColumn: a.nameColumn!,
      bRows: b.sheet.rows,
      bNameColumn: b.nameColumn!,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, a.sheet, a.nameColumn, b.sheet, b.nameColumn]);

  // Default to moving every matched name; re-sync whenever the files/columns
  // change (or clear when there is nothing to match).
  useEffect(() => {
    setMovedSelection(new Set((analysis?.matched ?? []).map((m) => m.aIndex)));
  }, [analysis]);

  const canProcess = Boolean(
    analysis &&
    a.sheet &&
    b.sheet &&
    a.sheet.rows.some((r) => String(r[a.nameColumn!] ?? "").trim() !== "") &&
    b.sheet.rows.some((r) => String(r[b.nameColumn!] ?? "").trim() !== "") &&
    (analysis.duplicateNameCount === 0 || dupAck),
  );

  /** Tick one name, or with Shift held, tick the whole range like in Excel. */
  const tickMoved = (index: number, shift: boolean) => {
    if (!analysis) return;
    const matched = analysis.matched;
    const target = matched[index].aIndex;
    if (shift && lastTickIndex !== null) {
      // Apply the clicked checkbox's new state across the whole range.
      const check = !movedSelection.has(target);
      const [start, end] = lastTickIndex <= index ? [lastTickIndex, index] : [index, lastTickIndex];
      const next = new Set(movedSelection);
      for (let i = start; i <= end; i++) {
        const aIndex = matched[i].aIndex;
        if (check) next.add(aIndex);
        else next.delete(aIndex);
      }
      setMovedSelection(next);
    } else {
      const next = new Set(movedSelection);
      if (movedSelection.has(target)) next.delete(target);
      else next.add(target);
      setMovedSelection(next);
    }
    setLastTickIndex(index);
    setProcessed(null);
    setExportMessage(null);
  };

  const doProcess = () => {
    if (!analysis || !b.sheet) return;
    setExportMessage(null);
    const moved = new Set(movedSelection);
    setProcessed({
      analysis,
      moved,
      output: buildMatcherOutput(b.sheet.rows, analysis, moved, [], !onlySelected),
    });
  };

  const doExport = async () => {
    if (!processed || !bSheet) return;
    setExportError(null);
    setExportMessage(null);
    try {
      const res = await window.parthseva.matcherExport({
        format: exportFormat,
        defaultName: defaultExportName(b.file?.filename),
        sheetName: "Matched Output",
        headers: bSheet.headers,
        rows: processed.output.rows,
      });
      if (res.canceled) return;
      if (res.filePath) {
        setExportMessage(
          `Saved: ${res.filePath}` + (res.openError ? ` (Could not open automatically: ${res.openError})` : ""),
        );
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Status label for the result preview, one per output row, in output order. */
  const resultLabels = useMemo(() => {
    if (!processed) return [];
    const { analysis, output, moved } = processed;
    const movedPos = new Map<number, number>(); // B row index -> 1-based moved position
    let k = 0;
    for (const m of analysis.matched) {
      if (moved.has(m.aIndex)) movedPos.set(m.bIndex, ++k);
    }
    const matchedByB = new Map(analysis.matched.map((m) => [m.bIndex, m]));
    const unnamed = new Set(analysis.unnamedBRows);
    const ambiguous = new Set(analysis.ambiguousBIndices);
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
  const bSheet = b.sheet;
  const displayedRows = showSheet && processed ? processed.output.rows.slice(0, RESULT_ROWS) : [];
  const resultColumns = showSheet && b.sheet ? Math.min(b.sheet.headers.length, PREVIEW_COLUMNS + 2) : 0;

  return (
    <section>
      <div className="screen-head">
        <h2>Structure Matcher</h2>
        <button className="btn link danger" onClick={reset}>
          Reset
        </button>
      </div>
      <p className="hint">
        Reorganizes File B using File A's order. Only exact name matches are used (ignoring letter
        case and extra spaces) — spelling differences are never matched automatically. You can
        choose which matched names are moved to the end, and whether the final file contains only
        those rows or everything. If a file has no header row, tick "First row is data". Both
        original files stay untouched; the result is a brand-new spreadsheet. Supported formats:
        XLSX, XLS, CSV.
      </p>

      <div className="two-col">
        <FilePanel
          side="a"
          title="File A — Reference Structure"
          description="Defines the required row sequence."
          state={a}
          onStateChange={updateA}
        />
        <FilePanel
          side="b"
          title="File B — Source Structure"
          description="Records that will be reorganized."
          state={b}
          onStateChange={updateB}
        />
      </div>

      {analysis && (
        <>
          <div className="card-grid">
            <Metric label="Total rows in A" value={analysis.totalA} />
            <Metric label="Total rows in B" value={analysis.totalB} />
            <Metric label="Matched records" value={analysis.matchedCount} />
            <Metric label="Unmatched records" value={analysis.unmatchedCount} />
            <Metric label="Missing records" value={analysis.missingCount} />
            <Metric label="Duplicate names" value={analysis.duplicateNameCount} />
            <Metric label="Output rows" value={analysis.outputRows} />
          </div>

          {analysis.missingInB.length > 0 && (
            <div className="card">
              <div className="card-label">Missing records — names in A not found in B</div>
              <p className="hint" style={{ marginTop: 0 }}>
                These names cannot be reordered because File B has no matching record. No rows are
                invented for them.
              </p>
              <ul className="file-list">
                {analysis.missingInB.map((m) => (
                  <li key={m.aIndex}>
                    <span>{m.name}</span>
                    <span className="hint">File A, spreadsheet row {m.aIndex + (a.noHeader ? 1 : 2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.duplicateGroups.length > 0 && (
            <div className="card">
              <div className="card-label">Duplicate names — manual review required</div>
              <p className="hint" style={{ marginTop: 0 }}>
                These names appear more than once, so the correct record cannot be chosen
                automatically. Ambiguous rows are <strong>not</strong> moved: they stay at the top
                of the output in their original order.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Occurrences in File A</th>
                    <th>Occurrences in File B</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.duplicateGroups.map((g) => (
                    <tr key={g.key} className="dup">
                      <td>{g.display}</td>
                      <td>{g.aRows.length}</td>
                      <td>{g.bRows.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={dupAck}
                  onChange={(e) => setDupAck(e.target.checked)}
                />{" "}
                I have reviewed these duplicate names and accept that ambiguous rows will be kept
                at the top rather than reordered.
              </label>
            </div>
          )}

          {analysis.matchedCount > 0 && (
            <div className="card">
              <div className="card-label">Names to move to the end</div>
              <p className="hint" style={{ marginTop: 0 }}>
                Click a name to select it. Hold <kbd>Shift</kbd> and click another to select the
                whole range between them — like selecting rows in Excel. Selected names are the
                ones whose File B rows move to the end; everything else keeps its original
                position.
              </p>
              <div className="btn-row" style={{ marginTop: 0 }}>
                <span className="hint">
                  {movedSelection.size} of {analysis.matchedCount} matched names selected
                </span>
                <button
                  className="btn link"
                  onClick={() => setMovedSelection(new Set(analysis.matched.map((m) => m.aIndex)))}
                >
                  Select all
                </button>
                <button className="btn link" onClick={() => setMovedSelection(new Set())}>
                  Clear
                </button>
              </div>
              <div className="table-scroll sm-preview" style={{ maxHeight: 260 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.matched.map((m, i) => (
                      <tr
                        key={m.aIndex}
                        className={"selectable" + (movedSelection.has(m.aIndex) ? " row-selected" : "")}
                        onClick={(e) => tickMoved(i, e.shiftKey)}
                      >
                        <td>{m.name}</td>
                        <td className="hint">{m.aIndex + (a.noHeader ? 1 : 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label style={{ display: "block", marginTop: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={onlySelected}
                  onChange={(e) => {
                    setOnlySelected(e.target.checked);
                    setProcessed(null);
                    setExportMessage(null);
                  }}
                />{" "}
                Final file contains <strong>only the selected names</strong> (with all their
                columns) — every other File B row is left out
              </label>
              {onlySelected && movedSelection.size === 0 && (
                <div className="warn-box">
                  No names are selected — the final file would contain no rows. Tick at least one
                  name (use Shift+click to select a whole range), or untick the option above to
                  keep the other rows.
                </div>
              )}
            </div>
          )}

          {(analysis.unnamedBRows.length > 0 || analysis.unnamedARows.length > 0 ||
            analysis.emptyBRowsRemoved > 0 || analysis.emptyARowsRemoved > 0) && (
            <div className="card">
              <div className="card-label">Data notes</div>
              <ul className="file-list">
                {analysis.unnamedBRows.length > 0 && (
                  <li>
                    <span>
                      {analysis.unnamedBRows.length} File B row(s) have data but no value in the
                      Name column — kept at the top, not matched.
                    </span>
                  </li>
                )}
                {analysis.unnamedARows.length > 0 && (
                  <li>
                    <span>
                      {analysis.unnamedARows.length} File A row(s) have data but no value in the
                      Name column — skipped for sequencing.
                    </span>
                  </li>
                )}
                {analysis.emptyBRowsRemoved > 0 && (
                  <li>
                    <span>
                      {analysis.emptyBRowsRemoved} completely empty File B row(s) will be removed
                      from the output.
                    </span>
                  </li>
                )}
                {analysis.emptyARowsRemoved > 0 && (
                  <li>
                    <span>
                      {analysis.emptyARowsRemoved} completely empty File A row(s) ignored.
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="btn-row">
            <button className="btn primary" onClick={doProcess} disabled={!canProcess}>
              Process — Reorder File B
            </button>
            {analysis && !canProcess && analysis.duplicateNameCount > 0 && !dupAck && (
              <span className="hint">
                Review and acknowledge the duplicate names above before processing.
              </span>
            )}
          </div>
        </>
      )}

      {processed && bSheet && (
        <>
          <div className="card wide">
            <div className="card-label">Result — final row order</div>
            <div className="ok-box" style={{ marginTop: 0 }}>
              {processed.output.rows.length} rows in the output:{" "}
              {processed.output.segments[1].end - processed.output.segments[1].start} moved to the
              end in File A order
              {processed.output.segments[0].end > 0
                ? `, ${processed.output.segments[0].end} other rows kept in place`
                : onlySelected
                  ? " — other File B rows were left out (only selected names included)"
                  : ""}
              .
            </div>
            <div className="table-scroll sm-preview">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    {bSheet.headers.slice(0, resultColumns).map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                    {bSheet.headers.length > resultColumns && <th>…</th>}
                  </tr>
                </thead>
                <tbody>
                  <SegmentRow
                    label={`Kept in place (${processed.output.segments[0].end})`}
                    visible={processed.output.segments[0].end > 0}
                    columns={resultColumns + 2}
                  />
                  {displayedRows.slice(0, processed.output.segments[0].end).map((row, r) => (
                    <ResultRow
                      key={r}
                      row={row}
                      index={r}
                      label={resultLabels[r]}
                      columns={resultColumns}
                      extra={bSheet.headers.length > resultColumns}
                    />
                  ))}
                  <SegmentRow
                    label={`Moved to end — File A order (${processed.output.segments[1].end - processed.output.segments[1].start})`}
                    visible={processed.output.segments[1].end > processed.output.segments[1].start}
                    columns={resultColumns + 2}
                  />
                  {displayedRows.slice(processed.output.segments[0].end).map((row, r) => (
                    <ResultRow
                      key={processed.output.segments[0].end + r}
                      row={row}
                      index={processed.output.segments[0].end + r}
                      label={resultLabels[processed.output.segments[0].end + r]}
                      columns={resultColumns}
                      extra={bSheet.headers.length > resultColumns}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {processed.output.rows.length > RESULT_ROWS && (
              <div className="hint">
                Showing the first {RESULT_ROWS} of {processed.output.rows.length} rows — the export
                includes every row.
              </div>
            )}
          </div>

          <div className="card wide">
            <div className="card-label">Export</div>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <label className="hint">
                Format
                <select
                  className="input"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value === "csv" ? "csv" : "xlsx")}
                  style={{ width: "auto", display: "block" }}
                >
                  <option value="xlsx">Excel workbook (.xlsx)</option>
                  <option value="csv">CSV file (.csv)</option>
                </select>
              </label>
              <button className="btn primary" onClick={() => void doExport()}>
                Download reorganized spreadsheet
              </button>
            </div>
            <p className="hint">
              A new file is created — File A and File B are never modified. All original columns
              and cell values are preserved.
            </p>
            {exportMessage && <div className="ok-box">{exportMessage}</div>}
            {exportError && <div className="error-box">{exportError}</div>}
          </div>
        </>
      )}
    </section>
  );
}

function SegmentRow({
  label,
  visible,
  columns,
}: {
  label: string;
  visible: boolean;
  columns: number;
}) {
  if (!visible) return null;
  return (
    <tr className="segment">
      <td colSpan={columns}>{label}</td>
    </tr>
  );
}

function ResultRow({
  row,
  index,
  label,
  columns,
  extra,
}: {
  row: string[];
  index: number;
  label: string;
  columns: number;
  extra: boolean;
}) {
  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <span className={"status-pill " + (label.startsWith("Moved") ? "ok" : "warn")}>
          {label}
        </span>
      </td>
      {row.slice(0, columns).map((cell, c) => (
        <td key={c}>{cell}</td>
      ))}
      {extra && <td>…</td>}
    </tr>
  );
}
