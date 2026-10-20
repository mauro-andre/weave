#!/usr/bin/env bash
# publish.sh — one version, three destinations: npm (stage), GitHub release, GHCR image.
#
# The version string from the ROOT package.json drives all three destinations:
# the npm package version, the GitHub release tag (bare, no "v" prefix — repo
# convention) and both image tags. Guards run before any external effect; any
# failure exits non-zero with a clear message and a per-destination summary.
#
# Secrets: NPM_TOKEN / GITHUB_TOKEN are read from .env at the repo root and are
# never echoed (no set -x, no verbose curl, password via stdin only).
#
# The npm path is `npm stage publish` — the NPM_TOKEN is stage-only and npm
# rejects a direct publish with E_STAGE_REQUIRED. Promotion (2FA) is a human
# step: `npm stage approve <stage-id> --otp <code>`, outside this script.
#
# Usage: scripts/publish.sh [--dry-run]
#   --dry-run  runs guards, builds the SDK, validates the tarball, rehearses
#              `npm stage publish --dry-run` and prints the full plan —
#              nothing is staged, released or pushed, and the tree is left
#              exactly as it was found.

set -Eeuo pipefail

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *)
    echo "usage: scripts/publish.sh [--dry-run]" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SDK_PKG="@mauroandre/weave-sdk"
SDK_DIR="packages/sdk"
GH_OWNER=""
GH_REPO=""
GH_LOGIN=""
IMG=""

# ---- per-destination state, printed by the EXIT trap on success AND failure
VERSION=""
NPM_STATE="pending"
NPM_NOTE=""
GH_STATE="pending"
GH_NOTE=""
IMG_STATE="pending"
IMG_NOTE=""

say() { printf '%s\n' "$*"; }
die() { printf 'publish: %s\n' "$*" >&2; exit 1; }

# ---- temp workspace: npm userconfig, tarball, backups, API responses
WORK="$(mktemp -d)"
SDK_BAK=""
LOCK_BAK=""

print_summary() {
  [ -n "$VERSION" ] || return 0
  say ""
  say "=== release ${VERSION} — summary ==="
  say "  npm (${SDK_PKG}): ${NPM_STATE}${NPM_NOTE:+ — ${NPM_NOTE}}"
  say "  github (${GH_OWNER:-<owner>}/${GH_REPO:-<repo>}): ${GH_STATE}${GH_NOTE:+ — ${GH_NOTE}}"
  say "  image (${IMG:-ghcr.io/<owner>/weave}): ${IMG_STATE}${IMG_NOTE:+ — ${IMG_NOTE}}"
  if [ "$DRY_RUN" = 1 ]; then
    say "  dry-run: nothing was staged, released or pushed."
    return 0
  fi
  # Recovery hints for whatever is still pending (partial failure).
  if [ "$NPM_STATE" != "ok" ] && [ "$NPM_STATE" != "staged" ]; then
    say "  npm pending: nothing was staged — re-run after fixing the failure above."
  fi
  if [ "$NPM_STATE" = "staged" ] && { [ "$GH_STATE" != "ok" ] || [ "$IMG_STATE" != "ok" ]; }; then
    say "  partial state: npm is staged but a later destination failed."
    say "    undo the stage : npm stage list  →  npm stage reject <stage-id>"
    say "    or finish by hand: see the plan printed by scripts/publish.sh --dry-run"
  fi
  if [ "$GH_STATE" = "ok" ] && [ "$IMG_STATE" != "ok" ]; then
    say "  image pending: build and push by hand —"
    say "    podman build -t ${IMG}:${VERSION} -t ${IMG}:latest ."
    say "    printf %s \"\$GITHUB_TOKEN\" | podman login ghcr.io -u <your-github-login> --password-stdin"
    say "    podman push ${IMG}:${VERSION} && podman push ${IMG}:latest"
  fi
  # Human next steps after a complete real run.
  if [ "$NPM_STATE" = "staged" ]; then
    say ""
    say "next (human): approve the stage with 2FA —"
    say "  npm stage list                       # find the stage id if needed"
    say "  npm stage approve <stage-id> --otp <code>"
  fi
  if [ "$NPM_STATE" = "staged" ] || [ "$GH_STATE" = "ok" ] || [ "$IMG_STATE" = "ok" ]; then
    say ""
    say "the tree now carries ${VERSION} in ${SDK_DIR}/package.json — commit pending (your move)."
    say "the next run without that commit fails the clean-tree guard: republishing the"
    say "same version is blocked."
  fi
}

