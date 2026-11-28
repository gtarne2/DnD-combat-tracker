#!/bin/sh
# Assemble the unsigned macOS player app and zip it.
# Usage: tools/package-macos.sh <aurora-party binary> <output directory>
# The binary is usually a universal one made with lipo (see .github/workflows/macos-player.yml).
set -eu
binary="$1"
out="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$out/Aurora Combat Tracker.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$root/macos/Info.plist" "$app/Contents/Info.plist"
cp "$root/macos/Aurora Combat Tracker" "$app/Contents/MacOS/Aurora Combat Tracker"
cp "$binary" "$app/Contents/MacOS/aurora-party"
chmod +x "$app/Contents/MacOS/Aurora Combat Tracker" "$app/Contents/MacOS/aurora-party"
for notice in SRD-5.1-NOTICES.txt SRD-5.2.1-NOTICES.txt; do
    cp "$root/content/monster-packs/$notice" "$app/Contents/Resources/$notice"
done
# An ad-hoc signature (no Apple account) is required for Apple silicon to run the binary at all.
# It does not satisfy Gatekeeper, so the first launch still needs Open Anyway (see the read-me).
if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "$app"
fi
cp "$root/docs/mac-player.md" "$out/READ ME FIRST.txt"
