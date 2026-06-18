@echo off
setlocal
cd /d "%~dp0"

echo === OYEN setup ===
echo.

echo [1/2] npm install (postinstall applies native-module patches)
call npm install
if %ERRORLEVEL% NEQ 0 goto fail

echo.
echo [2/2] electron-rebuild
call npm run rebuild
if %ERRORLEVEL% NEQ 0 goto fail

echo.
echo === Done ===
exit /b 0

:fail
echo.
echo === Setup failed ===
exit /b 1
