import { createElement, Fragment, ReactNode, CSSProperties } from "react";
import { RichDoc, normalizeRich, styleAttrs } from "../../lib/report-rich-text";
import "./report-text.css";
export default function ReportContent({
  value,
  text,
}: {
  value?: unknown;
  text?: string | null;
}) {
  const doc = normalizeRich(value);
  if (!doc)
    return <div className="report-prose report-plain">{text || "—"}</div>;
  function render(n: RichDoc, key: number): ReactNode {
    const a = n.attrs || {},
      children = n.content?.map(render),
      style: CSSProperties = {};
    if (["paragraph", "heading"].includes(n.type || "")) {
      if (a.textAlign) style.textAlign = a.textAlign;
      if (a.lineHeight) style.lineHeight = a.lineHeight;
      if (a.spaceAfter != null) style.marginBottom = a.spaceAfter + "pt";
      if (a.indent) style.marginLeft = a.indent * 24 + "px";
    }
    if (n.type === "text") {
      let out: ReactNode = n.text;
      for (const m of n.marks || []) {
        const tag = (
          {
            bold: "strong",
            italic: "em",
            underline: "u",
            strike: "s",
            code: "code",
          } as Record<string, string>
        )[m.type];
        out = tag ? (
          createElement(tag, {}, out)
        ) : m.type === "textStyle" ? (
          <span style={styleAttrs(m.attrs || {})}>{out}</span>
        ) : (
          out
        );
      }
      return <Fragment key={key}>{out}</Fragment>;
    }
    if (n.type === "doc") return <Fragment key={key}>{children}</Fragment>;
    if (n.type === "hardBreak") return <br key={key} />;
    if (n.type === "horizontalRule") return <hr key={key} />;
    if (n.type === "table")
      return (
        <div key={key} className="report-table-scroll">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      );
    if (n.type === "tableRow") return <tr key={key}>{children}</tr>;
    if (n.type === "tableCell" || n.type === "tableHeader")
      return createElement(
        n.type === "tableCell" ? "td" : "th",
        { key, colSpan: a.colspan, rowSpan: a.rowspan },
        children?.length ? (
          children
        ) : (
          <p>
            <br />
          </p>
        ),
      );
    if (n.type === "orderedList")
      return (
        <ol key={key} start={a.start || 1}>
          {children}
        </ol>
      );
    const tag = (
      {
        paragraph: "p",
        heading: "h" + a.level,
        bulletList: "ul",
        listItem: "li",
        blockquote: "blockquote",
        codeBlock: "pre",
      } as Record<string, string>
    )[n.type || ""];
    return tag
      ? createElement(tag, { key, style }, children?.length ? children : <br />)
      : null;
  }
  return <div className="report-prose">{render(doc, 0)}</div>;
}
