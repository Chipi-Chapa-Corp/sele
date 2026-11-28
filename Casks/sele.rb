cask "sele" do
  version "4.1.1"
  sha256 "c8a2f9974e1428cf86e285f32d549e1725b64700e0c44fada3f89c9429da0b74"

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
