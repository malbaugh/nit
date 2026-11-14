// Writes the Homebrew formula for a release from its checksums:
// `bun scripts/formula.ts <dir with nit-*.tar.gz.sha256> > nit.rb`. The release workflow commits
// it to sidwebworks/homebrew-tap, so `brew install sidwebworks/tap/nit` gets the new version.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../src/embedded";

const dir = process.argv[2] ?? "dist/release";
const sha = (os: string, arch: string) =>
  readFileSync(join(dir, `nit-${os}-${arch}.tar.gz.sha256`), "utf8").split(" ")[0];
const asset = (os: string, arch: string) => `
      url "https://github.com/sidwebworks/nit/releases/download/v${VERSION}/nit-${os}-${arch}.tar.gz"
      sha256 "${sha(os, arch)}"`;

console.log(`class Nit < Formula
  desc "Keyboard-first local code review, with Claude as a second reader"
  homepage "https://sidwebworks.com/things/nit"
  version "${VERSION}"
  license "MIT"

  on_macos do
    on_arm do${asset("darwin", "arm64")}
    end
    on_intel do${asset("darwin", "x64")}
    end
  end

  on_linux do
    on_arm do${asset("linux", "arm64")}
    end
    on_intel do${asset("linux", "x64")}
    end
  end

  def install
    bin.install "nit"
  end

  def caveats
    "Claude features need Claude Code: https://claude.com/claude-code"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/nit --version")
  end
end`);
