import { describe, expect, it } from "vitest";
import {
  buildSevaAnnouncements,
  formatAnnouncementDate,
  formatSevaDate,
  ordinalDay,
  parseNoticeDate,
} from "./sevaAnnouncement";

const NOV_1_2026 = { year: 2026, month: 11, day: 1 };

describe("parseNoticeDate", () => {
  it.each([
    "01st November 2026",
    "1st Nov 2026",
    "1 Nov 2026",
    "November 01 2026",
    "01-11-2026",
    "2026-11-01",
  ])("parses %s", (input) => {
    expect(parseNoticeDate(input)).toEqual(NOV_1_2026);
  });

  it("returns null for incomplete or impossible dates", () => {
    expect(parseNoticeDate("")).toBeNull();
    expect(parseNoticeDate("November 2026")).toBeNull();
    expect(parseNoticeDate("31-02-2026")).toBeNull();
    expect(parseNoticeDate("hello")).toBeNull();
  });
});

describe("date formatting", () => {
  it("uses correct ordinal suffixes", () => {
    expect(ordinalDay(1)).toBe("01st");
    expect(ordinalDay(2)).toBe("02nd");
    expect(ordinalDay(3)).toBe("03rd");
    expect(ordinalDay(4)).toBe("04th");
    expect(ordinalDay(11)).toBe("11th");
    expect(ordinalDay(12)).toBe("12th");
    expect(ordinalDay(13)).toBe("13th");
    expect(ordinalDay(21)).toBe("21st");
    expect(ordinalDay(22)).toBe("22nd");
    expect(ordinalDay(23)).toBe("23rd");
    expect(ordinalDay(31)).toBe("31st");
  });

  it("formats the long and short announcement dates with the weekday", () => {
    expect(formatSevaDate(NOV_1_2026)).toBe("01st November 2026");
    expect(formatAnnouncementDate(NOV_1_2026, "long")).toBe("01st November 2026, Sunday");
    expect(formatAnnouncementDate(NOV_1_2026, "short")).toBe("01st Nov 2026 - Sunday");
  });
});

describe("buildSevaAnnouncements", () => {
  const sections = [
    { id: "nitya", entries: [{ name: "Nitya Donor" }] },
    { id: "bhagvat", entries: [{ name: "Bhagvat Donor", note: "In memory of his father" }] },
    { id: "priti", entries: [{ name: "Priti Donor" }] },
    { id: "lunch", entries: [{ name: "Lunch Donor", note: "Seeking Blessings" }] },
    { id: "dinner", entries: [{ name: "Dinner Donor" }] },
  ];

  it("puts lunch sponsors, notes and the date into the lunch announcement", () => {
    const { lunch } = buildSevaAnnouncements(sections, "01st November 2026");
    expect(lunch).toContain("01st November 2026, Sunday: Lunch Announcement:");
    expect(lunch).toContain("is contributed by --\n• Nitya Donor");
    expect(lunch).toContain("Today’s Bhagvad Seva");
    expect(lunch).toContain("• Bhagvat Donor (In memory of his father)");
    expect(lunch).toContain("• Priti Donor");
    expect(lunch).toContain("Today’s Lunch Prasad is contributed by\n• Lunch Donor (Seeking Blessings)");
    expect(lunch).toContain("loudly chanting the Hare Krishna Mahamantra");
  });

  it("builds the mangal aarti announcement with its own heading and spelling", () => {
    const { mangalAarti } = buildSevaAnnouncements(sections, "01st November 2026");
    expect(mangalAarti).toContain("01st Nov 2026 - Sunday – Mangal Arati Announcement:");
    expect(mangalAarti).toContain("Today’s Bhagvat Seva");
    expect(mangalAarti).not.toContain("Today’s Bhagvad Seva");
    expect(mangalAarti).toContain("• Bhagvat Donor (In memory of his father)");
    expect(mangalAarti).toContain("Hare Krishna Mahamantra !!!");
  });

  it("omits seva sentences when that seva has no donor", () => {
    const { lunch, mangalAarti } = buildSevaAnnouncements(
      [{ id: "nitya", entries: [] }],
      "01st November 2026",
    );
    expect(lunch).not.toContain("Today’s Nitya Seva");
    expect(lunch).not.toContain("Today’s Bhagvad Seva");
    expect(lunch).not.toContain("Today’s Priti Bhoj Seva");
    expect(lunch).not.toContain("Today’s Lunch Prasad");
    expect(mangalAarti).not.toContain("Today’s Nitya Seva");
    expect(mangalAarti).not.toContain("Today’s Bhagvat Seva");
    expect(mangalAarti).not.toContain("Today’s Priti Bhoj Seva");
    expect(lunch).toContain("Hare Krishna Mahamantra");
    expect(mangalAarti).toContain("Hare Krishna Mahamantra !!!");
  });

  it("ignores blank names and services that are not part of these formats", () => {
    const { lunch, mangalAarti } = buildSevaAnnouncements(sections, "01st November 2026");
    expect(lunch).not.toContain("Dinner Donor");
    expect(mangalAarti).not.toContain("Dinner Donor");
    expect(buildSevaAnnouncements([{ id: "lunch", entries: [{ name: "  " }] }], "").lunch)
      .not.toContain("Today’s Lunch Prasad is contributed by");
  });

  it("falls back to the user's own heading when the date is not parseable", () => {
    const { lunch } = buildSevaAnnouncements([], "Gurupurnima");
    expect(lunch).toContain("Gurupurnima: Lunch Announcement:");
  });

  it("uses today's local date when the heading is empty", () => {
    const { lunch } = buildSevaAnnouncements([], "", new Date(2026, 10, 1));
    expect(lunch).toContain("01st November 2026, Sunday: Lunch Announcement:");
  });
});
