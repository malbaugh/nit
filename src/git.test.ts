import { expect, test } from "bun:test";
import { parseRemote } from "./git";

test("parseRemote reads every origin form git accepts", () => {
  const want = { host: "github.com", owner: "crbnos", name: "carbon" };
  expect(parseRemote("ssh://git@ssh.github.com:443/crbnos/carbon.git")).toEqual(want);
  expect(parseRemote("git@github.com:crbnos/carbon.git")).toEqual(want);
  expect(parseRemote("https://github.com/crbnos/carbon")).toEqual(want);
  expect(parseRemote("https://github.com/crbnos/carbon.git/")).toEqual(want);
  expect(parseRemote("git+https://github.com/crbnos/carbon.git")).toEqual(want);
  expect(parseRemote("ssh://git@ghe.example.com:2222/team/tool.git")).toEqual({
    host: "ghe.example.com",
    owner: "team",
    name: "tool",
  });
  expect(parseRemote("not a remote")).toBeNull();
});
