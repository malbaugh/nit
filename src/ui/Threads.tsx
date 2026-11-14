import { ChatBubble, CheckCircle, OpenNewWindow, Undo } from "iconoir-react/regular";
import { useState } from "react";
import type { Thread, ThreadComment } from "../types";
import { ago, DraftView, Markdown } from "./Comments";
import * as st from "./state";
import { Button, Tooltip } from "./ui";

function Avatar({ c, size = 20 }: { c: ThreadComment; size?: number }) {
  const [broken, setBroken] = useState(false);
  return c.avatar && !broken ? (
    <img
      src={c.avatar}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 self-start rounded-full bg-hover object-cover shadow-[0_0_0_1px_var(--line)]"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center self-start rounded-full bg-hover-2 text-[10px] font-semibold text-ink-2 uppercase"
    >
      {c.author.slice(0, 1)}
    </span>
  );
}

function Comment({ c, path }: { c: ThreadComment; path: string }) {
  return (
    <div className="flex gap-2.5 py-2.5">
      <Avatar c={c} />
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-2 text-[12px]">
          <span className="font-medium text-ink">{c.author}</span>
          <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-ink-3 hover:text-ink-2">
            {ago(Date.parse(c.createdAt))}
          </a>
        </div>
        <div className="mt-0.5">
          <Markdown source={c.body} path={path} />
        </div>
      </div>
    </div>
  );
}

/** A review thread already on the pull request, shown under its line. */
export function ThreadAnnotation({ id }: { id: string }) {
  const thread = st.useStore((s) =>
    s.github?.status === "ready" ? s.github.threads.find((t) => t.id === id) : undefined,
  );
  const replyIds = st.useStore((s) =>
    s.drafts
      .filter((d) => d.replyTo === id)
      .map((d) => d.id)
      .join(","),
  );
  const focused = st.useStore((s) => s.focused === id);
  const [open, setOpen] = useState<boolean | null>(null);
  if (!thread) return null;
  const expanded = open ?? !thread.resolved;
  const first = thread.comments[0];

  return (
    <div className="px-3 py-1.5 font-sans">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click focuses the thread; r and x act on it */}
      <section
        aria-label={`Review thread by ${first?.author ?? "someone"}`}
        onClick={() => st.set({ focused: thread.id })}
        className={`max-w-[780px] overflow-hidden rounded-card bg-surface transition-shadow duration-150 ${
          focused ? "shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-tint)]" : "shadow-card"
        }`}
      >
        {expanded ? (
          <>
            <div className="divide-y divide-line px-3.5">
              {thread.comments.map((c) => (
                <Comment key={c.id} c={c} path={thread.path} />
              ))}
            </div>
            {replyIds
              ? replyIds.split(",").map((rid) => (
                  <div key={rid} className="px-3 pb-3">
                    <DraftView id={rid} />
                  </div>
                ))
              : null}
            <ThreadActions thread={thread} onCollapse={thread.resolved ? () => setOpen(false) : undefined} />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-10 w-full items-center gap-2.5 px-3.5 text-left text-[12.5px] transition-colors duration-100 [@media(hover:hover)]:hover:bg-hover"
          >
            <CheckCircle width={14} height={14} className="shrink-0 text-green" />
            <span className="shrink-0 font-medium text-ink-2">Resolved</span>
            {first ? (
              <span className="min-w-0 truncate text-ink-3">
                {first.author}: {first.body.split("\n")[0]}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-ink-3 tabular-nums">{thread.comments.length}</span>
          </button>
        )}
      </section>
    </div>
  );
}

function ThreadActions({ thread, onCollapse }: { thread: Thread; onCollapse?: () => void }) {
  const url = thread.comments[0]?.url;
  return (
    <div className="flex h-10 items-center gap-1.5 bg-inset px-2.5 shadow-[0_-1px_0_var(--line)]">
      <Tooltip label="Reply (posts with your review)" keys="r">
        <Button tone="ghost" onClick={() => st.replyTo(thread.id)}>
          <ChatBubble width={14} height={14} /> Reply
        </Button>
      </Tooltip>
      <Tooltip label={thread.resolved ? "Reopen" : "Resolve"} keys="x">
        <Button tone="ghost" onClick={() => void st.setThreadResolved(thread.id, !thread.resolved)}>
          {thread.resolved ? <Undo width={14} height={14} /> : <CheckCircle width={14} height={14} />}
          {thread.resolved ? "Reopen" : "Resolve"}
        </Button>
      </Tooltip>
      {thread.outdated ? (
        <span className="rounded-chip bg-hover-2 px-1.5 py-px text-[11px] text-ink-3">Outdated</span>
      ) : null}
      <span className="ml-auto flex items-center gap-1">
        {onCollapse ? (
          <Button tone="ghost" onClick={onCollapse}>
            Collapse
          </Button>
        ) : null}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-7 items-center gap-1.5 rounded-control px-2 text-[12px] text-ink-3 transition-colors duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
          >
            <OpenNewWindow width={13} height={13} /> GitHub
          </a>
        ) : null}
      </span>
    </div>
  );
}
