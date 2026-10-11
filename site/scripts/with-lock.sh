#!/usr/bin/env bash
# Serialises astro build / check / dev across everyone sharing this checkout.
# mkdir is atomic, so whoever creates the directory owns the lock.
# Usage: ./scripts/with-lock.sh pnpm build
set -u

LOCK=/tmp/inboxies-site-build.lock
SITE_DIR=/Users/emmanuelaina/Developer/boxies/.claude/worktrees/product-landing-page-08efb2/site
POLL=2
GIVE_UP=900    # 15 min
STALE=1200     # 20 min

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

lock_age() {
  # Seconds since the lock dir was created (BSD stat first, GNU as fallback).
  local mtime
  mtime=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null) || return 1
  echo $(( $(date +%s) - mtime ))
}

holder_gone() {
  # The holder writes its pid on taking the lock; a pid that's no longer
  # running means it was killed before it could clean up.
  local pid
  pid=$(sed -n 's/^pid \([0-9]*\).*/\1/p' "$LOCK/owner" 2>/dev/null)
  [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null
}

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  age=$(lock_age) || age=0
  if [ "$age" -gt "$STALE" ] || holder_gone; then
    # A crashed run left the lock behind. Move it aside under a name of our
    # own first, so two waiters can't both clear it and both get in.
    echo "with-lock: removing stale lock (${age}s old)" >&2
    mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null && rm -rf "$LOCK.stale.$$"
    continue
  fi
  if [ "$waited" -ge "$GIVE_UP" ]; then
    echo "with-lock: gave up after ${GIVE_UP}s waiting for $LOCK" >&2
    exit 75
  fi
  if [ $(( waited % 30 )) -eq 0 ]; then
    holder=$(cat "$LOCK/owner" 2>/dev/null || echo unknown)
    echo "with-lock: waiting for lock held by: $holder" >&2
  fi
  sleep "$POLL"
  waited=$(( waited + POLL ))
done

# Release on every exit path, including Ctrl-C and kill.
trap 'rm -rf "$LOCK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Record who holds it so waiters can see what they're queued behind.
echo "pid $$ — $*" > "$LOCK/owner"

cd "$SITE_DIR" || exit 1
"$@"
