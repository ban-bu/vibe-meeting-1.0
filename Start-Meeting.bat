@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM 优先使用 PowerShell 脚本一键启动
where powershell >nul 2>nul
if %errorlevel%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-and-start.ps1
) else (
  echo 未检测到 PowerShell，请手动运行: node server\server.js
  pause
)

endlocal

