import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { $ } from "bun";

const out = async (p: ReturnType<typeof $>) => (await p.nothrow().quiet().text()).trim();

export async function repoRoot(cwd = process.cwd()) {
  return out($`git rev-parse --show-toplevel`.cwd(cwd));
}

export async function defaultBase(root: string) {
  return (await out($`git symbolic-ref --short refs/remotes/origin/HEAD`.cwd(root))) || "main";
}

export async function mergeBase(root: string, base: string) {
  return out($`git merge-base ${base} HEAD`.cwd(root));
}

export async function currentBranch(root: string) {
  const name = await out($`git rev-parse --abbrev-ref HEAD`.cwd(root));
  return name === "HEAD" ? await out($`git rev-parse --short HEAD`.cwd(root)) : name;
}

export type Repo = { host: string; owner: string; name: string };

/**
 * owner/name from an origin URL in any form git accepts: git@host:o/r.git, https://host/o/r,
 * ssh://git@host:port/o/r. GitHub's SSH-over-443 host (ssh.github.com) means github.com.
 */
export function parseRemote(url: string): Repo | null {
  const u = url.trim().replace(/^git\+/, "");
  let host: string;
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const scp = u.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
    if (!scp) return null;
    [, host, path] = scp;
  }
  const [owner, name] = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (!owner || !name) return null;
  host = host.toLowerCase();
  return { host: host === "ssh.github.com" ? "github.com" : host, owner, name };
}

/** Same repo across clones and worktrees: the origin's host/owner/name, else the first commit. */
export async function projectId(root: string) {
  const remote = parseRemote(await out($`git remote get-url origin`.cwd(root)));
  const key = remote
    ? `${remote.host}/${remote.owner}/${remote.name}`.toLowerCase()
    : await out($`git rev-list --max-parents=0 HEAD`.cwd(root));
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/** Committed, staged and unstaged changes since the merge base, plus untracked files. */
export async function diff(root: string, base: string) {
  const tracked = await $`git diff --no-color --no-ext-diff -M ${base}`.cwd(root).quiet().text();
  const untracked = (await $`git ls-files --others --exclude-standard`.cwd(root).quiet().text())
    .split("\n")
    .filter(Boolean);
  // ponytail: one git process per untracked file; batch if agents start dumping hundreds of files
  const added = await Promise.all(
    untracked.map((f) =>
      $`git diff --no-color --no-ext-diff --no-index /dev/null ${f}`.cwd(root).nothrow().quiet().text(),
    ),
  );
  return tracked + added.join("");
}

/** Resolves a repo-relative path, refusing anything outside the repo. */
export function safePath(root: string, path: string) {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path outside repo: ${path}`);
  return full;
}

export async function readAtRef(root: string, ref: string, path: string): Promise<string | null> {
  safePath(root, path);
  const r = await $`git show ${`${ref}:${path}`}`.cwd(root).nothrow().quiet();
  return r.exitCode === 0 ? r.text() : null;
}

export async function readWorking(root: string, path: string): Promise<string | null> {
  const f = Bun.file(safePath(root, path));
  return (await f.exists()) ? f.text() : null;
}
