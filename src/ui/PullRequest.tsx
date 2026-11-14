import { Popover } from "@base-ui/react/popover";
import {
  CheckCircle,
  GitPullRequest,
  InfoCircle,
  MinusCircle,
  OpenNewWindow,
  WarningTriangle,
  XmarkCircle,
} from "iconoir-react/regular";
import { useState } from "react";
import type { Check, CheckAnnotation } from "../types";
import { Markdown } from "./Comments";
import * as st from "./state";

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

/**
 * The pull request this review is for, from the file list's header: its checks (what failed, what
 * still runs) and what the author wrote about it.
 */
export function PullRequestButton() {
  const gh = st.useStore((s) => (s.github?.status === "ready" ? s.github : null));
  if (!gh) return null;
  const state = overall(gh.checks);
  const failed = gh.checks.filter((c) => c.state === "failure").length;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex h-6 shrink-0 items-center gap-1.5 rounded-control px-1.5 text-[12px] text-ink-2 tabular-nums transition-[background-color,color] duration-100 [@media(hover:hover)]:hover:bg-hover-2 [@media(hover:hover)]:hover:text-ink data-popup-open:bg-hover-2"
        aria-label={`Pull request #${gh.pr.number}${failed ? `, ${failed} checks failed` : ""}`}
      >
        {state ? <span className={`size-1.5 rounded-full ${DOT[state]}`} /> : <GitPullRequest width={13} height={13} />}
        #{gh.pr.number}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="z-50 outline-none" sideOffset={6} align="start">
          <Popover.Popup className="flex max-h-[min(640px,80vh)] w-[min(460px,calc(100vw-24px))] origin-(--transform-origin) flex-col overflow-hidden rounded-card bg-surface shadow-overlay outline-none transition-[opacity,scale] duration-100 ease-out-strong data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <header className="px-3.5 pt-3 pb-2.5 shadow-[0_1px_0_var(--line)]">
              <Popover.Title className="text-[13.5px] font-medium text-ink">
                <a
                  href={gh.pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-baseline gap-1.5 [@media(hover:hover)]:hover:underline"
                >
                  {gh.pr.title} <span className="font-normal text-ink-3 tabular-nums">#{gh.pr.number}</span>
                  <OpenNewWindow width={11} height={11} className="shrink-0 self-center text-ink-3" />
                </a>
              </Popover.Title>
            </header>
            <div className="min-h-0 overflow-y-auto">
              {gh.checks.length ? <Checks checks={gh.checks} annotations={gh.annotations} /> : null}
              <section className="px-3.5 py-3 text-[13px]">
                {gh.body.trim() ? <Markdown source={gh.body} /> : <p className="text-ink-3">No description.</p>}
              </section>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
    <section className="py-1.5 shadow-[0_1px_0_var(--line)]">
      <div className="px-3.5 pt-1 pb-1 text-[11.5px] text-ink-3 tabular-nums">
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
