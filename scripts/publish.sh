#!/bin/bash
# The publish button. One command, one conclusion.
#
#   bash scripts/publish.sh            (remote = origin)
#
# What it does, in this order (the order is the whole point):
#
#   1. build          -> bash scripts/build.sh. A non-zero exit means the site is
#                        broken, and NOTHING is published. Cloudflare keeps the
#                        previous deployment live.
#   2. restore        -> the build rewrites the generated files (llms.txt,
#                        llms-full.txt, sitemap.xml, tool-dates.json). The date
#                        stamp in llms.txt changes every day, so a build always
#                        dirties the tree; restore it or the "clean tree" check
#                        below reports a lie.
#   3. self-check     -> branch is main, the remote is Evan-MJ/devtools-hub, the
#                        working tree is clean (no edits, no stray files).
#   4. compare        -> publish the tree only if it differs from origin/main.
#                        A second run with no changes must not push and must not
#                        trigger a deployment.
#   5. publish        -> scripts/publish-github.sh publishes the tree as a
#                        snapshot commit on origin/main; Cloudflare Pages builds
#                        it automatically.
#   6. wait           -> poll the deployment until it succeeds or fails.
#   7. conclude       -> print what is live, in three lines.
#
# Nothing here is reversible except the deployment itself: to undo, roll back to
# the previous deployment and revert main. This script never rolls back on its
# own -- that is the health check's job (A3/A4), not the button's.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE="${PUBLISH_REMOTE:-origin}"
WAIT_SECONDS="${PUBLISH_WAIT_SECONDS:-1200}"
ACCOUNT_ID_FALLBACK="dfd1444566cc6b76eda1c8a9fabbb6f9"

# The files the build regenerates. Restoring them keeps the tree exactly as the
# author left it, so the clean-tree check means "no uncommitted edits".
GENERATED=(llms.txt llms-full.txt sitemap.xml tool-dates.json)

say() { printf '%s\n' "$*"; }
die() { printf 'publish: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. build ----
say "[publish] 1/7 build (a non-zero build publishes nothing)"
bash scripts/build.sh

# -------------------------------------------------------------- 2. restore ----
say "[publish] 2/7 restore the generated files"
git checkout -- "${GENERATED[@]}" 2>/dev/null || true

# ------------------------------------------------------------ 3. self-check ----
say "[publish] 3/7 self-check"
BRANCH=$(git symbolic-ref --quiet --short HEAD || echo "(detached)")
[ "$BRANCH" = "main" ] || die "branch is '$BRANCH', not main. Publishing a side branch publishes its tree to production."

REMOTE_URL=$(git remote get-url "$REMOTE" 2>/dev/null || echo "")
case "$REMOTE_URL" in
  *Evan-MJ/devtools-hub*) ;;
  *) die "remote '$REMOTE' is '$REMOTE_URL', not Evan-MJ/devtools-hub" ;;
esac

DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" | sed 's/^/    /' >&2
  die "working tree is not clean (build artifacts are restored; the rest are uncommitted edits)"
fi

# -------------------------------------------------------------- 4. compare ----
say "[publish] 4/7 compare with origin/main"
# The publish tree is the working tree, which is what publish-github.sh pushes.
# Recomputing tool-dates.json first makes this comparison exact.
node scripts/gen-tool-dates.js >/dev/null

publish_tree() {
  local idx
  idx="$(mktemp -t publish-index.XXXXXX)"
  rm -f "$idx"                       # git wants the index file to not exist yet
  GIT_INDEX_FILE="$idx" git read-tree HEAD
  GIT_INDEX_FILE="$idx" git add -A
  local tree
  tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
  rm -f "$idx"
  echo "$tree"
}

git fetch --quiet "$REMOTE" main || true
TREE=$(publish_tree)
REMOTE_TREE=$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/main^{tree}" || echo "")

if [ -n "$REMOTE_TREE" ] && [ "$TREE" = "$REMOTE_TREE" ]; then
  say "[publish] 5/7 tree unchanged ($TREE) -> not pushing, no deployment triggered"
  say ""
  say "  tree == origin/main = $TREE   (identical, nothing to publish)"
  say "  no push, no deployment, production untouched"
  exit 0
fi

# ------------------------------------------------------------- 5. publish ----
say "[publish] 5/7 publish the tree to $REMOTE/main"
PUBLISH_OUT=$(bash scripts/publish-github.sh "$REMOTE")
printf '%s\n' "$PUBLISH_OUT"
SNAPSHOT=$(printf '%s\n' "$PUBLISH_OUT" | grep -oE '[0-9a-f]{40}' | tail -1)
[ -n "$SNAPSHOT" ] || die "could not read the snapshot commit out of the publish output"

# ---------------------------------------------------------------- 6. wait ----
say "[publish] 6/7 wait for the deployment (up to ${WAIT_SECONDS}s)"

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f .env ]; then
  TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' .env | head -1)
fi
[ -n "$TOKEN" ] || die "no CLOUDFLARE_API_TOKEN (env or .env) -- cannot read the deployment status"

ACCOUNT_ID="${CF_ACCOUNT_ID:-}"
if [ -z "$ACCOUNT_ID" ] && [ -f .env ]; then
  ACCOUNT_ID=$(sed -n 's/^CF_ACCOUNT_ID=//p' .env | head -1)
fi
ACCOUNT_ID="${ACCOUNT_ID:-$ACCOUNT_ID_FALLBACK}"

DEPLOY_ID=""
DEPLOY_STATUS=""
DEADLINE=$(( $(date +%s) + WAIT_SECONDS ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  BODY=$(curl -s --max-time 30 \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/devtools-hub/deployments?env=production&per_page=5" \
    -H "Authorization: Bearer $TOKEN" || true)
  read -r DEPLOY_ID DEPLOY_STATUS <<< "$(printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin).get("result") or []
except Exception:
    d = []
for x in d:
    src = x.get("source") or {}
    sha = ((x.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") or src.get("commit_hash") or ""
    if sha.startswith(sys.argv[1]):
        print(x.get("id", ""), (x.get("latest_stage") or {}).get("status", ""))
        break
' "$SNAPSHOT")"
  if [ "$DEPLOY_STATUS" = "success" ]; then break; fi
  if [ "$DEPLOY_STATUS" = "failure" ] || [ "$DEPLOY_STATUS" = "error" ]; then break; fi
  sleep 20
done

if [ "$DEPLOY_STATUS" != "success" ]; then
  say ""
  say "  deployment status = ${DEPLOY_STATUS:-timeout} (id ${DEPLOY_ID:-none})"
  say "  the previous deployment is still live -- Cloudflare only swaps on a successful build"
  exit 1
fi

# ------------------------------------------------------------- 7. conclude ----
say "[publish] 7/7 done"
say ""
say "  deployment       = $DEPLOY_ID (success)"
say "  live             = https://tools.scoreroute.com/"
say "  snapshot commit  = $SNAPSHOT   <- what is live now"
say "  published tree   = $TREE   <- the tree that was published"
say "  local HEAD       = $(git rev-parse HEAD)   <- differs from the snapshot on purpose"
