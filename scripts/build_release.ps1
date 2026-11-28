# Monstar Studio - MS Island Official Release Builder & Code Signer
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build_release.ps1
param(
    [string]$SignScript = "C:\Users\misba\.gemini\config\skills\monstar-code-signing\scripts\sign_file.ps1"
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
Push-Location $rootDir

try {
    $pkg = Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json
    $version = $pkg.version
    Write-Host "=== Building MS Island v$version (Monstar Studio) ===" -ForegroundColor Cyan

    # 1. Stop any running instance so target binary is unlocked
    Stop-Process -Name "ms-island" -Force -ErrorAction SilentlyContinue

    # 2. Build frontend + Tauri release binary + NSIS Windows Installer
    Write-Host "`n[1/4] Compiling frontend and Tauri NSIS bundle..." -ForegroundColor Yellow
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
        throw "tauri build failed with exit code $LASTEXITCODE"
    }

    $exePath = Join-Path $rootDir "src-tauri\target\release\ms-island.exe"
    if (-not (Test-Path $exePath)) {
        throw "Expected release executable not found: $exePath"
    }

    $nsisDir = Join-Path $rootDir "src-tauri\target\release\bundle\nsis"
    $nsisSetup = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    # 3. Verify signature on internal exe (tauri signCommand signs both internal exe & NSIS setup automatically)
    $exeSigCheck = Get-AuthenticodeSignature -FilePath $exePath
    if ($exeSigCheck.Status -eq "NotSigned" -and (Test-Path $SignScript)) {
        Write-Host "`n[2/4] Signing ms-island.exe with Monstar Studio certificate..." -ForegroundColor Yellow
        & powershell -ExecutionPolicy Bypass -File $SignScript -FilePath $exePath
        if ($LASTEXITCODE -ne 0) {
            throw "Code signing failed for ms-island.exe"
        }
    }

    # Prepare clean release-dist directory
    $distDir = Join-Path $rootDir "release-dist"
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null

    $finalSetupPath = Join-Path $distDir "MS-Island_${version}_Setup.exe"
    if ($nsisSetup) {
        Copy-Item -Path $nsisSetup.FullName -Destination $finalSetupPath -Force
        $setupSigCheck = Get-AuthenticodeSignature -FilePath $finalSetupPath
        if ($setupSigCheck.Status -eq "NotSigned" -and (Test-Path $SignScript)) {
            Write-Host "`n[3/4] Signing MS-Island_${version}_Setup.exe..." -ForegroundColor Yellow
            & powershell -ExecutionPolicy Bypass -File $SignScript -FilePath $finalSetupPath
            if ($LASTEXITCODE -ne 0) {
                throw "Code signing failed for Setup installer"
            }
        }
    } else {
        Write-Warning "NSIS installer was not found in $nsisDir"
    }

    # 4. Create Signed Portable ZIP
    Write-Host "`n[4/4] Packaging signed Portable ZIP..." -ForegroundColor Yellow
    $portableStage = Join-Path $distDir "_portable_stage"
    if (Test-Path $portableStage) { Remove-Item $portableStage -Recurse -Force }
    New-Item -ItemType Directory -Path $portableStage -Force | Out-Null

    Copy-Item -Path $exePath -Destination (Join-Path $portableStage "MS-Island.exe") -Force
    @"
MS Island v$version (Portable Edition)
Publisher: Monstar Studio

Run MS-Island.exe directly to launch MS Island.
Right-click the Island for Style (Notch / Pill / Orb / Handle) and Dock Position.
Global Shortcuts:
  Alt+I           Focus / show MS Island
  Alt+L           Toggle Floating Lyrics window
  Alt+Shift+Space Play / Pause active media
"@ | Set-Content -Path (Join-Path $portableStage "README.txt") -Encoding UTF8

    $portableZip = Join-Path $distDir "MS-Island_${version}_Portable.zip"
    if (Test-Path $portableZip) { Remove-Item $portableZip -Force }
    Compress-Archive -Path (Join-Path $portableStage "*") -DestinationPath $portableZip -CompressionLevel Optimal
    Remove-Item $portableStage -Recurse -Force

    # Verification Summary
    Write-Host "`n=== Release Verification ===" -ForegroundColor Green
    $vi = (Get-Item $exePath).VersionInfo
    Write-Host "PE ProductName    : $($vi.ProductName)"
    Write-Host "PE CompanyName    : $($vi.CompanyName)"
    Write-Host "PE FileVersion    : $($vi.FileVersion)"
    Write-Host "PE FileDescription: $($vi.FileDescription)"
    Write-Host "PE LegalCopyright : $($vi.LegalCopyright)"

    $exeSig = Get-AuthenticodeSignature -FilePath $exePath
    Write-Host "EXE Signature     : $($exeSig.Status) | $($exeSig.SignerCertificate.Subject)"

    if (Test-Path $finalSetupPath) {
        $setupSig = Get-AuthenticodeSignature -FilePath $finalSetupPath
        $setupMb = [math]::Round((Get-Item $finalSetupPath).Length / 1MB, 2)
        Write-Host "Installer Output  : $finalSetupPath ($setupMb MB)"
        Write-Host "Setup Signature   : $($setupSig.Status) | $($setupSig.SignerCertificate.Subject)"
    }
    $zipMb = [math]::Round((Get-Item $portableZip).Length / 1MB, 2)
    Write-Host "Portable Output   : $portableZip ($zipMb MB)"
}
finally {
    Pop-Location
}
