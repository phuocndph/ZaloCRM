@echo off
setlocal EnableExtensions
for /f %%K in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"') do set "TOKEN_KEY=%%K"
if "%TOKEN_KEY%"=="" (
  echo Failed to generate TOKEN_ENCRYPTION_KEY.
  exit /b 1
)
findstr /B /C:"TOKEN_ENCRYPTION_KEY=" .env >nul
if not errorlevel 1 (
  echo TOKEN_ENCRYPTION_KEY already exists in .env. No change made.
  exit /b 0
)
>>.env echo.
>>.env echo # AES-256-GCM key for encrypted integration tokens and AI knowledge content.
>>.env echo # Keep this value stable and include it in encrypted configuration backups.
>>.env echo TOKEN_ENCRYPTION_KEY=%TOKEN_KEY%
echo TOKEN_ENCRYPTION_KEY was added to .env.