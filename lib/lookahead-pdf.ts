import { LookaheadReport, daysBetween, validateLookahead } from "./lookahead";
import { holidayOn, isWorkDay, isoDay, shiftDate } from "./work-calendar";
import { readableDate, readableDateTime } from "./dates";
import type { jsPDF } from "jspdf";
const clean = (s: string) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\n\r\t\u00a0-\u00ff]/g, "?");
export async function createLookaheadPdf(report: LookaheadReport, providedFonts?: {regular:string;bold:string}) {
  validateLookahead(report.options);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "letter",
  });
  const o = report.options,
    W = 279.4,
    H = 215.9,
    M = 12;
  let first = true;
  async function loadFont(path:string){
    const response=await fetch(path);
    if(!response.ok)throw Error('PDF fonts could not load. Refresh and try again.');
    const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  const fonts=providedFonts||{regular:await loadFont('/fonts/FieldDocsSans.ttf'),bold:await loadFont('/fonts/FieldDocsSans-Bold.ttf')};
  doc.addFileToVFS('FieldDocsSans.ttf',fonts.regular);
  doc.addFont('FieldDocsSans.ttf','FieldDocs','normal');
  doc.addFileToVFS('FieldDocsSans-Bold.ttf',fonts.bold);
  doc.addFont('FieldDocsSans-Bold.ttf','FieldDocs','bold');
  doc.setFont('FieldDocs','normal');
  const numbers = new Map(report.tasks.map((t, i) => [t.id, i + 1]));
  const text = (s: string, x: number, y: number, size = 9) => {
    doc.setFontSize(size);
    doc.setTextColor(35, 50, 66);
    doc.text(clean(s), x, y);
  };
  const wrap = (s: string, width: number, size = 9): string[] => {
    doc.setFontSize(size);
    return doc.splitTextToSize(clean(s), width) as string[];
  };
  function page(title: string, subtitle: string) {
    if (!first) doc.addPage();
    first = false;
    doc.setFillColor(24, 60, 64);
    doc.rect(0, 0, W, 3, "F");
    text("I/C CONSTRUCTION  /  PROJECT LOOK-AHEAD", M, 12, 9);
    doc.setFont("FieldDocs", "bold");
    const projectLines = wrap(report.project, 250, 16);
    text(projectLines.slice(0, 2).join("\n"), M, 22, 16);
    doc.setFont("FieldDocs", "normal");
    text(title, M, projectLines.length > 1 ? 36 : 31, 11);
    text(subtitle, M, projectLines.length > 1 ? 42 : 37, 8);
    return projectLines.length > 1 ? 49 : 44;
  }
  function footer() {
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setDrawColor(210, 219, 228);
      doc.line(M, H - 17, W - M, H - 17);
      text(
        `Issued ${readableDateTime(report.issued)} | Schedule revision ${report.revision} | Page ${p} of ${n}`,
        M,
        H - 11,
        8,
      );
      text(
        "Saved schedule snapshot. Dates may change. Internal notes and personal to-dos are excluded.",
        M,
        H - 6,
        7,
      );
    }
  }
  const scope = `${readableDate(o.start, "always")} - ${readableDate(o.end, "always")} | ${report.tasks.length} activities | ${o.customerOnly ? "Customer-visible only" : "Selected project activities"}`;
  const colour = (
    t: LookaheadReport["tasks"][number],
  ): [number, number, number] =>
    t.status === "complete"
      ? [37, 131, 100]
      : o.critical && t.critical
        ? [201, 48, 55]
        : [45, 102, 203];
  const legend =
    "Blue: scheduled  |  Red: critical (if enabled)  |  Green: complete  |  Diamond: milestone  |  < / >: continues outside panel";
  if (!report.tasks.length) {
    page("No scheduled activities in this selection", scope);
    text(
      "Adjust the date range, visibility setting or filters and export again.",
      M,
      58,
    );
    footer();
    return doc;
  }
  if (o.format === "gantt") {
    for (let start = o.start; start <= o.end; start = shiftDate(start, 14)) {
      const end = shiftDate(start, 13) < o.end ? shiftDate(start, 13) : o.end,
        days = daysBetween(start, end) + 1,
        left = 100,
        cw = (W - M - left) / days;
      const rows = report.tasks.filter(
        (t) => t.start <= end && t.finish >= start,
      );
      let index = 0;
      do {
        let y = page("Gantt look-ahead", scope);
        text(
          `Panel: ${readableDate(start, "always")} - ${readableDate(end, "always")}`,
          M,
          y,
          9,
        );
        y += 5;
        const top = y;
        doc.setFillColor(238, 242, 247);
        doc.rect(M, y, W - M * 2, 12, "F");
        text("ACTIVITY / RESPONSIBILITY", M + 2, y + 8, 8);
        for (let d = 0; d < days; d++) {
          const date = shiftDate(start, d);
          if (!isWorkDay(date)) {
            doc.setFillColor(
              holidayOn(date) ? 255 : 225,
              holidayOn(date) ? 238 : 230,
              holidayOn(date) ? 208 : 236,
            );
            doc.rect(left + d * cw, y, cw, 12, "F");
          }
          text(
            isoDay(date).toLocaleDateString("en-US", {
              timeZone: "UTC",
              weekday: "short",
            }),
            left + d * cw + 1,
            y + 4,
            6,
          );
          text(
            `${Number(date.slice(8))}${holidayOn(date) ? "*" : ""}`,
            left + d * cw + 1,
            y + 9,
            8,
          );
        }
        y += 12;
        const positions = new Map<
          string,
          { x: number; finish: number; y: number }
        >();
        if (!rows.length) {
          text("No activities overlap this panel.", M, y + 10);
          y += 20;
        }
        while (index < rows.length) {
          const t = rows[index];
          const heading = wrap(`#${numbers.get(t.id)} ${t.name}`, 82, 9);
          const info = wrap(
            [
              o.responsible
                ? [t.trade, t.responsible_party].filter(Boolean).join(" / ")
                : "",
              o.progress ? `${t.progress}% complete` : "",
              `${readableDate(t.start, "never")} - ${readableDate(t.finish, "never")}`,
            ]
              .filter(Boolean)
              .join(" | "),
            82,
            7,
          );
          const rowH = Math.max(14, heading.length * 3.7 + info.length * 3 + 4);
          if (y + rowH > 177 && positions.size) break;
          const actualH = Math.min(rowH, 177 - y);
          const maxHeading = Math.max(1, Math.floor((actualH - 18) / 3.7));
          const visibleHeading = heading.slice(0, maxHeading),
            visibleInfo = info.slice(0, 3);
          if (heading.length > maxHeading)
            visibleHeading[visibleHeading.length - 1] += "...";
          text(visibleHeading.join("\n"), M + 2, y + 4, 9);
          text(
            visibleInfo.join("\n"),
            M + 2,
            y + 5 + visibleHeading.length * 3.7,
            7,
          );
          for (let d = 0; d < days; d++) {
            const date = shiftDate(start, d);
            if (!isWorkDay(date)) {
              doc.setFillColor(
                holidayOn(date) ? 255 : 245,
                holidayOn(date) ? 245 : 247,
                holidayOn(date) ? 226 : 250,
              );
              doc.rect(left + d * cw, y, cw, actualH, "F");
            }
            doc.setDrawColor(229, 234, 240);
            doc.line(left + d * cw, y, left + d * cw, y + actualH);
          }
          const a = t.start < start ? start : t.start,
            b = t.finish > end ? end : t.finish,
            x = left + daysBetween(start, a) * cw + 1,
            width = Math.max(2, (daysBetween(a, b) + 1) * cw - 2),
            mid = y + actualH / 2;
          doc.setFillColor(...colour(t));
          if (t.is_milestone) {
            doc.triangle(
              x + cw / 2,
              mid - 3,
              x + cw / 2 - 3,
              mid,
              x + cw / 2 + 3,
              mid,
              "F",
            );
            doc.triangle(
              x + cw / 2,
              mid + 3,
              x + cw / 2 - 3,
              mid,
              x + cw / 2 + 3,
              mid,
              "F",
            );
          } else {
            doc.roundedRect(x, mid - 2.5, width, 5, 1, 1, "F");
            if (o.progress && t.progress > 0) {
              doc.setFillColor(20, 50, 90);
              doc.rect(x, mid - 2.5, (width * t.progress) / 100, 1, "F");
            }
          }
          if (t.start < start) text("<", x, mid + 1, 8);
          if (t.finish > end) text(">", x + width - 2, mid + 1, 8);
          positions.set(t.id, { x, finish: x + width, y: mid });
          doc.setDrawColor(217, 225, 235);
          doc.line(M, y + actualH, W - M, y + actualH);
          y += actualH;
          index++;
        }
        if (o.dependencies) {
          doc.setDrawColor(90, 104, 120);
          doc.setLineWidth(0.25);
          for (const l of report.links) {
            const a = positions.get(l.predecessor_id),
              b = positions.get(l.successor_id);
            if (a && b) {
              const bend = Math.min(W - M - 1, a.finish + 2);
              doc.line(a.finish, a.y, bend, a.y);
              doc.line(bend, a.y, bend, b.y);
              doc.line(bend, b.y, b.x, b.y);
              doc.line(b.x, b.y, b.x - 1.2, b.y - 1);
              doc.line(b.x, b.y, b.x - 1.2, b.y + 1);
            }
          }
        }
        text(legend, M, 184, 7);
        const holidays = Array.from({ length: days }, (_, d) =>
          shiftDate(start, d),
        )
          .map((d) => holidayOn(d))
          .filter(Boolean);
        text(
          wrap(
            holidays
              .map((h) => `* ${readableDate(h!.date, "never")}: ${h!.name}`)
              .join(" | ") ||
              "Shaded columns: weekends. Holiday shading uses the project Ontario planning calendar.",
            250,
            7,
          )
            .slice(0, 2)
            .join("\n"),
          M,
          190,
          7,
        );
      } while (index < rows.length);
    }
  } else {
    // One week per page; spill crowded weeks onto continuation pages without dropping entries.
    const offset = (isoDay(o.start).getUTCDay() + 6) % 7;
    for (
      let monday = shiftDate(o.start, -offset);
      monday <= o.end;
      monday = shiftDate(monday, 7)
    ) {
      const days = Array.from({ length: 7 }, (_, n) => shiftDate(monday, n));
      const dayTasks = days.map((date) =>
        date < o.start || date > o.end
          ? []
          : report.tasks.filter(
              (t) =>
                t.start <= date &&
                t.finish >= date &&
                (isWorkDay(date) || t.is_milestone),
            ),
      );
      const cw = (W - 2 * M) / 7;
      const entries = dayTasks.map((ts) =>
        ts.map((t) => {
          const label = `#${numbers.get(t.id)} ${t.is_milestone ? "[M] " : ""}${t.start < o.start ? "< " : ""}${t.name}${t.finish > o.end ? " >" : ""}`;
          const lines = wrap(label, cw - 4, 8);
          const extra = wrap(
            [
              o.responsible
                ? [t.trade, t.responsible_party].filter(Boolean).join(" / ")
                : "",
              o.progress ? `${t.progress}%` : "",
            ]
              .filter(Boolean)
              .join(" | "),
            cw - 4,
            6.5,
          );
          return {
            task: t,
            lines,
            extra,
            h: Math.max(11, lines.length * 3.2 + extra.length * 2.7 + 4),
          };
        }),
      );
      const pointers = Array(7).fill(0);
      let part = 0;
      do {
        let y = page(
          `Calendar look-ahead - week of ${readableDate(monday, "always")}${part ? " (continued)" : ""}`,
          scope,
        );
        const header = y;
        const bottom = 178;
        days.forEach((date, d) => {
          const x = M + d * cw;
          const holiday = holidayOn(date),
            active = date >= o.start && date <= o.end;
          doc.setFillColor(
            !active ? 233 : !isWorkDay(date) ? 244 : 255,
            !active ? 235 : !isWorkDay(date) ? 245 : 255,
            !active ? 238 : !isWorkDay(date) ? 247 : 255,
          );
          doc.rect(x, y, cw, bottom - y, "F");
          doc.setDrawColor(207, 216, 227);
          doc.rect(x, y, cw, bottom - y);
          text(
            isoDay(date).toLocaleDateString("en-US", {
              timeZone: "UTC",
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
            x + 2,
            y + 5,
            8,
          );
          if (holiday)
            text(
              wrap(holiday.name, cw - 4, 6)
                .slice(0, 2)
                .join("\n"),
              x + 2,
              y + 10,
              6,
            );
          let ey = y + 18;
          while (pointers[d] < entries[d].length) {
            const e = entries[d][pointers[d]];
            const hh = Math.min(e.h, 105);
            if (ey + hh > bottom - 6) break;
            doc.setFillColor(...colour(e.task));
            doc.roundedRect(x + 1, ey, cw - 2, hh - 1, 1, 1, "F");
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.text(e.lines.slice(0, 22), x + 3, ey + 4);
            doc.setFontSize(6.5);
            doc.text(
              e.extra.slice(0, 6),
              x + 3,
              ey + 4 + Math.min(e.lines.length, 22) * 3.2,
            );
            ey += hh + 2;
            pointers[d]++;
          }
          if (pointers[d] < entries[d].length)
            text("Continues on next page", x + 2, bottom - 2, 6);
        });
        text(legend, M, 185, 6.5);
        text(
          "Tasks appear on working days. Shaded weekends / holidays are non-working days; milestones remain visible on their date.",
          M,
          191,
          7,
        );
        part++;
      } while (entries.some((list, d) => pointers[d] < list.length));
    }
  }
  // Full activity names, dates and selected dependency references provide traceability across page panels.
  let y = page("Activity register", scope);
  for (const t of report.tasks) {
    const deps = o.dependencies
      ? report.links
          .filter((l) => l.successor_id === t.id)
          .map(
            (l) =>
              `#${numbers.get(l.predecessor_id)} (${l.lag_work_days >= 0 ? "+" : ""}${l.lag_work_days} work days)`,
          )
          .join(", ")
      : "";
    const line = `#${numbers.get(t.id)} ${t.name}\n${readableDate(t.start, "always")} - ${readableDate(t.finish, "always")}${t.is_milestone ? " | Milestone" : ""}${o.critical && t.critical ? " | Critical" : ""}${o.responsible ? " | " + [t.trade, t.responsible_party].filter(Boolean).join(" / ") : ""}${o.progress ? " | " + t.progress + "% complete" : ""}${deps ? "\nPredecessors in this export: " + deps : ""}`;
    for (const linePart of wrap(line, 250, 9)) {
      if (y > 184) y = page("Activity register (continued)", scope);
      text(linePart, M, y, 9);
      y += 4.2;
    }
    y += 5;
  }
  footer();
  return doc;
}
export async function downloadLookahead(report: LookaheadReport) {
  const doc = await createLookaheadPdf(report);
  doc.save(
    `${report.project.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60)}_${report.options.start}_${report.options.format}_lookahead.pdf`,
  );
}
