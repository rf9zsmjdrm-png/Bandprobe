# STATUS – Bandprobe-Planer
<!-- Ebene 2. Max. 40 Zeilen. Zustand, kein Verlauf. Wird bei /ende überschrieben, nicht ergänzt. -->

## Stand (08.11.2026)
- Bot + Mini App live (GitHub Pages, Apps Script lädt `app.js` von GitHub).
- Gebuchte Proben zeigen Fehlende (kann nicht / offen) in Mini App, Tag-Menü und Wochen-Zusammenfassung – gepusht (08.11.), live nach 1–2 Min. (Mini App) bzw. ≤10 Min. (Backend).
- Neu (lokal, ungepusht): Raum-Nachricht täglich ~14 Uhr („Heute sind wir in Raum X“) nur an gebuchten Tagen – `dailyRoomMessage_`/`extra1`/`extra2` in app.js. Test mit Attrappen ok, im echten Bot ungetestet.
- Git-Remote `origin` = GitHub „Bandprobe“; Push per HTTPS + Schlüsselbund-Token (Fine-grained, `docs/wissen/github-push.md`).

## Nächste Schritte
1. Julius: nach Push einmal Sheet-Menü „3. Automatik einrichten“ ausführen (legt den 14-Uhr-Trigger an), dann „Raum-Nachricht jetzt senden“ zum Test an einem gebuchten Tag.
2. Fehlende-Anzeige im echten Telegram prüfen (siehe Offen); bei Fehlern als Auftrag anlegen.
3. Neue Wünsche als Auftrag anlegen (`/auftrag`).
4. Push nur auf Julius' Wort.

## Aktive Aufträge
- keine

## Offen / wartet auf Julius
- Prüfen: Fehlende-Anzeige im echten Telegram (Buchen-Tab, Tag-Menü) und nächste Wochen-Zusammenfassung.
