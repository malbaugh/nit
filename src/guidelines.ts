import { dirname, join, normalize } from "node:path";
import { $ } from "bun";

/**
 * The project's own review guidelines, read from the base ref so a pull request can't rewrite
 * the rules it's reviewed against (as Qodo and Claude Code Review do). Picks, for the files the
 * diff touches:
 * - AGENTS.md, CLAUDE.md, REVIEW.md and BUGBOT.md at the root and in every directory above a
 *   changed file (nearest wins, as agents.md specifies), with `@file` imports followed once;
 * - .claude/rules/*.md whose `paths:` globs match a changed file (no `paths:` = everywhere);
 * - .github/copilot-instructions.md, and .github/instructions/*.instructions.md by `applyTo`;
 * - .cursor/BUGBOT.md.
 */

export type Guideline = {
  path: string;
  text: string;
  /** Changed files this applies to. */
  scope: string[];
  /** Nearer and more narrowly scoped guidance ranks higher; the top fits in the prompt. */
  rank: number;
  /** First heading, for the index of guidelines that didn't fit. */
  title: string;
  /** The untrimmed text, when `text` was trimmed for the prompt. */
  full?: string;
};

/**
 * `inline` goes into the prompt in full; `indexed` is listed by path and title, and the agent
 * reads one through the read_guideline tool (served from the base ref, never the checkout).
 */
export type Guidelines = { inline: Guideline[]; indexed: Guideline[]; ref: string };

const DIR_FILES = ["AGENTS.md", "CLAUDE.md", "REVIEW.md", "BUGBOT.md"];
const PER_FILE = 30_000;
/** Roughly 15k tokens of guidelines in every prompt; the rest is one tool call away. */
const INLINE = 60_000;
const INLINE_EACH = 16_000;

/** Literal directory depth before a glob's first wildcard: `packages/ee/src/onshape/**` → 4. */
const specificity = (glob: string) => {
  const literal = glob.split(/[*?[{]/)[0];
  return literal.split("/").filter(Boolean).length;
};

/** Paths in a patch, new side (a deleted file's old path). */
export function changedPaths(patch: string) {
  const out = new Set<string>();
  for (const m of patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) out.add(m[2] === "/dev/null" ? m[1] : m[2]);
  return [...out];
}

/** Reads many blobs at `ref` in one git process. Missing paths come back undefined. */
async function readAll(root: string, ref: string, paths: string[]) {
  const got = new Map<string, string>();
  if (!paths.length) return got;
  const proc = Bun.spawn(["git", "cat-file", "--batch"], { cwd: root, stdin: "pipe", stdout: "pipe" });
  proc.stdin.write(paths.map((p) => `${ref}:${p}\n`).join(""));
  await proc.stdin.end();
  const buf = Buffer.from(await new Response(proc.stdout).arrayBuffer());
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, at);
    const header = buf.subarray(at, nl).toString();
    at = nl + 1;
    if (header.endsWith(" missing")) continue;
    const size = Number(header.split(" ")[2]);
    got.set(p, buf.subarray(at, at + size).toString());
    at += size + 1;
  }
  return got;
}

/** Splits YAML frontmatter from the body; malformed frontmatter counts as none. */
function frontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    const meta = Bun.YAML.parse(m[1]);
    return {
      meta: meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {},
      body: text.slice(m[0].length),
    };
  } catch {
    return { meta: {}, body: text };
  }
}

const globs = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((g) => String(g).trim()).filter(Boolean);

