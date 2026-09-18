# apply_mk24.ps1 -- run from the ATLAS_PRE_FILTER_DASH repo root AFTER extracting
# the mk24 drop flat into it.
#
#   powershell -ExecutionPolicy Bypass -File .\apply_mk24.ps1
#
# mk24 strips the hub back: no nav rail, no title block, no console panel, and
# the section screen no longer leaks in under the deck. Templates and CSS only.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "web\templates\base.html"        = "387c03edcfd1943dcd41c38f49d2c3edea615a520d8ad753a03110d056cad9bf"
    "web\templates\hub.html"         = "74fef885b57326b9ea17d6bf72d437c0e2f9aebe52daba490a5ba2b0f5036568"
    "web\static\public\css\hub.css"  = "fcf6092ec0a24fae15f4c88a8b323195fe53b133b5f7e15e246e2fba561a27cf"
    "docs\STAGE_A_SCOPE_mk2.md"      = "8e2987e32af7aac28a5cc1e00ce685c9fa0832001a228363a1e59bd95ff479e2"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk24  (hub stripped)" -ForegroundColor Cyan
Write-Host ("-" * 66)

$i = 0; $n = $expected.Count; $bad = @()
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "Verifying mk24" -Status $path -PercentComplete (100 * $i / $n)
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
Write-Progress -Activity "Verifying mk24" -Completed

# the other sheets still need the rail and the title block -- prove they kept them
$b = Get-Content "web\templates\base.html" -Raw
$guards = ([regex]::Matches($b, [regex]::Escape("{% if page != 'hub' %}"))).Count
Write-Host ""
if ($guards -ge 3) {
    Write-Host ("  ok        base.html guards the rail, heading and title block ({0} found)" -f $guards) -ForegroundColor Green
    Write-Host "            /run, /board and the rest keep all three." -ForegroundColor DarkGray
} else {
    Write-Host ("  WARNING   expected 3 hub guards in base.html, found {0}" -f $guards) -ForegroundColor Yellow
}

Write-Host ("-" * 66)
if ($bad.Count) {
    Write-Host ("FAILED on {0} file(s). Re-extract the drop and re-run." -f $bad.Count) -ForegroundColor Red
    exit 1
}
Write-Host "mk24 verified. Ctrl+F5 on / ." -ForegroundColor Cyan
Write-Host ""
Write-Host "The hub has no Sign out and no page links now -- they went with the rail." -ForegroundColor Yellow
Write-Host "Other sheets still have both; from the hub, use /run, /board, /session by URL" -ForegroundColor Yellow
Write-Host "until the command board carries them." -ForegroundColor Yellow
