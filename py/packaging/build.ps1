# LegalLeaves（Python 版）の配布物を作る: PyInstaller でフォルダ形式に固め、NSIS でインストーラにする。
#
#   powershell -ExecutionPolicy Bypass -File py\packaging\build.ps1
#
# 前提: py\.venv に requirements.txt の部品が入っていること。NSIS 3（makensis.exe）があること
#       （PATH、既定のインストール先、electron-builder のキャッシュの順に探す）。
# 出力: py\build\out\LegalLeaves-Setup-<版>.exe と、そのハッシュ値の控え（.sha256.txt）
$ErrorActionPreference = "Stop"
$py = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $py
$venvPy = Join-Path $py ".venv\Scripts\python.exe"
$version = (& $venvPy -c "import sys; sys.path.insert(0, r'$py'); import legalleaves; print(legalleaves.__version__)").Trim()
Write-Host "版: $version"

# exe に入れる版の情報（エクスプローラーのプロパティに出る・日本語）
$v = $version.Split(".") + @("0")
$tuple = "($($v[0]), $($v[1]), $($v[2]), 0)"
@"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=$tuple, prodvers=$tuple, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041104B0', [
      StringStruct('ProductName', 'LegalLeaves'),
      StringStruct('FileDescription', 'LegalLeaves'),
      StringStruct('ProductVersion', '$version'),
      StringStruct('FileVersion', '$version'),
      StringStruct('LegalCopyright', 'MIT License'),
      StringStruct('OriginalFilename', 'LegalLeaves.exe')])]),
    VarFileInfo([VarStruct('Translation', [1041, 1200])])
  ]
)
"@ | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot "version_info.txt")

$build = Join-Path $py "build"
& $venvPy -m PyInstaller --noconfirm --clean --distpath (Join-Path $build "dist") --workpath (Join-Path $build "work") (Join-Path $PSScriptRoot "legalleaves.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller に失敗しました" }

$makensis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if (-not $makensis) {
  $cands = @("C:\Program Files (x86)\NSIS\makensis.exe", "C:\Program Files\NSIS\makensis.exe") +
           @(Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache" -Recurse -Filter makensis.exe -ErrorAction SilentlyContinue |
             Where-Object { $_.Directory.Name -ne "Bin" } | ForEach-Object FullName)
  $makensis = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $makensis) { throw "NSIS（makensis.exe）が見つかりません。NSIS 3 を入れてください（https://nsis.sourceforge.io/）。" }

$out = Join-Path $build "out"
New-Item -ItemType Directory -Force $out | Out-Null
$setup = Join-Path $out "LegalLeaves-Setup-$version.exe"
$args = @("/V2", "/DVERSION=$version", "/DSRCDIR=$(Join-Path $build 'dist\LegalLeaves')", "/DOUTFILE=$setup",
          "/DICON=$(Join-Path $root 'build\icon.ico')")
$manual = Join-Path $root "dist\LegalLeaves 操作説明書.pdf"
if (Test-Path $manual) { $args += "/DMANUAL=$manual" } else { Write-Warning "操作説明書のPDFが無いので、同梱せずに作ります: $manual" }
& $makensis @args (Join-Path $PSScriptRoot "installer.nsi")
if ($LASTEXITCODE -ne 0) { throw "NSIS に失敗しました" }

# 真正性の確認用ハッシュ（配布物とは別の経路＝メール本文などで伝える）
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
$size = (Get-Item $setup).Length
@"
LegalLeaves $version — ファイルの真正性を確認するための情報

ファイル名 : $(Split-Path -Leaf $setup)
サイズ     : $("{0:N0}" -f $size) バイト
SHA-256    :
$hash

作成日時   : $(Get-Date -Format "yyyy-MM-dd HH:mm")

■ 受け取った方へ（確認のしかた）
PowerShell で次を実行し、表示された Hash が上の値と同じか確かめてください。
  Get-FileHash "`$HOME\Downloads\$(Split-Path -Leaf $setup)" -Algorithm SHA256
値が違う場合は実行せず、配布元にご連絡ください。
"@ | Set-Content -Encoding utf8 "$setup.sha256.txt"
Write-Host "作成: $setup"
Write-Host "SHA-256: $hash"
