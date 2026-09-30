#!/usr/bin/env bash
# Launch an Inboxies DEBUG preview surface on a connected emulator/device.
# Mirrors iOS Simulator launch args (-previewDomainAdmin, -previewMailbox, …).
#
# Usage:
#   ./scripts/run-debug-preview.sh domainAdmin
#   ./scripts/run-debug-preview.sh mailbox
#   ./scripts/run-debug-preview.sh screener
#   ./scripts/run-debug-preview.sh replyLater
#   ./scripts/run-debug-preview.sh passwordSignIn
#   ./scripts/run-debug-preview.sh inviteAccept
#   ./scripts/run-debug-preview.sh signInMethods
#
# Env:
#   ANDROID_SERIAL  — optional adb device serial
#   INSTALL=1       — assembleDebug + adb install -r before launch

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB:-adb}"
PKG="co.inboxies.app"
ACTIVITY="$PKG/.MainActivity"

mode="${1:-domainAdmin}"
# Normalize aliases
case "$mode" in
  domainAdmin|DomainAdmin|admin|previewDomainAdmin) extra=previewDomainAdmin; label=domainAdmin ;;
  passwordSignIn|PasswordSignIn|password|previewPasswordSignIn) extra=previewPasswordSignIn; label=passwordSignIn ;;
  inviteAccept|InviteAccept|invite|previewInviteAccept) extra=previewInviteAccept; label=inviteAccept ;;
  signInMethods|SignInMethods|signinmethods|previewSignInMethods) extra=previewSignInMethods; label=signInMethods ;;
  mailbox|Mailbox|previewMailbox) extra=previewMailbox; label=mailbox ;;
  screener|Screener|previewScreener) extra=previewScreener; label=screener ;;
  replyLater|ReplyLater|reply-later|previewReplyLater) extra=previewReplyLater; label=replyLater ;;
  -h|--help|help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown preview mode: $mode" >&2
    echo "Try: domainAdmin | passwordSignIn | inviteAccept | signInMethods | mailbox | screener | replyLater" >&2
    exit 1
    ;;
esac

if [[ "${INSTALL:-0}" == "1" ]]; then
  echo "→ assembleDebug + install"
  (cd "$ROOT" && ./gradlew :app:assembleDebug)
  apk="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
  "$ADB" install -r "$apk"
fi

echo "→ force-stop $PKG"
"$ADB" shell am force-stop "$PKG" || true

echo "→ start $ACTIVITY ($label / --ez $extra true)"
"$ADB" shell am start -n "$ACTIVITY" --ez "$extra" true

echo "Done. Screencap: adb exec-out screencap -p > /tmp/inboxies-$label.png"
