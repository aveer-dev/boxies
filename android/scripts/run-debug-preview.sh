#!/usr/bin/env bash
# Launch an Inboxies DEBUG preview surface on a connected emulator/device.
# Mirrors iOS Simulator launch args (-previewDomainAdmin, -previewMailbox, …).
#
# Usage:
#   ./scripts/run-debug-preview.sh domainAdmin
#   ./scripts/run-debug-preview.sh mailbox
#   ./scripts/run-debug-preview.sh loadMore
#   ./scripts/run-debug-preview.sh manyNew
#   ./scripts/run-debug-preview.sh toast
#   ./scripts/run-debug-preview.sh reminderPicker   # Reply Later "Remind me" picker open (AVE-86)
#   ./scripts/run-debug-preview.sh reminderToast    # "Added to Reply Later" + "Add reminder" toast
#   ./scripts/run-debug-preview.sh reminderDue      # inbox with a due reminder: attention Reply Later button
#   ./scripts/run-debug-preview.sh loadFailed
#   ./scripts/run-debug-preview.sh listError
#   ./scripts/run-debug-preview.sh screener
#   ./scripts/run-debug-preview.sh screenerList
#   ./scripts/run-debug-preview.sh screenerUndo        # Screening room after Decline + Undo toast (AVE-159)
#   ./scripts/run-debug-preview.sh screenerUndoAccept  # … after Accept → Promotions
#   ./scripts/run-debug-preview.sh domainDns
#   ./scripts/run-debug-preview.sh forgotPassword
#   ./scripts/run-debug-preview.sh twoFactorChallenge  # email sign-in, 2FA code step
#   ./scripts/run-debug-preview.sh replyLater
#   ./scripts/run-debug-preview.sh spam
#   ./scripts/run-debug-preview.sh newsletter   # long, wide newsletter open in the reader (AVE-89)
#   ./scripts/run-debug-preview.sh replyQuote   # reply composer quoting a promo mail; tap the quote dock (AVE-133)
#   ./scripts/run-debug-preview.sh notes        # inbox rows with sticky strip + private notes chip
#   ./scripts/run-debug-preview.sh notesDetail  # thread with a draggable sticky + inline notes
#   ./scripts/run-debug-preview.sh passwordSignIn
#   ./scripts/run-debug-preview.sh inviteAccept
#   ./scripts/run-debug-preview.sh signInMethods
#   ./scripts/run-debug-preview.sh inviteAcceptSignedIn
#   ./scripts/run-debug-preview.sh members
#   ./scripts/run-debug-preview.sh sessions
#   ./scripts/run-debug-preview.sh senders             # Settings → Senders, Allowed tab
#   ./scripts/run-debug-preview.sh sendersBlocked      # Settings → Senders, Blocked tab
#   ./scripts/run-debug-preview.sh suppressions        # Settings → Outgoing mail → Bounced addresses
#   ./scripts/run-debug-preview.sh tags                # Settings → Tags (custom folders, AVE-158)
#   ./scripts/run-debug-preview.sh tagsRename          # Settings → Tags, rename dialog open
#   ./scripts/run-debug-preview.sh tagsDelete          # Settings → Tags, delete confirmation open
#   ./scripts/run-debug-preview.sh settings            # Settings sheet (Screener switch on)
#   ./scripts/run-debug-preview.sh settingsScreenerOff # Settings sheet, Screener off
#   ./scripts/run-debug-preview.sh aiUsage             # agent chat, usage meter at 42 / 50 (warning)
#   ./scripts/run-debug-preview.sh aiUsageLimit        # agent chat at 50 / 50: limit notice, composer off
#   ./scripts/run-debug-preview.sh aiUsageSettings     # Settings sheet with the AI usage section
#   ./scripts/run-debug-preview.sh serviceEnded        # read-only inbox, admin "Renew"
#   ./scripts/run-debug-preview.sh serviceEndedMember  # read-only inbox, "Ask an admin"
#   ./scripts/run-debug-preview.sh serviceEnding       # admin "Keep subscription"
#   ./scripts/run-debug-preview.sh domainDnsEnded      # DNS console, Subscription card
#   ./scripts/run-debug-preview.sh widgets             # "Today's inbox" widget mocks (AVE-138)
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
  domainOnboarding|DomainOnboarding|onboarding|previewDomainOnboarding) extra=previewDomainOnboarding; label=domainOnboarding ;;
  passwordSignIn|PasswordSignIn|password|previewPasswordSignIn) extra=previewPasswordSignIn; label=passwordSignIn ;;
  inviteAccept|InviteAccept|invite|previewInviteAccept) extra=previewInviteAccept; label=inviteAccept ;;
  signInMethods|SignInMethods|signinmethods|previewSignInMethods) extra=previewSignInMethods; label=signInMethods ;;
  inviteAcceptSignedIn|InviteAcceptSignedIn|previewInviteAcceptSignedIn) extra=previewInviteAcceptSignedIn; label=inviteAcceptSignedIn ;;
  members|Members|previewMembers) extra=previewMembers; label=members ;;
  sessions|Sessions|previewSessions) extra=previewSessions; label=sessions ;;
  senders|Senders|previewSenders) extra=previewSenders; label=senders ;;
  sendersBlocked|SendersBlocked|previewSendersBlocked) extra=previewSendersBlocked; label=sendersBlocked ;;
  suppressions|Suppressions|previewSuppressions) extra=previewSuppressions; label=suppressions ;;
  tags|Tags|previewTags) extra=previewTags; label=tags ;;
  tagsRename|TagsRename|previewTagsRename) extra=previewTagsRename; label=tagsRename ;;
  tagsDelete|TagsDelete|previewTagsDelete) extra=previewTagsDelete; label=tagsDelete ;;
  settings|Settings|previewSettings) extra=previewSettings; label=settings ;;
  settingsScreenerOff|SettingsScreenerOff|previewSettingsScreenerOff) extra=previewSettingsScreenerOff; label=settingsScreenerOff ;;
  mailbox|Mailbox|previewMailbox) extra=previewMailbox; label=mailbox ;;
  loadMore|LoadMore|previewLoadMore) extra=previewLoadMore; label=loadMore ;;
  manyNew|ManyNew|previewManyNew) extra=previewManyNew; label=manyNew ;;
  toast|Toast|previewToast) extra=previewToast; label=toast ;;
  reminderPicker|ReminderPicker|previewReminderPicker) extra=previewReminderPicker; label=reminderPicker ;;
  reminderToast|ReminderToast|previewReminderToast) extra=previewReminderToast; label=reminderToast ;;
  reminderDue|ReminderDue|previewReminderDue) extra=previewReminderDue; label=reminderDue ;;
  loadFailed|LoadFailed|previewLoadFailed) extra=previewLoadFailed; label=loadFailed ;;
  listError|ListError|previewListError) extra=previewListError; label=listError ;;
  screener|Screener|previewScreener) extra=previewScreener; label=screener ;;
  screenerList|ScreenerList|previewScreenerList) extra=previewScreenerList; label=screenerList ;;
  screenerUndo|ScreenerUndo|previewScreenerUndo) extra=previewScreenerUndo; label=screenerUndo ;;
  screenerUndoAccept|ScreenerUndoAccept|previewScreenerUndoAccept) extra=previewScreenerUndoAccept; label=screenerUndoAccept ;;
  domainDns|DomainDns|dns|previewDomainDns) extra=previewDomainDns; label=domainDns ;;
  forgotPassword|ForgotPassword|forgot|previewForgotPassword) extra=previewForgotPassword; label=forgotPassword ;;
  twoFactorChallenge|TwoFactorChallenge|twoFactor|2fa|previewTwoFactorChallenge) extra=previewTwoFactorChallenge; label=twoFactorChallenge ;;
  replyLater|ReplyLater|reply-later|previewReplyLater) extra=previewReplyLater; label=replyLater ;;
  spam|Spam|previewSpam) extra=previewSpam; label=spam ;;
  newsletter|Newsletter|previewNewsletter) extra=previewNewsletter; label=newsletter ;;
  replyQuote|ReplyQuote|previewReplyQuote) extra=previewReplyQuote; label=replyQuote ;;
  notes|Notes|previewNotes) extra=previewNotes; label=notes ;;
  notesDetail|NotesDetail|previewNotesDetail) extra=previewNotesDetail; label=notesDetail ;;
  aiUsage|AiUsage|ai-usage|previewAiUsage) extra=previewAiUsage; label=aiUsage ;;
  aiUsageLimit|AiUsageLimit|ai-usage-limit|previewAiUsageLimit) extra=previewAiUsageLimit; label=aiUsageLimit ;;
  aiUsageSettings|AiUsageSettings|ai-usage-settings|previewAiUsageSettings) extra=previewAiUsageSettings; label=aiUsageSettings ;;
  widgets|Widgets|widget|previewWidgets) extra=previewWidgets; label=widgets ;;
  splash|Splash|previewSplash) extra=previewSplash; label=splash ;;
  welcome|Welcome|previewWelcome) extra=previewWelcome; label=welcome ;;
  authOptions|AuthOptions|previewAuthOptions) extra=previewAuthOptions; label=authOptions ;;
  serviceEnded|ServiceEnded|previewServiceEnded) extra=previewServiceEnded; label=serviceEnded ;;
  serviceEndedMember|ServiceEndedMember|previewServiceEndedMember) extra=previewServiceEndedMember; label=serviceEndedMember ;;
  serviceEnding|ServiceEnding|previewServiceEnding) extra=previewServiceEnding; label=serviceEnding ;;
  domainDnsEnded|DomainDnsEnded|previewDomainDnsEnded) extra=previewDomainDnsEnded; label=domainDnsEnded ;;
  -h|--help|help)
    sed -n '2,51p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown preview mode: $mode" >&2
    echo "Try: splash | welcome | authOptions | passwordSignIn | twoFactorChallenge | domainAdmin | domainOnboarding | inviteAccept | signInMethods | mailbox | loadMore | manyNew | toast | reminderPicker | reminderToast | reminderDue | loadFailed | listError | screener | screenerList | screenerUndo | screenerUndoAccept | replyLater | spam | newsletter | replyQuote | notes | notesDetail | aiUsage | aiUsageLimit | aiUsageSettings | serviceEnded | serviceEndedMember | serviceEnding | domainDnsEnded | widgets" >&2
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
