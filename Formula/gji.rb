class Gji < Formula
  desc "Git worktree CLI for fast context switching"
  homepage "https://github.com/sjquant/gji"
  url "https://github.com/sjquant/gji/releases/download/v0.6.0/gji-v0.6.0.tar.gz"
  # Updated automatically by publish.yml after each release.
  sha256 "2d8d94f05572d3eb1f371a7c0cdad693f759205fcedbed00b0e79f479e227d51"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "libexec/gji-bundle.mjs"
    inreplace "bin/gji", "./gji-bundle.mjs", libexec/"gji-bundle.mjs"
    bin.install "bin/gji"
    man1.install Dir["man/man1/*.1"] if (buildpath/"man/man1").exist?
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gji --version")
  end
end
