# nit

A fast, keyboard-first local code review tool. You read a diff, leave comments on
lines, and then either let an agent apply them or post them to GitHub as one review.

GitHub's PR page is slow to comment on and loses your place. Editors either lack PR
review or bury it. px0 aimed at this and filled it with AI features and an IDE.
nit does one job: review a diff without distraction.

## Commands

```
nit                 review the current branch against its base (default: origin's default branch)
nit <base>          review against a branch or commit
nit <pr-url>        check out the PR into a worktree and review it
nit <pr-number>     same, for the current repo's GitHub remote
nit drafts --json   print the saved comments for other tools
```

`nit` starts a local server and opens a browser tab. One tab per review.

## v1 scope

1. **Diff view.** Branch against the merge base plus uncommitted changes. Split or
   unified (`s`). File list with a viewed state (`v`). Rendered with `@pierre/diffs`.
2. **Comments, better than GitHub's.** This is the main reason to use nit.
   Every comment is a draft until you submit. Drafts save as you type (see
   "Where state lives"). Suggestions can be applied locally.
   Drafts follow the code when it moves and are never hidden. On a PR, existing
   threads appear inline with reply and resolve. Full GitHub-flavoured
   Markdown with Write/Preview, a toolbar, GitHub's shortcuts, smart lists and
   file-level comments. The details are in DESIGN.md under "Comments".
3. **Apply.** "Apply comments" sends the drafts, each tied to its lines, to one
   Claude Agent SDK session. When it finishes, nit shows only the changes since the
   last review pass. The session is resumed for follow-up passes.
4. **Post.** "Post to GitHub" sends all drafts as one review through
   `gh api repos/{o}/{r}/pulls/{n}/reviews` (approve, comment, or request changes).
5. **Navigation.** Go to definition (`gd`), find references (`gr`) and file finder
   (`⌘P`), shown as an inline peek. `⌘[` goes back. `o` opens the file in your editor.

## Navigation design

- **tree-sitter (`web-tree-sitter`)** gives precision inside one file: the symbol
  under the cursor and its kind, local scope from `locals.scm`, import resolution,
  filtering out comments and strings, and parsing the base side
  (`git show <base>:<path>`).
- **fff (`@ff-labs/fff-bun`)** gives fast candidates across the repo: a warm
  in-memory index, a file watcher, git status, and grep with
  `classifyDefinitions: "definition_only" | "usage_only"`. Fuzzy mode stays off
  for references.

Go to definition: local scope → imported module → fff definition search across the
repo, ranked by same file, imported files, same package, then the rest.

Find references: fff `usage_only` with whole-word matches, checked by tree-sitter,
grouped as **changed in this diff** and **not touched**. The untouched group answers
"did they update every caller?".

As built: grammars are VS Code's prebuilt WASM set (TypeScript, TSX, JavaScript,
Python, Go, Rust, Java, C#, Ruby, PHP, C++). Each grammar's own `tags.scm` is
vendored in `src/queries`, plus nit's additions for TypeScript type aliases and
enums, and top-level constants. A test compiles every query. Definitions are
found by name: fff picks candidate files, tree-sitter confirms. References are
checked by tree-sitter too; matches in files without a grammar are listed apart
as text matches. `node_modules` isn't indexed.

In JavaScript and TypeScript, go to definition follows imports first: Bun's
resolver handles relative paths, tsconfig `paths`, workspace packages and
`package.json` `exports`. nit then follows barrels, `export *`, renamed and
default exports, and `import * as ns` members to the one declaration.
Dependencies resolve to their `.d.ts`. Only names that aren't imported fall back
to the repo-wide name search.

Known limits: `obj.method()` with an unknown type is matched by name and marked
approximate. A language server (definition, references, hover only) is a later,
optional addition.

## Out of scope

An editor, LSP diagnostics or completions, chat threads, AI summaries or
walkthroughs, AI rebase, a picker for other agent tools, themes, a file tree browser,
and Markdown or Mermaid rendering. To edit, press `o`.

## Where state lives

Nothing goes in the repo or in `.git`. State lives in nit's own data folder,
the same approach OpenCode uses:

- `~/.local/share/nit/nit.db`, one SQLite file (`bun:sqlite`, so no extra
  dependency). It holds drafts, viewed files and review passes. SQLite rather
  than JSON files because drafts save on every keystroke, and SQLite can't
  leave a half-written file.
- **Project identity:** a hash of the normalised `origin` URL, falling back to
  the repo's first commit. Every worktree and every fresh clone of the same
  repo map to the same project.
- **Review identity:** the project plus the PR number, or the branch name when
  there's no PR. Drafts therefore survive `crbn remove` deleting the worktree.
  Check the PR out again and they're back.
- **Lifetime:** drafts are deleted once posted to GitHub, or once you resolve
  them after an agent pass. On start, nit removes drafts for branches that
  no longer exist and haven't been touched for 30 days.
- `nit drafts --json` prints a review's drafts for other tools.

**Why not a GitHub pending review?** That only works for PRs. It needs the
network on every keystroke, allows one pending review per person, and can't
hold comments on lines outside the diff. nit posts to GitHub once, at the end.

### Snapshots for review passes

"Changes since the last review" and "undo the agent's edits" both come from a
shadow git repo, copied from OpenCode:

