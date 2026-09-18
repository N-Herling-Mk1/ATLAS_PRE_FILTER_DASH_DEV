# apply_mk25c.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root after extracting
# the mk25c zip into 0_ATLAS_DASHBORD (the zip carries the ATLAS_PRE_FILTER_DASH level).
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk25c.ps1
#
# mk25c: bigger dial and deck, closer together; Open under the dial; red
# underline under the section name. Template + CSS + JS.

$ErrorActionPreference = "Stop"
$expected = [ordered]@{
    "web\templates\hub.html"               = "2957f0b70e2b752e1d96a8d982ecca781611aea2d306d12cc59178a1bb835091"
    "web\static\public\css\hub.css"        = "d57830e793e7a023f66c16f4118393de4656f1a348790949b0d31c863b5d9889"
    "web\static\app\js\deck.js"            = "9823ef81f222b251d1db33c1e4d294b2555d4261b29ac475c3319baed1639177"
    "web\static\app\js\hub.js"             = "482cd864d952c8fb1119d477a508d552ce2d58a816393d076df0e195dc6a6d34"
    "docs\STAGE_A_SCOPE_mk2.md"            = "94fbeed45dec6c37e5f20c0fa32bb6ccb36677617bccf2cd28d88f82e12a37c1"
}
Write-Host "ATLAS-Dashboard-mk_1 :: apply mk25c  (dial + deck enlarged, Open under dial)" -ForegroundColor Cyan
Write-Host ("-" * 70)
Write-Host "  unblocking every file under the repo (Zone.Identifier)" -ForegroundColor DarkGray
Get-ChildItem -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk25c" -Status $path -PercentComplete (100 * $i / $n)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "Verifying mk25c" -Completed
Write-Host ("-" * 70)
if ($bad.Count) { Write-Host "FAILED. Re-extract and re-run." -ForegroundColor Red; exit 1 }
Write-Host "mk25c verified." -ForegroundColor Cyan
Write-Host "hub.html changed: -Mode dev picks templates up live; parity/live mode needs a server restart." -ForegroundColor Yellow
Write-Host "Then Ctrl+F5 on / . Check: Open sits under the dial, red line under the section name." -ForegroundColor DarkGray
