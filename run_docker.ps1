# ATLAS_PRE_FILTER_DASH -- container launcher (mk47). Docker Desktop or Podman.
#   .\run_docker.ps1                  local: build, run, open http://127.0.0.1:5710/ (no tunnel)
#   .\run_docker.ps1 -Tunnel          hosted: build, run app + cloudflared, nothing published
#   .\run_docker.ps1 -Down            stop the stack (the store volume is kept)
#   .\run_docker.ps1 -Logs            follow the logs
# Needs deploy\docker\stack.env (copy stack.env.example) and .env (python -m server.set_password).
param([switch]$Tunnel, [switch]$Down, [switch]$Logs, [switch]$Podman, [switch]$NoBrowser)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$engine = if ($Podman) { "podman" } else { "docker" }
$stackEnv = "deploy\docker\stack.env"
function Step($n, $of, $msg) { Write-Host ("[{0}/{1}] {2}" -f $n, $of, $msg) -ForegroundColor Cyan }

$files = @("-f", "compose.yaml")
if (-not $Tunnel) { $files += @("-f", "compose.local.yaml") }
$base = @("compose") + $files + @("--env-file", $stackEnv)
if ($Tunnel) { $base += @("--profile", "tunnel") }

if ($Down) { & $engine @base down; exit $LASTEXITCODE }
if ($Logs) { & $engine @base logs -f; exit $LASTEXITCODE }

Step 1 5 "checking prerequisites ($engine)"
if (-not (Get-Command $engine -ErrorAction SilentlyContinue)) { throw "$engine not found on PATH" }
& $engine info *> $null
if ($LASTEXITCODE -ne 0) { throw "$engine is installed but its engine is not running (start Docker Desktop / podman machine)" }
if (-not (Test-Path $stackEnv)) { throw "no $stackEnv -- copy deploy\docker\stack.env.example and fill it in" }
if (-not (Test-Path ".env")) { throw "no .env -- run: python -m server.set_password" }
$kv = @{}
Get-Content $stackEnv | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2; $kv[$k.Trim()] = $v.Trim() }
foreach ($k in "PFD_LOCATIONS_HOST", "PFD_DATA_HOST") {
  if (-not $kv[$k]) { throw "$k is empty in $stackEnv" }
  if (-not (Test-Path $kv[$k])) { throw "$k points at a missing path: $($kv[$k])" }
}
if ($Tunnel -and -not $kv["TUNNEL_TOKEN"]) { throw "TUNNEL_TOKEN is empty in $stackEnv (needed with -Tunnel)" }
$weak = (Select-String -Path .env -Pattern '^PFD_PASSWORD_WEAK=1' -Quiet)
if ($Tunnel -and $weak) { Write-Host "  WARNING: weak password and the site is about to be public. python -m server.set_password" -ForegroundColor Yellow }

Step 2 5 "stamping the image with the current commit"
$commit = (git rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = "unknown" }
$dirty = (git status --porcelain --untracked-files=no 2>$null)
if ($dirty) { $commit += "+dirty" }
$env:PFD_CODE_COMMIT = $commit
Write-Host "  commit $commit"

Step 3 5 "building atlas-pfd image (first build takes a few minutes)"
& $engine @base build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Step 4 5 ("starting stack: " + $(if ($Tunnel) { "app + cloudflared (tunnel)" } else { "app on 127.0.0.1:5710 (local)" }))
& $engine @base up -d
if ($LASTEXITCODE -ne 0) { throw "up failed" }

Step 5 5 "waiting for /health"
$ok = $false
$cid = (& $engine @base ps -q app | Select-Object -First 1)
if (-not $cid) { throw "no app container found after up" }
for ($i = 1; $i -le 30; $i++) {
  $state = (& $engine inspect --format "{{.State.Health.Status}}" $cid 2>$null)
  Write-Progress -Activity "atlas-pfd" -Status "health: $state" -PercentComplete ([int]($i * 100 / 30))
  if ($state -eq "healthy") { $ok = $true; break }
  Start-Sleep -Seconds 2
}
Write-Progress -Activity "atlas-pfd" -Completed
if (-not $ok) { & $engine @base logs --tail 40 app; throw "app did not become healthy in 60 s" }
Write-Host "  app healthy" -ForegroundColor Green
if ($Tunnel) {
  Write-Host "  tunnel up: https://nth-atlas-llp.com/  (check: $engine compose logs cloudflared)"
} elseif (-not $NoBrowser) {
  Start-Process "http://127.0.0.1:5710/"
}
