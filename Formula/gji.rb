class Gji < Formula
  desc "Git worktree CLI for fast context switching"
  homepage "https://github.com/sjquant/gji"
  url "https://github.com/sjquant/gji/releases/download/v0.12.0/gji-v0.12.0.tar.gz"
  # Updated automatically by publish.yml after each release.
  sha256 "6c8a94b0c50b7f25a1ab6311ec1b7ae8876bb79c5e943c425f142753e776191a"
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
