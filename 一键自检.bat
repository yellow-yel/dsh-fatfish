@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
call "%HERE%scripts\node-env.bat" || (pause & exit /b 1)
"%FFNODE%" "%HERE%scripts\preflight.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [OK] Pre-flight passed. Next: step 2, the release bat.) else (echo [FAIL] Fix the items above before publishing.)
pause
exit /b %RC%
