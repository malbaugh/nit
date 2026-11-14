import { homedir } from "node:os";
import type { AgentEvent, AgentRun, Job } from "./types";

/**
 * Terminal output, kept plain: progress on stdout (stderr renders red in many terminals, so
 * normal steps looked like errors), failures alone on stderr in red. No colour when output
 * isn't a terminal or NO_COLOR is set.
 */
const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  cyan: paint("36"),
};

const out = (s = "") => process.stdout.write(`${s}\n`);
export const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
const width = () => Math.max(40, process.stdout.columns ?? 80);
const fit = (s: string, room: number) => (s.length > room ? `${s.slice(0, room - 1)}…` : s);

/** A step on the way to the review, dim: "· creating a worktree at …". */
export const step = (msg: string) => print(`  ${c.dim(`· ${msg}`)}`);
const warned = new Set<string>();
/** A warning, once per run: config is re-read often (settings, opening the editor). */
export const warn = (msg: string) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  print(`  ${c.yellow("!")} ${msg}`);
};

/** Stops nit with one red line saying what went wrong and what to do. */
export function fail(msg: string): never {
  process.stderr.write(`\n  ${c.red("✕")} ${msg}\n\n`);
  process.exit(1);
}

/** A request the server couldn't handle: the message, then the stack dimmed. */
export function error(e: unknown) {
  const [first, ...rest] = (e instanceof Error ? (e.stack ?? e.message) : String(e)).split("\n");
  log(
    `${c.red("✕")} ${first}`,
    rest.slice(0, 6).map((l) => c.dim(l.trim())),
  );
}

// ---------- while nit runs: a log of what happened, and one status line under it (TTY only)

const tty = process.stdout.isTTY === true;
const clock = () => new Date().toTimeString().slice(0, 5);
let hint = ""; // the keys, shown when nothing is running
let activity: { label: string; since: number; detail: string } | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function footer() {
  if (!activity) return hint;
  const secs = Math.round((Date.now() - activity.since) / 1000);
  const rest = [activity.label, duration(secs), activity.detail].filter(Boolean).join(" · ");
  return `  ${c.cyan(SPIN[Math.floor(Date.now() / 80) % SPIN.length])} ${c.dim(fit(rest, width() - 6))}`;
}
const redraw = () => tty && process.stdout.write(`\r\x1b[2K${footer()}`);
const clearFooter = () => tty && process.stdout.write("\r\x1b[2K");

/** One timestamped line (and dim detail lines) above the status line. */
export function log(msg: string, detail: string[] = []) {
  clearFooter();
  out(`  ${c.dim(clock())}  ${msg}`);
  for (const d of detail) out(`         ${d}`);
  redraw();
}

/** A plain line above the status line (it's cleared first and drawn again after). */
function print(line: string) {
  clearFooter();
  out(line);
  redraw();
}

