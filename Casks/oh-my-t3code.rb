# frozen_string_literal: true

cask "oh-my-t3code" do
  version "0.1.1"
  sha256 "d436f240d966c05758f1a3876dcac0f3269a4328b72928c171a4579873c4a0c5"

  url "https://github.com/alencarfreire/oh-my-t3code/releases/download/v#{version}/Oh.My.T3Code_#{version}_universal.dmg"
  name "Oh My T3Code"
  desc "Menu Bar companion, Preset Studio, and squad compiler for T3 Code"
  homepage "https://github.com/alencarfreire/oh-my-t3code"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Oh My T3Code.app"

  postflight_steps do
    run "/usr/bin/xattr",
        args: ["-dr", "com.apple.quarantine", "{{appdir}}/Oh My T3Code.app"]
  end

  zap trash: [
    "~/.config/oh-my-t3code",
    "~/Library/Application Support/com.vtech.ohmyt3code",
    "~/Library/Caches/com.vtech.ohmyt3code",
    "~/Library/Preferences/com.vtech.ohmyt3code.plist",
    "~/Library/Saved Application State/com.vtech.ohmyt3code.savedState",
  ]
end