cleanup() {
  local rc=$?
  # Restore the workspace shape on exit:
  #   dry-run  → byte-for-byte backup of manifest (+lockfile): the ensaio
  #              leaves the tree exactly as found.
  #   real run → only exports (and friends) return to the workspace shape; the
  #              new version stays — the designed dirty state, commit pending.
  if [ "$SDK_BAK" = 1 ] && [ -f "$WORK/sdk-package.json.bak" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      cp "$WORK/sdk-package.json.bak" "$SDK_DIR/package.json" || true
      if [ "$LOCK_BAK" = 1 ] && [ -f "$WORK/package-lock.json.bak" ]; then
        cp "$WORK/package-lock.json.bak" package-lock.json || true
      fi
    else
      node -e '
const fs = require("fs");
const cur = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const bak = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const f of ["exports", "main", "types", "bin"]) {
  if (f in bak) cur[f] = bak[f]; else delete cur[f];
}
fs.writeFileSync(process.argv[1], JSON.stringify(cur, null, 2) + "\n");
' "$SDK_DIR/package.json" "$WORK/sdk-package.json.bak" || true
    fi
  fi
  rm -rf "$WORK" || true
  print_summary || true
  exit "$rc"
}
trap cleanup EXIT

# ============================== guards ==============================
# Every guard runs before any external effect. Each failure names the problem
# and exits non-zero.

say "==> guards"

# --- .env with both tokens (values are only ever read, never printed)
[ -f "$ROOT/.env" ] || die ".env not found at repo root — copy .env.example and fill NPM_TOKEN / GITHUB_TOKEN"
read_env_var() {
  v="$(grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2-)"
  printf '%s' "$v" | tr -d "\"'"
}
NPM_TOKEN="$(read_env_var NPM_TOKEN)"
GITHUB_TOKEN="$(read_env_var GITHUB_TOKEN)"
[ -n "$NPM_TOKEN" ] || die "NPM_TOKEN missing or empty in .env (see .env.example)"
[ -n "$GITHUB_TOKEN" ] || die "GITHUB_TOKEN missing or empty in .env (see .env.example)"

# --- reference version: the root package.json, one string for all destinations
VERSION="$(node -p "require('$ROOT/package.json').version")"
case "$VERSION" in
  *[!0-9A-Za-z.-]* | "" ) die "invalid version in root package.json: '${VERSION}'" ;;
esac
say "    version: ${VERSION} (root package.json)"

# --- inside a git work tree, with an origin remote
REMOTE_URL="$(git remote get-url origin 2>/dev/null)" || true
[ -n "$REMOTE_URL" ] || die "not a git repository with an 'origin' remote — run from the repo root"

# --- HEAD synced with the remote: published == committed == pushed. Runs
#     before the clean-tree guard so a branch never pushed is named as such.
BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || die "detached HEAD — publish from a branch"
if ! REMOTE_SHA="$(git ls-remote origin "refs/heads/${BRANCH}" 2>/dev/null)"; then
  die "cannot reach origin (${REMOTE_URL}) to verify HEAD sync"
fi
REMOTE_SHA="$(printf '%s' "$REMOTE_SHA" | cut -f1)"
[ -n "$REMOTE_SHA" ] || die "branch '${BRANCH}' does not exist on the remote — push it before publishing"
LOCAL_SHA="$(git rev-parse HEAD)"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || die "HEAD (${LOCAL_SHA:0:12}) differs from origin/${BRANCH} (${REMOTE_SHA:0:12}) — sync before publishing"

# --- clean tree: what is published must be what is committed.
#     Real run: hard fail. Dry-run: warn and continue — an ensaio on a working
#     tree is a legitimate rehearsal; the barrier belongs to the real run.
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    say "    WARNING: tree is dirty — the REAL run will stop here (list follows)"
    git status --porcelain >&2 || true
  else
    git status --porcelain >&2
    die "tree is dirty (see list above) — commit or clean before publishing"
  fi
fi

# --- owner/repo derived from the origin remote (never hardcoded)
GH_SLUG="$(printf '%s' "$REMOTE_URL" | sed -nE 's#^(git@github[.]com:|https://github[.]com/|ssh://git@github[.]com/)([^/]+)/([^/]+)$#\2/\3#p')"
case "$GH_SLUG" in
  */*) GH_OWNER="${GH_SLUG%%/*}"; GH_REPO="${GH_SLUG#*/}" ;;
  *) die "origin is not a GitHub remote (got: ${REMOTE_URL}) — owner/repo cannot be derived" ;;
