@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "reativar_conquistas.py" (
  echo ERRO: reativar_conquistas.py nao foi encontrado.
  pause
  exit /b 1
)
where py >nul 2>nul
if errorlevel 1 (
  where python >nul 2>nul
  if errorlevel 1 (
    echo ERRO: Python 3 nao foi encontrado no PATH.
    pause
    exit /b 1
  )
  set "PYTHON_CMD=python"
) else (
  set "PYTHON_CMD=py -3"
)
if "%PORT%"=="" set "PORT=8080"
echo ReativaConquistas: http://localhost:%PORT%/
echo Backend e frontend serao servidos pelo mesmo processo.
echo Feche esta janela ou pressione Ctrl+C para parar.
%PYTHON_CMD% reativar_conquistas.py --server %PORT% --open
if errorlevel 1 (
  echo.
  echo ERRO: o servidor encerrou com codigo %errorlevel%.
  pause
)
endlocal
