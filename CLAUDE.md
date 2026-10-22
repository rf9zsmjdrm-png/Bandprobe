# Bandprobe-Planer

Telegram-Bot + Mini App zur Probenplanung.

- `index.html` – Mini App (GitHub Pages: https://rf9zsmjdrm-png.github.io/Bandprobe/). Push auf `main` → nach 1–2 Min. live.
- `app.js` – eigentlicher Backend-Code (Apps Script). Wird vom Lader in Apps Script automatisch von GitHub geholt → nach Push spätestens nach 10 Min. live (sofort: Sheet-Menü „Bandprobe → Code jetzt von GitHub neu laden“).
- `Code.gs` – fester Lader, steht einmalig in Apps Script. Nur ändern, wenn unvermeidbar (erfordert manuelles Einfügen + neue Bereitstellungsversion durch den Nutzer).
- `appsscript.json` – Manifest (Scopes). Änderungen erfordern ebenfalls manuelles Einfügen.

Regeln:
- Neue Menüpunkte/Trigger-Funktionen brauchen eine gleichnamige Funktion im Lader. Ohne Lader-Änderung: Funktionen `extra1` … `extra5` in app.js definieren und diese Namen im Menü/Trigger verwenden.
- `app.js` muss `function doPost` enthalten und syntaktisch gültig sein (sonst bleibt die alte Fassung aktiv).
- Vor dem Push prüfen: `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"` und dasselbe für das Skript in index.html.
- Benutzeroberfläche und Texte auf Deutsch. Keine Wochenenden (CONFIG.WEEKDAYS), Modus „verfuegbar“, keine Sonntags-Zusammenfassung.
