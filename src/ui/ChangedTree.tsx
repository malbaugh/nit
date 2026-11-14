import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeRowDecoration, GitStatus } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect } from "react";
import { stats } from "./lines";
import * as st from "./state";

const STATUS: Record<FileDiffMetadata["type"], GitStatus> = {
  new: "added",
  deleted: "deleted",
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
};

const statusOf = (files: FileDiffMetadata[]) => files.map((f) => ({ path: f.name, status: STATUS[f.type] }));

/** Draft count, then +/−; a viewed file shows a check and greys its counts. Reads the live store. */
function decoration({ item }: { item: { path: string; kind: string } }): FileTreeRowDecoration | null {
  if (item.kind !== "file") return null;
  const s = st.get();
  const file = s.files.find((f) => f.name === item.path);
  if (!file) return null;
  const { add, del } = stats(file);
  const viewed = s.viewed.has(item.path);
  const drafts = s.drafts.filter((d) => d.path === item.path).length;
  // Viewed is the one thing to see at a glance: a solid check replaces the counts.
  if (viewed) return { icon: { name: "nit-viewed", width: 14, height: 14 }, title: `Viewed · +${add} −${del}` };
  const parts = [
    ...(drafts ? [{ text: `${drafts}  `, color: "var(--orange)" }] : []),
    ...(add ? [{ text: `+${add}`, color: "var(--green)" }] : []),
    ...(add && del ? [{ text: " " }] : []),
    ...(del ? [{ text: `−${del}`, color: "var(--red)" }] : []),
  ];
  const title = [drafts ? `${drafts} draft comments` : "", `+${add} −${del}`].filter(Boolean).join(" · ");
  return { text: parts.map((p) => p.text).join(""), parts, title };
}

// The tree draws in its own shadow root; these map it onto nit's tokens and type.
const TREE_STYLE = {
  "--trees-font-family-override": "var(--font-sans)",
  "--trees-font-size-override": "12.5px",
  "--trees-fg-override": "var(--ink-2)",
  "--trees-fg-muted-override": "var(--ink-3)",
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--hover)",
  "--trees-accent-override": "var(--accent)",
  "--trees-border-color-override": "var(--line)",
  "--trees-selected-bg-override": "var(--hover-2)",
  "--trees-selected-fg-override": "var(--ink)",
  "--trees-selected-focused-border-color-override": "transparent",
  "--trees-focus-ring-color-override": "color-mix(in oklch, var(--accent) 70%, transparent)",
  "--trees-git-added-color-override": "var(--green)",
  "--trees-git-modified-color-override": "var(--ink-3)",
  "--trees-git-deleted-color-override": "var(--red)",
  "--trees-git-renamed-color-override": "var(--accent-ink)",
  "--trees-status-added-override": "var(--green)",
  "--trees-status-modified-override": "var(--ink-3)",
  "--trees-status-deleted-override": "var(--red)",
  "--trees-status-renamed-override": "var(--accent-ink)",
  "--trees-padding-inline-override": "6px",
  "--trees-scrollbar-thumb-override": "var(--line-strong)",
} as React.CSSProperties;

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute"><symbol id="nit-viewed" viewBox="0 0 16 16">
<circle cx="8" cy="8" r="7" fill="var(--green)"/>
<path d="M4.9 8.3l2 2 4.2-4.5" fill="none" stroke="var(--page)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</symbol></svg>`;

// Counts never give way to a long name: the name truncates instead.
const TREE_CSS = `
[data-item-section="decoration"] { flex: 0 0 auto; overflow: visible; }
[data-item-section="decoration"] > span {
  max-width: none; font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums;
}`;

/** The review's changed files as a tree (Pierre Trees). Selecting a file opens it. */
export function ChangedTree() {
  const files = st.useStore((s) => s.files);
  const current = st.useStore((s) => st.currentFile(s)?.name);
  const viewed = st.useStore((s) => s.viewed);
  const drafts = st.useStore((s) => s.drafts);

  const { model } = useFileTree({
    paths: st.get().files.map((f) => f.name),
    presorted: true, // the store keeps files in tree order (lines.treeOrder)
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    itemHeight: 28,
    gitStatus: statusOf(st.get().files),
    renderRowDecoration: decoration,
    unsafeCSS: TREE_CSS,
    icons: { set: "complete", colored: true, spriteSheet: SPRITE },
    onSelectionChange: (paths) => {
      const path = paths.at(-1);
      const s = st.get();
      const index = path ? s.files.findIndex((f) => f.name === path) : -1;
      if (index === -1 || (index === s.current && !s.browse)) return;
      st.openFile(index);
      // Hand the keyboard back to the review: nit's single-letter keys would otherwise go to
      // the tree's type-to-find.
      if (document.activeElement?.tagName === "FILE-TREE-CONTAINER") (document.activeElement as HTMLElement).blur();
    },
  });

  // A new patch (a reload that changed files) replaces the tree's paths and statuses.
  useEffect(() => {
    model.resetPaths(files.map((f) => f.name));
    model.setGitStatus(statusOf(files));
  }, [model, files]);

  // Drafts and viewed marks live in the decorations, which read the store when drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw when either changes
  useEffect(() => {
    model.setComposition(model.getComposition());
  }, [model, viewed, drafts, files]);

  // Keyboard and palette moves select the file in the tree and keep it in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: files changing can re-add the path
  useEffect(() => {
    if (!current) return;
    for (const p of model.getSelectedPaths()) if (p !== current) model.getItem(p)?.deselect();
    model.getItem(current)?.select();
    model.focusPath(current); // the tree's own focus, so a redraw can't re-select an old row
    model.scrollToPath(current, { focus: false, offset: "nearest" });
  }, [model, current, files]);

  return <FileTree model={model} className="min-h-0 flex-1" style={TREE_STYLE} />;
}
