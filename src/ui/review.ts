import type { Draft } from "../types";

const where = (d: Draft) =>
  d.start === 0 ? "File" : d.start === d.end ? `Line ${d.end}` : `Lines ${d.start}–${d.end}`;

/**
 * All drafts as one Markdown document, grouped by file in review order, ready to paste into a
 * GitHub review or hand to an agent. Suggestions become GitHub `suggestion` blocks.
 */
export function draftsAsMarkdown(drafts: Draft[], order: string[]) {
  const rank = new Map(order.map((p, i) => [p, i]));
  const sorted = [...drafts].sort((a, b) => (rank.get(a.path) ?? 1e9) - (rank.get(b.path) ?? 1e9) || a.start - b.start);
  const out: string[] = [];
  let file = "";
  for (const d of sorted) {
    if (d.path !== file) {
      file = d.path;
      out.push(`### \`${file}\``, "");
    }
    out.push(`**${where(d)}${d.side === "deletions" ? " (removed code)" : ""}**`, "");
    if (d.body.trim()) out.push(d.body.trim(), "");
    if (d.suggestion !== null) out.push("```suggestion", d.suggestion, "```", "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
