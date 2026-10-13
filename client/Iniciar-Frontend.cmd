@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 goto node_missing
where npm.cmd >nul 2>nul
if errorlevel 1 goto node_missing
if not exist "node_modules\.bin\vite.cmd" goto install
if not exist "node_modules\react\package.json" goto install
goto start
:install
echo Instalando o reparando las dependencias. Espera a que termine...
call npm.cmd install --include=dev --bin-links=true --no-audit --no-fund
if errorlevel 1 goto error
if not exist "node_modules\.bin\vite.cmd" goto vite_missing
:start
echo Abri en tu navegador la direccion que aparece abajo junto a Local.
call npm.cmd run dev
if errorlevel 1 goto error
exit /b 0
:node_missing
echo No se encontro Node.js o npm. Instala Node.js LTS y vuelve a abrir este archivo.
goto error
:vite_missing
echo No se pudo instalar Vite. Revisa los mensajes de la instalacion.
:error
echo No se pudo iniciar el frontend. Revisa el mensaje anterior.
pause
exit /b 1