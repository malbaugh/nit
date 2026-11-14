import { Scroll, Sheet } from "@silk-hq/components";
import {
  CheckCircle,
  GitPullRequest,
  InfoCircle,
  MinusCircle,
  OpenNewWindow,
  WarningTriangle,
  Xmark,
  XmarkCircle,
} from "iconoir-react/regular";
import { useEffect, useRef, useState } from "react";
import type { Check, CheckAnnotation } from "../types";
import { ago, Markdown } from "./Comments";
import * as st from "./state";
import { IconButton, Kbd } from "./ui";

const CHECK_ICON: Record<Check["state"], React.ReactNode> = {
  success: <CheckCircle width={14} height={14} className="text-green" />,
  failure: <XmarkCircle width={14} height={14} className="text-red" />,
  pending: <span className="size-3 animate-spin rounded-full border-[1.5px] border-line-strong border-t-orange" />,
  neutral: <MinusCircle width={14} height={14} className="text-ink-3" />,
};

/** The one dot the header shows: red if anything failed, amber while anything runs, else green. */
function overall(checks: Check[]): Check["state"] | null {
  if (!checks.length) return null;
  if (checks.some((c) => c.state === "failure")) return "failure";
  if (checks.some((c) => c.state === "pending")) return "pending";
  return checks.some((c) => c.state === "success") ? "success" : "neutral";
}

const DOT: Record<Check["state"], string> = {
  failure: "bg-red",
  pending: "bg-orange",
  success: "bg-green",
  neutral: "bg-ink-3",
};

const PR_STATE = {
  OPEN: { label: "Open", tone: "bg-green-tint text-green" },
  DRAFT: { label: "Draft", tone: "bg-hover-2 text-ink-2" },
  MERGED: { label: "Merged", tone: "bg-accent-tint text-accent-ink" },
  CLOSED: { label: "Closed", tone: "bg-red-tint text-red" },
} as const;

/**
 * The pull request this review is for, from the file list's header: a dot for its checks, and the
 * drawer with what the author wrote, the checks and the Linear issue.
 */
export function PullRequestButton() {
  const gh = st.useStore((s) => (s.github?.status === "ready" ? s.github : null));
  const open = st.useStore((s) => s.prOpen);
  if (!gh) return null;
  const state = overall(gh.checks);
  const failed = gh.checks.filter((c) => c.state === "failure").length;
  return (
    <button
      type="button"
      onClick={() => st.set({ prOpen: true })}
      aria-expanded={open}
      aria-label={`Pull request #${gh.pr.number}${failed ? `, ${failed} checks failed` : ""}`}
      className={`flex h-6 shrink-0 items-center gap-1.5 rounded-control px-1.5 text-[12px] text-ink-2 tabular-nums transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink ${open ? "bg-hover-2" : ""}`}
    >
      {state ? <span className={`size-1.5 rounded-full ${DOT[state]}`} /> : <GitPullRequest width={13} height={13} />}#
      {gh.pr.number}
    </button>
  );
}

