"use client";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Extension, Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import {
  RichDoc,
  FONTS,
  FONT_SIZES,
  LINE_HEIGHTS,
  PARAGRAPH_GAPS,
  normalizeRich,
} from "../../lib/report-rich-text";
import "./report-text.css";
function paragraphFormat(editor: Editor, attrs: Record<string, unknown>) {
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { from, to } = state.selection;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (["paragraph", "heading"].includes(node.type.name))
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
      });
      return true;
    })
    .run();
}
function indent(editor: Editor, amount: number) {
  if (editor.isActive("listItem"))
    return amount > 0
      ? editor.chain().focus().sinkListItem("listItem").run()
      : editor.chain().focus().liftListItem("listItem").run();
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      state.doc.nodesBetween(
        state.selection.from,
        state.selection.to,
        (node, pos) => {
          if (["paragraph", "heading"].includes(node.type.name))
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indent: Math.max(
                0,
                Math.min(6, Number(node.attrs.indent || 0) + amount),
              ),
            });
        },
      );
      return true;
    })
    .run();
}
const Layout = Extension.create({
  name: "reportLayout",
  priority: 1000,
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: "1.15",
            parseHTML: (e) =>
              LINE_HEIGHTS.includes(e.style.lineHeight)
                ? e.style.lineHeight
                : "1.15",
            renderHTML: (a) => ({ style: `line-height:${a.lineHeight}` }),
          },
          spaceAfter: {
            default: "8",
            parseHTML: (e) =>
              PARAGRAPH_GAPS.includes(e.style.marginBottom.replace("pt", ""))
                ? e.style.marginBottom.replace("pt", "")
                : "8",
            renderHTML: (a) => ({ style: `margin-bottom:${a.spaceAfter}pt` }),
          },
          indent: {
            default: 0,
            parseHTML: (e) =>
              Math.max(
                0,
                Math.min(
                  6,
                  Math.round(parseFloat(e.style.marginLeft || "0") / 24),
                ),
              ),
            renderHTML: (a) => ({ style: `margin-left:${a.indent * 24}px` }),
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive("table")) return false;
        if (this.editor.isActive("listItem")) return indent(this.editor, 1);
        return this.editor.commands.insertContent({ type: "text", text: "\t" });
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("table")) return false;
        return indent(this.editor, -1);
      },
      "Mod-Enter": () => {
        (
          this.editor.view.dom
            .closest(".rich-editor")
            ?.querySelector("[data-after-editor]") as HTMLElement
        )?.focus();
        return true;
      },
    };
  },
});
export default function RichReportEditor({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: RichDoc;
  onChange: (value: RichDoc) => void;
  disabled?: boolean;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: false } }),
      Layout,
    ],
    content: value,
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "report-prose",
      },
    },
    onUpdate: ({ editor }) =>
      change.current(normalizeRich(editor.getJSON()) || editor.getJSON()),
  });
  useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            selection: editor.state.selection,
            doc: editor.state.doc,
            marks: editor.state.storedMarks,
          }
        : null,
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  const button = (
    name: string,
    fn: () => void,
    active = false,
    unavailable = false,
  ) => (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={active}
      disabled={disabled || unavailable}
      className={active ? "active" : ""}
      onMouseDown={(e) => e.preventDefault()}
      onClick={fn}
    >
      {name}
    </button>
  );
  if (!editor) return <div className="rich-editor">Loading editor…</div>;
  const a = editor.getAttributes(
      editor.isActive("heading") ? "heading" : "paragraph",
    ),
    text = editor.getAttributes("textStyle");
  return (
    <div className="rich-editor">
      <div
        className="rich-toolbar"
        role="group"
        aria-label={label + " formatting"}
      >
        <label>
          Font
          <select
            disabled={disabled}
            aria-label="Font"
            value={FONTS.includes(text.fontFamily) ? text.fontFamily : "Arial"}
            onChange={(e) =>
              editor.chain().focus().setFontFamily(e.target.value).run()
            }
          >
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          Size
          <select
            disabled={disabled}
            aria-label="Font size"
            value={
              FONT_SIZES.includes(String(text.fontSize).replace("pt", ""))
                ? String(text.fontSize).replace("pt", "")
                : "11"
            }
            onChange={(e) =>
              editor
                .chain()
                .focus()
                .setFontSize(e.target.value + "pt")
                .run()
            }
          >
            {FONT_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Style
          <select
            disabled={disabled}
            aria-label="Paragraph style"
            value={
              editor.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "p"
            }
            onChange={(e) =>
              e.target.value === "p"
                ? editor.chain().focus().setParagraph().run()
                : editor
                    .chain()
                    .focus()
                    .setHeading({ level: Number(e.target.value) as 1 | 2 | 3 })
                    .run()
            }
          >
            <option value="p">Normal</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
        </label>
        {button(
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {button(
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {button(
          "Underline",
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
        )}
        {button(
          "Bullets",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {button(
          "Numbering",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}
        {button("Indent", () => indent(editor, 1))}
        {button("Outdent", () => indent(editor, -1))}
        <label>
          Align
          <select
            disabled={disabled}
            aria-label="Alignment"
            value={a.textAlign || "left"}
            onChange={(e) =>
              editor.chain().focus().setTextAlign(e.target.value).run()
            }
          >
            {["left", "center", "right", "justify"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Line spacing
          <select
            disabled={disabled}
            aria-label="Line spacing"
            value={a.lineHeight || "1.15"}
            onChange={(e) =>
              paragraphFormat(editor, { lineHeight: e.target.value })
            }
          >
            {LINE_HEIGHTS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          After paragraph
          <select
            disabled={disabled}
            aria-label="Paragraph spacing"
            value={a.spaceAfter ?? "8"}
            onChange={(e) =>
              paragraphFormat(editor, { spaceAfter: e.target.value })
            }
          >
            {PARAGRAPH_GAPS.map((x) => (
              <option key={x} value={x}>
                {x} pt
              </option>
            ))}
          </select>
        </label>
        {button(
          "Undo",
          () => editor.chain().focus().undo().run(),
          false,
          !editor.can().undo(),
        )}
        {button(
          "Redo",
          () => editor.chain().focus().redo().run(),
          false,
          !editor.can().redo(),
        )}
        {button("Clear formatting", () => {
          editor.chain().focus().unsetAllMarks().clearNodes().run();
          paragraphFormat(editor, {
            lineHeight: "1.15",
            spaceAfter: "8",
            indent: 0,
            textAlign: "left",
          });
        })}
        {button(
          "Insert table",
          () =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
          false,
          editor.isActive("table"),
        )}
        {editor.isActive("table") && (
          <div className="rich-table-tools">
            {button("Add row", () =>
              editor.chain().focus().addRowAfter().run(),
            )}
            {button("Add column", () =>
              editor.chain().focus().addColumnAfter().run(),
            )}
            {button("Delete row", () =>
              editor.chain().focus().deleteRow().run(),
            )}
            {button("Delete column", () =>
              editor.chain().focus().deleteColumn().run(),
            )}
            {button(
              "Merge cells",
              () => editor.chain().focus().mergeCells().run(),
              false,
              !editor.can().mergeCells(),
            )}
            {button(
              "Split cell",
              () => editor.chain().focus().splitCell().run(),
              false,
              !editor.can().splitCell(),
            )}
            {button("Header row", () =>
              editor.chain().focus().toggleHeaderRow().run(),
            )}
            {button("Delete table", () => {
              if (window.confirm("Delete this table and its contents?"))
                editor.chain().focus().deleteTable().run();
            })}
          </div>
        )}
      </div>
      <EditorContent editor={editor} />
      <div className="rich-help">
        Enter: new paragraph · Shift+Enter: new line · Tab: tab / list indent /
        next table cell · Ctrl+Enter: leave editor{" "}
        <button
          data-after-editor
          type="button"
          onClick={(e) => e.currentTarget.focus()}
        >
          Done editing {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}