esac
GH_REPO="${GH_REPO%.git}"
GH_OWNER="$(printf '%s' "$GH_OWNER" | tr '[:upper:]' '[:lower:]')"
IMG="ghcr.io/${GH_OWNER}/weave"
say "    repo   : ${GH_OWNER}/${GH_REPO} (from origin)"
say "    image  : ${IMG}"

# --- version must not be live on the registry yet
if npm view "${SDK_PKG}@${VERSION}" version >/dev/null 2>&1; then
  die "${SDK_PKG}@${VERSION} is already live on the registry — bump the root package.json first"
fi
say "    registry: ${VERSION} not live yet"

# --- npm token authenticates (temporary userconfig; never touches ~/.npmrc)
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$WORK/npmrc"
chmod 600 "$WORK/npmrc"
export NPM_CONFIG_USERCONFIG="$WORK/npmrc"
NPM_USER="$(npm whoami 2>/dev/null || true)"
if [ -z "$NPM_USER" ]; then
  # stage-only tokens may not answer whoami; `npm stage list` proves auth
  npm stage list >/dev/null 2>&1 || die "NPM_TOKEN did not authenticate (npm whoami / npm stage list both failed)"
  NPM_USER="stage-token"
fi
say "    npm    : authenticated (${NPM_USER})"

# --- github token authenticates (also gives the GHCR login user: the token
#     owner's login, NOT the repo owner — they may differ)
GH_CODE="$(curl -sS -o "$WORK/gh-user.json" -w '%{http_code}' \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/user)" || die "GitHub API unreachable (api.github.com)"
[ "$GH_CODE" = 200 ] || die "GITHUB_TOKEN did not authenticate (GET /user → HTTP ${GH_CODE})"
GH_LOGIN="$(node -p "JSON.parse(require('fs').readFileSync('$WORK/gh-user.json','utf8')).login")"
[ -n "$GH_LOGIN" ] || die "could not read the GitHub login from GET /user"
say "    github : authenticated (${GH_LOGIN})"

say "==> guards ok"

# ========================= version + build + pack =========================
# Common to both modes. The dry-run restores the touched manifests on exit
# (byte-for-byte backup), so an ensaio leaves the tree exactly as found.

say "==> stamping ${VERSION} into ${SDK_DIR}/package.json + publish shape (exports→dist)"
cp "$SDK_DIR/package.json" "$WORK/sdk-package.json.bak"; SDK_BAK=1
if [ -f package-lock.json ]; then
  cp package-lock.json "$WORK/package-lock.json.bak"; LOCK_BAK=1
fi
npm version "$VERSION" --no-git-tag-version --no-workspaces-update --allow-same-version --workspace "$SDK_PKG" >/dev/null
# npm does NOT apply publishConfig.exports as a manifest field on this npm
# (verified: npm warn "Unknown publishConfig config" and the tarball kept
# exports→src). The publish shape lives HERE — the packer is the one who swaps
# the fields — and the workspace shape (exports→src) comes back on exit; the
# real run keeps only the new version as its designed dirty state.
PUBLISH_EXPORTS='{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"},"./cli":{"types":"./dist/cli.d.ts","import":"./dist/cli.js"}}'
node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.exports = JSON.parse(process.argv[2]);
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$SDK_DIR/package.json" "$PUBLISH_EXPORTS"

say "==> building the SDK (tsup) + prepack (agent skills)"
npm run build --workspace "$SDK_PKG"
npm run prepack --workspace "$SDK_PKG"

say "==> packing and validating the tarball"
npm pack --workspace "$SDK_PKG" --pack-destination "$WORK" > "$WORK/pack.out"
TGZ="$WORK/$(tail -1 "$WORK/pack.out")"
[ -f "$TGZ" ] || die "npm pack did not produce the expected tarball"
tar -tzf "$TGZ" > "$WORK/tar-files.txt"
tar -xOzf "$TGZ" package/package.json > "$WORK/tar-manifest.json"

