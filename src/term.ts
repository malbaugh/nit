import { homedir } from "node:os";

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
export const step = (msg: string) => out(`  ${c.dim(`· ${msg}`)}`);
export const warn = (msg: string) => out(`  ${c.yellow("!")} ${msg}`);

/** Stops nit with one red line saying what went wrong and what to do. */
export function fail(msg: string): never {
  process.stderr.write(`\n  ${c.red("✕")} ${msg}\n\n`);
  process.exit(1);
}

/** A request the server couldn't handle: the message, then the stack dimmed. */
export function error(e: unknown) {
  const [first, ...rest] = (e instanceof Error ? (e.stack ?? e.message) : String(e)).split("\n");
  process.stderr.write(`  ${c.red("✕")} ${first}\n${c.dim(rest.slice(0, 6).join("\n"))}\n`);
}

/** What's under review and where to open it. */
export function banner(o: {
  title: string | null;
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

/** Single-key shortcuts while nit runs (when stdin is a terminal): o opens, q quits. */
export function keys(actions: Record<string, { label: string; run: () => void }>) {
  if (!process.stdin.isTTY) return;
  out(
    `  ${c.dim(
      Object.entries(actions)
        .map(([k, a]) => `${c.bold(k)}${c.dim(` ${a.label}`)}`)
        .join(c.dim(" · ")),
    )}`,
  );
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    // Raw mode swallows the signal, so ⌃C and ⌃D quit here.
    if (key === "\u0003" || key === "\u0004") process.exit(0);
    actions[key.toLowerCase()]?.run();
  });
}