/** The pull request, read like a document: who opened it, what it's for, and whether CI agrees. */
export function PullRequestSheet() {
  const open = st.useStore((s) => s.prOpen);
  const gh = st.useStore((s) => (s.github?.status === "ready" ? s.github : null));
  const branch = st.useStore((s) => s.data?.branch);
  const base = st.useStore((s) => s.data?.base);
  const close = () => st.set({ prOpen: false });
  const state = gh
    ? PR_STATE[gh.draft && gh.pr.state === "OPEN" ? "DRAFT" : (gh.pr.state as keyof typeof PR_STATE)]
    : null;
  return (
    <Sheet.Root license="non-commercial" presented={open && !!gh} onPresentedChange={(p) => st.set({ prOpen: p })}>
      <Sheet.Portal>
        <Sheet.View contentPlacement="right" className="z-50">
          <Sheet.Backdrop className="bg-[oklch(0_0_0/0.28)]" />
          <Sheet.Content className="box-border flex h-svh w-[720px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-l-window bg-surface shadow-overlay">
            {gh ? (
              <>
                <header className="shrink-0 px-6 pt-4 pb-4 shadow-[0_1px_0_var(--line)]">
                  <div className="flex h-7 items-center gap-2">
                    {state ? (
                      <span
                        className={`flex h-5 items-center gap-1 rounded-chip px-1.5 text-[11.5px] font-medium ${state.tone}`}
                      >
                        <GitPullRequest width={12} height={12} />
                        {state.label}
                      </span>
                    ) : null}
                    <span className="text-[12.5px] text-ink-3 tabular-nums">#{gh.pr.number}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <a
                        href={gh.pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 items-center gap-1.5 rounded-control px-2 text-[12.5px] text-ink-2 transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink"
                      >
                        Open on GitHub <OpenNewWindow width={12} height={12} />
                      </a>
                      <Kbd k="Esc" quiet />
                      <IconButton label="Close" keys="Esc" onClick={close}>
                        <Xmark />
                      </IconButton>
                    </span>
                  </div>
                  <Sheet.Title className="mt-2 text-[19px] leading-snug font-semibold tracking-[-0.015em] text-balance text-ink">
                    {gh.pr.title}
                  </Sheet.Title>
                  <Sheet.Description className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-3">
                    {gh.author ? (
                      <>
                        <img src={gh.author.avatar} alt="" className="size-4 rounded-full" />
                        <span className="font-medium text-ink-2">{gh.author.login}</span>
                      </>
                    ) : null}
                    <span>opened {ago(gh.openedAt)}</span>
                    <span aria-hidden>·</span>
                    <code className="rounded-[5px] bg-hover px-1.5 font-mono text-[11.5px] text-ink-2">{branch}</code>
                    <span>into</span>
                    <code className="rounded-[5px] bg-hover px-1.5 font-mono text-[11.5px] text-ink-2">{base}</code>
                  </Sheet.Description>
                </header>
                <Scroll.Root className="min-h-0 flex-1">
                  <Scroll.View className="h-full w-full">
                    <Scroll.Content className="box-border w-full min-w-0 space-y-4 px-6 py-5">
                      <LinearIssueCard />
                      {gh.checks.length ? <Checks checks={gh.checks} annotations={gh.annotations} /> : null}
                      <section>
                        <h3 className="mb-2 text-[11.5px] font-medium text-ink-3">Description</h3>
                        <div className="doc">
                          {gh.body.trim() ? (
                            <Markdown source={gh.body} />
                          ) : (
                            <p className="text-[13px] text-ink-3">No description.</p>
                          )}
                        </div>
                      </section>
                    </Scroll.Content>
                  </Scroll.View>
                </Scroll.Root>
              </>
            ) : null}
          </Sheet.Content>
        </Sheet.View>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

/** Long text folded to a few lines that fade out, with Show more when there's more to show. */
function Clamped({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || open) return;
    // The Markdown renders late (lazy), so watch its size rather than measuring once.
    const watch = new ResizeObserver(() => setOver(el.scrollHeight > el.clientHeight + 1));
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    watch.observe(el);
    return () => watch.disconnect();
  }, [open]);
  return (
    <div className="mt-2 text-[13px]">
      <div ref={box} className={open ? "" : `max-h-28 overflow-hidden ${over ? "mask-b-from-60%" : ""}`}>
        <div>{children}</div>
      </div>
      {over && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-[12px] text-ink-3 [@media(hover:hover)]:hover:text-ink-2"
        >
          Show more
        </button>
      ) : null}
    </div>
  );
}

