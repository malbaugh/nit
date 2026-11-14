import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";
import { dataDir } from "./store";

/**
 * Snapshots of a checkout's files in a shadow git repo (copied from OpenCode): its own git
 * directory and index, the checkout as its work tree, and the real repo's objects through
 * `objects/info/alternates`. Your branch, index and stash are never touched. A snapshot is a
 * tree id; the agent's changes are the diff between the trees before and after it ran.
 */
export function createSnapshots(root: string, project: string) {
  // sha1, not Bun.hash: the name must survive Bun upgrades or undo loses its snapshots.
  const dir = join(
    dataDir(),
    "snapshot",
    project,
    new Bun.CryptoHasher("sha1").update(root).digest("hex").slice(0, 16),
  );
  // Snapshots from before this name (Bun.hash) move over, so an earlier pass can still be undone.
  const before = join(dataDir(), "snapshot", project, Bun.hash(root).toString(36));
  if (!existsSync(dir) && existsSync(before)) renameSync(before, dir);
  // Only these variables: an inherited GIT_DIR or GIT_INDEX_FILE would point git at the real repo.
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_DIR: dir,
    GIT_WORK_TREE: root,
    GIT_INDEX_FILE: join(dir, "index"),
  };
  const git = (cmd: ReturnType<typeof $>) => cmd.cwd(root).env(env).quiet();
  const real = async (args: string[]) => (await $`git ${args}`.cwd(root).quiet().text()).trim();
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p));

  let ready: Promise<void> | null = null;
  function ensure() {
    ready ??= (async () => {
      if (!existsSync(join(dir, "HEAD"))) {
        mkdirSync(dir, { recursive: true });
        await $`git init -q --bare ${dir}`.quiet();
      }
      // Reuse the repo's objects, and its local ignore rules (.gitignore files apply anyway).
      const common = abs(await real(["rev-parse", "--git-common-dir"]));
      mkdirSync(join(dir, "objects", "info"), { recursive: true });
      writeFileSync(join(dir, "objects", "info", "alternates"), `${join(common, "objects")}\n`);
      mkdirSync(join(dir, "info"), { recursive: true });
      if (existsSync(join(common, "info", "exclude")))
        copyFileSync(join(common, "info", "exclude"), join(dir, "info", "exclude"));
      // Start from the real index: it carries file stats, so the first snapshot only hashes
      // what changed instead of the whole checkout.
      if (!existsSync(join(dir, "index"))) {
        const index = abs(await real(["rev-parse", "--git-path", "index"]));
        if (existsSync(index)) copyFileSync(index, join(dir, "index"));
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  }

  return {
    /** Records the checkout as it is now and returns the tree id. */
    async take(): Promise<string> {
      await ensure();
      await git($`git add -A .`);
      return (await git($`git write-tree`).text()).trim();
    },

    /** Unified diff between two snapshots, for the "agent's changes" view. */
    async diff(from: string, to: string): Promise<string> {
      await ensure();
      return git($`git diff --no-ext-diff --no-color ${from} ${to}`).text();
    },

    /** Files that differ between two snapshots, with git's status letter (A, M, D, R…). */
    async changed(from: string, to: string): Promise<{ status: string; path: string }[]> {
      await ensure();
      const text = await git($`git diff --name-status --no-renames -z ${from} ${to}`).text();
      const parts = text.split("\0").filter(Boolean);
      const out: { status: string; path: string }[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i], path: parts[i + 1] });
      return out;
    },

    /**
     * Puts back the files the agent changed (between `before` and `after`). A file you edited
     * after the agent ran is left alone and reported, so undo never loses your work.
     */
    async undo(before: string, after: string): Promise<{ restored: string[]; kept: string[] }> {
      const agent = await this.changed(before, after);
      const now = await this.take();
      const touched = new Set((await this.changed(after, now)).map((c) => c.path));
      const restored: string[] = [];
      const kept: string[] = [];
      const back: string[] = [];
      for (const { status, path } of agent) {
        if (touched.has(path)) {
          kept.push(path);
          continue;
        }
        if (status === "A") rmSync(join(root, path), { force: true });
        else back.push(path);
        restored.push(path);
      }
      if (back.length) await git($`git checkout ${before} -- ${back}`);
      await this.take(); // keep the shadow index in step with the files
      return { restored, kept };
    },
  };
}

export type Snapshots = ReturnType<typeof createSnapshots>;
