class Gji < Formula
  desc "Git worktree CLI for fast context switching"
  homepage "https://github.com/sjquant/gji"
  url "https://github.com/sjquant/gji/releases/download/v0.7.1/gji-v0.7.1.tar.gz"
  # Updated automatically by publish.yml after each release.
  sha256 "94cc5846c863d1ed9b2f8cc12fe125b80314420248c0f21307a01223db8304e7"
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
