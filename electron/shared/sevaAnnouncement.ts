/**
 * Builds the two daily seva announcements from the Seva Notice builder data.
 *
 * Pure text functions — no Node, no DOM — so the renderer can call this on
 * every keystroke and the output can be unit-tested.
 *
 * Section mapping (ids from the Seva Notice editor):
 *   nitya   -> "Nitya Seva" slot in both announcements
 *   bhagvat -> "Bhagvad Seva" (Lunch) / "Bhagvat Seva" (Mangal Aarti) slot
 *   priti   -> "Priti Bhoj Seva" bullet list in both announcements
 *   lunch   -> "Today’s Lunch Prasad is contributed by" line (Lunch only)
 *
 * These are the only four sevas on the notice; neither announcement format
 * mentions anything else.
 */

export interface SevaSponsor {
  name: string;
  note?: string;
}

export interface SevaSectionInput {
  id: string;
  entries: SevaSponsor[];
}

export interface SevaAnnouncements {
  lunch: string;
  mangalAarti: string;
}

export interface NoticeDate {
  year: number;
  month: number; // 1-based
  day: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthFromName(raw: string): number | null {
  if (raw.length < 3) return null;
  return MONTH_LOOKUP[raw.slice(0, 3).toLowerCase()] ?? null;
}

function isValidNoticeDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

/**
 * Parse the free-text date heading, e.g. "01st November 2026", "1 Nov 2026",
 * "November 01 2026", "01-11-2026" or "2026-11-01".
 * Returns null when the text is not a recognizable full date.
 */
export function parseNoticeDate(input: string): NoticeDate | null {
  const text = (input ?? "").trim().replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  if (!text) return null;

  const accept = (year: number, month: number | null, day: number): NoticeDate | null =>
    month !== null && isValidNoticeDate(year, month, day) ? { year, month, day } : null;

  // 01 November 2026 / 1 Nov 2026
  const dayFirst = /^(\d{1,2})[\s.,/-]+([A-Za-z]{3,9})[\s.,/-]+(\d{4})$/.exec(text);
  if (dayFirst) {
    return accept(parseInt(dayFirst[3], 10), monthFromName(dayFirst[2]), parseInt(dayFirst[1], 10));
  }

  // November 01 2026
  const monthFirst = /^([A-Za-z]{3,9})[\s.,/-]+(\d{1,2})[\s.,/-]+(\d{4})$/.exec(text);
  if (monthFirst) {
    return accept(parseInt(monthFirst[3], 10), monthFromName(monthFirst[1]), parseInt(monthFirst[2], 10));
  }

  // 2026-11-01
  const yearFirst = /^(\d{4})[\s./-]+(\d{1,2})[\s./-]+(\d{1,2})$/.exec(text);
  if (yearFirst) {
    return accept(parseInt(yearFirst[1], 10), parseInt(yearFirst[2], 10), parseInt(yearFirst[3], 10));
  }

  // 01-11-2026 (day first, matching the filenames this app already handles)
  const numeric = /^(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+(\d{2,4})$/.exec(text);
  if (numeric) {
    const rawYear = parseInt(numeric[3], 10);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return accept(year, parseInt(numeric[2], 10), parseInt(numeric[1], 10));
  }

  return null;
}

/** "1" -> "01st", "22" -> "22nd", "13" -> "13th". */
export function ordinalDay(day: number): string {
  const remainder = day % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${String(day).padStart(2, "0")}${suffix}`;
}

/** "01st November 2026" — the printed-notice style heading. */
export function formatSevaDate(date: NoticeDate): string {
  return `${ordinalDay(date.day)} ${MONTH_NAMES[date.month - 1]} ${date.year}`;
}

function weekdayOf(date: NoticeDate): string {
  return new Date(date.year, date.month - 1, date.day).toLocaleDateString("en-US", {
    weekday: "long",
  });
}

/**
 * "01st November 2026, Sunday" (long) or "01st Nov 2026 - Sunday" (short).
 */
export function formatAnnouncementDate(date: NoticeDate, style: "long" | "short"): string {
  const weekday = weekdayOf(date);
  if (style === "long") return `${formatSevaDate(date)}, ${weekday}`;
  const shortMonth = MONTH_NAMES[date.month - 1].slice(0, 3);
  return `${ordinalDay(date.day)} ${shortMonth} ${date.year} - ${weekday}`;
}

function todayAsNoticeDate(today: Date): NoticeDate {
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
}

function resolveHeadings(dateText: string, today: Date): { lunch: string; mangal: string } {
  const text = (dateText ?? "").trim();
  const parsed = parseNoticeDate(text);
  if (parsed) {
    return {
      lunch: formatAnnouncementDate(parsed, "long"),
      mangal: formatAnnouncementDate(parsed, "short"),
    };
  }
  if (!text) {
    const fallback = todayAsNoticeDate(today);
    return {
      lunch: formatAnnouncementDate(fallback, "long"),
      mangal: formatAnnouncementDate(fallback, "short"),
    };
  }
  // Unrecognized but non-empty heading: keep the user's own words, no weekday.
  return { lunch: text.replace(/,$/, ""), mangal: text };
}

function sponsorLines(entries: SevaSponsor[] | undefined, empty: string): string {
  const lines = (entries ?? [])
    .map((entry) => {
      const name = (entry.name ?? "").trim();
      if (!name) return "";
      const note = (entry.note ?? "").trim();
      return `• ${name}${note ? ` (${note})` : ""}`;
    })
    .filter((line) => line !== "");
  return lines.length > 0 ? lines.join("\n") : empty;
}

function sectionEntries(sections: SevaSectionInput[], id: string): SevaSponsor[] {
  return sections.find((section) => section.id === id)?.entries ?? [];
}

/**
 * Build both announcement texts. `dateText` is the Seva Notice date heading;
 * an empty heading falls back to today's local date.
 */
export function buildSevaAnnouncements(
  sections: SevaSectionInput[],
  dateText: string,
  today: Date = new Date(),
): SevaAnnouncements {
  const headings = resolveHeadings(dateText, today);

  const nitya = sponsorLines(sectionEntries(sections, "nitya"), "—");
  const bhagvad = sponsorLines(sectionEntries(sections, "bhagvat"), "—");
  const priti = sponsorLines(sectionEntries(sections, "priti"), "• —");
  const lunchPrasad = sponsorLines(sectionEntries(sections, "lunch"), "• —");

  const lunch = [
    `${headings.lunch}: Lunch Announcement:`,
    "",
    "Today’s Nitya Seva which includes entire day’s bhoga, Aarati to their Lordships also entire day’s Prasad for devotees is contributed by --",
    nitya,
    "Today’s Bhagvad Seva which includes entire day’s bhoga, Aarati to their Lordships is contributed by --",
    bhagvad,
    "",
    "Today’s Priti Bhoj Seva which includes the entire day’s Prasad for devotees is contributed by the following devotees…",
    priti,
    "Today’s Lunch Prasad is contributed by",
    lunchPrasad,
    "",
    "Let us express our gratitude and prayers by loudly chanting the Hare Krishna Mahamantra",
  ].join("\n");

  const mangalAarti = [
    `${headings.mangal} – Mangal Arati Announcement:`,
    "",
    "For the transcendental pleasure of Their Lordships Sri Sri Radha Gopinath, Sri Lalita Devi, Sri Vishaka Devi, Sri Gopalji, Sri Sri Nitai Gaurachandra, Srila Prabhupada and all the Vaisnavas –",
    "",
    "Today’s Nitya Seva which includes entire day’s bhoga, Aarati to their Lordships also entire day’s Prasad for devotees is contributed by --",
    nitya,
    "Today’s Bhagvat Seva which includes entire day’s bhoga, Aarati to their Lordships is contributed by --",
    bhagvad,
    "",
    "Today’s Priti Bhoj Seva which includes the entire day’s Prasad for devotees is contributed by the following devotees…",
    "",
    priti,
    "",
    "We would like to pray to Their Lordships to shower their choicest Blessings upon them & their families, for their wonderful service.",
    "",
    "Let us express our gratitude and prayers by loudly chanting the Hare Krishna Mahamantra !!!",
  ].join("\n");

  return { lunch, mangalAarti };
}
