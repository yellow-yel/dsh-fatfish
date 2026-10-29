@echo off
rem Find a Node 22+ runtime: DSH's bundled node first, then PATH.
set "FFNODE="
if exist "%LOCALAPPDATA%\Programs\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe" set "FFNODE=%LOCALAPPDATA%\Programs\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe"
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe" set "FFNODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe"
if not defined FFNODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%D\dependencies\node\bin\node.exe" set "FFNODE=%%D\dependencies\node\bin\node.exe"
  )
)
if not defined FFNODE (
  where node >nul 2>nul
  if not errorlevel 1 set "FFNODE=node"
)
if not defined FFNODE (
  echo [ERROR] Node 22 or newer not found. Install Node, or run DSH once so its runtime exists.
  exit /b 1
)
exit /b 0
