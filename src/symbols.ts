import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { Language, type Node, Parser, Query, type Tree } from "@vscode/tree-sitter-wasm";
import csharp from "./queries/c-sharp.scm" with { type: "text" };
import cpp from "./queries/cpp.scm" with { type: "text" };
import go from "./queries/go.scm" with { type: "text" };
import java from "./queries/java.scm" with { type: "text" };
import javascript from "./queries/javascript.scm" with { type: "text" };
import javascriptExtra from "./queries/javascript-extra.scm" with { type: "text" };
import php from "./queries/php.scm" with { type: "text" };
import python from "./queries/python.scm" with { type: "text" };
import ruby from "./queries/ruby.scm" with { type: "text" };
import rust from "./queries/rust.scm" with { type: "text" };
import typescript from "./queries/typescript.scm" with { type: "text" };
import typescriptExtra from "./queries/typescript-extra.scm" with { type: "text" };
import type { Symbol as Sym } from "./types";

// Grammars come from VS Code's prebuilt package (built against the same runtime). Tag queries are
// the grammars' own queries/tags.scm, vendored in src/queries. TypeScript reuses JavaScript's.
// The *-extra files are nit's additions (type aliases, enums, top-level constants).
const JS = javascript + javascriptExtra;
const TS = JS + typescript + typescriptExtra;
const GRAMMARS = {
  typescript: { wasm: "tree-sitter-typescript.wasm", query: TS },
  tsx: { wasm: "tree-sitter-tsx.wasm", query: TS },
  javascript: { wasm: "tree-sitter-javascript.wasm", query: JS },
  python: { wasm: "tree-sitter-python.wasm", query: python },
  go: { wasm: "tree-sitter-go.wasm", query: go },
  rust: { wasm: "tree-sitter-rust.wasm", query: rust },
  java: { wasm: "tree-sitter-java.wasm", query: java },
  csharp: { wasm: "tree-sitter-c-sharp.wasm", query: csharp },
  ruby: { wasm: "tree-sitter-ruby.wasm", query: ruby },
  php: { wasm: "tree-sitter-php.wasm", query: php },
  cpp: { wasm: "tree-sitter-cpp.wasm", query: cpp },
} as const;
export type Grammar = keyof typeof GRAMMARS;

const BY_EXT: Record<string, Grammar> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".h": "cpp",
};

export const grammarFor = (path: string): Grammar | null => BY_EXT[extname(path).toLowerCase()] ?? null;

const wasmDir = join(dirname(createRequire(import.meta.url).resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
let ready: Promise<void> | null = null;
function init() {
  if (!ready) ready = Parser.init({ locateFile: (f: string) => join(wasmDir, f) });
  return ready;
}

type Loaded = { parser: Parser; query: Query };
const loaded = new Map<Grammar, Promise<Loaded>>();

export function load(grammar: Grammar): Promise<Loaded> {
  let p = loaded.get(grammar);
  if (!p) {
    p = (async () => {
      await init();
      const language = await Language.load(join(wasmDir, GRAMMARS[grammar].wasm));
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, query: new Query(language, GRAMMARS[grammar].query) };
    })();
    loaded.set(grammar, p);
  }
  return p;
}

// Parsed files, keyed by caller (path + version). Trees hold WASM memory, so old ones are freed.
type Parsed = { tree: Tree; grammar: Grammar; symbols: Sym[] };
const parsed = new Map<string, Parsed>();
const MAX_PARSED = 200;

export async function parse(key: string, path: string, source: string): Promise<Parsed | null> {
  const hit = parsed.get(key);
  if (hit) {
    parsed.delete(key);
    parsed.set(key, hit); // most recently used last
    return hit;
  }
  const grammar = grammarFor(path);
  if (!grammar) return null;
  const { parser, query } = await load(grammar);
  const tree = parser.parse(source);
  if (!tree) return null;
  const entry = { tree, grammar, symbols: outline(tree, query) };
  parsed.set(key, entry);
  if (parsed.size > MAX_PARSED) {
    const [oldest, value] = parsed.entries().next().value!;
    parsed.delete(oldest);
    value.tree.delete();
  }
  return entry;
}

/** Definitions from the tags query (@definition.* with its @name), ordered by position. */
function outline(tree: Tree, query: Query): Sym[] {
  const seen = new Map<number, number>(); // definition node → index in out
  const out: Sym[] = [];
  for (const m of query.matches(tree.rootNode)) {
    const def = m.captures.find((c) => c.name.startsWith("definition."));
    const name = m.captures.find((c) => c.name === "name");
    if (!def || !name) continue;
    const kind = def.name.slice("definition.".length);
    const at = seen.get(def.node.id);
    if (at !== undefined) {
      // A const holding a function is matched as both; "function" says more than "constant".
      if (out[at].kind === "constant" && kind !== "constant") out[at].kind = kind;
      continue;
    }
    seen.set(def.node.id, out.length);
    out.push({
      name: name.node.text,
      kind,
      line: def.node.startPosition.row + 1,
      endLine: def.node.endPosition.row + 1,
      nameLine: name.node.startPosition.row + 1,
      nameCol: name.node.startPosition.column,
    });
  }
  return out.sort((a, b) => a.line - b.line || b.endLine - a.endLine);
}

const IDENT = /identifier|^name$|^constant$|^field$|^property$/;
const isIdentifier = (n: Node) => n.childCount === 0 && IDENT.test(n.type);

/** The identifier at a 1-based line and 0-based column, or null on punctuation, strings, comments. */
export function identifierAt(p: Parsed, line: number, col: number): string | null {
  const n = p.tree.rootNode.descendantForPosition({ row: line - 1, column: col });
  return n && isIdentifier(n) ? n.text : null;
}

/** Distinct identifiers on a line, left to right. Keywords and literals aren't identifiers. */
export function identifiersOnLine(p: Parsed, line: number): { name: string; col: number }[] {
  const out: { name: string; col: number }[] = [];
  const seen = new Set<string>();
  const row = line - 1;
  const walk = (n: Node) => {
    if (n.endPosition.row < row || n.startPosition.row > row) return;
    if (isIdentifier(n)) {
      if (n.startPosition.row === row && !seen.has(n.text)) {
        seen.add(n.text);
        out.push({ name: n.text, col: n.startPosition.column });
      }
      return;
    }
    for (const c of n.children) if (c) walk(c);
  };
  walk(p.tree.rootNode);
  return out;
}
