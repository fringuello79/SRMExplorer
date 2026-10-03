@echo off
rem Avvia un piccolo server locale nella cartella del repository e apre il centro di Magliano nel browser.
rem (La pagina legge file JSON e modelli: aperta direttamente dal disco il browser li blocca.)
cd /d "%~dp0.."
start "" http://localhost:8765/centro/
python -m http.server 8765
