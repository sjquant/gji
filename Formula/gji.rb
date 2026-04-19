class Gji < Formula
  desc "Git worktree CLI for fast context switching"
  homepage "https://github.com/sjquant/gji"
  url "https://github.com/sjquant/gji/releases/download/v0.4.0/gji-v0.4.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    bin.install "bin/gji", "bin/gji-bundle.mjs"
    man1.install Dir["man/man1/*.1"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gji --version")
  end
end
