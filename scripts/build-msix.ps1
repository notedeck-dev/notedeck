# Microsoft Store 版 (MSIX) を包む (#849)。
#
# 入力は、直接配布版と同じ notedeck.exe と notemaid.exe が入ったフォルダ。Store 用に
# ビルドし直すものは無い (Store 版かどうかはアプリが実行時に見分ける)。
#
# 出力は未署名の MSIX。Store が署名し直すので、提出物に署名は要らない。手元や CI で入れて
# 確かめるときは -Publisher で発行者を試験用の証明書の subject に差し替え、その写しに署名する
# (発行者は証明書と一致しないと入れられない)。差し替えた写しは提出物とは別物。
param(
  [Parameter(Mandatory)][string]$InputDir,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$OutFile,
  [string]$Publisher
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "version must be X.Y.Z (the 4th part is reserved by the Store): $Version" }
foreach ($exe in 'notedeck.exe', 'notemaid.exe') {
  if (-not (Test-Path (Join-Path $InputDir $exe))) { throw "$exe is missing in $InputDir" }
}

$stage = Join-Path ([IO.Path]::GetTempPath()) ("notedeck-msix-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory "$stage\Assets" | Out-Null
try {
  Copy-Item (Join-Path $InputDir 'notedeck.exe'), (Join-Path $InputDir 'notemaid.exe') $stage
  foreach ($icon in 'StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png') {
    Copy-Item (Join-Path $root "src-tauri\icons\$icon") "$stage\Assets"
  }

  [xml]$manifest = Get-Content (Join-Path $root 'src-tauri\msix\AppxManifest.xml') -Raw
  $manifest.Package.Identity.Version = "$Version.0"
  if ($Publisher) { $manifest.Package.Identity.Publisher = $Publisher }
  $manifest.Save("$stage\AppxManifest.xml")

  $makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $makeappx) { throw 'makeappx.exe (Windows SDK) was not found' }
  & $makeappx.FullName pack /d $stage /p $OutFile /o | Select-Object -Last 2
  if ($LASTEXITCODE -ne 0) { throw 'makeappx failed' }
}
finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
Get-Item $OutFile | Select-Object Name, Length
