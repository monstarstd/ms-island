@echo off
if exist "%~dp0src-tauri\target\release\ms-island.exe" (
    start "" "%~dp0src-tauri\target\release\ms-island.exe"
) else (
    start "" "%~dp0src-tauri\target\debug\ms-island.exe"
)
exit
