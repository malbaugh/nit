import type { Node, Tree } from "@vscode/tree-sitter-wasm";

/** Where a local name comes from: a module specifier and the name it has there ("default", "*", or a name). */
export type ImportBinding = { spec: string; imported: string };

/** What a JavaScript or TypeScript module imports and exports, read from its syntax tree. */
export type ModuleShape = {
  /** local name → import */
  imports: Map<string, ImportBinding>;
  /** exported name → local name, from `export { a as b }` without a source */
  localExports: Map<string, string>;
  /** `export … from "spec"`: a name map (exported → imported), or null for `export *` */
  reexports: { spec: string; names: Map<string, string> | null; namespace: string | null }[];
  /** `export default x` (a local name) or `export default function f` (its name); null name if anonymous */
  defaultExport: { name: string | null; line: number } | null;
};

const specOf = (n: Node | null) => {
  const s = n?.childForFieldName("source");
  return s ? s.text.slice(1, -1) : null;
};

export function moduleShape(tree: Tree): ModuleShape {
  const shape: ModuleShape = { imports: new Map(), localExports: new Map(), reexports: [], defaultExport: null };
  for (const node of tree.rootNode.children) {
    if (!node) continue;
    if (node.type === "import_statement") {
      const spec = specOf(node);
      const clause = node.children.find((c) => c?.type === "import_clause");
      if (!spec || !clause) continue;
      for (const part of clause.children) {
        if (!part) continue;
        if (part.type === "identifier") shape.imports.set(part.text, { spec, imported: "default" });
        else if (part.type === "namespace_import") {
          const id = part.children.find((c) => c?.type === "identifier");
          if (id) shape.imports.set(id.text, { spec, imported: "*" });
        } else if (part.type === "named_imports") {
          for (const s of part.children) {
            if (s?.type !== "import_specifier") continue;
            const name = s.childForFieldName("name")?.text;
            const alias = s.childForFieldName("alias")?.text;
            if (name) shape.imports.set(alias ?? name, { spec, imported: name });
          }
        }
      }
      continue;
    }
    if (node.type !== "export_statement") continue;
    const spec = specOf(node);
    const clause = node.children.find((c) => c?.type === "export_clause");
    const pairs = new Map<string, string>(); // exported → original
    for (const s of clause?.children ?? []) {
      if (s?.type !== "export_specifier") continue;
      const name = s.childForFieldName("name")?.text;
      const alias = s.childForFieldName("alias")?.text;
      if (name) pairs.set(alias ?? name, name);
    }
    if (spec) {
      const ns = node.children.find((c) => c?.type === "namespace_export");
      const nsName = ns?.children.find((c) => c?.type === "identifier")?.text ?? null;
      shape.reexports.push({ spec, names: clause ? pairs : nsName ? new Map() : null, namespace: nsName });
      continue;
    }
    for (const [exported, local] of pairs) shape.localExports.set(exported, local);
    if (node.children.some((c) => c?.type === "default")) {
      const decl = node.childForFieldName("declaration");
      const value = node.childForFieldName("value");
      shape.defaultExport = {
        name: decl?.childForFieldName("name")?.text ?? (value?.type === "identifier" ? value.text : null),
        line: node.startPosition.row + 1,
      };
    }
  }
  return shape;
}

/**
 * For `ns.name` on a line: the namespace identifier, when `name` is a property of a member
 * expression there. Used to resolve `import * as ns` lookups.
 */
export function namespaceOf(tree: Tree, line: number, name: string): string | null {
  const row = line - 1;
  let found: string | null = null;
  const walk = (n: Node) => {
    if (found || n.endPosition.row < row || n.startPosition.row > row) return;
    if (n.type === "member_expression" && n.startPosition.row <= row) {
      const prop = n.childForFieldName("property");
      const obj = n.childForFieldName("object");
      if (prop?.text === name && prop.startPosition.row === row && obj?.type === "identifier") {
        found = obj.text;
        return;
      }
    }
    for (const c of n.children) if (c) walk(c);
  };
  walk(tree.rootNode);
  return found;
}
