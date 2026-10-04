import { useMemo, useState } from "react";
import "./SevaNoticeScreen.css";

interface Sponsor { id: string; name: string; note: string; sideBySide: boolean }
interface SponsorSection { id: string; title: string; entries: Sponsor[] }
const defaultFooter = "May Their Lordships Sri Sri Radha Gopinath bestow Their infinite mercy and choicest blessings upon all the sponsors, their families, and all living beings. Hare Krishna.";
const initialSections: SponsorSection[] = [
  { id: "nitya", title: "Nitya Seva", entries: [] },
  { id: "raj", title: "Raj Bhoga", entries: [] },
  { id: "lunch", title: "Lunch Prasad", entries: [] },
  { id: "dinner", title: "Dinner Prasad", entries: [] },
  { id: "breakfast", title: "Breakfast Prasad", entries: [] },
];

export function SevaNoticeScreen() {
  const [sections, setSections] = useState(initialSections);
  const [date, setDate] = useState("");
  const [footer, setFooter] = useState(defaultFooter);
  const [paper, setPaper] = useState("#fdf2e1");
  const [fontSize, setFontSize] = useState(18);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const total = useMemo(() => sections.reduce((n, section) => n + section.entries.length, 0), [sections]);

  const patchEntry = (sectionId: string, id: string, patch: Partial<Sponsor>) => setSections((all) => all.map((s) => s.id !== sectionId ? s : { ...s, entries: s.entries.map((e) => e.id === id ? { ...e, ...patch } : e) }));
  const addEntry = (sectionId: string) => setSections((all) => all.map((s) => s.id !== sectionId ? s : { ...s, entries: [...s.entries, { id: crypto.randomUUID(), name: "", note: "", sideBySide: false }] }));
  const removeEntry = (sectionId: string, id: string) => setSections((all) => all.map((s) => s.id !== sectionId ? s : { ...s, entries: s.entries.filter((e) => e.id !== id) }));
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
    setDragId(null); setDragFrom(null);
  };

  return <section className="seva-notice">
    <header className="seva-topbar">
      <div><h2>Seva Notice Builder</h2><span>Daily temple sponsorship sheet · {total} donor{total === 1 ? "" : "s"}</span></div>
      <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
    </header>
    <div className="seva-workspace">
      <aside className="seva-editor" aria-label="Notice editor">
        <div className="seva-field-card">
          <label>Date heading<input value={date} onChange={(e) => setDate(e.target.value)} placeholder="e.g. 01st October 2026" /></label>
          <label>Donor name size <output>{fontSize}px</output><input type="range" min="14" max="36" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /></label>
          <label>Sheet background<input className="seva-color" type="color" value={paper} onChange={(e) => setPaper(e.target.value)} /></label>
        </div>
        {sections.map((section) => <div className="seva-section" key={section.id} onDragOver={(e) => e.preventDefault()} onDrop={() => dropInto(section.id)}>
          <div className="seva-section-head"><h3>{section.title}</h3><span>{section.entries.length}</span><button className="btn" onClick={() => addEntry(section.id)}>＋ Add donor</button></div>
          {!section.entries.length && <p className="seva-empty">Drop a donor here or add one.</p>}
          {section.entries.map((entry) => <div className="seva-entry" key={entry.id} draggable onDragStart={() => { setDragId(entry.id); setDragFrom(section.id); }} onDragEnd={() => { setDragId(null); setDragFrom(null); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropInto(section.id, entry.id); }}>
            <div className="seva-entry-head"><span className="seva-drag" title="Drag to reorder or move">⠿ Drag</span><button className="btn danger" onClick={() => removeEntry(section.id, entry.id)}>Remove</button></div>
            <label>Donor name<input value={entry.name} onChange={(e) => patchEntry(section.id, entry.id, { name: e.target.value })} placeholder="Full name" /></label>
            <label>Note or dedication<input value={entry.note} onChange={(e) => patchEntry(section.id, entry.id, { note: e.target.value })} placeholder="In loving memory of…" /></label>
            <label className="seva-check"><input type="checkbox" checked={entry.sideBySide} onChange={(e) => patchEntry(section.id, entry.id, { sideBySide: e.target.checked })} /> Place side-by-side (two columns)</label>
          </div>)}
        </div>)}
        <label className="seva-footer-editor">Closing blessing<textarea rows={4} value={footer} onChange={(e) => setFooter(e.target.value)} /></label>
      </aside>
      <div className="seva-preview-area" aria-label="Live notice preview">
        <article className="seva-paper" style={{ backgroundColor: paper }}>
          <h1>{date || " "}</h1><div className="seva-ornament"><span />✧<span /></div>
          {sections.map((section) => {
            const entries = section.entries.filter((entry) => entry.name.trim() || entry.note.trim());
            return entries.length ? <section className="seva-doc-section" key={section.id}><h2>{section.title}</h2><div className="seva-donors">
              {entries.map((entry) => <div key={entry.id} className={entry.sideBySide ? "seva-donor half" : "seva-donor"}>
                <div className="seva-donor-name" style={{ fontSize: `${fontSize}px` }}>{entry.name || " "}</div>{entry.note.trim() && <div className="seva-donor-note">{entry.note}</div>}
              </div>)}
            </div></section> : null;
          })}
          {footer.trim() && <p className="seva-blessing">{footer}</p>}
        </article>
      </div>
    </div>
  </section>;
}
