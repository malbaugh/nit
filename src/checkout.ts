import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { $ } from "bun";
import { Octokit } from "octokit";
import { parseRemote, token } from "./github";

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
const log = (msg: string) => console.error(`nit: ${msg}`);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Repo config is read from the default branch on origin, never from the branch under review. */
async function repoConfig(root: string): Promise<{ commands?: { checkout?: string } }> {
  const head = (await out($`git symbolic-ref --short refs/remotes/origin/HEAD`.cwd(root))) || "origin/main";
  const text = await $`git show ${`${head}:.nit.toml`}`.cwd(root).nothrow().quiet();
  if (text.exitCode !== 0) return {};
  try {
    return Bun.TOML.parse(text.text()) as { commands?: { checkout?: string } };
  } catch (e) {
    log(`ignoring .nit.toml on ${head}: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/**
 * Puts a pull request in a worktree and returns where, plus the base to diff against.
 * Uses the repo's `checkout` command if `.nit.toml` sets one (e.g. crbn), else the built-in:
 * reuse a worktree that already has the PR's branch, or make one beside the main checkout.
 */
export async function checkoutPr(root: string, ref: PrRef): Promise<{ path: string; base: string; number: number }> {
  const remote = parseRemote(await out($`git remote get-url origin`.cwd(root)));
  if (!remote) throw new Error("this repo has no origin remote");
  if (
    ref.owner &&
    ref.name &&
    `${ref.owner}/${ref.name}`.toLowerCase() !== `${remote.owner}/${remote.name}`.toLowerCase()
  )
    throw new Error(
      `that PR is in ${ref.owner}/${ref.name}; run nit inside a clone of it (this is ${remote.owner}/${remote.name})`,
    );

  const auth = await token(remote.host);
  if (!auth) throw new Error("sign in with `gh auth login` (or set GH_TOKEN) to open a pull request");
  const octokit = new Octokit({
    auth,
    baseUrl: remote.host === "github.com" ? undefined : `https://${remote.host}/api/v3`,
    userAgent: "nit",
  });
  const { data: pr } = await octokit.rest.pulls.get({
    owner: remote.owner,
    repo: remote.name,
    pull_number: ref.number,
  });
  const branch = pr.head.ref;
  const base = `origin/${pr.base.ref}`;
  log(`PR #${pr.number} — ${pr.title} (${branch} → ${pr.base.ref})`);

  const env = {
    ...process.env,
    NIT_PR: String(pr.number),
    NIT_BRANCH: branch,
    NIT_URL: pr.html_url,
    NIT_REPO_ROOT: root,
  };
  const command = (await repoConfig(root)).commands?.checkout;
  let path: string | null = null;

  if (command) {
    // The plug point: logs on stderr, the directory on the last line of stdout.
    log(`checking out with .nit.toml: ${command}`);
    const r = await $`sh -c ${command}`.cwd(root).env(env).nothrow();
    const last = r.stdout.toString().trim().split("\n").at(-1)?.trim() ?? "";
    if (r.exitCode !== 0 || !isDir(last))
      throw new Error(`the checkout command didn't print a directory (exit ${r.exitCode})`);
    path = last;
  } else {
    const worktrees = await out($`git worktree list --porcelain`.cwd(root));
    for (const block of worktrees.split("\n\n")) {
      if (block.includes(`branch refs/heads/${branch}\n`) || block.endsWith(`branch refs/heads/${branch}`)) {
        path = block.match(/^worktree (.+)$/m)?.[1] ?? null;
        if (path) log(`using the existing worktree at ${path}`);
        break;
      }
    }
    if (!path) {
      const main = dirname(await out($`git rev-parse --path-format=absolute --git-common-dir`.cwd(root)));
      path = join(dirname(main), `${basename(main)}-${slug(branch)}`);
      if (existsSync(path)) throw new Error(`${path} already exists and isn't a worktree for ${branch}`);
      log(`creating a worktree at ${path}`);
      const hasGh = (await $`gh --version`.nothrow().quiet()).exitCode === 0;
      if (hasGh) {
        // gh sets push tracking, so `git push` from the worktree updates the PR (forks included).
        await $`git worktree add --detach ${path}`.cwd(root).quiet();
        const r = await $`gh pr checkout ${pr.number} --branch ${branch}`.cwd(path).env(env).nothrow().quiet();
        if (r.exitCode !== 0) {
          await $`git worktree remove --force ${path}`.cwd(root).nothrow().quiet();
          throw new Error(`gh pr checkout failed: ${r.stderr.toString().trim()}`);
        }
      } else {
        const local = `pr-${pr.number}`;
        await $`git fetch origin ${`pull/${pr.number}/head:${local}`}`.cwd(root).quiet();
        await $`git worktree add ${path} ${local}`.cwd(root).quiet();
      }
    }
  }

  await $`git fetch origin ${pr.base.ref} --quiet`.cwd(path).nothrow().quiet();
  return { path, base, number: pr.number };
}
