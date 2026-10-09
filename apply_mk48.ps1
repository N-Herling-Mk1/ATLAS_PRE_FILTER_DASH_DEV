# apply_mk48.ps1 -- run from the ATLAS_PRE_FILTER_DASH_DEV repo root after the
# drop's files have been extracted over the repo.
#
#   Unblock-File .\apply_mk48.ps1
#   powershell -ExecutionPolicy Bypass -File .\apply_mk48.ps1
#
# mk48: NN Genealogy panel (framed GitHub Pages site) + section cards that fit.
# pages.py and app.py changed -> RESTART the server.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "DROP_NOTES_mk48.md"                          = "14382a39084565ec38f2c8cc77093706ed74df72aee172c920b2a4667e187cbf"
    "server\app.py"                               = "3ed57f5db7398446f4c1ddb298357718fbfc83cb9c89c3e5edac906bad541dde"
    "server\pages.py"                             = "ac9144bbe07dace7b337bf7529ed34dc0adcc3d26102e8a96cd6306573dfcf99"
    "tests\test_lock.py"                          = "866d11f5260e635e8658af84ef9927822b0c6efe3d3cbdca1450485cd2917748"
    "web\static\public\css\hub.css"               = "ddc049227830f8e54bf2b3213e1ddded5cdc30f85c38fa635ef2fc6a7b6b8249"
    "web\templates\hub.html"                      = "038283cb8b2dfd0ccaa32f8f475702958cd7fc94278238cb5d74d5f4792aba7d"
    "web\templates\sections\genealogy.html"       = "c5c21ebaa38e367ef732433f62cfee687bb0a1bf454f409c4084a4694bf0b236"
    "web\templates\sections\_side\genealogy.html" = "bbe8d1400cb070193df72c5731b0e7fb996c83107bbad9d86ba44865bee1c738"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk48  (NN Genealogy panel + card fit)" -ForegroundColor Cyan
Write-Host ("-" * 70)
$bad = @()
$i = 0
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "mk48: verifying files" -Status $path -PercentComplete (100 * $i / $expected.Count)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "mk48: verifying files" -Completed

Write-Host ""
$checks = [ordered]@{
    "genealogy tile present ..........." = @("server\pages.py", '\("genealogy", "NN Genealogy"')
    "frame-src built from EMBED_SRC ..." = @("server\app.py", 'frame-src " \+')
    "cards carry the column class ....." = @("web\templates\hub.html", 'class="cards cols-')
    "card fit block in hub.css ........" = @("web\static\public\css\hub.css", "mk48: cards that fit")
    "sheet frames the page ............" = @("web\templates\sections\genealogy.html", 'id="gen-frame"')
}
$j = 0
foreach ($k in $checks.Keys) {
    $j++
    Write-Progress -Activity "mk48: content checks" -Status $k -PercentComplete (100 * $j / $checks.Count)
    $ok = Select-String -Path $checks[$k][0] -Pattern $checks[$k][1] -Quiet
    Write-Host ("  {0} {1}" -f $k, $(if ($ok) {"yes"} else {"NO"})) -ForegroundColor $(if ($ok) {"Green"} else {"Red"})
    if (-not $ok) { $bad += $k }
}
Write-Progress -Activity "mk48: content checks" -Completed

Write-Host ("-" * 70)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk48 verified. Restart the server, then: .\run_tests.ps1" -ForegroundColor Cyan
Write-Host "Hub -> NN Genealogy (double-click) -> the page loads in the sheet." -ForegroundColor Cyan
