import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { $ } from "bun";
import { Octokit } from "octokit";
import { loadCommands } from "./config";
import { parseRemote, token } from "./github";
import * as term from "./term";
import { NitError } from "./term";

export type PrRef = { owner: string | null; name: string | null; number: number };

/** `2227`, `#2227`, or a pull request URL (github.com or GitHub Enterprise). */
export function parsePrArg(arg: string | undefined): PrRef | null {
  if (!arg) return null;
  const n = arg.match(/^#?(\d+)$/);
  if (n) return { owner: null, name: null, number: Number(n[1]) };
  const url = arg.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return url ? { owner: url[1], name: url[2], number: Number(url[3]) } : null;
}

const out = async (p: ReturnType<typeof $>) => (await p.nothrow().quiet().text()).trim();
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/**
 * Puts a pull request in a worktree and returns where, plus the base to diff against.
 * Uses a `checkout` command when any config layer sets one (config.ts), else the built-in:
 * reuse a worktree that already has the PR's branch, or make one beside the main checkout.
 */
export async function checkoutPr(
  root: string,
  ref: PrRef,
): Promise<{ path: string; base: string; number: number; title: string; head: string; baseName: string }> {
  const remote = parseRemote(await out($`git remote get-url origin`.cwd(root)));
  if (!remote)
    throw new NitError(
      "This repository isn't on GitHub",
      "nit opens pull requests from the repository's origin remote, and it has none on GitHub.",
      "Run nit inside a clone of the repository the pull request is in.",
    );
  if (
    ref.owner &&
    ref.name &&
    `${ref.owner}/${ref.name}`.toLowerCase() !== `${remote.owner}/${remote.name}`.toLowerCase()
  )
    throw new NitError(
      `That pull request is in ${ref.owner}/${ref.name}`,
      `This is a clone of ${remote.owner}/${remote.name}.`,
      `Run nit inside a clone of ${ref.owner}/${ref.name}.`,
    );

  const auth = await token(remote.host);
  if (!auth)
    throw new NitError(
      "nit isn't signed in to GitHub",
      "Opening a pull request needs to read it from GitHub.",
      "Run `gh auth login`, or save a token in nit's Settings → GitHub.",
    );
  const octokit = new Octokit({
    auth,
    baseUrl: remote.host === "github.com" ? undefined : `https://${remote.host}/api/v3`,
    userAgent: "nit",
  });
  const repo = `${remote.owner}/${remote.name}`;
  const pr = await term.task(
    `Finding pull request #${ref.number}`,
    async () => {
      try {
        return (await octokit.rest.pulls.get({ owner: remote.owner, repo: remote.name, pull_number: ref.number })).data;
      } catch (e) {
        if ((e as { status?: number }).status === 404)
          throw new NitError(
            `There's no pull request #${ref.number} in ${repo}`,
            undefined,
            "Check the number, or pass the pull request's URL.",
          );
        throw e;
      }
    },
    (p) =>
      `PR #${p.number}  ${p.head.ref} → ${p.base.ref}${p.merged_at ? term.c.dim("  merged") : p.state === "closed" ? term.c.dim("  closed") : ""}`,
  );
  const branch = pr.head.ref;
  const base = `origin/${pr.base.ref}`;
  // A merged or closed pull request's branch is often deleted, and a fork's can be: GitHub
  // keeps its commits at refs/pull/<n>/head either way.
  const fromPullRef = pr.state === "closed" || !pr.head.repo;

  const env = {
    ...process.env,
    NIT_PR: String(pr.number),
    NIT_BRANCH: branch,
    NIT_URL: pr.html_url,
    NIT_REPO_ROOT: root,
  };
  const command = (await loadCommands(root)).checkout;
  const local = `pr-${pr.number}`;
  let path: string | null = null;

  if (command) {
    // The plug point: logs on stderr, the directory on the last line of stdout.
    term.step(`checking out with ${command.from}: ${command.run}`);
    // Its log (stderr) streams to the terminal as it works; stdout is the answer, for nit.
    const proc = Bun.spawn(["sh", "-c", command.run], { cwd: root, env, stdout: "pipe", stderr: "inherit" });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const last = text.trim().split("\n").at(-1)?.trim() ?? "";
    if (code !== 0 || !isDir(last))
      throw new NitError(
        "Your checkout command didn't check out the pull request",
        `${command.run} (from ${command.from}) ${code !== 0 ? `exited with ${code}` : "didn't print a directory as its last line"}.`,
        "Fix it, or clear it in Settings → Commands to use a git worktree.",
      );
    path = last;
  } else {
    // A worktree that already has the pull request: its branch, or the pr-<n> branch nit made.
    const worktrees = await out($`git worktree list --porcelain`.cwd(root));
    for (const block of worktrees.split("\n\n")) {
      const has = (b: string) => block.includes(`branch refs/heads/${b}\n`) || block.endsWith(`branch refs/heads/${b}`);
      if (has(branch) || has(local)) {
        path = block.match(/^worktree (.+)$/m)?.[1] ?? null;
        break;
      }
    }
    if (path) term.step(`using the worktree at ${term.tilde(path)}`);
    else {
      const main = dirname(await out($`git rev-parse --path-format=absolute --git-common-dir`.cwd(root)));
      const into = join(dirname(main), `${basename(main)}-${slug(branch)}`);
      path = into;
      if (existsSync(into))
        throw new NitError(
          `${term.tilde(into)} is in the way`,
          "nit puts the pull request in a worktree there, and something else already is.",
          "Move it aside, or run nit from inside it.",
        );
      const hasGh = (await $`gh --version`.nothrow().quiet()).exitCode === 0;
      // From the pull request's own ref, into a pr-<n> branch: works for merged, closed and fork PRs.
      const fromRef = async () => {
        await $`git fetch origin ${`+pull/${pr.number}/head:${local}`}`.cwd(root).quiet();
        await $`git worktree add ${into} ${local}`.cwd(root).quiet();
      };
      await term.task(
        `Checking out PR #${pr.number}`,
        async () => {
          if (fromPullRef || !hasGh) return fromRef();
          // gh sets push tracking, so `git push` from the worktree updates the PR (forks included).
          await $`git worktree add --detach ${into}`.cwd(root).quiet();
          const r = await $`gh pr checkout ${pr.number} --branch ${branch}`.cwd(into).env(env).nothrow().quiet();
          if (r.exitCode === 0) return;
          // Its branch is gone or unreachable: the pull request's ref still has its commits.
          await $`git worktree remove --force ${into}`.cwd(root).nothrow().quiet();
          term.warn(`gh couldn't check out ${branch}; using the pull request's commits instead`);
          await fromRef();
        },
        () =>
          `Checked out into ${term.tilde(into)}${fromPullRef ? term.c.dim(`  (${pr.merged_at ? "merged" : "closed"}: from the PR's commits)`) : ""}`,
      );
    }
  }

  await $`git fetch origin ${pr.base.ref} --quiet`.cwd(path).nothrow().quiet();
  return { path, base, number: pr.number, title: pr.title, head: branch, baseName: pr.base.ref };
}
