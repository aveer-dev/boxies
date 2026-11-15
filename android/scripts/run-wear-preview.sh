#!/usr/bin/env bash
# Launch an Inboxies for Wear OS DEBUG preview on a connected Wear OS emulator/watch
# (AVE-145). Peer of run-debug-preview.sh (phone) and the iOS watch's
# -previewWatch… launch args. Fixtures only: no phone link, no network, and the
# watch's real session is never read or touched.
#
# Usage:
#   ./scripts/run-wear-preview.sh inbox        # Inbox, two mailboxes (switcher row)
#   ./scripts/run-wear-preview.sh message      # first conversation open
#   ./scripts/run-wear-preview.sh reply        # quick reply: voice / keyboard + canned replies
#   ./scripts/run-wear-preview.sh mailboxes    # mailbox picker
#   ./scripts/run-wear-preview.sh connect      # "Open Inboxies on your phone" + Connect
#   ./scripts/run-wear-preview.sh connecting   # first launch, asking the phone quietly
#   INSTALL=1 ./scripts/run-wear-preview.sh inbox   # build + install :wear first
#   ADB="adb -s emulator-5556" ./scripts/run-wear-preview.sh inbox

set -euo pipefail

mode="${1:-inbox}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB:-adb}"
PKG="co.inboxies.app"
ACTIVITY="$PKG/co.inboxies.wear.MainActivity"

case "$mode" in
  inbox|Inbox|previewWatchInbox) extra=previewWatchInbox; label=inbox ;;
  message|Message|previewWatchMessage) extra=previewWatchMessage; label=message ;;
  reply|Reply|previewWatchReply) extra=previewWatchReply; label=reply ;;
  mailboxes|Mailboxes|previewWatchMailboxes) extra=previewWatchMailboxes; label=mailboxes ;;
  connect|Connect|previewWatchConnect) extra=previewWatchConnect; label=connect ;;
  connecting|Connecting|previewWatchConnecting) extra=previewWatchConnecting; label=connecting ;;
  -h|--help|help)
    sed -n '2,/^$/p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown wear preview mode: $mode" >&2
    echo "Try: inbox | message | reply | mailboxes | connect | connecting" >&2
    exit 1
    ;;
esac

if [[ "${INSTALL:-0}" == "1" ]]; then
  echo "→ :wear:assembleDebug + install"
  (cd "$ROOT" && ./gradlew :wear:assembleDebug)
  $ADB install -r "$ROOT/wear/build/outputs/apk/debug/wear-debug.apk"
fi

echo "→ force-stop $PKG"
$ADB shell am force-stop "$PKG" || true

echo "→ start $ACTIVITY ($label / --ez $extra true)"
$ADB shell am start -n "$ACTIVITY" --ez "$extra" true

echo "Done. Screencap: $ADB exec-out screencap -p > /tmp/inboxies-wear-$label.png"