/** The Linear issue the branch is for: why the change exists, before what it does. */
function LinearIssueCard() {
  const link = st.useStore((s) => s.linear);
  if (!link) return null;
  const issue = link.issue;
  return (
    <section className="rounded-card px-3.5 py-3 shadow-[0_0_0_1px_var(--line)]">
      <a
        href={link.url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-2 text-[12.5px] [@media(hover:hover)]:hover:[&>.title]:underline"
      >
        {issue ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: issue.state.color }}
            title={issue.state.name}
          />
        ) : null}
        <span className="shrink-0 font-medium text-ink-2 tabular-nums">{link.key}</span>
        {issue ? <span className="title min-w-0 truncate text-ink">{issue.title}</span> : null}
        {issue ? <span className="shrink-0 text-[11.5px] text-ink-3">{issue.state.name}</span> : null}
        {link.url ? <OpenNewWindow width={11} height={11} className="ml-auto shrink-0 text-ink-3" /> : null}
      </a>
      {link.error ? (
        <p className="mt-1 text-[12px] text-red">{link.error}</p>
      ) : !link.hasKey ? (
        <p className="mt-1 text-[12px] text-ink-3">
          <button
            type="button"
            className="text-accent-ink [@media(hover:hover)]:hover:underline"
            onClick={() => st.set({ settingsOpen: true, settingsSection: "linear" })}
          >
            Add a Linear API key
          </button>{" "}
          to read the issue here.
        </p>
      ) : issue?.description?.trim() ? (
        <Clamped>
          <Markdown source={issue.description} />
        </Clamped>
      ) : null}
    </section>
  );
}

function Checks({ checks, annotations }: { checks: Check[]; annotations: CheckAnnotation[] }) {
  const done = checks.filter((c) => c.state === "success").length;
  const flagged = (name: string) => annotations.filter((a) => a.check === name && a.level !== "notice").length;
  // What needs you (failed, still running) is listed; passed and skipped fold into one row.
  const [all, setAll] = useState(false);
  const quiet = checks.filter((c) => c.state === "success" || c.state === "neutral").length;
  const shown = all ? checks : checks.filter((c) => c.state === "failure" || c.state === "pending");
  return (
    <section className="overflow-hidden rounded-card py-1.5 shadow-[0_0_0_1px_var(--line)]">
      <div className="px-3.5 pt-1 pb-1 text-[11.5px] font-medium text-ink-3 tabular-nums">
        Checks · {done} of {checks.length} passed
      </div>
      <ul>
        {shown.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: matrix jobs can share a name
          <li key={i}>
            <a
              href={c.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 items-center gap-2 px-3.5 text-[12.5px] [@media(hover:hover)]:hover:bg-hover"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">{CHECK_ICON[c.state]}</span>
              <span className="shrink-0 truncate text-ink-2">{c.name}</span>
              {c.summary ? <span className="min-w-0 truncate text-ink-3">{c.summary}</span> : null}
              {flagged(c.name) ? (
                <span className="ml-auto shrink-0 text-[11.5px] text-orange tabular-nums">
                  {flagged(c.name)} {flagged(c.name) === 1 ? "line" : "lines"}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
      {quiet && !all ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex h-7 w-full items-center gap-2 px-3.5 text-[12.5px] text-ink-3 tabular-nums [@media(hover:hover)]:hover:bg-hover [@media(hover:hover)]:hover:text-ink-2"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">{CHECK_ICON.success}</span>
          {done} passed{quiet > done ? `, ${quiet - done} skipped` : ""}
          <span className="ml-auto text-[11.5px]">Show</span>
        </button>
      ) : null}
    </section>
  );
}

const LEVEL = {
  failure: { icon: <XmarkCircle width={13} height={13} />, ink: "text-red", tint: "bg-red-tint" },
  warning: { icon: <WarningTriangle width={13} height={13} />, ink: "text-orange", tint: "bg-orange-tint" },
  notice: { icon: <InfoCircle width={13} height={13} />, ink: "text-ink-3", tint: "bg-inset" },
} as const;

/** What a CI check said about these lines, under them. */
export function CheckAnnotationRow({ id }: { id: string }) {
  const a = st.useStore((s) => (s.github?.status === "ready" ? s.github.annotations.find((x) => x.id === id) : null));
  if (!a) return null;
  const l = LEVEL[a.level];
  return (
    <div className="px-3 py-1 font-sans">
      <div className={`flex max-w-[780px] gap-2 rounded-control px-2.5 py-1.5 text-[12px] ${l.tint}`}>
        <span className={`mt-px shrink-0 ${l.ink}`}>{l.icon}</span>
        <div className="min-w-0">
          <span className="font-medium text-ink-2">{a.check}</span>
          {a.title ? <span className="text-ink-2"> · {a.title}</span> : null}
          <p className="whitespace-pre-wrap text-ink-2">{a.message}</p>
        </div>
      </div>
    </div>
  );
}
