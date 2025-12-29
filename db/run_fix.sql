@echo off
echo Age Size 모디파이어 수정 시작...
echo.

echo 1. 현재 상태 확인...
sqlite3 web2pos.db < fix_age_size_modifier.sql

echo.
echo 2. 수정 완료!
echo.

pause 