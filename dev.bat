@echo off
setlocal

rem Anatomy of an Edge - one-shot dev bootstrap.
rem
rem Installs dependencies, runs the full verification suite (format check,
rem lint, typecheck, tests), regenerates the permalink goldens, then starts
rem the Vite dev server and opens it in the default browser once it is ready.
rem
rem NOTE: the app shell (index.html, src/main.tsx) is not written yet - see
rem "Milestone 1 - not done" in PROGRESS.md. Until it lands, this script still
rem runs everything correctly, but the page the browser opens will 404. It
rem will start showing the real site the moment the shell is added, with no
rem change needed here.
rem
rem This does NOT run `npm audit fix --force` - that rewrites dependency
rem versions (potentially with breaking changes) and should stay a deliberate,
rem reviewed action, not something that runs unattended on every launch.

cd /d "%~dp0"

echo.
echo === npm install ===
call npm install
if errorlevel 1 goto :error

echo.
echo === npm audit (report only) ===
call npm audit

echo.
echo === npm run verify  (format check + lint + typecheck + test) ===
call npm run verify
if errorlevel 1 goto :error

echo.
echo === npm run goldens  (regenerate permalink goldens) ===
call npm run goldens
if errorlevel 1 goto :error

echo.
echo === npm run dev  (starts the server and opens the browser once ready) ===
call npm run dev -- --open
goto :eof

:error
echo.
echo *** A step above failed - see the output above. Dev server was not started. ***
exit /b 1