const ancestors = (path: string) => {
  const dirs = [""];
  const parts = path.split("/").slice(0, -1);
  for (let i = 1; i <= parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
};

export async function loadGuidelines(root: string, ref: string, changed: string[]): Promise<Guidelines> {
  const tree = (await $`git ls-tree -r --name-only ${ref}`.cwd(root).nothrow().quiet().text()).split("\n");
  const exists = new Set(tree);
  // depth = how narrowly a guideline targets these files (directory depth, or a glob's literal
  // depth); its rank weighs that by how much of the change it covers. The root is always first.
  const wanted = new Map<string, { scope: Set<string>; depth: number }>();
  const want = (path: string, scope: string[], depth: number) => {
    if (!exists.has(path) || !scope.length) return;
    const w = wanted.get(path) ?? { scope: new Set<string>(), depth };
    for (const s of scope) w.scope.add(s);
    w.depth = Math.max(w.depth, depth);
    wanted.set(path, w);
  };
  const rankOf = (path: string, w: { scope: Set<string>; depth: number }) =>
    !path.includes("/") || path === ".cursor/BUGBOT.md" || path === ".github/copilot-instructions.md"
      ? 10_000
      : Math.round(w.depth * Math.sqrt(w.scope.size) * 10);

  for (const file of changed)
    for (const dir of ancestors(file))
      for (const name of DIR_FILES) want(dir ? `${dir}/${name}` : name, [file], dir.split("/").filter(Boolean).length);
  want(".cursor/BUGBOT.md", changed, 0);
  want(".github/copilot-instructions.md", changed, 0);

  // Path-scoped rule files: read them all to see their globs.
  const ruleFiles = tree.filter(
    (p) =>
      (p.startsWith(".claude/rules/") && p.endsWith(".md")) ||
      (p.startsWith(".github/instructions/") && p.endsWith(".instructions.md")),
  );
  const rules = await readAll(root, ref, ruleFiles);
  const ruleText = new Map<string, string>();
  for (const [path, text] of rules) {
    const { meta, body } = frontmatter(text);
    const patterns = globs(meta.paths ?? meta.applyTo).map((g) => ({ g, glob: new Bun.Glob(g) }));
    const scope = patterns.length ? changed.filter((f) => patterns.some((p) => p.glob.match(f))) : changed;
    if (!scope.length) continue;
    ruleText.set(path, body);
    // A rule aimed at exactly these paths beats one that covers half the repo.
    const depth = Math.max(
      0,
      ...patterns.filter((p) => scope.some((f) => p.glob.match(f))).map((p) => specificity(p.g)),
    );
    want(path, scope, patterns.length ? depth : 0.5);
  }

  const texts = await readAll(
    root,
    ref,
    [...wanted.keys()].filter((p) => !ruleText.has(p)),
  );
  for (const [p, t] of ruleText) texts.set(p, t);

  // `@file` imports (CLAUDE.md is often just "@AGENTS.md"), one level, relative to the file.
  const docs: Guideline[] = [];
  const seen = new Set<string>();
  const imports: { path: string; scope: string[]; rank: number }[] = [];
  for (const [path, w] of wanted) {
    const rank = rankOf(path, w);
    let text = texts.get(path);
    if (text === undefined) continue;
    text = text.replace(/(^|\s)@([\w./-]+\.md)\b/g, (whole, pre: string, target: string) => {
      const resolved = normalize(join(dirname(path), target));
      if (!exists.has(resolved)) return whole;
      imports.push({ path: resolved, scope: [...w.scope], rank });
      return `${pre}(see ${resolved})`;
    });
    if (
      !text
        .trim()
        .replace(/\(see [^)]+\)/g, "")
        .trim()
    ) {
      seen.add(path); // nothing but imports
      continue;
    }
    docs.push({ path, text, scope: [...w.scope], rank, title: titleOf(text, path) });
    seen.add(path);
  }
  const extra = imports.filter((i) => !seen.has(i.path) && !wanted.has(i.path));
  const importedTexts = await readAll(root, ref, [...new Set(extra.map((i) => i.path))]);
  for (const i of extra) {
    if (seen.has(i.path)) continue;
    const text = importedTexts.get(i.path);
    if (text?.trim()) docs.push({ path: i.path, text, scope: i.scope, rank: i.rank, title: titleOf(text, i.path) });
    seen.add(i.path);
  }

  // Budget: cap each file; the highest-ranked fill the prompt, the rest go in the index.
  for (const d of docs) if (d.text.length > PER_FILE) d.text = `${d.text.slice(0, PER_FILE)}\n…(truncated)`;
  const byRank = [...docs].sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path));
  const inline: Guideline[] = [];
  const indexed: Guideline[] = [];
  let total = 0;
  for (const d of byRank) {
    // In the prompt, a long guideline is trimmed; read_guideline still returns all of it.
    const shown =
      d.text.length > INLINE_EACH
        ? `${d.text.slice(0, INLINE_EACH)}\n…(trimmed here: read_guideline("${d.path}") for the rest)`
        : d.text;
    if (total + shown.length <= INLINE) {
      inline.push({ ...d, text: shown, full: d.text });
      total += shown.length;
    } else indexed.push(d);
  }
  // Prompt order: general first, nearest and most specific last, so the specific reads as the override.
  inline.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  return { inline, indexed, ref };
}

const titleOf = (text: string, path: string) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? path.split("/").pop() ?? path;

/** The GUIDELINES block for a prompt: the top guidelines in full, then an index of the rest. */
export function guidelinesBlock(g: Guidelines) {
  if (!g.inline.length && !g.indexed.length) return "";
  const applies = (d: Guideline) =>
    `${d.scope.slice(0, 6).join(", ")}${d.scope.length > 6 ? `, +${d.scope.length - 6} more` : ""}`;
  const full = g.inline.map(
    (d) => `<guideline file="${d.path}" applies-to="${applies(d)}">\n${d.text.trim()}\n</guideline>`,
  );
  const index = g.indexed.length
    ? `\n\n<more-guidelines note="Not included above. Read any that bear on the change with read_guideline.">\n${g.indexed
        .map((d) => `- ${d.path}: ${d.title} (applies to ${applies(d)})`)
        .join("\n")}\n</more-guidelines>`
    : "";
  return `<guidelines ref="${g.ref}">\n${full.join("\n\n")}${index}\n</guidelines>`;
}

/** A guideline by path (its whole text), from the base ref, if it's one that applies here. */
export function guidelineText(g: Guidelines, path: string) {
  const d = [...g.inline, ...g.indexed].find((x) => x.path === path);
  return d ? { ...d, text: d.full ?? d.text } : undefined;
}

/** True when `quote` is really in a guideline that applies to `path` (whitespace-insensitive). */
export function quoteHolds(g: Guidelines, file: string, quote: string, path: string) {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const doc = guidelineText(g, file);
  return !!doc && doc.scope.includes(path) && squash(quote).length >= 8 && squash(doc.text).includes(squash(quote));
}
