import { describe, expect, test } from "bun:test";
import { type Grammar, identifierAt, identifiersOnLine, load, parse } from "./symbols";

const ALL: Grammar[] = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "ruby",
  "php",
  "cpp",
];

describe("every vendored tags query compiles against its grammar", () => {
  for (const g of ALL) test(g, async () => expect((await load(g)).query.captureNames.length).toBeGreaterThan(0));
});

const TS = `export function resolveToken(cfg: Config) {
  return cfg.token ?? fallback(cfg);
}

export class Client {
  get(url: string) {
    return fetch(url);
  }
}

interface Config { token?: string }

export type Id = string;
enum Mode { A, B }
export const LIMIT = 10;
const helper = () => 1;
function inner() { const local = 1; return local; }
`;

test("outline lists definitions with kinds and ranges", async () => {
  const p = await parse("t1", "a.ts", TS);
  const got = p!.symbols.map((s) => `${s.kind}:${s.name}@${s.line}-${s.endLine}`);
  expect(got).toContain("function:resolveToken@1-3");
  expect(got).toContain("class:Client@5-9");
  expect(got).toContain("method:get@6-8");
  expect(got).toContain("interface:Config@11-11");
  expect(got).toContain("type:Id@13-13");
  expect(got).toContain("enum:Mode@14-14");
  expect(got).toContain("constant:LIMIT@15-15");
  expect(got).toContain("function:helper@16-16");
  expect(got.some((g) => g.includes(":local@"))).toBe(false);
});

test("identifiers: at a position, and per line", async () => {
  const p = (await parse("t2", "a.ts", TS))!;
  expect(identifierAt(p, 2, 14)).toBe("token"); // cfg.t|oken
  expect(identifierAt(p, 2, 3)).toBeNull(); // inside the `return` keyword
  expect(identifiersOnLine(p, 2).map((i) => i.name)).toEqual(["cfg", "token", "fallback"]);
});
