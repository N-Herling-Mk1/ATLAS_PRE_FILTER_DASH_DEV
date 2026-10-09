# apply_mk51.ps1 -- run from the ATLAS_PRE_FILTER_DASH_DEV repo root (mk48 applied or not),
# once the drop's files have been extracted over the repo.
#
#   Unblock-File .\apply_mk51.ps1
#   powershell -ExecutionPolicy Bypass -File .\apply_mk51.ps1
#
# mk51 (cumulative mk48-mk51): Code Truth panel, shared framed-page template,
# dev-server port fix, scaled frames, glare, tap-to-open. RESTART the server.

$ErrorActionPreference = "Stop"

$expected = [ordered]@{
    "DROP_NOTES_mk49.md"                           = "db16ceefad91525c47cefa1d2e5a70328c7b6ea8123c1977477ffbd5a54319c3"
    "DROP_NOTES_mk51.md"                           = "ea89886c70aaaba080f3fa95ca6dbb2a2f78fc30ec6d829813bd0e8fb79165ae"
    "server\app.py"                                = "3ed57f5db7398446f4c1ddb298357718fbfc83cb9c89c3e5edac906bad541dde"
    "server\pages.py"                              = "16fdbaf81b5cc9c9c15ec87825747a6b4cb115aceb04d6ad15a8f8bd4f390be0"
    "server\serve.py"                              = "10546a9765d783595790aed5264769356e9875e4178e8fa9af16100b0b600642"
    "tests\test_lock.py"                           = "5f7ae6b7423d7d726e90e7fd58cd52ea8caa28a03d4b34f944b1cfb0221290f5"
    "web\static\app\js\deck.js"                    = "d82fee5202bb868d81a301db14e2ef89f351ac782196955a29f06ce8c1078457"
    "web\static\app\js\hub.js"                     = "310f47de9978e9fa4577828dfaa1e2c602899e83324a0eeb2001a887b14c5003"
    "web\static\app\js\traces.js"                  = "1a25a5f60806f6b1fd2c9e4c6c101e755733251a0ba2c17ffd7d85d7bd5d478b"
    "web\static\public\css\hub.css"                = "2675e18758f3de2469efc8754956e7fef3a1f3d65d34dd08c30cd80da47b2971"
    "web\templates\hub.html"                       = "038283cb8b2dfd0ccaa32f8f475702958cd7fc94278238cb5d74d5f4792aba7d"
    "web\templates\sections\_embed.html"           = "d1a746f691b6ca411e97103b2b162e000bc2d28f61eb0899b5db05e952ced3e2"
    "web\templates\sections\_side\_embed.html"     = "fe32e146df9efe0770599cc3b2e0e2531c90e77e56913a458ae3012a9cd8235c"
    "web\templates\sections\_side\code-truth.html" = "bdc2de346a75d621e35ae98077492e8a823a3bf276c11b12c616230778d2cdb1"
    "web\templates\sections\_side\genealogy.html"  = "278963be918a8bca3ce3d958e94d4e99d09f3e51552bc8ad81757d85d4e99535"
    "web\templates\sections\code-truth.html"       = "6028fcb8847acc957f768c4f5f0dbc3ebd1a7dbb99b598960892bdd87f9eba52"
    "web\templates\sections\genealogy.html"        = "525e5f6d29ad45112e3318c17e9343babb4fd5b3650bb89bff918806a7c7f27b"
}

Write-Host "ATLAS-Dashboard-mk_1 :: apply mk51  (Code Truth panel; cumulative mk48-mk51)" -ForegroundColor Cyan
Write-Host ("-" * 70)
$bad = @()
$i = 0
foreach ($path in $expected.Keys) {
    $i++
    Write-Progress -Activity "mk51: verifying files" -Status $path -PercentComplete (100 * $i / $expected.Count)
    if (-not (Test-Path $path)) { Write-Host ("  MISSING   {0}" -f $path) -ForegroundColor Red; $bad += $path; continue }
    Unblock-File -Path $path -ErrorAction SilentlyContinue
    $h = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
    if ($h -eq $expected[$path]) { Write-Host ("  ok        {0}" -f $path) -ForegroundColor Green }
    else { Write-Host ("  MISMATCH  {0}" -f $path) -ForegroundColor Red; $bad += $path }
}
Write-Progress -Activity "mk51: verifying files" -Completed

Write-Host ""
$checks = [ordered]@{
    "mk48 is underneath ..............." = @("server\app.py", 'frame-src " \+')
    "page size declared ..............." = @("server\pages.py", '"size": \{"w":')
    "frame fit in hub.js .............." = @("web\static\app\js\hub.js", 'iframe\[data-vw\]')
    "buttons fire glare only .........." = @("web\static\app\js\hub.js", "tracks: false")
    "segue grows the box .............." = @("web\static\app\js\hub.js", "grow: 0\.5, glare: 1\.9")
    "traces.js takes the options ......" = @("web\static\app\js\traces.js", "opt\.tracks === false")
    "tap opens the front placard ......" = @("web\static\app\js\deck.js", "travelled < 6")
    "code-truth tile present .........." = @("server\pages.py", '\("code-truth", "Code Truth"')
    "shared framed-page template ......" = @("web\templates\sections\_embed.html", 'id="\{\{ key \}\}-frame"')
    "dev server hands its port down ..." = @("server\serve.py", "PFD_DEV_PORT")
}
$j = 0
foreach ($k in $checks.Keys) {
    $j++
    Write-Progress -Activity "mk51: content checks" -Status $k -PercentComplete (100 * $j / $checks.Count)
    $ok = Select-String -Path $checks[$k][0] -Pattern $checks[$k][1] -Quiet
    Write-Host ("  {0} {1}" -f $k, $(if ($ok) {"yes"} else {"NO"})) -ForegroundColor $(if ($ok) {"Green"} else {"Red"})
    if (-not $ok) { $bad += $k }
}
Write-Progress -Activity "mk51: content checks" -Completed

Write-Host ("-" * 70)
if ($bad.Count) { Write-Host ("FAILED on {0} item(s)." -f $bad.Count) -ForegroundColor Red; exit 1 }
Write-Host "mk51 verified. Restart the server, then Ctrl+F5 on the hub." -ForegroundColor Cyan
