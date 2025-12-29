@echo off
echo Building production version...
call npm run build
echo.
echo Starting production server on http://localhost:3088
npx serve -s build -l 3088

