import { AlignmentType, Document, Packer, Paragraph, TextRun, UnderlineType } from "docx";
import type { SevaDocxRequest } from "../shared/types";

/**
 * Writes an editable Word document for the seva list or an announcement.
 *
 * The page is A4 landscape to match what the screen shows. The editor uses
 * points, while Word stores font sizes as half-points (pt × 2).
 */

const HEADING_BROWN = "7A3B12";
const NOTE_BROWN = "5A4328";
const NOTICE_FONT = "Bell MT";

const A4_LANDSCAPE = {
  orientation: "landscape" as const,
  width: 16838,
  height: 11906,
};

function halfPoints(points: number): number {
  return Math.max(8, Math.round(points * 2));
}

function parenthesizeNote(note: string): string {
  const text = note.trim();
  return text.startsWith("(") && text.endsWith(")") ? text : `(${text})`;
}

export async function buildSevaDocx(request: SevaDocxRequest): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (request.date?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: request.date.trim(),
            bold: true,
            underline: { type: UnderlineType.SINGLE },
            font: NOTICE_FONT,
            size: halfPoints(request.dateSize ?? 22),
            color: HEADING_BROWN,
          }),
        ],
      }),
    );
  }

  if (request.text) {
    for (const line of request.text.split("\n")) {
      children.push(
        new Paragraph({
          spacing: { after: line.trim() ? 60 : 120 },
          children: [new TextRun({ text: line, font: NOTICE_FONT, size: 24 })],
        }),
      );
    }
  }

  for (const section of request.sections ?? []) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 260, after: 120 },
        children: [
          new TextRun({
            text: section.heading,
            bold: true,
            underline: { type: UnderlineType.SINGLE },
            font: NOTICE_FONT,
            size: halfPoints(section.headingSize ?? 13),
            color: HEADING_BROWN,
          }),
        ],
      }),
    );
    for (const entry of section.entries) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: entry.note?.trim() ? 40 : 140 },
          children: [
            new TextRun({
              text: entry.name.toUpperCase(),
              bold: true,
              font: "Algerian",
              size: halfPoints(entry.size ?? 48),
            }),
          ],
        }),
      );
      if (entry.note?.trim()) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: parenthesizeNote(entry.note),
                italics: true,
                font: NOTICE_FONT,
                size: halfPoints(entry.noteSize ?? 11),
                color: NOTE_BROWN,
              }),
            ],
          }),
        );
      }
    }
  }

  if (request.footer?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 320 },
        children: [
          new TextRun({ text: request.footer.trim(), bold: true, font: NOTICE_FONT, size: halfPoints(request.footerSize ?? 11) }),
        ],
      }),
    );
  }

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: A4_LANDSCAPE,
            margin: { top: 900, bottom: 900, left: 960, right: 960 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
