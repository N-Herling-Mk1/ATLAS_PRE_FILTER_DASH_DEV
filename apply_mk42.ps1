# apply_mk42.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root.
# Carries mk41's CSS as well, so it supersedes mk41 -- either order is fine,
# as long as mk42 lands last.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk42.ps1
#
# mk42: hovering the sign-in button gives a white card, an ink diagram on the
# left and a navy "Sign in" on the right. No restart.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "docs\STAGE_A_SCOPE_mk2.md"                   = "83101c20a9da4e712a0aa21486cfe863d0bd8739ecf99bf1760e39de0f17f76f"
    "web\static\public\css\gate.css"              = "bbd67e8cae6fd2c1e7d516d5c2dee974040766b6379bf52a259b109c395cbeee"
    "web\static\public\js\gate.js"                = "58dbc909ec0e8848637e91235f11af58c9051e05d2f7927d1695909d06fa338c"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk42  (white hover card)" -ForegroundColor Cyan
Write-Host ("-" * 66)
$bad = @()
foreach ($path in $expected.Keys) {
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}

Write-Host ""
$css = Get-Content "web\static\public\css\gate.css"
$live = $css | Where-Object { $_ -match "color-mix\(" -and $_ -notmatch "^\s*(/\*|\*)" }
if ($live) { Write-Host "  FAILED    a live color-mix() is back" -ForegroundColor Red; $bad += "color-mix" }
else       { Write-Host "  ok        no color-mix in any declaration (mk41 carried forward)" -ForegroundColor Green }
if ($css -match "--st-rgb") { Write-Host "  ok        rgb state tokens present" -ForegroundColor Green }
else { Write-Host "  MISSING   --st-rgb" -ForegroundColor Red; $bad += "tokens" }
if ($css -match "background: #FFFFFF") { Write-Host "  ok        white hover card" -ForegroundColor Green }
else { Write-Host "  MISSING   the white hover card" -ForegroundColor Red; $bad += "hover" }
if (Select-String -Path "web\static\public\js\gate.js" -SimpleMatch -Pattern "const FIT = 0.60" -Quiet) {
    Write-Host "  ok        diagram fitted to the left of the face" -ForegroundColor Green
} else { Write-Host "  MISSING   the left fit" -ForegroundColor Red; $bad += "fit" }

Write-Host ("-" * 66)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk42 verified. Ctrl+F5 on /login and hover the button." -ForegroundColor Cyan
