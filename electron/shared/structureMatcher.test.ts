import { describe, expect, it } from "vitest";
import {
  analyzeStructureMatch,
  buildMatcherOutput,
  normalizeName,
} from "./structureMatcher";

/** PRD §3.4 example. */
const PRD_A = [["Rahul"], ["Amit"], ["Priya"], ["Neha"]];

const PRD_B = [
  ["Suresh", "111", "Mumbai"],
  ["Priya", "222", "Pune"],
  ["Rahul", "333", "Delhi"],
  ["Karan", "444", "Nashik"],
  ["Neha", "555", "Mumbai"],
  ["Amit", "666", "Pune"],
];

function analyze(aRows: string[][], bRows: string[][], aNameCol = 0, bNameCol = 0) {
  return analyzeStructureMatch({ aRows, aNameColumn: aNameCol, bRows, bNameColumn: bNameCol });
}

describe("normalizeName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Priya   Sharma ")).toBe("priya sharma");
  });

  it("ignores case and zero-width characters", () => {
    expect(normalizeName("RAHUL\u200B")).toBe(normalizeName("rahul"));
  });

  it("does not correct spelling", () => {
    expect(normalizeName("Radhika Sharma")).not.toBe(normalizeName("Radhika Shama"));
  });
});

describe("analyzeStructureMatch — PRD example", () => {
  const result = analyze(PRD_A, PRD_B);
  const output = buildMatcherOutput(PRD_B, result);

  it("matches all shared names", () => {
    expect(result.matchedCount).toBe(4);
  });

  it("keeps unmatched rows at the top in original order", () => {
    expect(result.unmatchedBIndices).toEqual([0, 3]); // Suresh, Karan
    expect(output.rows[0]).toEqual(["Suresh", "111", "Mumbai"]);
    expect(output.rows[1]).toEqual(["Karan", "444", "Nashik"]);
  });

  it("orders matched rows exactly like File A", () => {
    expect(output.rows.slice(2)).toEqual([
      ["Rahul", "333", "Delhi"],
      ["Amit", "666", "Pune"],
      ["Priya", "222", "Pune"],
      ["Neha", "555", "Mumbai"],
    ]);
  });

  it("moves complete rows, not just the name", () => {
    expect(output.rows[2]).toEqual(["Rahul", "333", "Delhi"]);
  });

  it("reports the summary metrics", () => {
    expect(result.totalA).toBe(4);
    expect(result.totalB).toBe(6);
    expect(result.unmatchedCount).toBe(2);
    expect(result.missingCount).toBe(0);
    expect(result.duplicateNameCount).toBe(0);
    expect(result.outputRows).toBe(6);
  });

  it("emits the two output segments", () => {
    expect(output.segments).toEqual([
      { start: 0, end: 2, kind: "in-place" },
      { start: 2, end: 6, kind: "moved" },
    ]);
  });

  it("exposes the File B row behind each output row", () => {
    // Suresh(0), Karan(3) in place; then Rahul(2), Amit(5), Priya(1), Neha(4)
    expect(output.sourceIndices).toEqual([0, 3, 2, 5, 1, 4]);
  });
});

describe("buildMatcherOutput — selective move", () => {
  const result = analyze(PRD_A, PRD_B); // aIndex: Rahul 0, Amit 1, Priya 2, Neha 3

  it("moves only the selected names, in File A order", () => {
    const output = buildMatcherOutput(PRD_B, result, new Set([1, 2])); // Amit, Priya
    expect(output.rows).toEqual([
      ["Suresh", "111", "Mumbai"],
      ["Rahul", "333", "Delhi"],
      ["Karan", "444", "Nashik"],
      ["Neha", "555", "Mumbai"],
      ["Amit", "666", "Pune"],
      ["Priya", "222", "Pune"],
    ]);
    expect(output.sourceIndices).toEqual([0, 2, 3, 4, 5, 1]);
    expect(output.segments).toEqual([
      { start: 0, end: 4, kind: "in-place" },
      { start: 4, end: 6, kind: "moved" },
    ]);
  });

  it("keeps unselected matched rows in their original position", () => {
    const output = buildMatcherOutput(PRD_B, result, new Set([3])); // only Neha moves
    expect(output.rows).toEqual([
      ["Suresh", "111", "Mumbai"],
      ["Priya", "222", "Pune"],
      ["Rahul", "333", "Delhi"],
      ["Karan", "444", "Nashik"],
      ["Amit", "666", "Pune"],
      ["Neha", "555", "Mumbai"],
    ]);
  });

  it("moves nothing when the selection is empty", () => {
    const output = buildMatcherOutput(PRD_B, result, new Set<number>());
    expect(output.rows).toEqual(PRD_B);
    expect(output.segments).toEqual([
      { start: 0, end: 6, kind: "in-place" },
      { start: 6, end: 6, kind: "moved" },
    ]);
  });

  it("can exclude everything except the moved rows", () => {
    const output = buildMatcherOutput(PRD_B, result, new Set([1, 2]), [], false); // only Amit, Priya
    expect(output.rows).toEqual([
      ["Amit", "666", "Pune"],
      ["Priya", "222", "Pune"],
    ]);
    expect(output.sourceIndices).toEqual([5, 1]);
    expect(output.segments).toEqual([
      { start: 0, end: 0, kind: "in-place" },
      { start: 0, end: 2, kind: "moved" },
    ]);
  });

  it("moves every matched row when no selection is given", () => {
    const output = buildMatcherOutput(PRD_B, result);
    expect(output.rows).toEqual([
      ["Suresh", "111", "Mumbai"],
      ["Karan", "444", "Nashik"],
      ["Rahul", "333", "Delhi"],
      ["Amit", "666", "Pune"],
      ["Priya", "222", "Pune"],
      ["Neha", "555", "Mumbai"],
    ]);
  });
});

