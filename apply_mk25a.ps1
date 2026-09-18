# apply_mk25a.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root after extracting
# the mk25a zip into 0_ATLAS_DASHBORD (the zip carries the ATLAS_PRE_FILTER_DASH level).
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25a.ps1
#
# mk25a: edge_sim reports a dead origin as 502 on Windows too (was 524, which
# failed test_edge_behaviour). One server file and a changelog row.

$ErrorActionPreference = "Stop"
$expected = [ordered]@{
    "server\edge_sim.py"          = "38686a481e0ab0cb155cbc8911ae1a24507c6ee978f65280339beaf7bb7c7fd7"
    "docs\STAGE_A_SCOPE_mk2.md"   = "ae76cd05ff1a662700be248c139112e97d96350a11bd72faabd3c986e3b879a3"
}
Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25a  (edge_sim 502 on Windows)" -ForegroundColor Cyan
Write-Host ("-" * 70)
$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25a" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "Verifying mk25a" -Completed
Write-Host ("-" * 70)
if ($bad.Count) { Write-Host "FAILED. Re-extract and re-run." -ForegroundColor Red; exit 1 }

$py = "C:\venvs\atlas_pfd\Scripts\python.exe"
if (Test-Path $py) {
    Write-Host "[tests] full suite" -ForegroundColor Cyan
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { Write-Host "Tests FAILED -- see above." -ForegroundColor Red; exit 1 }
} else { Write-Host "[tests] venv not found -- run .\run_tests.ps1" -ForegroundColor Yellow }
Write-Host "mk25a verified. If the parity server is running, restart it (Python changed)." -ForegroundColor Cyan
