import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

function reqLines(reqSet) {
  const lines = [];
  lines.push("Functional Requirements:");
  for (const fr of reqSet.functional_requirements || []) {
    lines.push(`  [${fr.id}]${fr.is_vague ? " (VAGUE)" : ""} ${fr.text}`);
  }
  lines.push("");
  lines.push("Non-Functional Requirements:");
  for (const nfr of reqSet.non_functional_requirements || []) {
    lines.push(`  [${nfr.id}] (${nfr.category})${nfr.is_vague ? " (VAGUE)" : ""} ${nfr.text}`);
  }
  return lines;
}

function buildTextReport({ withoutClar, withClar, evaluation }) {
  const lines = [];
  lines.push("REQUIREMENT ANALYSIS REPORT");
  lines.push("=".repeat(40));
  lines.push("");
  lines.push("--- WITHOUT CLARIFICATION ---");
  lines.push(...reqLines(withoutClar));
  lines.push("");
  lines.push("--- WITH CLARIFICATION ---");
  lines.push(...reqLines(withClar));
  lines.push("");
  lines.push("--- QUALITY EVALUATION ---");
  lines.push(JSON.stringify(evaluation, null, 2));
  return lines.join("\n");
}

export function exportAsTxt({ withoutClar, withClar, evaluation }, outPath) {
  fs.writeFileSync(outPath, buildTextReport({ withoutClar, withClar, evaluation }), "utf-8");
  return outPath;
}

export function exportAsPdf({ withoutClar, withClar, evaluation }, outPath) {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(outPath));

  doc.fontSize(18).text("Requirement Analysis Report", { underline: true });
  doc.moveDown();

  doc.fontSize(14).text("Without Clarification", { underline: true });
  doc.fontSize(10);
  reqLines(withoutClar).forEach((l) => doc.text(l));
  doc.moveDown();

  doc.fontSize(14).text("With Clarification", { underline: true });
  doc.fontSize(10);
  reqLines(withClar).forEach((l) => doc.text(l));
  doc.moveDown();

  doc.fontSize(14).text("Quality Evaluation", { underline: true });
  doc.fontSize(10).text(JSON.stringify(evaluation, null, 2));

  doc.end();
  return outPath;
}

export async function exportAsDocx({ withoutClar, withClar, evaluation }, outPath) {
  const section = (title, reqSet) => [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: "Functional Requirements", heading: HeadingLevel.HEADING_2 }),
    ...(reqSet.functional_requirements || []).map(
      (fr) =>
        new Paragraph({
          children: [new TextRun(`[${fr.id}]${fr.is_vague ? " (VAGUE)" : ""} ${fr.text}`)],
        })
    ),
    new Paragraph({ text: "Non-Functional Requirements", heading: HeadingLevel.HEADING_2 }),
    ...(reqSet.non_functional_requirements || []).map(
      (nfr) =>
        new Paragraph({
          children: [new TextRun(`[${nfr.id}] (${nfr.category})${nfr.is_vague ? " (VAGUE)" : ""} ${nfr.text}`)],
        })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Requirement Analysis Report", heading: HeadingLevel.TITLE }),
          ...section("Without Clarification", withoutClar),
          ...section("With Clarification", withClar),
          new Paragraph({ text: "Quality Evaluation", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: JSON.stringify(evaluation, null, 2) }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}
