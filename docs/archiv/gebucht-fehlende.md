# Auftrag: Fehlende bei gebuchten Proben anzeigen
<!-- Ebene 3. Max. 60 Zeilen. Ein Auftrag = eine Sitzung (oder wenige). Fertig → nach docs/archiv/. -->

## Ziel
- Bei gebuchten Proben ist sichtbar, wer an dem Tag „kann nicht“ gesagt hat (und wer noch nicht geantwortet hat) – übersichtlich, ohne die Liste zu überladen.

## Ausgangslage (Ist)
- Tab „Buchen“ → „📌 Gebuchte Proben“ zeigt nur `Datum  yes/total` + „Raum X · gebucht von Y“.
- „Beste Termine“ zeigt dagegen `fehlt: Name, Name?` (`?` = noch nicht geantwortet).
- Daten sind schon im Client: `countFor(d, ms).missing` liefert die Fehlenden → rein Oberfläche, kein Backend nötig.

## Eingaben (nur diese lesen)
- `index.html` Z. 119–143 – `members()`, `can()` (true/false/null), `countFor()`, `bookingOf()`
- `index.html` Z. 175–235 `renderCalendar` – Tageszelle mit `.booked` (Z. ~217) und Hinweistext (Z. ~180)
- `index.html` Z. 237–275 `renderBooking` – Block „Gebuchte Proben“ (Z. 245–253) = Hauptstelle; Vorbild „fehlt:“ Z. 268
- `index.html` Z. 55–70 – CSS `.day.booked`, `.list li.booked`, `.who`
- `app.js` Z. 512–544 `weeklySummary` – Zeile „📌 GEBUCHT … (yes/total)“ zeigt keine Namen (Z. 525–527)
- `app.js` Z. 439–460 `renderOverview_` – Spalte „Gebucht“ im Sheet (optional, nur falls sinnvoll)
- `docs/ENTSCHEIDUNGEN.md` – nur greppen (`grep -i gebucht`)

## Vorschlag (vor dem Bauen mit Julius kurz bestätigen)
- Gebuchte Proben: Zeile `Datum  4/5` + zweite Zeile „fehlt: Anna, Ben?“ im Stil von „Beste Termine“; bei 5/5 „✅ alle können“.
- Unterscheiden: „kann nicht“ (answered, can=false) vs. „offen“ (`?`, can=null) – z. B. „kann nicht: Anna · offen: Ben“.
- Kalender-Tageszelle bleibt schlank (Zahl + Raum); Details nur im Buchen-Tab bzw. Tag-Menü (`dayMenu`, Z. ~503) – prüfen, ob dort Fehlende im Popup-Text ergänzt werden.
- Wochen-Zusammenfassung (Telegram): bei 📌 Zeilen `– fehlt: …` anhängen, analog Z. 532.

## Ausgabe
- `index.html` (Block Gebuchte Proben, ggf. CSS, ggf. `dayMenu`-Text)
- `app.js` (`weeklySummary`, nur wenn bestätigt)

## Fertig, wenn
- [ ] Gebuchte Probe mit 4/5 zeigt im Buchen-Tab den fehlenden Namen; „offen“ vs. „kann nicht“ unterscheidbar (Screenshot, z. B. mit Testdaten im Browser)
- [ ] Gebuchte Probe mit 5/5 zeigt keine Fehlenden-Zeile / „✅“
- [ ] Layout auf schmalem Handy-Viewport (~375 px) bricht nicht, Zurücknehmen-Button bleibt erreichbar
- [ ] `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"` ok; dasselbe für das Skript in `index.html`
- [ ] Wenn `app.js` geändert: `function doPost` noch vorhanden
- [ ] Commit; Push nur auf Julius' Anweisung (Repo „Bandprobe“, siehe STATUS „Offen“)

## Notizen für die nächste Sitzung
- Hinweis: Nach Rückmeldungs-Wochen („declined“, Abwesend-Woche) prüfen, ob `can()` diese schon abdeckt – sonst Fehlende falsch gezählt.
