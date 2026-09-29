# One-time: create ATLAS_PRE_FILTER_DASH_dev and put this history (plus mk47) in it.
#
#   cd <the folder that holds your repos>
#   .\bootstrap_dev_repo.ps1 -Bundle .\ATLAS_PRE_FILTER_DASH_dev_mk47.bundle
#
# Result: .\ATLAS_PRE_FILTER_DASH_dev (in the current folder) with
#   origin   -> github.com/N-Herling-Mk1/ATLAS_PRE_FILTER_DASH_dev   (develop here)
#   release  -> github.com/N-Herling-Mk1/ATLAS_PRE_FILTER_DASH       (promote here)
# The release repo is not touched by this script.
param(
  [Parameter(Mandatory = $true)][string]$Bundle,
  [string]$Dest = "",
  [string]$Owner = "N-Herling-Mk1",
  [string]$Name = "ATLAS_PRE_FILTER_DASH_dev",
  [string]$Release = "ATLAS_PRE_FILTER_DASH"
)
$ErrorActionPreference = "Stop"
function Step($n, $of, $msg) { Write-Host ("[{0}/{1}] {2}" -f $n, $of, $msg) -ForegroundColor Cyan }
$Bundle = (Resolve-Path $Bundle).Path
if (-not $Dest) { $Dest = Join-Path (Get-Location).Path $Name }
$devUrl = "https://github.com/$Owner/$Name.git"
$relUrl = "https://github.com/$Owner/$Release.git"

Step 1 4 "checking the bundle"
git bundle list-heads $Bundle
if ($LASTEXITCODE -ne 0) { throw "bundle failed verification" }

Step 2 4 "creating $Owner/$Name on GitHub (private)"
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh repo view "$Owner/$Name" *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "  exists already; reusing it" }
  else {
    gh repo create "$Owner/$Name" --private --description "ATLAS_PRE_FILTER_DASH development line (promotes to $Release)"
    if ($LASTEXITCODE -ne 0) { throw "gh repo create failed" }
  }
} else {
  Write-Host "  gh not found. Create an EMPTY private repo named $Name at https://github.com/new" -ForegroundColor Yellow
  Write-Host "  (no README, no .gitignore, no licence), then press Enter." -ForegroundColor Yellow
  Read-Host | Out-Null
}

Step 3 4 "cloning the bundle into $Dest"
if (Test-Path $Dest) { throw "$Dest already exists; move it or pass -Dest" }
git clone $Bundle $Dest
if ($LASTEXITCODE -ne 0) { throw "clone failed" }
Push-Location $Dest
git remote set-url origin $devUrl
git remote add release $relUrl
git fetch release

Step 4 4 "pushing main to origin ($Name)"
git push -u origin main
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "push failed (auth? the repo must exist and be empty)" }
Pop-Location

Write-Host ""
Write-Host "Done. Work in $Dest." -ForegroundColor Green
Write-Host "Promote a tested state to the release repo:"
Write-Host "    git push release main            # fast-forward only; refuses if release has moved"
Write-Host "Or tag it first:  git tag mk47 ; git push release main --tags"
