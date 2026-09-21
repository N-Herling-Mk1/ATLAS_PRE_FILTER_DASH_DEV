# apply_mk35b.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk35b.ps1
#
# mk35 lost its hub.js in transfer. This is that ONE file, re-cut. The mk35
# changelog row is already on disk -- mk36's docs were chained from mk35's, so
# the row came in with mk36 and nothing here touches docs.
#
# Safe to run after mk36; it does not carry or overwrite anything of mk36's.

$ErrorActionPreference = "Stop"
$path = "web\static\app\js\hub.js"
$want = "a7a845d7e253d8960981159e3fc41fb4566f46e5956557a47685a359172a91e4"

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk35b  (TV effects, hub.js only)" -ForegroundColor Cyan
Write-Host ("-" * 66)

$bad = @()
if (-not (Test-Path $path)) {
    Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path
} else {
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $want) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}

# the two behaviours mk35 exists to deliver
Write-Host ""
if (Select-String -Path $path -SimpleMatch -Pattern "shearLoop" -Quiet) {
    Write-Host "  STALE     shearLoop still present -- static/shear still on a metronome" -ForegroundColor Yellow
    $bad += "shearLoop"
} else {
    Write-Host "  ok        the 3-8 s shear loop is gone" -ForegroundColor Green
}
if (Select-String -Path $path -SimpleMatch -Pattern "else noise = 0.05" -Quiet) {
    Write-Host "  STALE     residual static still crawling on every picture" -ForegroundColor Yellow
    $bad += "residual"
} else {
    Write-Host "  ok        no residual static between changes" -ForegroundColor Green
}
if (Select-String -Path $path -SimpleMatch -Pattern "const CLEAR = 0.75" -Quiet) {
    Write-Host "  ok        the 75/25 glitch budget is in" -ForegroundColor Green
} else {
    Write-Host "  MISSING   the glitch budget" -ForegroundColor Red; $bad += "budget"
}

# mk36 must still be intact -- this drop is deliberately not carrying it
if (Select-String -Path "web\static\app\js\traces.js" -SimpleMatch -Pattern "const far = Math.max(24, room * 0.95)" -Quiet) {
    Write-Host "  ok        mk36's box pulse is untouched" -ForegroundColor Green
} else {
    Write-Host "  WARNING   mk36's pulse fix is not on disk" -ForegroundColor Yellow
}

# and the changelog row that came in with mk36
$rows = (Select-String -Path "docs\STAGE_A_SCOPE_mk2.md" -Pattern "\| mk3[56]\." -AllMatches).Count
Write-Host ("  changelog rows mk35 + mk36: {0} of 2" -f $rows) -ForegroundColor $(if ($rows -eq 2) { "Green" } else { "Yellow" })

Write-Host ("-" * 66)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk35b verified. Ctrl+F5 on / and watch one full 10 s dwell." -ForegroundColor Cyan
