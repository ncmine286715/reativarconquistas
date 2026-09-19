@echo off
chcp 65001 >nul
title ReativaConquistas - Site local (sem Python)
cd /d "%~dp0"

REM  Abre o site 100%% local direto no navegador, SEM Python e SEM servidor.
REM  Tudo roda no PC da pessoa: conversao (converter.js), licenca Kiwify
REM  (codes.js), cota e historico (navegador). Requer internet 1x p/ o JSZip,
REM  que ja vem em site\vendor\ (offline depois do 1o uso, via cache).
REM  Uso: duplo-clique em AbrirSemPython.bat

start "" "%~dp0site\index.html"
exit /b 0
