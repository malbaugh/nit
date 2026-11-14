import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createNavigator, type Navigator } from "./navigate";

// A small repo with the import shapes real TypeScript projects use.
const FILES: Record<string, string> = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~/*": ["./src/*"] } } }),
  "src/lib/impl.ts": "export function thing() {\n  return 1;\n}\n",
  "src/lib/other.ts": "export const other = 2;\n",
  "src/lib/index.ts":
    'export * from "./impl";\nexport { other as renamed } from "./other";\nexport * as group from "./other";\n',
  "src/make.ts": "export default function make() {\n  return 3;\n}\n",
  "src/value.ts": "const hidden = 4;\nexport { hidden as visible };\nexport default hidden;\n",
  "src/use.ts": [
    'import { thing as t, renamed, group } from "./lib";',
    'import mk from "./make";',
    'import * as L from "~/lib";',
    'import val, { visible } from "./value";',
    "t(); renamed; group; mk(); L.thing(); val; visible;",
    "",
  ].join("\n"),
};

let root: string;
let nav: Navigator;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "nit-imports-"));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  nav = await createNavigator(root, "HEAD", async () => "");
});
afterAll(() => {
  nav.destroy();
  rmSync(root, { recursive: true, force: true });
});

const at = { path: "src/use.ts", side: "additions" as const, line: 5 };
const first = async (name: string) => {
  const [r] = await nav.definition(name, at);
  return r ? `${r.path}:${r.line} ${r.kind}` : null;
};

describe("go to definition follows imports", () => {
  test("renamed import through export *", async () => expect(await first("t")).toBe("src/lib/impl.ts:1 function"));
  test("renamed re-export", async () => expect(await first("renamed")).toBe("src/lib/other.ts:1 constant"));
  test("namespace re-export lands on the module", async () =>
    expect(await first("group")).toBe("src/lib/other.ts:1 module"));
  test("default export with a name", async () => expect(await first("mk")).toBe("src/make.ts:1 function"));
  test("tsconfig path and namespace member", async () =>
    expect(await first("thing")).toBe("src/lib/impl.ts:1 function"));
  test("default export of a local", async () => expect(await first("val")).toBe("src/value.ts:1 constant"));
  test("export { local as name }", async () => expect(await first("visible")).toBe("src/value.ts:1 constant"));
});
