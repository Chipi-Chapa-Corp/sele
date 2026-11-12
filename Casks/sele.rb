cask "sele" do
  version "3.31.0"
  sha256 "6c66b825c65c1f2d7847cd5d2f806b3af1d5bdb8f91b4570a84afc7857be7a0b"

  url "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v#{version}-macos-arm64/sele-macos-arm64.dmg",
      verified: "github.com/Chipi-Chapa-Corp/sele/"
  name "Sele"
  desc "Desktop AI harness for Codex, Claude, and Copilot"
  homepage "https://github.com/Chipi-Chapa-Corp/sele"

  depends_on arch: :arm64
  depends_on :macos

  app "Sele.app"

  zap trash: [
    "~/Library/Application Support/Sele",
    "~/Library/Caches/com.chipichapa.sele",
    "~/Library/Preferences/com.chipichapa.sele.plist",
    "~/Library/Saved Application State/com.chipichapa.sele.savedState",
  ]
end
