@echo off
rem Double-click to start the mangadl web app. Close this window to stop it.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Setting up for the first time...
  python -m venv .venv || goto :error
  ".venv\Scripts\python" -m pip install -q -e . || goto :error
)
".venv\Scripts\python" -m mangadl.web %*
goto :eof

:error
echo Setup failed. Make sure Python is installed and on your PATH.
pause
