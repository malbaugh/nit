import { describe, expect, test } from "bun:test";
import {
  code,
  continueList,
  type Edit,
  link,
  pasteLink,
  prefixLines,
  type Sel,
  toggleTask,
  wrap,
} from "./markdown-edit";

/** Applies an edit to a value and marks the new selection with « and ». */
function run(sel: Sel, edit: Edit | null) {
  if (!edit) return null;
  const v = sel.value.slice(0, edit.from) + edit.text + sel.value.slice(edit.to);
  return `${v.slice(0, edit.selStart)}«${v.slice(edit.selStart, edit.selEnd)}»${v.slice(edit.selEnd)}`;
}
/** "a «b» c" → value "a b c" with b selected. */
function sel(marked: string): Sel {
  const start = marked.indexOf("«");
  const end = marked.indexOf("»") - 1;
  return { value: marked.replace("«", "").replace("»", ""), start, end };
}

describe("wrap", () => {
  test("wraps and selects the inner text", () =>
    expect(run(sel("a «b» c"), wrap(sel("a «b» c"), "**"))).toBe("a **«b»** c"));
  test("unwraps when already wrapped", () =>
    expect(run(sel("a **«b»** c"), wrap(sel("a **«b»** c"), "**"))).toBe("a «b» c"));
  test("inserts a placeholder with no selection", () =>
    expect(run(sel("a «» c"), wrap(sel("a «» c"), "_"))).toBe("a _«text»_ c"));
});

describe("code", () => {
  test("inline for one line", () => expect(run(sel("«x»"), code(sel("«x»")))).toBe("`«x»`"));
  test("fenced for several lines", () => expect(run(sel("«a\nb»"), code(sel("«a\nb»")))).toBe("```\n«a\nb»\n```"));
});

test("link selects the url to type over", () =>
  expect(run(sel("see «docs» now"), link(sel("see «docs» now")))).toBe("see [docs](«url») now"));

describe("prefixLines", () => {
  test("quotes every selected line", () =>
    expect(run(sel("«a\nb»"), prefixLines(sel("«a\nb»"), "> "))).toBe("«> a\n> b»"));
  test("removes the prefix when all lines have it", () =>
    expect(run(sel("«> a\n> b»"), prefixLines(sel("«> a\n> b»"), "> "))).toBe("«a\nb»"));
  test("numbers lines", () =>
    expect(
      run(
        sel("«a\nb»"),
        prefixLines(sel("«a\nb»"), (i) => `${i + 1}. `),
      ),
    ).toBe("«1. a\n2. b»"));
  test("keeps a caret in place", () => expect(run(sel("ab«»c"), prefixLines(sel("ab«»c"), "### "))).toBe("### ab«»c"));
});

describe("continueList", () => {
  test("next bullet", () => expect(run(sel("- one«»"), continueList(sel("- one«»")))).toBe("- one\n- «»"));
  test("next number", () =>
    expect(run(sel("  9. nine«»"), continueList(sel("  9. nine«»")))).toBe("  9. nine\n  10. «»"));
  test("next task is unchecked", () =>
    expect(run(sel("- [x] done«»"), continueList(sel("- [x] done«»")))).toBe("- [x] done\n- [ ] «»"));
  test("empty item ends the list", () => expect(run(sel("- a\n- «»"), continueList(sel("- a\n- «»")))).toBe("- a\n«»"));
  test("not a list", () => expect(continueList(sel("plain«»"))).toBeNull());
});

test("pasting a URL over text makes a link", () => {
  expect(run(sel("see «docs»"), pasteLink(sel("see «docs»"), "https://x.dev"))).toBe("see [docs](https://x.dev)«»");
  expect(pasteLink(sel("see «»"), "https://x.dev")).toBeNull();
  expect(pasteLink(sel("«a»"), "not a url")).toBeNull();
});

test("toggleTask flips only the nth box", () => {
  expect(toggleTask("- [ ] a\n- [x] b\n1. [ ] c", 1)).toBe("- [ ] a\n- [ ] b\n1. [ ] c");
  expect(toggleTask("- [ ] a\n- [x] b\n1. [ ] c", 2)).toBe("- [ ] a\n- [x] b\n1. [x] c");
});