describe("analyzeStructureMatch — missing records", () => {
  it("flags names in A that are absent from B without inventing rows", () => {
    const result = analyze([["Rahul"], ["Amit"]], [["Rahul", "1"]]);
    expect(result.missingInB).toEqual([{ aIndex: 1, name: "Amit", sheetRow: 3 }]);
    expect(result.matchedCount).toBe(1);
    expect(result.outputRows).toBe(1);
  });
});

describe("analyzeStructureMatch — duplicates", () => {
  it("flags a duplicated B name and does not move either row", () => {
    const result = analyze(
      [["Priya"]],
      [["Priya", "one"], ["Rahul", "two"], ["Priya", "three"]],
    );
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].key).toBe("priya");
    expect(result.matchedCount).toBe(0);
    // all three B rows stay at the top in original order
    expect(result.unmatchedBIndices).toEqual([0, 1, 2]);
    expect(result.ambiguousBIndices).toEqual([0, 2]);
  });

  it("flags a duplicated A name as ambiguous", () => {
    const result = analyze(
      [["Priya"], ["Rahul"], ["Priya"]],
      [["Priya", "1"], ["Rahul", "2"]],
    );
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.matchedCount).toBe(1); // only Rahul
    expect(result.unmatchedBIndices).toEqual([0]);
    expect(result.outputRows).toBe(2);
  });

  it("still matches every other unique name around a duplicate", () => {
    const result = analyze(
      [["Rahul"], ["Priya"], ["Neha"]],
      [["Neha", "1"], ["Priya", "2"], ["Priya", "3"], ["Rahul", "4"]],
    );
    expect(result.matchedCount).toBe(2);
    expect(result.matched.map((m) => m.name)).toEqual(["Rahul", "Neha"]);
    expect(result.unmatchedBIndices).toEqual([1, 2]);
  });
});

