/* Integration smoke test for Structure Matcher (run with plain node).
 * 1. Writes File A / File B as real .xlsx and .csv files.
 * 2. Reads them with the compiled main-process reader (excel.js).
 * 3. Runs the compiled engine (structureMatcher.js) and verifies the output.
 * 4. Builds an export workbook exactly like matcher.ts does and re-reads it. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const XLSX = require("xlsx");
const { readSheet } = require("../dist/electron/main/excel.js");
const {
  analyzeStructureMatch,
  buildMatcherOutput,
} = require("../dist/electron/shared/structureMatcher.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "structure-matcher-"));
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };

// --- write File A (xlsx) ---
const aRows = [
  ["Name", "Note"],
  ["Rahul", "first"],
  ["Amit", ""],
  ["Priya", "third"],
  ["Neha", "fourth"],
];
const wbA = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbA, XLSX.utils.aoa_to_sheet(aRows), "Ref");
const pathA = path.join(tmp, "Reference.xlsx");
XLSX.writeFile(wbA, pathA);

// --- write File B (csv, deliberately in scrambled order) ---
const pathB = path.join(tmp, "Source.csv");
fs.writeFileSync(pathB, [
  "Name,Phone,City",
  "Suresh,111,Mumbai",
  "Priya,222,Pune",
  "Rahul,333,Delhi",
  "Karan,444,Nashik",
  ",555-0100,Mumbai",      // unnamed row -> kept, flagged
  "Neha,666,Mumbai",
  "Amit,777,Pune",
].join("\n"));

// --- read with the real reader ---
const a = readSheet({ filename: "Reference.xlsx", fullPath: pathA, kind: "xlsx", matchedDate: "" }, 0);
const b = readSheet({ filename: "Source.csv", fullPath: pathB, kind: "csv", matchedDate: "" }, 0);
assert(a.headers.join("|") === "Name|Note", "File A headers detected");
assert(b.headers.join("|") === "Name|Phone|City", "File B headers detected");
assert(a.rows.length === 4, `File A data rows = ${a.rows.length}`);

// --- analyze + build output ---
const analysis = analyzeStructureMatch({
  aRows: a.rows, aNameColumn: 0, bRows: b.rows, bNameColumn: 0,
});
assert(analysis.matchedCount === 4, `matched = ${analysis.matchedCount}`);
assert(analysis.unmatchedCount === 3, `unmatched = ${analysis.unmatchedCount}`); // Suresh, Karan + unnamed row
assert(analysis.unnamedBRows.length === 1, "unnamed B row flagged");
assert(analysis.duplicateNameCount === 0 && analysis.missingCount === 0, "no duplicates / missing");

const output = buildMatcherOutput(b.rows, analysis);
const expected = [
  ["Suresh", "111", "Mumbai"],
  ["Karan", "444", "Nashik"],
  ["", "555-0100", "Mumbai"],
  ["Rahul", "333", "Delhi"],
  ["Amit", "777", "Pune"],
  ["Priya", "222", "Pune"],
  ["Neha", "666", "Mumbai"],
];
assert(JSON.stringify(output.rows) === JSON.stringify(expected), "output order matches PRD rules");

// --- build the export exactly like matcher.ts, then re-read it ---
const ws = XLSX.utils.aoa_to_sheet([b.headers, ...output.rows]);
const wbOut = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbOut, ws, "Matched Output");
const pathOut = path.join(tmp, "Source - Reordered.xlsx");
XLSX.writeFile(wbOut, pathOut);
const roundTrip = readSheet({ filename: "Source - Reordered.xlsx", fullPath: pathOut, kind: "xlsx", matchedDate: "" }, 0);
assert(roundTrip.headers.join("|") === "Name|Phone|City", "export headers preserved");
assert(JSON.stringify(roundTrip.rows) === JSON.stringify(expected), "export rows round-trip correctly");

// --- verify inputs untouched ---
const wbACheck = XLSX.readFile(pathA);
assert(JSON.stringify(XLSX.utils.sheet_to_json(wbACheck.Sheets.Ref, { header: 1 })) ===
  JSON.stringify(aRows), "File A unchanged");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\nAll integration checks passed.");
