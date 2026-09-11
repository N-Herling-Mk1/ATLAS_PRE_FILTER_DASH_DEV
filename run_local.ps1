# ATLAS_PRE_FILTER_DASH local launcher.
#   .\run_local.ps1 -Data home                 parity mode (default): behaves like the hosted site
#   .\run_local.ps1 -Data home -Mode dev       Flask dev server with auto-reload
#   .\run_local.ps1 -Data office
#   .\run_local.ps1 -Data C:\path\file_locations.txt
#   .\run_local.ps1 -Data home -LlpSrc C:\...\projects\atlas\src   S9 uses llp/data.py::apply_scale
# First run on PS 5.1 after unzipping:  Get-ChildItem -Recurse | Unblock-File
param(
  [ValidateSet("parity", "dev", "live")][string]$Mode = "parity",
  [string]$Data = "",
  [string]$LlpSrc = "",          # folder CONTAINING the llp package (…\projects\atlas\src)
  [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$venv = "C:\venvs\atlas_pfd"
$py = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "[setup] creating venv $venv"
  py -3 -m venv $venv
}
Write-Host "[setup] checking requirements"
& $py -m pip install -q -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

if (-not (Test-Path ".env")) {
  Write-Host "[auth ] no .env found: set the shared password now"
  & $py -m server.set_password
  if ($LASTEXITCODE -ne 0) { throw "password not set" }
}

if ($LlpSrc) {
  if (-not (Test-Path (Join-Path $LlpSrc "llp\data.py"))) { throw "no llp\data.py under $LlpSrc" }
  $env:PFD_LLP_SRC = $LlpSrc
}
$a = @("-m", "server.serve", "--mode", $Mode)
if ($Data -eq "home") { $a += "--home" }
elseif ($Data -eq "office") { $a += "--office" }
elseif ($Data) { $a += @("--locations", $Data) }
if ($NoBrowser) { $a += "--no-browser" }
& $py @a