cat > "$WORK/validate.mjs" <<'EOF'
import fs from "node:fs";
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const m = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const version = process.argv[4];
const want = [];
if (m.version !== version) throw new Error(`tarball version is ${m.version}, expected ${version}`);
if (m.main) want.push(m.main);
if (m.types) want.push(m.types);
if (m.bin) for (const b of Object.values(m.bin)) want.push(b);
if (m.exports) for (const e of Object.values(m.exports)) for (const v of Object.values(e)) want.push(v);
const norm = (p) => p && "package/" + p.replace(/^\.\//, "");
const missing = want.filter((p) => p && !files.includes(norm(p)));
if (missing.length) throw new Error(`manifest points outside the tarball: ${missing.join(", ")}`);
for (const must of ["package/dist/index.js", "package/dist/cli.js"]) {
  if (!files.includes(must)) throw new Error(`tarball is missing ${must}`);
}
if (!files.some((f) => /^package\/agent\/skills\/.+\/SKILL\.md$/.test(f))) {
  throw new Error("tarball is missing agent/skills/*/SKILL.md");
}
console.log(`tarball ok: ${files.length} files, manifest (main/types/bin/exports) resolves inside, dist + agent/skills present`);
EOF
if ! node "$WORK/validate.mjs" "$WORK/tar-files.txt" "$WORK/tar-manifest.json" "$VERSION" 2> "$WORK/validate.err" > "$WORK/validate.out"; then
  die "tarball validation failed: $(head -1 "$WORK/validate.err")"
fi
cat "$WORK/validate.out"

# ============================== dry-run ==============================
if [ "$DRY_RUN" = 1 ]; then
  say ""
  say "==> rehearsing the staged publish path (npm stage publish --dry-run)"
  (cd "$SDK_DIR" && npm stage publish . --dry-run)
  say ""
  say "==> PLAN — nothing below runs in --dry-run; version ${VERSION} goes to all three destinations"
  say "  1. npm    : (cd ${SDK_DIR} && npm stage publish .)"
  say "              → stages ${SDK_PKG}@${VERSION} for a maintainer to approve with 2FA"
  say "  2. github : POST /repos/${GH_OWNER}/${GH_REPO}/releases"
  say "              { tag_name: \"${VERSION}\", name: \"${VERSION}\", target_commitish: \"${BRANCH}\" }"
  say "  3. image  : podman build -t ${IMG}:${VERSION} -t ${IMG}:latest ${ROOT}"
  say "              printf %s \"\$GITHUB_TOKEN\" | podman login ghcr.io -u ${GH_LOGIN} --password-stdin"
  say "              podman push ${IMG}:${VERSION} && podman push ${IMG}:latest"
  NPM_STATE="rehearsed"; NPM_NOTE="npm stage publish --dry-run ok"
  GH_STATE="planned"; GH_NOTE="tag ${VERSION}, bare (no v prefix)"
  IMG_STATE="planned"; IMG_NOTE="two tags: ${VERSION} + latest"
  exit 0
fi

# ============================== real run ==============================

say ""
say "==> npm: staging ${SDK_PKG}@${VERSION} (promotion is a human 2FA step)"
(cd "$SDK_DIR" && npm stage publish .) 2>&1 | tee "$WORK/stage.out"
NPM_STATE="staged"
NPM_NOTE="awaiting approval — npm stage list / npm stage approve <stage-id> --otp <code>"
say ""
say "staged packages (id for the approve step):"
npm stage list 2>&1 || true
STAGE_ID="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORK/stage.out" | head -1 || true)"
if [ -n "$STAGE_ID" ]; then
  NPM_NOTE="awaiting approval — npm stage approve ${STAGE_ID} --otp <code>"
fi

say ""
say "==> github: creating release ${VERSION} on ${GH_OWNER}/${GH_REPO}"
GH_CODE="$(curl -sS -o "$WORK/gh-release.json" -w '%{http_code}' -X POST \
  "https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "{\"tag_name\":\"${VERSION}\",\"name\":\"${VERSION}\",\"target_commitish\":\"${BRANCH}\",\"body\":\"\"}")" \
  || die "GitHub API unreachable (api.github.com)"
if [ "$GH_CODE" != 201 ]; then
  GH_MSG="$(node -p "try{JSON.parse(require('fs').readFileSync('$WORK/gh-release.json','utf8')).message}catch{''}" 2>/dev/null || true)"
  die "GitHub release failed (HTTP ${GH_CODE})${GH_MSG:+: ${GH_MSG}}"
fi
GH_URL="$(node -p "JSON.parse(require('fs').readFileSync('$WORK/gh-release.json','utf8')).html_url")"
GH_STATE="ok"
GH_NOTE="tag ${VERSION} — ${GH_URL}"

say ""
say "==> image: building ${IMG}:${VERSION} (+ latest) and pushing to ghcr.io"
podman build -t "${IMG}:${VERSION}" -t "${IMG}:latest" "$ROOT"
printf '%s' "$GITHUB_TOKEN" | podman login ghcr.io -u "$GH_LOGIN" --password-stdin >/dev/null
podman push "${IMG}:${VERSION}"
podman push "${IMG}:latest"
IMG_STATE="ok"
IMG_NOTE="${VERSION} + latest pushed"

say ""
say "release ${VERSION} complete."
exit 0
