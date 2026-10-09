# apply_mk49.ps1 -- run from the ATLAS_PRE_FILTER_DASH_DEV repo root AFTER mk48,
# once the drop's files have been extracted over the repo.
#
#   Unblock-File .\apply_mk49.ps1
#   powershell -ExecutionPolicy Bypass -File .\apply_mk49.ps1
#
# mk49: genealogy frame scaled to fit + glare-only buttons + bigger segue +
# tap the front placard to open. pages.py changed -> RESTART the server.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "DROP_NOTES_mk49.md"                    = "db16ceefad91525c47cefa1d2e5a70328c7b6ea8123c1977477ffbd5a54319c3"
    "server\pages.py"                       = "ff92ed9fa5a7d1e3dc64fbec90459c37a63226d996a7bfa3b56166475fcfc9a5"
    "tests\test_lock.py"                    = "73d9d1a4b531683ce4679a2434168e910007a0cc2866123ccda3971689c324db"
    "web\static\app\js\deck.js"             = "d82fee5202bb868d81a301db14e2ef89f351ac782196955a29f06ce8c1078457"
    "web\static\app\js\hub.js"              = "310f47de9978e9fa4577828dfaa1e2c602899e83324a0eeb2001a887b14c5003"
    "web\static\app\js\traces.js"           = "1a25a5f60806f6b1fd2c9e4c6c101e755733251a0ba2c17ffd7d85d7bd5d478b"
    "web\static\public\css\hub.css"         = "14c1f718ed7a1691135ccd56ac0641a968a02489d1be98d1aa472c1a11beebcf"
    "web\templates\sections\genealogy.html" = "705e0e729138db352d090f2f7abf634c68da5654eb8b465269a1e0e3821ad577"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk49  (scaled frame + glare + tap-to-open)" -ForegroundColor Cyan
Write-Host ("-" * 70)
$bad = @()
$i = 0
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "mk49: verifying files" -Status $path -PercentComplete (100 * $i / $expected.Count)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "mk49: verifying files" -Completed

Write-Host ""
$checks = [ordered]@{
    "mk48 is underneath ..............." = @("server\app.py", 'frame-src " \+')
    "page size declared ..............." = @("server\pages.py", '"size": \{"w":')
    "frame fit in hub.js .............." = @("web\static\app\js\hub.js", 'iframe\[data-vw\]')
    "buttons fire glare only .........." = @("web\static\app\js\hub.js", "tracks: false")
    "segue grows the box .............." = @("web\static\app\js\hub.js", "grow: 0\.5, glare: 1\.9")
    "traces.js takes the options ......" = @("web\static\app\js\traces.js", "opt\.tracks === false")
    "tap opens the front placard ......" = @("web\static\app\js\deck.js", "travelled < 6")
}
$j = 0
foreach ($k in $checks.Keys) {
    $j++
    Write-Progress -Activity "mk49: content checks" -Status $k -PercentComplete (100 * $j / $checks.Count)
    $ok = Select-String -Path $checks[$k][0] -Pattern $checks[$k][1] -Quiet
    Write-Host ("  {0} {1}" -f $k, $(if ($ok) {"yes"} else {"NO"})) -ForegroundColor $(if ($ok) {"Green"} else {"Red"})
    if (-not $ok) { $bad += $k }
}
Write-Progress -Activity "mk49: content checks" -Completed

Write-Host ("-" * 70)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk49 verified. Restart the server, then Ctrl+F5 on the hub." -ForegroundColor Cyan
