cask "sele" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/chipichapa/sele/releases/latest/download/sele-macos-#{arch}.dmg",
      verified: "github.com/chipichapa/sele/"
  name "Sele"
  desc "Desktop AI harness for Codex"
  homepage "https://github.com/chipichapa/sele"

  depends_on :macos

  app "Sele.app"

  zap trash: [
    "~/Library/Application Support/Sele",
    "~/Library/Caches/com.chipichapa.sele",
    "~/Library/Preferences/com.chipichapa.sele.plist",
    "~/Library/Saved Application State/com.chipichapa.sele.savedState",
  ]
end
