@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
call "%HERE%scripts\node-env.bat" || (pause & exit /b 1)
echo This publishes to npm. It cannot be undone once a version is out.
echo The script asks you to type the confirm word and the 6-digit 2FA code.
echo.
"%FFNODE%" "%HERE%scripts\publish-npm.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [STOP] Publish script exited with code %RC%.
pause
exit /b %RC%