- It lives at `~/.local/share/nit/snapshot/<project>/<hash of worktree path>`.
- It has its own git directory and index, and its work tree is the review's
  checkout. It reuses the real repo's objects through `objects/info/alternates`
  and respects its ignore rules.
- nit takes a snapshot when you finish a pass and before each agent run.
- "Since last review" is the diff from the latest snapshot to the working tree.
  "Undo" restores files from the snapshot taken before the agent ran.
- The user's branch, index and stash are never touched.

## Extending nit

nit does the review. Other tools already own checkouts, environments and
editors, and nit should call them instead of copying them. The model is jdx's
tools (mise, hk): good defaults with no config, layered config files, every
setting also readable from an environment variable, and shell commands as the
escape hatch rather than a plugin API.

### Plug points

A plug point is a shell command with a small contract: logs go to stderr, and
the one useful result goes to stdout. That is the contract `crbn checkout`
already follows.

Values reach the command as environment variables, never pasted into the
command text. Branch names come from PR authors, and pasting one into a shell
string would let a branch named `x;rm -rf ~` run commands. OpenCode passes its
worktree start command values the same way.

| Plug point | Runs when | Gets | Must print | Default |
|---|---|---|---|---|
| `checkout` | `nit <pr>` or `nit <branch>` names something that isn't checked out | `NIT_PR`, `NIT_BRANCH`, `NIT_URL`, `NIT_REPO_ROOT` | The directory to review | Built in: reuse the branch's worktree if one exists, otherwise `git worktree add --detach` beside the repo, then `gh pr checkout` so `git push` updates the PR |
| `editor` | `o` | `NIT_FILE`, `NIT_LINE`, `NIT_COL` | Nothing | `$VISUAL` or `$EDITOR`, with known line syntax for zed, code, cursor, idea, nvim |

Example `.nit.toml` in carbon:

```toml
[commands]
checkout = 'crbn checkout "$NIT_PR" --print'
editor = 'zed "$NIT_FILE:$NIT_LINE"'
```

That needs one change in crbn: a `--print` flag that prints the bare path
instead of `cd '<path>'`. nit won't parse the `cd` line, because guessing at
another tool's output breaks silently.

nit never deletes a worktree it didn't create. With a `checkout` command set,
cleanup stays with that tool (`crbn remove`, `crbn prune`).

### Config

Config is read in this order, later entries winning:

1. `~/.config/nit/config.toml` (yours, every repo)
2. `.nit.toml` at the repo root (shared with the team, committed)
3. `.nit.local.toml` (yours, this repo, git-ignored)
4. `NIT_*` environment variables, for example `NIT_COMMANDS_EDITOR`

**Repo config is read from the base branch, never from the branch under
review.** Otherwise a PR could change `.nit.toml` and run any command on the
reviewer's machine. nit never shows a trust prompt. Reading config only from
the base branch, and passing values as environment variables, is the whole
safety model. A repo's own default branch can run commands through `.nit.toml`,
just as its `Makefile` and `package.json` scripts already can.

### Open data

`nit drafts --json` prints a review's drafts in a documented format. The local
server's HTTP API is the same contract the browser UI uses, with an event
stream for live updates (as OpenCode does), so an editor extension could show
drafts without a plugin system.

### Agent permissions

The Agent SDK run may read anything in the review's checkout and edit files
there. Shell commands are off by default. Each agent run is undoable from its
snapshot.

### Left out on purpose

A JavaScript plugin API, hooks for every event, and themes. OpenCode has
JS plugins and Markdown commands because it is a platform; nit is a single
tool, and shell plug points are enough. Add a plug point
only when a real tool needs one. The next likely one is `agent`, a command that
receives the drafts on stdin and edits the code, for people who don't want the
built-in Agent SDK run.

## Stack

Bun server (`Bun.serve`, HTML imports bundle the UI), React, `@pierre/diffs`,
`@anthropic-ai/claude-agent-sdk`, `@ff-labs/fff-bun`, `web-tree-sitter`, and `gh`
for GitHub.

Auth: nit has no login of its own. The Agent SDK runs the Claude Code binary,
which uses whatever credentials Claude Code already has on the machine. For
personal use, that's your existing Claude subscription login. If
`ANTHROPIC_API_KEY` is set, it takes precedence. Anthropic's Agent SDK
docs say that, unless previously approved, third-party products may not offer
claude.ai login or subscription rate limits. So a public release documents an
API key as the supported setup, unless Anthropic approves otherwise.

## Build order

Three phases. Each ends in something you can use every day.

0. Skeleton: CLI, server, diff view, file list, split/unified. **(done)**
1. **Review locally.** The design system and the whole review screen: file
   list, sticky header, line cursor and keyboard map, viewed state, and
   comments (drafts saved as you type, ranges, suggestions applied locally,
   labels, jump between comments), plus the `⌘K` palette. State lives in
   SQLite.
2. **Hand off.** Post to GitHub (submit dialog, existing threads with reply and
   resolve), `nit <pr>` with config and the `checkout` and `editor` plug
   points, and Apply with the Agent SDK (snapshots, undo, changes since last
   review).
3. **Navigate.** **(built, ahead of phase 2)** Go to definition (`g d`,
   ⌘-click) and find references (`g r`) with fff and tree-sitter, shown as an
   inline peek. An outline panel (`⇧O`) marks symbols the diff added, changed
   or removed. `@` in the palette jumps to a symbol, the header shows which
   function the cursor is in, and `⌘[` goes back.
