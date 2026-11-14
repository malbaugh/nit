import { expect, test } from "bun:test";
import { linearRef } from "./linear";

test("a linear.app link in the description wins, with its url", () => {
  expect(linearRef("main", "x", "Fixes https://linear.app/acme/issue/ENG-42/fix-the-thing).")).toEqual({
    key: "ENG-42",
    url: "https://linear.app/acme/issue/ENG-42/fix-the-thing",
  });
});

test("a key at the start of the branch's last part, or the title's, is a guess to confirm", () => {
  expect(linearRef("sid/eng-123-add-hiding")).toEqual({ key: "ENG-123", url: null });
  expect(linearRef("eng-7")).toEqual({ key: "ENG-7", url: null });
  expect(linearRef("feature", "[OPS-9] Rotate keys")).toEqual({ key: "OPS-9", url: null });
  expect(linearRef("feature", "Bump UTF-8 handling")).toBeNull();
  expect(linearRef("fix/the-bug")).toBeNull();
});
