@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
call "%HERE%scripts\node-env.bat" || (pause & exit /b 1)
echo Install both plugins into the local DSH profile (pass --remove to uninstall).
echo.
"%FFNODE%" "%HERE%scripts\install-to-dsh.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [STOP] Installer exited with code %RC%.
pause
exit /b %RC%
