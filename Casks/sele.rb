cask "sele" do
  version "3.34.0"
  sha256 "17eb93b9a59dab5ec9a0a12a4c7e68862670d619049bf1e92c96a32c632e08ba"

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
