# apply_mk25e.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root after extracting
# the mk25e zip into 0_ATLAS_DASHBORD (the zip carries the ATLAS_PRE_FILTER_DASH level).
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25e.ps1
#
# mk25e: readout under the control box, deck closer in. CSS + JS only.

$ErrorActionPreference = "Stop"
$expected = [ordered]@{
    "web\static\public\css\hub.css"        = "e2fd266f56b6e9d1728a552161d24e4bef47ebc8074d21d251d5f6b7ed1c3c98"
    "web\static\app\js\deck.js"            = "1f40926d7be18ceb8dbe7d5b2d2974544649eb6054f967390f324069eb13be6b"
    "docs\STAGE_A_SCOPE_mk2.md"            = "8512cafbd83e96966cd44bedcad7e99b62a5f2df4479cdf35f7f913446698cc7"
}
Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25e  (readout under the control box)" -ForegroundColor Cyan
Write-Host ("-" * 70)
Write-Host "  unblocking every file under the repo (Zone.Identifier)" -ForegroundColor DarkGray
Get-ChildItem -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25e" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "Verifying mk25e" -Completed
Write-Host ("-" * 70)
if ($bad.Count) { Write-Host "FAILED. Re-extract and re-run." -ForegroundColor Red; exit 1 }
Write-Host "mk25e verified." -ForegroundColor Cyan
Write-Host "CSS + JS only: no restart." -ForegroundColor Yellow
Write-Host "Then Ctrl+F5 on / . Check: name + index sit under the control box; deck moved left." -ForegroundColor DarkGray
