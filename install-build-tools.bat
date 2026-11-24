@echo off
title Instalasi Visual Studio C++ Build Tools untuk Tauri
echo ====================================================================
echo  MEMASANG VISUAL STUDIO C++ BUILD TOOLS (DIBUTUHKAN OLEH RUST/TAURI)
echo ====================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set INSTALLER="C:\Users\misba\AppData\Local\Temp\WinGet\Microsoft.VisualStudio.2022.BuildTools.17.14.45\vs_BuildTools.exe"

if not exist %INSTALLER% (
    echo Mengunduh installer Visual Studio Build Tools...
    powershell -Command "Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile '%TEMP%\vs_BuildTools.exe'"
    set INSTALLER="%TEMP%\vs_BuildTools.exe"
)

echo.
echo Installer sedang berjalan. Jendela progress Visual Studio akan muncul.
echo Harap tunggu sampai proses instalasi selesai.
echo.

%INSTALLER% --passive --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended

echo.
echo ====================================================================
echo  SELESAI! Visual Studio C++ Build Tools telah berhasil terpasang.
echo ====================================================================
echo Tekan tombol apa saja untuk menutup...
pause >nul
