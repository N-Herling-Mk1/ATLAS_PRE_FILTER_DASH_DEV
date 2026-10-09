# ATLAS_PRE_FILTER_DASH_DEV -> ATLAS_PRE_FILTER_DASH (release) transfer, mk1.
#
#   .\promote_to_release.ps1 -DryRun            show what would transfer, change nothing
#   .\promote_to_release.ps1 -Tag mk48          transfer, tag the release, push both repos
#   .\promote_to_release.ps1 -Tag mk48 -Deploy  ...then rebuild and restart the live site
#
# Run it from the DEV repo, after committing your work there.
#
# The transfer is a git fast-forward from this folder into the release folder,
# not a file copy. That moves every tracked file (adds, edits, deletes) and
# leaves the release folder's own untracked files alone: .env, deploy\docker\stack.env
# and anything else git-ignored. Those are checked before and after, by hash.
param(
  [string]$Tag = "",
  [string]$Release = "",
  [switch]$Deploy,
  [switch]$DryRun,
  [switch]$SkipTests,
  [switch]$NoPush
)
$ErrorActionPreference = "Stop"
$Dev = $PSScriptRoot
if (-not $Release) { $Release = Join-Path (Split-Path $Dev -Parent) "ATLAS_PRE_FILTER_DASH" }
$Protected = @(".env", "deploy\docker\stack.env")
$total = 7

function Step($n, $msg) { Write-Host ("[{0}/{1}] {2}" -f $n, $total, $msg) -ForegroundColor Cyan }
function Info($msg) { Write-Host ("  " + $msg) }
function Good($msg) { Write-Host ("  " + $msg) -ForegroundColor Green }
function Stop-Here($msg) { Write-Host ("  STOP: " + $msg) -ForegroundColor Red; exit 1 }
function Git-In($dir) {
  # git -C <dir> <args...>; returns stdout lines, leaves $LASTEXITCODE set
  $rest = $args
  & git -C $dir @rest
}
function Hash-Of($path) {
  if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash } else { "absent" }
}

# ---------------------------------------------------------------- 1 --
Step 1 "checking both repos"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Here "git not found on PATH" }
if (-not (Test-Path (Join-Path $Dev ".git"))) { Stop-Here "this folder is not a git repo: $Dev" }
if (-not (Test-Path (Join-Path $Release ".git"))) { Stop-Here "release repo not found at $Release (pass -Release <path>)" }
$Release = (Resolve-Path $Release).Path
$devUrl = (Git-In $Dev remote get-url origin)
$relUrl = (Git-In $Release remote get-url origin)
# direction guard: this script only ever goes DEV -> release
if ($devUrl -notmatch 'ATLAS_PRE_FILTER_DASH_DEV(\.git)?/?$') { Stop-Here "run this from the DEV repo. This folder's origin is $devUrl" }
if ($relUrl -notmatch 'ATLAS_PRE_FILTER_DASH(\.git)?/?$') { Stop-Here "target is not the release repo. Its origin is $relUrl" }
$devBranch = (Git-In $Dev rev-parse --abbrev-ref HEAD)
$relBranch = (Git-In $Release rev-parse --abbrev-ref HEAD)
if ($devBranch -ne "main") { Stop-Here "DEV is on branch '$devBranch', expected main" }
if ($relBranch -ne "main") { Stop-Here "release is on branch '$relBranch', expected main" }
$devDirty = @(Git-In $Dev status --porcelain)
if ($devDirty.Count -gt 0) {
  $devDirty | ForEach-Object { Info $_ }
  Stop-Here "DEV has uncommitted or untracked files (above). Commit them (or delete strays) first."
}
$relDirty = @(Git-In $Release status --porcelain --untracked-files=no)
if ($relDirty.Count -gt 0) {
  $relDirty | ForEach-Object { Info $_ }
  Stop-Here "release has edited tracked files (above). Never edit release directly: move the change to DEV, then 'git -C `"$Release`" checkout -- .'"
}
Info "DEV      $Dev"
Info "release  $Release"
Good "both on main, both clean"

# ---------------------------------------------------------------- 2 --
Step 2 "what will transfer"
$devHead = (Git-In $Dev rev-parse HEAD)
$relHead = (Git-In $Release rev-parse HEAD)
Git-In $Release fetch --quiet $Dev main
if ($LASTEXITCODE -ne 0) { Stop-Here "could not read DEV from the release repo" }
if ($devHead -eq $relHead) { Good "release is already at DEV's commit ($($devHead.Substring(0,7))). Nothing to transfer."; exit 0 }
Git-In $Release merge-base --is-ancestor $relHead $devHead
if ($LASTEXITCODE -ne 0) {
  Stop-Here "release has commits DEV does not have, so a clean fast-forward is impossible. In DEV: git pull `"$Release`" main, resolve, commit, re-run."
}
$commits = @(Git-In $Release log --oneline "$relHead..$devHead")
$files = @(Git-In $Release diff --name-status "$relHead..$devHead")
Info ("{0} commit(s):" -f $commits.Count)
$commits | ForEach-Object { Info ("   " + $_) }
Info ("{0} file(s):" -f $files.Count)
$files | ForEach-Object { Info ("   " + $_) }
if ($Tag) {
  $have = @(Git-In $Release tag --list $Tag)
  if ($have.Count -gt 0) { Stop-Here "tag '$Tag' already exists in release. Pick the next one." }
}
if ($DryRun) { Good "dry run: nothing changed."; exit 0 }

