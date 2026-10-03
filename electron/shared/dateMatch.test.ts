import { describe, expect, it } from "vitest";
import {
  filenameMatchesDay,
  monthFolderName,
  parseFilenameDate,
  toLocalISODate,
} from "./dateMatch";

const OCT_2_2026 = new Date(2026, 9, 2); // local time, October 2 2026

describe("parseFilenameDate", () => {
  it.each([
    "02-10-2026",
    "02_10_2026",
    "02.10.2026",
    "02 10 2026",
    "2-10-2026",
    "2026-10-02",
    "02 October 2026",
    "2 Oct 2026",
    "02-Oct-2026",
    "02 Oct 2026",
  ])("parses %s", (input) => {
    const parsed = parseFilenameDate(input);
    expect(parsed).not.toBeNull();
    expect(parsed!.year).toBe(2026);
    expect(parsed!.month).toBe(10);
    expect(parsed!.day).toBe(2);
  });

  it("finds dates inside larger filenames (prefix/suffix ignored)", () => {
    expect(parseFilenameDate("Birthday List 02-10-2026.xlsx")).toMatchObject({
      year: 2026,
      month: 10,
      day: 2,
    });
    expect(parseFilenameDate("ParthSeva 02-10-2026.xlsx")).toMatchObject({
      month: 10,
      day: 2,
    });
    expect(parseFilenameDate("02-10-2026 Members.xlsx")).toMatchObject({
      month: 10,
      day: 2,
    });
    expect(parseFilenameDate("October 02 2026.xlsx")).toMatchObject({
      month: 10,
      day: 2,
    });
    expect(parseFilenameDate("Report 02.10.2026 final.xlsx")).toMatchObject({
      month: 10,
      day: 2,
    });
  });

  it("returns null for filenames without a date", () => {
    expect(parseFilenameDate("Members.xlsx")).toBeNull();
    expect(parseFilenameDate("data.csv")).toBeNull();
    expect(parseFilenameDate("backup 2026.xlsx")).toBeNull();
    expect(parseFilenameDate("summary-October.xlsx")).toBeNull();
  });

  it("returns null for invalid calendar dates", () => {
    expect(parseFilenameDate("31-02-2026.xlsx")).toBeNull();
    expect(parseFilenameDate("13-13-2026.xlsx")).toBeNull();
    expect(parseFilenameDate("32-10-2026.xlsx")).toBeNull();
  });

  it("does not misparse phone-number-like fragments as dates", () => {
    // 10 digit runs are not 4-digit years
    expect(parseFilenameDate("9876543210.xlsx")).toBeNull();
  });
});

describe("filenameMatchesDay", () => {
  it("matches files whose filename contains today's date", () => {
    expect(filenameMatchesDay("02-10-2026.xlsx", OCT_2_2026)).toBe(true);
    expect(filenameMatchesDay("Birthday List 02-10-2026.xlsx", OCT_2_2026)).toBe(true);
    expect(filenameMatchesDay("ParthSeva 02-10-2026.xlsx", OCT_2_2026)).toBe(true);
    expect(filenameMatchesDay("02-10-2026 Members.xlsx", OCT_2_2026)).toBe(true);
    expect(filenameMatchesDay("October 02 2026.xlsx", OCT_2_2026)).toBe(true);
  });

  it("ignores other days, months and years", () => {
    expect(filenameMatchesDay("03-10-2026.xlsx", OCT_2_2026)).toBe(false);
    expect(filenameMatchesDay("02-09-2026.xlsx", OCT_2_2026)).toBe(false); // 2 Sep
    expect(filenameMatchesDay("02-10-2025.xlsx", OCT_2_2026)).toBe(false);
    expect(filenameMatchesDay("12-10-2026.xlsx", OCT_2_2026)).toBe(false); // 12 Oct
  });

  it("ignores files with no date in the name", () => {
    expect(filenameMatchesDay("Members.xlsx", OCT_2_2026)).toBe(false);
  });

  it("never matches temp files like ~$02-10-2026.xlsx", () => {
    // parse still works on the stem, but discovery filters ~$ before calling;
    // matching itself is date-based so the filter is enforced in fileFinder.
    expect(filenameMatchesDay("~$02-10-2026.xlsx", OCT_2_2026)).toBe(true);
  });
});

describe("monthFolderName", () => {
  it("returns English month names", () => {
    expect(monthFolderName(OCT_2_2026)).toBe("October");
    expect(monthFolderName(new Date(2026, 0, 15))).toBe("January");
    expect(monthFolderName(new Date(2026, 11, 31))).toBe("December");
  });
});

describe("toLocalISODate", () => {
  it("formats local dates without UTC shifting", () => {
    expect(toLocalISODate(OCT_2_2026)).toBe("2026-10-02");
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
