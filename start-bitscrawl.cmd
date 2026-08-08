@echo off
cd /d "%~dp0"
echo.
echo Bitscrawl inditasa...
echo PC:      http://127.0.0.1:5173/
echo Telefon: http://192.168.0.112:5173/
echo.
echo Ezt az ablakot hagyd nyitva jatek kozben.
echo Leallitashoz nyomj Ctrl+C-t.
echo.
npm.cmd run dev
pause