const duration = (secs: number) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`);
const took = (from: number, to: number | null) => c.dim(duration(Math.round(((to ?? from) - from) / 1000)));

/** Claude is working: the status line spins and says on what until `idle()`. */
function busy(label: string, since: number) {
  activity = { label, since, detail: "" };
  ticker ??= setInterval(redraw, 80);
  ticker.unref?.();
  redraw();
}
function idle() {
  activity = null;
  clearInterval(ticker);
  ticker = undefined;
  redraw();
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const where = (j: Job) => (j.at ? `${j.at.path}:${j.at.start}${j.at.end !== j.at.start ? `-${j.at.end}` : ""}` : "");
const failed = (what: string, error: string | null) => log(`${c.red("✕")} ${what}: ${error ?? "unknown error"}`);

const running = new Set<string>();
function job(j: Job) {
  const what =
    j.kind === "review"
      ? "Claude reviewing the diff"
      : j.kind === "guide"
        ? "Claude ordering the files"
        : `Claude answering about ${where(j)}`;
  if (j.state === "running") {
    if (!running.has(j.id)) {
      running.add(j.id);
      log(`${c.dim("·")} ${what}`);
      busy(what, j.startedAt);
    }
    return;
  }
  if (!running.delete(j.id)) return;
  idle();
  if (j.state === "stopped") return log(`${c.dim("·")} stopped ${took(j.startedAt, j.endedAt)}`);
  if (j.state === "failed")
    return failed(j.kind === "review" ? "co-review" : j.kind === "guide" ? "guide" : "question", j.error);
  if (j.kind === "guide") return log(`${c.green("✓")} ordered the files ${took(j.startedAt, j.endedAt)}`);
  if (j.kind === "ask") return log(`${c.green("✓")} answered ${took(j.startedAt, j.endedAt)}`);
  const dropped = j.dropped.length ? c.dim(` · ${j.dropped.length} dropped by checks`) : "";
  log(`${c.green("✓")} proposed ${plural(j.found, "comment")}${dropped} ${took(j.startedAt, j.endedAt)}`);
}

function run(r: AgentRun) {
  const what = `Claude applying ${plural(r.drafts.length, "comment")}`;
  if (r.state === "running") {
    if (!running.has(r.id)) {
      running.add(r.id);
      log(`${c.dim("·")} ${what}`);
      busy(what, r.startedAt);
    }
    return;
  }
  if (!running.delete(r.id)) return;
  idle();
  if (r.state === "stopped")
    return log(`${c.dim("·")} stopped; what Claude changed is kept ${took(r.startedAt, r.endedAt)}`);
  if (r.state === "failed") return failed("apply", r.error);
  const done = r.outcomes.filter((o) => o.status === "done").length;
  log(
    `${c.green("✓")} applied ${done} of ${r.drafts.length} · ${plural(r.files.length, "file")} changed ${took(r.startedAt, r.endedAt)}`,
  );
}

/** Narrates the agent's events: a line when a pass starts and ends, its tools on the status line. */
export function agent(e: AgentEvent) {
  if (e.type === "job") job(e.job);
  else if (e.type === "run") run(e.run);
  else if (e.type === "tool" && activity) {
    activity.detail = `${e.tool.replace(/^mcp__nit__/, "")} ${e.target}`.trim();
    redraw();
  }
}

/** Library warnings (the SDK's, Node's) as one dim line each, not a raw block over the log. */
process.removeAllListeners("warning");
process.on("warning", (w) =>
  log(`${c.yellow("!")} ${c.dim(fit(`${w.name === "Warning" ? "" : `${w.name}: `}${w.message}`, width() - 14))}`),
);
// Leave the shell's prompt on a clean line.
process.on("exit", () => clearFooter());

/** What's under review and where to open it. */
export function banner(o: {
  title: string | null;
  pr: number | null;
  branch: string;
  base: string;
  files: number;
  add: number;
  del: number;
  url: string;
  root: string;
}) {
  const head = o.title ? fit(o.title, width() - 10) : `${o.branch} → ${o.base}`;
  const meta = [
    o.pr ? `#${o.pr}` : null,
    o.title ? `${o.branch} → ${o.base}` : null,
    `${o.files} ${o.files === 1 ? "file" : "files"}`,
    `${c.green(`+${o.add}`)} ${c.red(`−${o.del}`)}`,
  ].filter(Boolean);
  out();
  out(`  ${c.bold("nit")}  ${head}`);
  out(`       ${c.dim(meta.join("   "))}`);
  out();
  out(`  ${c.green("➜")}  ${c.cyan(o.url)}`);
  out(`     ${c.dim(tilde(o.root))}`);
  out();
}

/** Single-key shortcuts while nit runs (when stdin is a terminal), shown on the status line. */
export function keys(actions: Record<string, { label: string; run: () => void }>) {
  if (!process.stdin.isTTY) return;
  hint = `  ${Object.entries(actions)
    .map(([k, a]) => `${c.bold(k)} ${c.dim(a.label)}`)
    .join(c.dim("  ·  "))}`;
  redraw();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    // Raw mode swallows the signal, so ⌃C and ⌃D quit here.
    if (key === "\u0003" || key === "\u0004") process.exit(0);
    actions[key.toLowerCase()]?.run();
  });
}
