cask "sele" do
  version "3.33.0"
  sha256 "03fcccd1a702cb8ca8d36077675ada1115605082bf9b89230354879e8d6f3aa2"

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
