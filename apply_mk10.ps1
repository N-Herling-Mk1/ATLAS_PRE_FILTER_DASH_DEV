# apply_mk10.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk10 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk10.ps1
#
# Unblocks the dropped files, verifies each by SHA256 (size and timestamp are not
# evidence -- OneDrive reverts silently), and retires seg7.js, which mk10 replaces
# with the cathode console.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\login.html"        = "b39d22a369f6269bf9286902980c64f922fcb602d2ec243c952288d4583d259d"
    "web\static\public\css\gate.css"  = "9b59a69f1318a4d4ed43b28d7125fe5bd2954756ff6c482bafb83287ecedc783"
    "web\static\public\js\gate.js"    = "36ddfa0a85c42d3ecc18e74ad853503182e1ae325ac67401b14a37e4f8e2b971"
    "web\static\public\js\crt.js"     = "40034efa5121aca27d931c9a59818d4db92d8fbb64f66e72134e0edaca585b58"
    "docs\STAGE_A_SCOPE_mk2.md"       = "c6cbbdffc20b376f851e6ad2dbd2e50ace8a790e16ff5c06f019e56749afc219"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk10" -ForegroundColor Cyan
Write-Host ("-" * 62)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk10" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) {
        Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red
        $bad += $path; continue
    }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) {
        Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green
    } else {
        Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red
        Write-Host ("            want {0}" -f $expected[$path]) -ForegroundColor DarkGray
        Write-Host ("            have {0}" -f $h) -ForegroundColor DarkGray
        $bad += $path
    }
}
Write-Progress -Activity "Verifying mk10" -Completed

# seg7.js is superseded by crt.js; nothing references it after mk10
$dead = "web\static\public\js\seg7.js"
if (Test-Path $dead) {
    Write-Host ""
    Write-Host "Retiring $dead (replaced by crt.js)" -ForegroundColor Yellow
    Remove-Item -Force $dead
    Write-Host "  removed" -ForegroundColor Green
}

# anything still pointing at the old readout would be a half-applied drop
$stale = Get-ChildItem -Recurse -File -Include *.html, *.css, *.js -Path web -EA SilentlyContinue |
         Select-String -SimpleMatch -Pattern "seg7"
if ($stale) {
    Write-Host ""
    foreach ($h in $stale) {
        Write-Host ("  STALE seg7 reference: {0}:{1}" -f (Resolve-Path -Relative $h.Path), $h.LineNumber) -ForegroundColor Yellow
    }
}

Write-Host ("-" * 62)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk10 verified." -ForegroundColor Cyan
Write-Host ""
Write-Host "The server auto-reloads templates and Python, but NOT your browser cache:" -ForegroundColor Yellow
Write-Host "/static/public/* has no no-store header, so HARD-RELOAD the gate (Ctrl+F5)" -ForegroundColor Yellow
Write-Host "or gate.js and gate.css will still be the mk9 copies." -ForegroundColor Yellow
