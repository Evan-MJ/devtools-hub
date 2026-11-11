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
#   7. health         -> scripts/health-check.sh, read-only, on the production
#                        domain. A green build with a broken page is not done.
#   8. conclude       -> print what is live, in a few lines.
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

# The publish path has to write a FRESH tool-dates.json and a sitemap.xml built from
# it (BUG-469) — the GitHub build is a shallow clone and can only carry the dates that
# are committed here. Those two files are therefore regenerated during the publish and
# must be put back afterwards, or the publish leaves the working tree dirty and the
# next run's "clean tree" check fails on leftovers nobody edited.
restore_generated() { git checkout -- "${GENERATED[@]}" 2>/dev/null || true; }
trap restore_generated EXIT

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
#
# BUG-469: sitemap.xml's tool <lastmod> comes from that same map (BUG-375), so the
# sitemap is regenerated from it too. Recomputing only the map published a tree whose
# two surfaces disagreed ("the sitemap says 2026-11-10, tool-dates.json says
# 2026-11-11"). Only sitemap.xml is regenerated: llms.txt / llms-full.txt carry a
# "Last updated: <today>" stamp, and rewriting them here would make the published
# tree change every single day for no content change.
node scripts/gen-tool-dates.js >/dev/null
node scripts/regen-static-fallbacks.js sitemap >/dev/null

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

# ------------------------------------------------------------- 7. health ----
# The deployment succeeded; now check that the live site actually answers. A
# green build with a broken page is the failure mode that hurts, so the button
# refuses to call it done without this.
say "[publish] 7/8 health check (read-only)"
if bash scripts/health-check.sh; then
  HEALTH=green
else
  HEALTH=red
fi

# ----------------------------------------------------------- 8. conclude ----
say "[publish] 8/8 done"
say ""
say "  deployment       = $DEPLOY_ID (success)"
say "  health           = $HEALTH"
say "  live             = https://tools.scoreroute.com/"
say "  snapshot commit  = $SNAPSHOT   <- what is live now"
say "  published tree   = $TREE   <- the tree that was published"
say "  local HEAD       = $(git rev-parse HEAD)   <- differs from the snapshot on purpose"

# A red health check after a successful deploy is the one case the button must
# not report as success. It does NOT roll back here: rollback needs a target
# deployment id and a revert of main, and it is A4's job to own that decision.
if [ "$HEALTH" = "red" ]; then
  say ""
  say "  The build was green but the live site is not. Roll back with:"
  say "    bash scripts/rollback.sh   (picks the last good deployment by itself)"
  exit 1
fi
