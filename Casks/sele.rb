cask "sele" do
  version "3.1.0"
  sha256 "785f0b5bc54fc6060bbd37ddf5fd761aae978e24ee918d2445bf92f36a444585"

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