describe("analyzeStructureMatch — normalization", () => {
  it("matches despite case, padding and zero-width characters", () => {
    const result = analyze(
      [[" Rahul "], ["amit"]],
      [["AMIT\u00A0", "1"], ["Rahul", "2"]],
    );
    expect(result.matchedCount).toBe(2);
    expect(result.outputRows).toEqual(2);
  });

  it("never matches a spelling difference", () => {
    const result = analyze(
      [["Radhika Sharma"]],
      [["Radhika Shama", "1"]],
    );
    expect(result.matchedCount).toBe(0);
    expect(result.missingCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
  });
});

describe("analyzeStructureMatch — data preservation", () => {
  it("drops fully-empty rows and counts them", () => {
    const result = analyze(
      [["Rahul"]],
      [["Rahul", "1"], ["", "", ""], ["Karan", "2"]],
    );
    expect(result.emptyBRowsRemoved).toBe(1);
    expect(result.totalB).toBe(2);
    expect(result.outputRows).toBe(2);
  });

  it("keeps B rows without a name at the top and flags them", () => {
    const result = analyze(
      [["Rahul"]],
      [["Rahul", "1"], ["", "555-0100", "Mumbai"]],
    );
    expect(result.unnamedBRows).toEqual([1]);
    expect(result.unmatchedBIndices).toEqual([1]);
    expect(result.outputRows).toBe(2);
  });

  it("flags A rows without a name", () => {
    const result = analyze(
      [["Rahul"], ["", "x"]],
      [["Rahul", "1"]],
    );
    expect(result.unnamedARows).toEqual([1]);
    expect(result.matchedCount).toBe(1);
  });

  it("accounts for every non-empty B row in the output", () => {
    const result = analyze(PRD_A, PRD_B);
    const output = buildMatcherOutput(PRD_B, result);
    expect(output.rows).toHaveLength(result.totalB);
    const names = output.rows.map((r) => r[0]).sort();
    expect(names).toEqual(["Amit", "Karan", "Neha", "Priya", "Rahul", "Suresh"]);
  });

  it("handles a different name-column position in File B", () => {
    const aRows = [["Rahul"], ["Amit"]];
    const bRows = [["999", "Mumbai", "Amit"], ["333", "Delhi", "Rahul"]];
    const result = analyze(aRows, bRows, 0, 2);
    expect(result.matchedCount).toBe(2);
    const output = buildMatcherOutput(bRows, result);
    expect(output.rows).toEqual([
      ["333", "Delhi", "Rahul"],
      ["999", "Mumbai", "Amit"],
    ]);
  });
});

describe("buildMatcherOutput — manual pairs", () => {
  const MIXED_A = [["Rahul"], ["Amit"], ["Radhika Sharma"]];
  const MIXED_B = [
    ["Suresh", "111"],
    ["Amit", "222"],
    ["Radhika Shama", "333"], // spelling difference -> no auto match
  ];

  it("moves a manually linked pair despite a spelling difference", () => {
    const analysis = analyze(MIXED_A, MIXED_B);
    expect(analysis.matchedCount).toBe(1); // only Amit

    const output = buildMatcherOutput(MIXED_B, analysis, new Set<number>(), [
      { aIndex: 2, bIndex: 2 }, // Radhika Sharma -> Radhika Shama
    ]);
    expect(output.rows).toEqual([
      ["Suresh", "111"],
      ["Amit", "222"],
      ["Radhika Shama", "333"],
    ]);
    expect(output.segments).toEqual([
      { start: 0, end: 2, kind: "in-place" }, // Suresh kept; Amit kept (not selected)
      { start: 2, end: 3, kind: "moved" }, // manual pair only
    ]);
  });

  it("orders manual pairs into File A order together with auto matches", () => {
    const analysis = analyze(MIXED_A, MIXED_B);
    const output = buildMatcherOutput(MIXED_B, analysis, undefined, [{ aIndex: 2, bIndex: 2 }]);
    // Amit is A row 2 (aIndex 1), Radhika is A row 3 (aIndex 2) => Amit first.
    expect(output.rows).toEqual([
      ["Suresh", "111"],
      ["Amit", "222"],
      ["Radhika Shama", "333"],
    ]);
    expect(output.sourceIndices).toEqual([0, 1, 2]);
  });

  it("ignores manual pairs that collide with an automatic match", () => {
    const analysis = analyze(MIXED_A, MIXED_B);
    const output = buildMatcherOutput(MIXED_B, analysis, undefined, [
      { aIndex: 2, bIndex: 1 }, // B row 1 is already auto-matched to Amit
    ]);
    // Pair ignored: Radhika stays in place, Amit still moved.
    expect(output.rows).toEqual([
      ["Suresh", "111"],
      ["Radhika Shama", "333"],
      ["Amit", "222"],
    ]);
  });

  it("ignores duplicate and out-of-range manual pairs", () => {
    const analysis = analyze(MIXED_A, MIXED_B);
    const output = buildMatcherOutput(MIXED_B, analysis, undefined, [
      { aIndex: 2, bIndex: 2 },
      { aIndex: 0, bIndex: 2 }, // same B row again -> ignored
      { aIndex: 2, bIndex: 99 }, // out of range -> ignored
      { aIndex: 0, bIndex: -1 }, // invalid -> ignored
    ]);
    expect(output.sourceIndices).toEqual([0, 1, 2]);
    expect(output.segments).toEqual([
      { start: 0, end: 1, kind: "in-place" },
      { start: 1, end: 3, kind: "moved" },
    ]);
  });

  it("can move a specific duplicate B row by manual choice", () => {
    const analysis = analyze([["Priya"]], [["Priya", "one"], ["Priya", "two"]]);
    expect(analysis.matchedCount).toBe(0); // ambiguous, nothing auto-moves

    const output = buildMatcherOutput(
      [["Priya", "one"], ["Priya", "two"]],
      analysis,
      undefined,
      [{ aIndex: 0, bIndex: 1 }], // user picks the second Priya row
    );
    expect(output.rows).toEqual([
      ["Priya", "one"],
      ["Priya", "two"],
    ]);
    expect(output.segments).toEqual([
      { start: 0, end: 1, kind: "in-place" },
      { start: 1, end: 2, kind: "moved" },
    ]);
  });
});

describe("buildMatcherOutput — empty inputs", () => {
  it("returns empty output for empty inputs", () => {
    const result = analyze([], []);
    const output = buildMatcherOutput([], result);
    expect(output.rows).toEqual([]);
    expect(output.segments).toEqual([
      { start: 0, end: 0, kind: "in-place" },
      { start: 0, end: 0, kind: "moved" },
    ]);
  });
});
