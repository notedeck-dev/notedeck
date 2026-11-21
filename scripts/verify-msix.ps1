# Microsoft Store 版 (MSIX) を runner に入れて、Store 版としての振る舞いを確かめる (#849)。
#
# 入力は build-msix.ps1 に -Publisher 'CN=NoteDeckTest' を付けて作った写し (未署名)。ここで
# 試験用の自己署名証明書を作って署名し、入れて起動する。発行者を差し替えているので、提出物と
# 完全に同じパッケージではない。
#
# 見るのは「直接配布版のデータに触らず、専用の場所だけを使うこと」。そのために、直接配布版が
# 使うフォルダを先に作っておく (無い端末では、OS の振り替えだけでも専用の場所に行くので、
# アプリが場所を明示していることの証明にならない)。
param(
  [Parameter(Mandatory)][string]$Msix
)
$ErrorActionPreference = 'Stop'
$id = 'com.notedeck.desktop'
$failures = [System.Collections.Generic.List[string]]::new()
function Check($ok, $what) {
  if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $failures.Add($what) }
}

# --- 署名して入れる
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
  Sort-Object FullName -Descending | Select-Object -First 1
$cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=NoteDeckTest' -KeyUsage DigitalSignature `
  -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$pfx = Join-Path $env:TEMP 'notedeck-test.pfx'
$cer = Join-Path $env:TEMP 'notedeck-test.cer'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString 'test' -Force -AsPlainText) | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
& $signtool.FullName sign /fd SHA256 /f $pfx /p test $Msix | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }

# --- 直接配布版のフォルダが残っている端末を再現する
$realRoaming = Join-Path $env:APPDATA $id
$realLocal = Join-Path $env:LOCALAPPDATA $id
foreach ($d in $realRoaming, $realLocal) {
  New-Item -ItemType Directory $d -Force | Out-Null
  'left by the direct version' | Set-Content (Join-Path $d 'marker.txt')
}

Add-AppxPackage -Path $Msix
$pkg = Get-AppxPackage | Where-Object { $_.Name -like 'NotedeckDev.NoteDeck*' } | Select-Object -First 1
if (-not $pkg) { throw 'the package was not installed' }
$pfn = $pkg.PackageFamilyName
$priv = Join-Path $env:LOCALAPPDATA "Packages\$pfn\LocalCache"
$privData = Join-Path $priv "Roaming\$id"
$privLocal = Join-Path $priv "Local\$id"

try {
  Start-Process "shell:AppsFolder\$pfn!App"
  Start-Sleep 30

  $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'notedeck.exe', 'notemaid.exe' }
  Check ([bool]($procs | Where-Object Name -eq 'notedeck.exe')) 'the app is running inside the package'
  $maid = $procs | Where-Object Name -eq 'notemaid.exe' | Select-Object -First 1
  Check ([bool]$maid) 'notemaid runs as a child of the app'
  if ($maid) {
    Check ($maid.CommandLine -like "*--data-dir*$privData*") 'notemaid gets the package data dir'
    Check ($maid.CommandLine -like '*--keychain-service notedeck-msstore*') 'notemaid gets the Store keychain namespace'
  }

  # 専用の場所 (明示したパスがさらに振り替えられていないことも、これで分かる)
  Check (Test-Path (Join-Path $privData 'notecli.db')) 'the database is in the package data dir'
  Check ([bool](Get-ChildItem (Join-Path $privLocal 'logs') -Filter 'notedeck.log*' -ErrorAction SilentlyContinue)) 'the log is in the package data dir'
  Check (Test-Path (Join-Path $privLocal 'EBWebView')) 'the WebView data is in the package data dir'

  # プロトコル: マニフェストの宣言だけで、動いているプロセスに届く
  Start-Process 'notedeck://msix-check/hello'
  Start-Sleep 10
  $log = Get-ChildItem (Join-Path $privLocal 'logs') -Filter 'notedeck.log*' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-Content $_.FullName -Raw } | Out-String
  Check ($log -match [regex]::Escape('[deep-link] received: notedeck://msix-check/hello')) 'notedeck:// reaches the running app'
  Check (-not (Test-Path 'HKCU:\Software\Classes\notedeck')) 'the app did not register the scheme at runtime'

  # 通知: 自分の識別子で、通知を出す準備ができている (実際に表示されるかは実機で見る)
  Check ($log -notmatch 'failed to get toast notifier') 'the notification manager was created'
  Check ($log -notmatch 'could not get the application user model id') 'the application user model id was resolved'
}
finally {
  Get-Process notedeck, notemaid -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 3
}

# 直接配布版のフォルダに何も増えていない。窓の位置を覚えるプラグインのファイルだけは、
# Tauri が場所を決めるので除く
foreach ($d in $realRoaming, $realLocal) {
  $extra = Get-ChildItem $d -Recurse -File -Force | Where-Object { $_.Name -notin 'marker.txt', '.window-state.json' }
  Check (-not $extra) "nothing was written to $d"
  $extra | ForEach-Object { Write-Host "     $($_.FullName)" }
}

Remove-AppxPackage -Package $pkg.PackageFullName
Check (-not (Test-Path (Join-Path $env:LOCALAPPDATA "Packages\$pfn"))) 'uninstalling removes the package data'

if ($failures.Count) {
  Write-Host "`n--- log tail"
  ($log -split "`n") | Select-Object -Last 40
  throw "$($failures.Count) check(s) failed"
}
