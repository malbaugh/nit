import { Scroll, Sheet } from "@silk-hq/components";
import { Copy, EditPencil, Xmark } from "iconoir-react/regular";
import { useMemo } from "react";
import type { Draft } from "../types";
import { splitLabel } from "./Comments";
import { draftsAsMarkdown } from "./review";
import * as st from "./state";
import { Button, basename, dirname, IconButton, Kbd } from "./ui";

const labelTone: Record<string, string> = {
  blocking: "bg-red-tint text-red",
  issue: "bg-red-tint text-red",
  question: "bg-accent-tint text-accent-ink",
  suggestion: "bg-green-tint text-green",
  praise: "bg-green-tint text-green",
};

const where = (d: Draft) => (d.start === 0 ? "File" : d.start === d.end ? `L${d.end}` : `L${d.start}–${d.end}`);

/** First line of a comment as plain text, for the list. */
const preview = (body: string) =>
  (body.split("\n").find((l) => l.trim()) ?? "")
    .replace(/`|\*\*|__|~~/g, "")
    .replace(/^\s*(#+|>|[-*+]( \[[ xX]\])?)\s+/, "")
    .trim();

async function copyAll() {
  const { drafts, files } = st.get();
  try {
    await navigator.clipboard.writeText(
      draftsAsMarkdown(
        drafts,
        files.map((f) => f.name),
      ),
    );
    st.toast(`Copied ${drafts.length} ${drafts.length === 1 ? "comment" : "comments"} as Markdown`);
  } catch {
    st.toast("Couldn't copy to the clipboard.");
  }
}

/**
 * Every draft in the review, grouped by file: check your review before it leaves your machine.
 * A Silk sheet from the right (non-commercial licence: nit is a personal open-source tool).
 */
export function ReviewSheet() {
  const open = st.useStore((s) => s.reviewOpen);
  const drafts = st.useStore((s) => s.drafts);
  const files = st.useStore((s) => s.files);

  const groups = useMemo(() => {
    const order = new Map(files.map((f, i) => [f.name, i]));
    const byFile = Map.groupBy(drafts, (d) => d.path);
    return [...byFile.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9))
      .map(([path, list]) => ({ path, list: list.toSorted((a, b) => a.start - b.start) }));
  }, [drafts, files]);

  const go = (d: Draft) => {
    st.set({ reviewOpen: false });
    st.focusDraft(d.id);
  };

  return (
    <Sheet.Root license="non-commercial" presented={open} onPresentedChange={(p) => st.set({ reviewOpen: p })}>
      <Sheet.Portal>
        <Sheet.View contentPlacement="right" className="z-50">
          <Sheet.Backdrop className="bg-[oklch(0_0_0/0.28)]" />
          <Sheet.Content className="box-border flex h-svh w-[460px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-l-window bg-surface shadow-overlay">
            <header className="flex h-14 shrink-0 items-center gap-3 px-4 shadow-[0_1px_0_var(--line)]">
              <div className="min-w-0 flex-1">
                <Sheet.Title className="text-[14px] font-medium text-ink">Review</Sheet.Title>
                <Sheet.Description className="text-[12px] text-ink-3 tabular-nums">
                  {drafts.length} {drafts.length === 1 ? "comment" : "comments"} in {groups.length}{" "}
                  {groups.length === 1 ? "file" : "files"}
                </Sheet.Description>
              </div>
              <Kbd k="Esc" quiet />
              <IconButton label="Close" keys="Esc" onClick={() => st.set({ reviewOpen: false })}>
                <Xmark />
              </IconButton>
            </header>

            <Scroll.Root className="min-h-0 flex-1">
              <Scroll.View className="h-full w-full">
                <Scroll.Content className="box-border w-full min-w-0 p-2">
                  {groups.length ? null : (
                    <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
                      <span className="text-ink-2">No comments yet</span>
                      <span className="text-[12px] text-ink-3">
                        Press <Kbd k="c" /> on a line to start one.
                      </span>
                    </div>
                  )}
                  {groups.map(({ path, list }) => (
                    <section key={path} className="mb-2">
                      <div className="flex h-8 items-baseline gap-1.5 px-2 pt-2">
                        <span className="shrink-0 text-[12.5px] font-medium text-ink">{basename(path)}</span>
                        <span className="min-w-0 truncate text-[12px] text-ink-3">
                          {dirname(path).replace(/\/$/, "")}
                        </span>
                        <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{list.length}</span>
                      </div>
                      {list.map((d) => {
                        const { label, rest } = splitLabel(d.body);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => go(d)}
                            className="flex w-full items-start gap-2.5 rounded-control px-2 py-2 text-left transition-[background-color] duration-100 [@media(hover:hover)]:hover:bg-hover"
                          >
                            <span className="mt-px w-12 shrink-0 font-mono text-[11.5px] text-ink-3 tabular-nums">
                              {where(d)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                {label ? (
                                  <span
                                    className={`shrink-0 rounded-chip px-1.5 py-px text-[11px] font-medium ${labelTone[label] ?? "bg-hover-2 text-ink-2"}`}
                                  >
                                    {label}
                                  </span>
                                ) : null}
                                <span className="truncate text-[13px] text-ink">
                                  {preview(rest) || (d.suggestion !== null ? "Suggested change" : "Empty comment")}
                                </span>
                              </span>
                              {d.suggestion !== null ? (
                                <span className="mt-1 flex items-center gap-1 text-[11.5px] text-green">
                                  <EditPencil width={12} height={12} /> Suggests a change
                                </span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                </Scroll.Content>
              </Scroll.View>
            </Scroll.Root>

            <footer className="flex h-14 shrink-0 items-center gap-3 bg-inset px-4 shadow-[0_-1px_0_var(--line)]">
              <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                <Kbd k="Mod+Shift+Enter" quiet /> toggles this
              </span>
              <Button tone="primary" className="ml-auto" onClick={copyAll} disabled={!drafts.length}>
                <Copy width={14} height={14} /> Copy as Markdown
              </Button>
            </footer>
          </Sheet.Content>
        </Sheet.View>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
