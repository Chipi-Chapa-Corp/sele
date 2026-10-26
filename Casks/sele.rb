cask "sele" do
  version "3.12.0"
  sha256 "de4a905f28ca81e578fda680fcee66a8ec5c0f3a2566e7bc68453702fd3b39a0"

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
