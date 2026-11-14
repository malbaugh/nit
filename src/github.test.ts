import { expect, test } from "bun:test";
import { ghEnv, toDetails } from "./github";

test("a repo's .env reaches neither gh nor Claude Code: only the basics a CLI needs", () => {
  const saved = {
    t: process.env.GITHUB_TOKEN,
    u: process.env.ANTHROPIC_BASE_URL,
    tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
  };
  process.env.GITHUB_TOKEN = "ghp_from_a_repo_env";
  process.env.ANTHROPIC_BASE_URL = "https://evil.example";
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const env = ghEnv();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(env.HOME).toBe(process.env.HOME as string);
    expect(env.PATH).toBe(process.env.PATH as string);
  } finally {
    for (const [k, v] of [
      ["GITHUB_TOKEN", saved.t],
      ["ANTHROPIC_BASE_URL", saved.u],
      ["NODE_TLS_REJECT_UNAUTHORIZED", saved.tls],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

const run = (name: string, status: string, conclusion: string | null, annotations: object[] = []) => ({
  __typename: "CheckRun" as const,
  name,
  status,
  conclusion,
  detailsUrl: null,
  title: null,
  annotations: { nodes: annotations as never },
});

test("checks: failures first, running next; annotations keep their lines", () => {
  const d = toDetails({
    title: "t",
    state: "OPEN",
    body: "b",
    headRefOid: "abc",
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    author: null,
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  run("Test", "COMPLETED", "SUCCESS"),
                  run("Deploy", "COMPLETED", "SKIPPED"),
                  run("Build", "IN_PROGRESS", null),
                  run("Lint", "COMPLETED", "FAILURE", [
                    {
                      path: "src/a.ts",
                      title: "noUnused",
                      message: "b is unused",
                      annotationLevel: "FAILURE",
                      location: { start: { line: 2 }, end: { line: 3 } },
                    },
                  ]),
                  {
                    __typename: "StatusContext",
                    context: "ci/legacy",
                    state: "ERROR",
                    targetUrl: null,
                    description: "x",
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
  expect(d.checks.map((c) => `${c.name}:${c.state}`)).toEqual([
    "ci/legacy:failure",
    "Lint:failure",
    "Build:pending",
    "Deploy:neutral",
    "Test:success",
  ]);
  expect(d.annotations).toEqual([
    {
      id: "Lint:0",
      check: "Lint",
      path: "src/a.ts",
      start: 2,
      end: 3,
      level: "failure",
      title: "noUnused",
      message: "b is unused",
    },
  ]);
  expect(d.pr.headSha).toBe("abc");
});

test("checks: a commit with no checks", () => {
  const d = toDetails({
    title: "t",
    state: "OPEN",
    body: "",
    headRefOid: "x",
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    author: null,
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  });
  expect(d.checks).toEqual([]);
});
