import type { JSONContent } from "@tiptap/core";
export type RichDoc = JSONContent;
export const REPORT_FIELDS = ["work_completed", "labour", "issues"] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];
export type RichSections = Partial<Record<ReportField, RichDoc>>;
export const FONTS = [
  "Arial",
  "Calibri",
  "Aptos",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Courier New",
];
export const FONT_SIZES = [
  "8",
  "9",
  "10",
  "11",
  "12",
  "14",
  "16",
  "18",
  "20",
  "24",
  "28",
  "36",
];
export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2"];
export const PARAGRAPH_GAPS = ["0", "4", "8", "12", "18", "24"];
const nodes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const marks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textStyle",
]);
export function normalizeRich(value: unknown): RichDoc | null {
  let count = 0,
    exceeded = false;
  function clean(value: unknown, depth = 0): RichDoc | null {
    if (!value || typeof value !== "object") return null;
    if (depth > 40 || ++count > 20000) {
      exceeded = true;
      return null;
    }
    const n = value as JSONContent;
    if (typeof n.type !== "string" || !nodes.has(n.type)) return null;
    if (n.type === "text")
      return typeof n.text === "string" && n.text.length
        ? {
            type: "text",
            text: n.text,
            marks: (Array.isArray(n.marks) ? n.marks : [])
              .filter(
                (m) => m && typeof m.type === "string" && marks.has(m.type),
              )
              .map((m) => ({
                type: m.type,
                ...(m.type === "textStyle"
                  ? { attrs: styleAttrs(m.attrs || {}) }
                  : {}),
              })),
          }
        : null;
    const a = n.attrs || {},
      attrs: Record<string, unknown> = {};
    if (["paragraph", "heading"].includes(n.type)) {
      if (["left", "center", "right", "justify"].includes(a.textAlign))
        attrs.textAlign = a.textAlign;
      if (LINE_HEIGHTS.includes(String(a.lineHeight)))
        attrs.lineHeight = String(a.lineHeight);
      if (PARAGRAPH_GAPS.includes(String(a.spaceAfter)))
        attrs.spaceAfter = String(a.spaceAfter);
      if (Number.isInteger(a.indent) && a.indent >= 0 && a.indent <= 6)
        attrs.indent = a.indent;
    }
    if (n.type === "heading")
      attrs.level = [1, 2, 3].includes(a.level) ? a.level : 2;
    if (n.type === "orderedList")
      attrs.start =
        Number.isInteger(a.start) && a.start > 0 && a.start <= 9999
          ? a.start
          : 1;
    if (n.type === "tableCell" || n.type === "tableHeader") {
      for (const key of ["colspan", "rowspan"])
        attrs[key] =
          Number.isInteger(a[key]) && a[key] > 0 && a[key] <= 20 ? a[key] : 1;
      if (
        Array.isArray(a.colwidth) &&
        a.colwidth.length <= 20 &&
        a.colwidth.every(
          (w: unknown) => typeof w === "number" && w >= 30 && w <= 1200,
        )
      )
        attrs.colwidth = a.colwidth;
    }
    return {
      type: n.type,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(Array.isArray(n.content)
        ? {
            content: n.content
              .map((c) => clean(c, depth + 1))
              .filter((x): x is RichDoc => !!x),
          }
        : {}),
    };
  }
  const n = clean(value);
  return !exceeded && n?.type === "doc" ? n : null;
}
export function styleAttrs(a: Record<string, unknown>) {
  const attrs: Record<string, string> = {};
  const family = String(a.fontFamily || "").replace(/["']/g, "");
  if (FONTS.includes(family)) attrs.fontFamily = family;
  const size = String(a.fontSize || "");
  if (FONT_SIZES.map((x) => x + "pt").includes(size)) attrs.fontSize = size;
  else if (
    /^\d+(\.\d+)?px$/.test(size) &&
    parseFloat(size) >= 8 &&
    parseFloat(size) <= 48
  )
    attrs.fontSize = size;
  return attrs;
}
export function fromPlain(text: string): RichDoc {
  return {
    type: "doc",
    content: (text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  };
}
export function richToPlain(doc: RichDoc): string {
  function visit(n: RichDoc): string {
    if (n.type === "text") return n.text || "";
    if (n.type === "hardBreak") return "\n";
    const children = n.content || [];
    if (n.type === "tableRow") return children.map(visit).join("\t");
    if (n.type === "bulletList")
      return children.map((c) => "• " + visit(c)).join("\n");
    if (n.type === "orderedList")
      return children
        .map((c, i) => `${Number(n.attrs?.start || 1) + i}. ${visit(c)}`)
        .join("\n");
    return children
      .map(visit)
      .join(
        [
          "doc",
          "listItem",
          "blockquote",
          "table",
          "tableCell",
          "tableHeader",
        ].includes(n.type || "")
          ? "\n"
          : "",
      );
  }
  return visit(doc);
}
