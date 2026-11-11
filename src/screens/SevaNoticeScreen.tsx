import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildSevaAnnouncements, formatSevaDate, parseNoticeDate } from "@shared/sevaAnnouncement";
import "./SevaNoticeScreen.css";

interface Sponsor { id: string; name: string; note: string; size: number; noteSize: number; autoFitName: boolean; sideBySide: boolean }
interface SponsorSection { id: string; title: string; entries: Sponsor[] }
type NoticeTab = "list" | "mangal" | "lunch";
const TABS: Array<{ key: NoticeTab; label: string }> = [
  { key: "list", label: "Seva List" },
  { key: "mangal", label: "Mangal Aarti Announcement" },
  { key: "lunch", label: "Lunch Announcement" },
];
const MIN_NAME_SIZE = 8;
const MAX_NAME_SIZE = 400;
const DEFAULT_NAME_SIZE = 72;
const NAME_SIZE_STEP = 4;
const MIN_CANVAS_TEXT_SIZE = 8;
const MAX_CANVAS_TEXT_SIZE = 160;
const DEFAULT_DATE_SIZE = 22;
const DEFAULT_SECTION_HEADING_SIZE = 15;
const DEFAULT_NOTE_SIZE = 11;
const DEFAULT_FOOTER_SIZE = 11;

type ResizeCorner = "nw" | "ne" | "sw" | "se";

/** Keeps a typed or clicked size inside the supported range. */
function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NAME_SIZE;
  return Math.min(MAX_NAME_SIZE, Math.max(MIN_NAME_SIZE, Math.round(value)));
}

/** Text resized from the preview uses half-point steps, matching Word's units. */
function clampCanvasTextSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SECTION_HEADING_SIZE;
  const clamped = Math.min(MAX_CANVAS_TEXT_SIZE, Math.max(MIN_CANVAS_TEXT_SIZE, value));
  return Math.round(clamped * 2) / 2;
}

const defaultFooter = "May Their Lordships Sri Sri Radha Gopinath bestow Their infinite mercy and choicest blessings upon all the sponsors, their families, and all living beings. Hare Krishna.";
const initialSections: SponsorSection[] = [
  { id: "nitya", title: "Nitya Seva", entries: [] },
  { id: "bhagvat", title: "Bhagvat Seva", entries: [] },
  { id: "priti", title: "Priti Bhoj Seva", entries: [] },
  { id: "lunch", title: "Lunch Prasad", entries: [] },
];
const SEVA_OPTIONS = [
  "Nitya Seva",
  "Bhagvat Seva",
  "Priti Bhoj Seva",
  "Lunch Prasad",
  "Special Lunch Prasad",
  "Breakfast Prasad",
  "Dinner Prasad",
  "Balya Bhoga",
  "Raj Bhoga",
  "Puja Bhoga",
  "Mangal Bhoga",
  "Sandhya Bhoga",
  "Vaikalika Bhoga",
  "Kartik Deepdaan",
] as const;

function sevaHeading(title: string): string {
  return `Today’s ${title} is contributed by following Devotees`;
}

function parenthesizeNote(note: string): string {
  const text = note.trim();
  if (!text) return "";
  return text.startsWith("(") && text.endsWith(")") ? text : `(${text})`;
}

/** Opens the print dialog for the panel on screen. Chromium takes the suggested
 * PDF file name from the document title, so it is swapped for the duration of
 * the dialog and restored afterwards.
 */
/** Strips characters Windows does not allow in file names. */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function printAs(title: string) {
  const previousTitle = document.title;
  document.title = fileSafe(title);
  const restore = () => {
    document.title = previousTitle;
    window.clearTimeout(fallback);
  };
  const fallback = window.setTimeout(restore, 60_000);
  window.addEventListener("afterprint", restore, { once: true });
  window.print();
}

/** Keeps the sheet at A4 landscape proportions: its minimum height always
 * matches the paper's width (297 × 210 mm), so the preview reads as a real
 * page. Content taller than one page simply lengthens the sheet.
 */
