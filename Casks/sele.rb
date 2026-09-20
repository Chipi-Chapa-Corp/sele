cask "sele" do
  version "2.16.0"
  sha256 "69c5473555f7078d3d6552241491cd8f402dbf807b7efdd91743a6cac18e9003"

  url "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v#{version}/sele-macos-arm64.dmg",
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
