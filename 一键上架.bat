@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
call "%HERE%scripts\node-env.bat" || (pause & exit /b 1)
echo Running pre-flight, then commit + tag + push (Gitee and GitHub), then npm pack into dist\.
echo Nothing is published to npm by this script - it prints the command at the end.
echo.
"%FFNODE%" "%HERE%scripts\release.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [STOP] Release script exited with code %RC%.
pause
exit /b %RC%