function useA4Landscape(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = () => {
      const width = element.clientWidth;
      if (!width) return;
      const next = `${Math.round((width * 210) / 297)}px`;
      if (element.style.minHeight !== next) element.style.minHeight = next;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

interface ResizableTextProps {
  as: "h1" | "h2" | "div" | "p";
  children: React.ReactNode;
  className: string;
  textClassName?: string;
  label: string;
  selected: boolean;
  size: number;
  fitToWidth?: boolean;
  onDisableFit?: () => void;
  onSelect: () => void;
  onResize: (size: number) => void;
}

/** A canvas-like text element. Selecting it reveals four corner dots; dragging
 * any dot toward or away from the opposite corner scales the font.
 */
function ResizableText({
  as,
  children,
  className,
  textClassName,
  label,
  selected,
  size,
  fitToWidth = false,
  onDisableFit,
  onSelect,
  onResize,
}: ResizableTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    pointerId: number;
    oppositeX: number;
    oppositeY: number;
    startDistance: number;
    startSize: number;
  } | null>(null);
  const Tag = as;
  const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];

  // Donor names keep their original single-line, fit-to-column behaviour. The
  // dragged size is the preferred maximum and is reduced only when necessary.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const element = root?.querySelector<HTMLElement>(":scope > [data-seva-resizable-content]");
    if (!root || !element) return;
    if (!fitToWidth) {
      element.style.fontSize = `${size}pt`;
      return;
    }
    const fit = () => {
      const width = root.clientWidth;
      if (width <= 0) return;
      let low = Math.min(MIN_NAME_SIZE, size);
      let high = Math.max(size, low);
      for (let step = 0; step < 10; step += 1) {
        const mid = (low + high) / 2;
        element.style.fontSize = `${mid}pt`;
        if (element.scrollWidth <= width) low = mid;
        else high = mid;
      }
      element.style.fontSize = `${Math.floor(low * 2) / 2}pt`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [children, fitToWidth, size]);

  const beginResize = (corner: ResizeCorner, event: React.PointerEvent<HTMLSpanElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const box = root.getBoundingClientRect();
    const oppositeX = corner.includes("w") ? box.right : box.left;
    const oppositeY = corner.includes("n") ? box.bottom : box.top;
    let startSize = size;
    if (fitToWidth) {
      const element = root.querySelector<HTMLElement>(":scope > [data-seva-resizable-content]");
      const pixels = element ? Number.parseFloat(getComputedStyle(element).fontSize) : Number.NaN;
      if (Number.isFinite(pixels)) startSize = Math.max(MIN_NAME_SIZE, Math.floor(pixels * 0.75));
      onDisableFit?.();
      onResize(startSize);
    }
    resizeRef.current = {
      pointerId: event.pointerId,
      oppositeX,
      oppositeY,
      startDistance: Math.max(1, Math.hypot(event.clientX - oppositeX, event.clientY - oppositeY)),
      startSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const distance = Math.hypot(event.clientX - resize.oppositeX, event.clientY - resize.oppositeY);
    onResize(clampCanvasTextSize(resize.startSize * distance / resize.startDistance));
  };

  const finishResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
      return;
    }
    const direction = event.key === "ArrowUp" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowDown" || event.key === "ArrowLeft"
        ? -1
        : 0;
    if (!direction) return;
    event.preventDefault();
    onSelect();
    onResize(clampCanvasTextSize(size + direction));
  };

  const sizeLabel = Number.isInteger(size) ? size.toFixed(0) : size.toFixed(1);
  return <div
    ref={rootRef}
    className={`seva-canvas-text ${className}${selected ? " selected" : ""}`}
    data-fit-to-width={fitToWidth ? "" : undefined}
    role="button"
    tabIndex={0}
    aria-label={`${label}. ${sizeLabel} points. Click to select, then drag a corner dot to resize.`}
    aria-pressed={selected}
    onFocus={onSelect}
    onKeyDown={resizeWithKeyboard}
    onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}
  >
    <Tag className={textClassName} data-seva-resizable-content style={{ fontSize: `${size}pt` }}>{children}</Tag>
    {selected && <>
      <span className="seva-text-size-badge" aria-hidden="true">{sizeLabel} pt</span>
      {corners.map((corner) => <span
        key={corner}
        className="seva-resize-handle"
        data-corner={corner}
        aria-hidden="true"
        onPointerDown={(event) => beginResize(corner, event)}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
      />)}
    </>}
  </div>;
}

/** The default date heading, taken from the system clock: the notice is prepared
 * a day ahead, so it starts on tomorrow's date. Month is always spelled out,
 * e.g. "02nd November 2026". The heading stays editable in the field above.
 */
function systemHeading(dayOffset: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  return formatSevaDate({
    year: target.getFullYear(),
    month: target.getMonth() + 1,
    day: target.getDate(),
  });
}

