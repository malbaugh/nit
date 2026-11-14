<p align="center"><img src="https://raw.githubusercontent.com/sidwebworks/nit/main/docs/logo/icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">nit</h1>

A keyboard-first code review tool that runs on your machine, with Claude as a second reader.

`nit` opens your branch, or any pull request, as a page in your browser. You read it with the keyboard, leave comments, ask Claude about the parts you're unsure of, and post one review to GitHub when you're done.

**[sidwebworks.com/things/nit](https://sidwebworks.com/things/nit)**

![nit reviewing a pull request: the files in Claude's reading order, a side-by-side diff and the file's outline](https://raw.githubusercontent.com/sidwebworks/nit/main/docs/media/hero.png)

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/sidwebworks/nit/main/install.sh | sh
```

```sh
brew install sidwebworks/tap/nit
```

Both install one binary for macOS or Linux (arm64 and x64).

## Use

```
nit                 review this branch against its default base
nit <branch>        review against another branch or commit
nit <pr>            review a pull request (number, #number or URL) in its own worktree
```

nit starts a local server and opens a tab. Press `⌘K` for every file and action.

## What it does

**Read it in order.** Guide asks Claude to sort the files into a few chapters, the heart of the change first. Lockfiles, generated code, tests, docs and whitespace-only changes can be set aside, as your `.gitattributes` or plain conventions say.

**Ask about any lines.** Select lines and press `⌘I`. Claude reads the code around them and the project's guidelines, and answers under the lines. Conversations are kept with the review and never posted.

![Asking Claude what could go wrong with the selected lines](https://raw.githubusercontent.com/sidwebworks/nit/main/docs/media/ask.gif)

**Comment, then post once.** Comments and suggested changes work as on GitHub, saved as you type. Post them all as one review, or hand them to Claude to apply.

![Draft comments, one with a suggested change](https://raw.githubusercontent.com/sidwebworks/nit/main/docs/media/comments.png)

**Search the whole repo.** `⌘⇧F` searches every file, with results as code. `⌘`-click a name to peek at its definition.

![Repository-wide search](https://raw.githubusercontent.com/sidwebworks/nit/main/docs/media/search.png)

**The whole pull request.** The description, the checks (with flagged lines in the diff) and the linked Linear issue. A viewed file that changes again is unmarked, and can show just what changed since you looked.

![The pull request drawer](https://raw.githubusercontent.com/sidwebworks/nit/main/docs/media/pr.png)

## Keyboard

| Keys | Action |
| --- | --- |
| `j` `k` | Next and previous file |
| `n` `p` | Next and previous change |
| `c` | Comment on the selected lines |
| `⌘I` | Ask Claude about them |
| `v` | Mark the file viewed |
| `g` `d` | Go to definition |
| `⌘⇧F` | Search the repository |
| `⌘K` | Every file and action |
| `⌘⇧↵` | Review and post |

## What it needs

- **git.** nit reviews the repository you run it in.
- **GitHub**, for pull requests: your `gh` login, or a token saved in Settings (kept in your keychain).
- **Claude**, for the Claude features: [Claude Code](https://claude.com/claude-code) installed, and an Anthropic API key saved in Settings. Everything else works without it.

Reviews, drafts and settings stay on your machine, in `~/.local/share/nit` (or `$NIT_DATA_DIR`). nit talks to GitHub and Anthropic, and nothing else.

## Develop

```sh
bun install
bun run dev          # NIT_DEV=1: rebuilds the UI as you edit
bun test
bun run compile      # the single binary for this machine, in dist/release
```

Releases: bump `version` in `package.json`, then push a `v<version>` tag. The release workflow builds every platform, publishes the GitHub release and the Homebrew formula.

## Licence

MIT