# ---------------------------------------------------------------- 3 --
Step 3 "running the DEV test suite"
if ($SkipTests) { Info "skipped (-SkipTests)" }
else {
  & (Join-Path $Dev "run_tests.ps1")
  if ($LASTEXITCODE -ne 0) { Stop-Here "tests failed. Nothing was transferred." }
  Set-Location $Dev
  Good "tests passed"
}

# ---------------------------------------------------------------- 4 --
Step 4 "pushing DEV to GitHub"
if ($NoPush) { Info "skipped (-NoPush)" }
else {
  Git-In $Dev push --quiet origin main
  if ($LASTEXITCODE -ne 0) { Stop-Here "DEV push failed. Nothing was transferred." }
  Good "DEV pushed"
}

# ---------------------------------------------------------------- 5 --
Step 5 "fast-forwarding release to DEV"
$before = @{}
foreach ($p in $Protected) { $before[$p] = Hash-Of (Join-Path $Release $p) }
Git-In $Release merge --ff-only --quiet $devHead
if ($LASTEXITCODE -ne 0) { Stop-Here "fast-forward refused. Release is unchanged." }
$now = (Git-In $Release rev-parse HEAD)
if ($now -ne $devHead) { Stop-Here "release HEAD is $now, expected $devHead" }
Good ("release moved {0} -> {1}" -f $relHead.Substring(0,7), $devHead.Substring(0,7))

# ---------------------------------------------------------------- 6 --
Step 6 "checking the release-only files were not touched"
foreach ($p in $Protected) {
  $after = Hash-Of (Join-Path $Release $p)
  if ($after -ne $before[$p]) { Stop-Here "$p changed during the transfer. Roll back: git -C `"$Release`" reset --hard $($relHead.Substring(0,7))" }
  if ($after -eq "absent") { Info ("{0,-26} absent (was absent before too)" -f $p) }
  else { Good ("{0,-26} unchanged" -f $p) }
}

# ---------------------------------------------------------------- 7 --
Step 7 "tagging and pushing release"
if ($Tag) {
  Git-In $Release tag $Tag
  if ($LASTEXITCODE -ne 0) { Stop-Here "could not create tag $Tag" }
  Good "tagged $Tag"
} else { Info "no -Tag given, so no tag" }
if ($NoPush) { Info "push skipped (-NoPush)" }
else {
  Git-In $Release push --quiet origin main
  if ($LASTEXITCODE -ne 0) { Stop-Here "release push failed (the local transfer is done; re-run 'git push origin main' in release)" }
  if ($Tag) {
    Git-In $Release push --quiet origin $Tag
    if ($LASTEXITCODE -ne 0) { Stop-Here "tag push failed (re-run 'git push origin $Tag' in release)" }
  }
  Good "release pushed"
}

Write-Host ""
Good "transfer complete."
Info ("roll back with:  git -C `"$Release`" reset --hard {0}" -f $relHead.Substring(0,7))
if ($Deploy) {
  Write-Host ""
  Write-Host "rebuilding and restarting the live site" -ForegroundColor Cyan
  & (Join-Path $Release "run_docker.ps1") -Tunnel
  exit $LASTEXITCODE
} else {
  Info "the live site still runs the old build. To update it:"
  Info ("   cd `"$Release`"; .\run_docker.ps1 -Tunnel")
}