export function SevaNoticeScreen() {
  const [sections, setSections] = useState(initialSections);
  const [date, setDate] = useState(() => systemHeading(1));
  const [dateSize, setDateSize] = useState(DEFAULT_DATE_SIZE);
  const [headingSizes, setHeadingSizes] = useState<Record<string, number>>({});
  const [footerSize, setFooterSize] = useState(DEFAULT_FOOTER_SIZE);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [footer, setFooter] = useState(defaultFooter);
  const [paper, setPaper] = useState("#fdf2e1");
  const [tab, setTab] = useState<NoticeTab>("list");
  const paperRef = useRef<HTMLElement>(null);
  useA4Landscape(paperRef);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const total = useMemo(() => sections.reduce((n, section) => n + section.entries.length, 0), [sections]);
  const availableSevas = SEVA_OPTIONS.filter((title) => !sections.some((section) => section.title === title));
  const announcements = useMemo(() => buildSevaAnnouncements(sections, date), [sections, date]);
  const activeText = tab === "mangal" ? announcements.mangalAarti : announcements.lunch;

  const activeLabel = tab === "list" ? "Seva List" : tab === "mangal" ? "Mangal Aarti Announcement" : "Lunch Announcement";
  // The saved file is named after the notice date currently in the editor.
  const fileDate = useMemo(() => {
    const parsed = parseNoticeDate(date);
    return parsed ? formatSevaDate(parsed) : date.replace(/,$/, "");
  }, [date]);
  const fileName = fileDate.trim() ? `${activeLabel} ${fileDate}` : activeLabel;
  const printPanel = () => printAs(fileName);

  // The Word document carries the same sections, names, notes and sizes as the sheet.
  const docxSections = sections
    .map((section) => ({
      heading: sevaHeading(section.title),
      headingSize: headingSizes[section.id] ?? DEFAULT_SECTION_HEADING_SIZE,
      entries: section.entries
        .filter((entry) => entry.name.trim() || entry.note.trim())
        .map((entry) => ({
          name: entry.name.trim(),
          note: entry.note.trim() || undefined,
          size: entry.size,
          noteSize: entry.noteSize,
        })),
    }))
    .filter((section) => section.entries.length > 0);

  const download = async () => {
    const bridge = window.parthseva;
    const name = fileSafe(fileName) || activeLabel;
    const request = tab === "list"
      ? { defaultName: name, date, dateSize, sections: docxSections, footer, footerSize }
      : { defaultName: name, text: activeText };
    try {
      if (bridge?.sevaSaveDocx) {
        const saved = await bridge.sevaSaveDocx(request);
        setSaveNote(saved.canceled
          ? null
          : saved.openError
            ? `Saved to ${saved.filePath}, but it could not be opened automatically: ${saved.openError}`
            : `Saved and opened ${saved.filePath}`);
        return;
      }
      const fallback = tab === "list" ? `${date}\n\n${footer}` : activeText;
      const url = URL.createObjectURL(new Blob([fallback], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSaveNote(error instanceof Error ? `Could not save: ${error.message}` : "Could not save the file.");
    }
  };

  const copyAnnouncement = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
  };

  const addSeva = (title: string) => {
    if (!title) return;
    setSections((all) => all.some((section) => section.title === title)
      ? all
      : [...all, { id: crypto.randomUUID(), title, entries: [] }]);
  };

  const patchEntry = (sectionId: string, id: string, patch: Partial<Sponsor>) => setSections((all) => all.map((section) => section.id !== sectionId ? section : {
    ...section,
    entries: section.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry),
  }));
  const addEntry = (sectionId: string) => setSections((all) => all.map((section) => section.id !== sectionId ? section : {
    ...section,
    entries: [...section.entries, { id: crypto.randomUUID(), name: "", note: "", size: DEFAULT_NAME_SIZE, noteSize: DEFAULT_NOTE_SIZE, autoFitName: true, sideBySide: false }],
  }));
  const removeEntry = (sectionId: string, id: string) => setSections((all) => all.map((section) => section.id !== sectionId ? section : {
    ...section,
    entries: section.entries.filter((entry) => entry.id !== id),
  }));
  const removeSeva = (section: SponsorSection) => {
    const donorText = section.entries.length
      ? ` and its ${section.entries.length} donor${section.entries.length === 1 ? "" : "s"}`
      : "";
    if (!window.confirm(`Remove “${section.title}”${donorText}?`)) return;
    setSections((all) => all.filter((item) => item.id !== section.id));
  };

  const dropInto = (sectionId: string, beforeId?: string) => {
    if (!dragId || !dragFrom) return;
    setSections((all) => {
      let dragged: Sponsor | undefined;
      const without = all.map((section) => {
        if (section.id !== dragFrom) return section;
        dragged = section.entries.find((entry) => entry.id === dragId);
        return { ...section, entries: section.entries.filter((entry) => entry.id !== dragId) };
      });
      if (!dragged) return all;
      return without.map((section) => {
        if (section.id !== sectionId) return section;
        const index = beforeId ? section.entries.findIndex((entry) => entry.id === beforeId) : -1;
        const entries = [...section.entries];
        entries.splice(index < 0 ? entries.length : index, 0, dragged!);
        return { ...section, entries };
      });
    });
    setDragId(null);
    setDragFrom(null);
  };

  return <section className="seva-notice">
    <header className="seva-topbar">
      <div><h2>Seva List</h2><span>Daily temple sponsorship sheet · {total} donor{total === 1 ? "" : "s"}</span></div>
      <button className="btn primary" onClick={printPanel}>Print / Save PDF</button>
    </header>
    <div className="seva-workspace">
      <aside className="seva-editor" aria-label="Notice editor">
        <div className="seva-field-card">
          <label>Date heading<input value={date} onChange={(e) => setDate(e.target.value)} placeholder="e.g. 01st October 2026" /></label>
          <label>Sheet background<input className="seva-color" type="color" value={paper} onChange={(e) => setPaper(e.target.value)} /></label>
          <label className="seva-add-select-label">
            Add Seva
            <select
              className="seva-add-select"
              value=""
              disabled={!availableSevas.length}
              onChange={(event) => addSeva(event.target.value)}
            >
              <option value="">{availableSevas.length ? "Select a Seva…" : "All Sevas added"}</option>
              {availableSevas.map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
          </label>
        </div>
        {sections.map((section) => (
          <div className="seva-section" key={section.id} onDragOver={(e) => e.preventDefault()} onDrop={() => dropInto(section.id)}>
            <div className="seva-section-head">
              <h3>{section.title}</h3>
              <span>{section.entries.length}</span>
              <button type="button" className="btn seva-remove-section" onClick={() => removeSeva(section)}>Remove</button>
              <button className="btn" onClick={() => addEntry(section.id)}>＋ Add donor</button>
            </div>
            {!section.entries.length && <p className="seva-empty">Drop a donor here or add one.</p>}
            {section.entries.map((entry) => (
              <div className="seva-entry" key={entry.id} draggable onDragStart={() => { setDragId(entry.id); setDragFrom(section.id); }} onDragEnd={() => { setDragId(null); setDragFrom(null); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropInto(section.id, entry.id); }}>
                <div className="seva-entry-head">
                  <span className="seva-drag" title="Drag to reorder or move">⠿ Drag</span>
                  <button className="btn danger" onClick={() => removeEntry(section.id, entry.id)}>Remove</button>
                </div>
                <label>Donor name<input value={entry.name} onChange={(e) => patchEntry(section.id, entry.id, { name: e.target.value })} placeholder="Full name" /></label>
                <label>Note or dedication<input value={entry.note} onChange={(e) => patchEntry(section.id, entry.id, { note: e.target.value })} placeholder="In loving memory of…" /></label>
                <div className="seva-size-row">
                  <span className="seva-size-label">Name size</span>
                  <button type="button" className="seva-step" aria-label="Decrease name size" onClick={() => patchEntry(section.id, entry.id, { size: clampSize(entry.size - NAME_SIZE_STEP), autoFitName: false })}>−</button>
                  <input
                    className="seva-size-input"
                    type="number"
                    min={MIN_NAME_SIZE}
                    max={MAX_NAME_SIZE}
                    value={entry.size}
                    onChange={(e) => patchEntry(section.id, entry.id, { size: clampSize(Number(e.target.value)), autoFitName: false })}
                  />
                  <button type="button" className="seva-step" aria-label="Increase name size" onClick={() => patchEntry(section.id, entry.id, { size: clampSize(entry.size + NAME_SIZE_STEP), autoFitName: false })}>+</button>
                  <span className="seva-size-unit">pt</span>
                </div>
                <label className="seva-check">
                  <input type="checkbox" checked={entry.sideBySide} onChange={(e) => patchEntry(section.id, entry.id, { sideBySide: e.target.checked })} /> Place side-by-side (two columns)
                </label>
              </div>
            ))}
          </div>
        ))}
        <label className="seva-footer-editor">Closing blessing<textarea rows={4} value={footer} onChange={(e) => setFooter(e.target.value)} /></label>
      </aside>
      <div className="seva-preview-column">
        <div className="seva-tabs" role="tablist" aria-label="Notice and announcement tabs">
          {TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={"seva-tab" + (tab === item.key ? " active" : "")}
              onClick={() => { setTab(item.key); setSelectedText(null); setSaveNote(null); }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "list" ? (
          <div className="seva-preview-area seva-printable" aria-label="Live notice preview" onPointerDown={() => setSelectedText(null)}>
            <p className="seva-canvas-tip">Select any text on the sheet, then drag a corner dot to resize it.</p>
            <article className="seva-paper" ref={paperRef} style={{ backgroundColor: paper }} onPointerDown={() => setSelectedText(null)}>
              <ResizableText
                as="h1"
                className="seva-date-text"
                label="Date heading"
                selected={selectedText === "date"}
                size={dateSize}
                onSelect={() => setSelectedText("date")}
                onResize={(size) => setDateSize(clampCanvasTextSize(size))}
              >
                {date || " "}
              </ResizableText>
              <div className="seva-ornament"><span />✧<span /></div>
              {sections.map((section) => {
                const entries = section.entries.filter((entry) => entry.name.trim() || entry.note.trim());
                const selectionKey = `heading:${section.id}`;
                return entries.length ? <section className="seva-doc-section" key={section.id}>
                  <ResizableText
                    as="h2"
                    className="seva-section-heading"
                    label={`${section.title} heading`}
                    selected={selectedText === selectionKey}
                    size={headingSizes[section.id] ?? DEFAULT_SECTION_HEADING_SIZE}
                    onSelect={() => setSelectedText(selectionKey)}
                    onResize={(size) => setHeadingSizes((current) => ({ ...current, [section.id]: clampCanvasTextSize(size) }))}
                  >
                    {sevaHeading(section.title)}
                  </ResizableText>
                  <div className="seva-donors">
                  {entries.map((entry) => {
                    const nameKey = `name:${entry.id}`;
                    const noteKey = `note:${entry.id}`;
                    return <div key={entry.id} className={entry.sideBySide ? "seva-donor half" : "seva-donor"}>
                      <ResizableText
                        as="div"
                        className="seva-donor-name-text"
                        textClassName="seva-donor-name"
                        label={`${entry.name.trim() || "Donor"} name`}
                        selected={selectedText === nameKey}
                        size={entry.size}
                        fitToWidth={entry.autoFitName}
                        onDisableFit={() => patchEntry(section.id, entry.id, { autoFitName: false })}
                        onSelect={() => setSelectedText(nameKey)}
                        onResize={(size) => patchEntry(section.id, entry.id, { size: clampSize(size) })}
                      >
                        {entry.name || " "}
                      </ResizableText>
                      {entry.note.trim() && <ResizableText
                        as="div"
                        className="seva-donor-note-text"
                        textClassName="seva-donor-note"
                        label={`${entry.name.trim() || "Donor"} note`}
                        selected={selectedText === noteKey}
                        size={entry.noteSize}
                        onSelect={() => setSelectedText(noteKey)}
                        onResize={(size) => patchEntry(section.id, entry.id, { noteSize: clampCanvasTextSize(size) })}
                      >
                        {parenthesizeNote(entry.note)}
                      </ResizableText>}
                    </div>;
                  })}
                </div></section> : null;
              })}
              {footer.trim() && <ResizableText
                as="p"
                className="seva-blessing-text"
                textClassName="seva-blessing"
                label="Closing blessing"
                selected={selectedText === "footer"}
                size={footerSize}
                onSelect={() => setSelectedText("footer")}
                onResize={(size) => setFooterSize(clampCanvasTextSize(size))}
              >
                {footer}
              </ResizableText>}
            </article>
          </div>
        ) : (
          <div className="seva-tab-panel seva-printable" aria-label={TABS.find((item) => item.key === tab)?.label}>
            <div className="seva-tab-panel-head">
              <h4>{tab === "mangal" ? "Mangal Arati Announcement" : "Lunch Announcement"}</h4>
              <button className="btn" onClick={() => void copyAnnouncement(tab, activeText)}>
                {copied === tab ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <pre className="seva-announcement-text">{activeText}</pre>
          </div>
        )}
        <div className="seva-tab-actions">
          <button
            className="btn primary seva-icon-btn"
            onClick={() => void download()}
            aria-label="Download as a Word document"
            title="Download as a Word document (.docx)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 11 5 5 5-5" />
              <path d="M4 20h16" />
            </svg>
          </button>
          <button
            className="btn primary seva-icon-btn"
            onClick={printPanel}
            aria-label="Print"
            title="Print"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V3h12v6" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v7H6z" />
            </svg>
          </button>
          {(saveNote || tab !== "list") && (
            <span className="seva-tab-hint">
              {saveNote ?? "Written automatically from the donor names on the left; Download saves it as an editable Word document."}
            </span>
          )}
        </div>
      </div>
    </div>
  </section>;
}
