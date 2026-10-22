/******************************************************************
 * Bandprobe-Planer – eigentlicher Backend-Code.
 * Wird NICHT in Apps Script eingefügt: der Lader (Code.gs) holt diese Datei
 * automatisch von GitHub. Änderungen hier sind nach spätestens 10 Min. live.
 *
 * Skripteigenschaften (Projekteinstellungen → Skripteigenschaften):
 *   BOT_TOKEN     – Token von @BotFather (Pflicht)
 *   BOT_USERNAME  – Bot-Name ohne @, z. B. unsere_band_bot (Pflicht)
 *   CHAT_ID       – wird über Menü „Bandprobe → Chat-ID suchen“ gesetzt
 *   APP_LINK      – optional, nur falls die Mini App über /newapp angelegt
 *                   wurde (z. B. https://t.me/unsere_band_bot/probe)
 ******************************************************************/

const CONFIG = {
  WEEKS_AHEAD: 8,                 // wie weit im Voraus geplant wird
  WEEKDAYS: [1, 2, 3, 4, 5],       // auswählbare Tage: 1=Mo … 6=Sa, 0=So
  MODE: 'verfuegbar',             // 'abwesend' = man markiert Tage, an denen man NICHT kann
                                  // 'verfuegbar' = man markiert Tage, an denen man kann
  REMINDER_HOUR: 10,              // Samstags um diese Uhrzeit: Erinnerung an alle ohne Eintrag für die kommende Woche
  SUMMARY_DAYS: 14,               // Zeitraum der wöchentlichen Zusammenfassung
  INITDATA_MAX_AGE_H: 24,         // Gültigkeit einer Telegram-Sitzung
  BOOKING_URL: 'https://www.volume11.de/raumbuchung/index.php', // Buchungsseite des Proberaums
  ROOMS: ['1', '2', '3'],         // Räume, die beim Markieren als gebucht zur Auswahl stehen (max. 3)
};

const SHEET_DATA = 'Daten';
const SHEET_VIEW = 'Übersicht';
const SHEET_BOOK = 'Buchungen';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/* ───────────── Web-App-Endpunkte ───────────── */

function doGet() {
  return ContentService.createTextOutput('Bandprobe-Planer läuft.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verifyInitData_(req.initData);
    if (req.action === 'save') {
      saveDays_(user, Array.isArray(req.days) ? req.days : [], Array.isArray(req.declined) ? req.declined : []);
    }
    else if (req.action === 'book') setBooked_(user, String(req.date), true, String(req.room || ''));
    else if (req.action === 'unbook') setBooked_(user, String(req.date), false);
    else touchUser_(user);
    out = Object.assign({ ok: true }, state_(user));
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────────── Telegram-Anmeldung prüfen ───────────── */

function verifyInitData_(initData) {
  if (!initData) throw new Error('Bitte die Seite über Telegram öffnen.');
  const params = {};
  initData.split('&').forEach(function (p) {
    const i = p.indexOf('=');
    params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, '%20'));
  });
  const hash = params.hash;
  delete params.hash;
  const dataCheck = Object.keys(params).sort().map(function (k) { return k + '=' + params[k]; }).join('\n');

  const secret = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(token_()).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  const sig = Utilities.computeHmacSha256Signature(Utilities.newBlob(dataCheck).getBytes(), secret);
  const hex = sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  if (hex !== hash) throw new Error('Ungültige Telegram-Signatur.');

  if (Date.now() / 1000 - Number(params.auth_date) > CONFIG.INITDATA_MAX_AGE_H * 3600) {
    throw new Error('Sitzung abgelaufen – bitte die App neu öffnen.');
  }
  const u = JSON.parse(params.user);
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || ('User ' + u.id);
  return { id: String(u.id), name: name };
}

/* ───────────── Daten ───────────── */

function dataSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_DATA);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DATA);
    sh.getRange(1, 1, 1, 5).setValues([['user_id', 'name', 'aktualisiert', 'markierte_tage', 'keine_zeit_wochen']]);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 5).getValue() === '') {
    sh.getRange(1, 5).setValue('keine_zeit_wochen'); // ältere Tabellen um die neue Spalte ergänzen
  }
  return sh;
}

/** Montag der Woche, in der d liegt. */
function mondayOf_(d) {
  return addDays_(d, -((dow_(d) + 6) % 7));
}

/** Probentage der kommenden Woche (ab dem nächsten Montag). */
function nextWeek_() {
  const today = range_().today;
  const monday = addDays_(today, ((8 - dow_(today)) % 7) || 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays_(monday, i);
    if (CONFIG.WEEKDAYS.indexOf(dow_(d)) !== -1) dates.push(d);
  }
  return { monday: monday, dates: dates };
}

/* ───────────── Zwischenspeicher (CacheService) ─────────────
 * Lesen aus dem Sheet ist langsam (je Zugriff 0,1–0,5 s). Deshalb liegt eine Kopie aller
 * Daten im Google-Cache. Normale Aufrufe der App lesen nur noch dort; nach jedem
 * Schreiben wird die Kopie verworfen und beim nächsten Lesen neu aufgebaut.
 */
const SNAP_KEY = 'snapshot_v3';
let snapMemo_ = null;

function snapshot_(fresh) {
  if (!fresh && snapMemo_) return snapMemo_;
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const c = cache.get(SNAP_KEY);
    if (c) return (snapMemo_ = JSON.parse(c));
  }
  const sh = dataSheet_();
  const rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .map(function (r) {
      return [String(r[0]), String(r[1]), r[2] instanceof Date ? r[2].toISOString() : '', String(r[3] || ''), String(r[4] || '')];
    });
  const bsh = bookSheet_();
  const bookings = bsh.getLastRow() < 2 ? [] : bsh.getRange(2, 1, bsh.getLastRow() - 1, 4).getValues()
    .map(function (r) { return [String(r[0]), String(r[1]), String(r[3] || '')]; });
  snapMemo_ = { rows: rows, bookings: bookings };
  try { cache.put(SNAP_KEY, JSON.stringify(snapMemo_), 21600); } catch (e) { /* zu groß o. Ä. – dann eben ohne Cache */ }
  return snapMemo_;
}

/** Nach jedem Schreiben aufrufen: Cache verwerfen, Übersicht zum Neuzeichnen vormerken. */
function invalidate_() {
  snapMemo_ = null;
  const cache = CacheService.getScriptCache();
  cache.remove(SNAP_KEY);
  cache.put('overview_dirty', '1', 21600);
}

function readAll_(fresh) {
  const nw = nextWeek_();
  return snapshot_(fresh).rows
    .map(function (r, i) {
      const updated = r[2] ? new Date(r[2]) : null;
      const days = String(r[3] || '').split(',').filter(Boolean);
      const declined = String(r[4] || '').split(',').filter(Boolean); // Montage der Wochen mit „keine Zeit“
      // „stale“ = für die kommende Woche weder ein Tag eingetragen noch „keine Zeit“ gewählt
      const hasNextWeek = days.some(function (d) { return nw.dates.indexOf(d) !== -1; }) ||
        declined.indexOf(nw.monday) !== -1;
      return {
        row: i + 2, // Zeilennummer – nur bei readAll_(true) verlässlich
        id: String(r[0]),
        name: String(r[1]),
        updated: updated,
        answered: !!updated,
        stale: !updated || (CONFIG.MODE === 'verfuegbar' && !hasNextWeek),
        days: days,
        declined: declined,
      };
    })
    .filter(function (m) { return m.id !== ''; });
}

function touchUser_(user) {
  // Schneller Weg: bekannte Nutzer brauchen keine Sperre und keinen Schreibzugriff
  if (readAll_().some(function (m) { return m.id === user.id; })) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const me = readAll_(true).find(function (m) { return m.id === user.id; });
    if (!me) {
      const sh = dataSheet_();
      const row = sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, 5).setNumberFormat('@').setValues([[user.id, user.name, '', '', '']]);
      invalidate_();
    }
  } finally {
    lock.releaseLock();
  }
}

function saveDays_(user, days, declinedWeeks) {
  const valid = {}, validWeek = {};
  range_().dates.forEach(function (d) { valid[d] = true; validWeek[mondayOf_(d)] = true; });
  const weeks = (declinedWeeks || [])
    .filter(function (w, i) { return validWeek[w] && declinedWeeks.indexOf(w) === i; }).sort();
  // Tage in abgelehnten Wochen werden verworfen
  const clean = days.filter(function (d, i) {
    return valid[d] && days.indexOf(d) === i && weeks.indexOf(mondayOf_(d)) === -1;
  }).sort();

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = dataSheet_();
    const me = readAll_(true).find(function (m) { return m.id === user.id; });
    const row = me ? me.row : sh.getLastRow() + 1;
    const rng = sh.getRange(row, 1, 1, 5);
    rng.setNumberFormats([['@', '@', 'dd.MM.yyyy HH:mm', '@', '@']]);
    rng.setValues([[user.id, user.name, new Date(), clean.join(','), weeks.join(',')]]);
    SpreadsheetApp.flush();
    invalidate_(); // Übersicht wird im Hintergrund aktualisiert – Speichern bleibt schnell
  } finally {
    lock.releaseLock();
  }
}

function state_(user) {
  const r = range_();
  const inRange = {};
  r.dates.forEach(function (d) { inRange[d] = true; });
  const all = readAll_();
  const me = all.find(function (m) { return m.id === user.id; });
  return {
    me: { name: user.name, answered: !!(me && me.answered), stale: !me || me.stale },
    nextMonday: nextWeek_().monday,
    myDays: me ? me.days.filter(function (d) { return inRange[d]; }) : [],
    myDeclined: me ? me.declined.filter(function (w) { return w >= mondayOf_(r.today); }) : [],
    members: all.map(function (m) {
      return {
        name: m.name,
        isMe: m.id === user.id,
        answered: m.answered,
        days: m.days.filter(function (d) { return inRange[d]; }),
        declined: m.declined.filter(function (w) { return w >= mondayOf_(r.today); }),
      };
    }),
    dates: r.dates,
    today: r.today,
    end: r.end,
    mode: CONFIG.MODE,
    bookingUrl: CONFIG.BOOKING_URL,
    bookings: readBookings_()
      .filter(function (b) { return b.date >= r.today; })
      .map(function (b) { return { date: b.date, by: b.by, room: b.room }; }),
    rooms: CONFIG.ROOMS,
  };
}

/* ───────────── Buchungen ───────────── */

function bookSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_BOOK);
  if (!sh) {
    sh = ss.insertSheet(SHEET_BOOK);
    sh.getRange(1, 1, 1, 4).setValues([['datum', 'gebucht_von', 'zeitpunkt', 'raum']]);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 4).getValue() === '') {
    sh.getRange(1, 4).setValue('raum'); // ältere Tabellen um die Spalte ergänzen
  }
  return sh;
}

function roomLabel_(room) {
  return room ? 'Raum ' + room : '';
}

function readBookings_(fresh) {
  return snapshot_(fresh).bookings
    .map(function (r, i) { return { row: i + 2, date: String(r[0]), by: String(r[1]), room: String(r[2] || '') }; })
    .filter(function (b) { return /^\d{4}-\d{2}-\d{2}$/.test(b.date); })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

function setBooked_(user, date, booked, room) {
  if (range_().dates.indexOf(date) === -1) throw new Error('Ungültiges Datum.');
  if (booked && CONFIG.ROOMS.length && CONFIG.ROOMS.indexOf(room) === -1) throw new Error('Bitte einen Raum auswählen.');
  let note = null;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = bookSheet_();
    const existing = readBookings_(true).find(function (b) { return b.date === date; });
    if (booked && !existing) {
      const row = sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, 4).setNumberFormats([['@', '@', 'dd.MM.yyyy HH:mm', '@']])
        .setValues([[date, user.name, new Date(), room]]);
      note = 'Für ' + day_(date) + ' ist ' + (room ? roomLabel_(room) : 'ein Raum') + ' gebucht.';
    } else if (booked && existing && room && existing.room !== room) {
      sh.getRange(existing.row, 4).setNumberFormat('@').setValue(room);
      note = 'Für ' + day_(date) + ' ist jetzt ' + roomLabel_(room) + ' gebucht.';
    } else if (!booked && existing) {
      sh.deleteRow(existing.row);
      note = 'Die Buchung für ' + day_(date) + ' wurde zurückgenommen.';
    }
    SpreadsheetApp.flush();
    invalidate_();
  } finally {
    lock.releaseLock();
  }
  if (note) notify_(note);
}

function notify_(text) {
  const chatId = prop_('CHAT_ID');
  if (!chatId) return;
  try { tg_('sendMessage', { chat_id: chatId, text: text }); } catch (e) { /* Meldung ist optional */ }
}

/* ───────────── Hilfsfunktionen ───────────── */

let propsMemo_ = null;
function prop_(key) {
  if (!propsMemo_) propsMemo_ = PropertiesService.getScriptProperties().getProperties();
  return propsMemo_[key] || null;
}

function token_() {
  const t = prop_('BOT_TOKEN');
  if (!t) throw new Error('Skripteigenschaft BOT_TOKEN fehlt.');
  return t;
}

function addDays_(d, n) {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function dow_(d) {
  return new Date(d + 'T12:00:00Z').getUTCDay();
}

/** '2026-10-28' → 'Mittwoch, den 28.10.' */
function day_(d) {
  const p = d.split('-');
  const names = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  return names[dow_(d)] + ', den ' + Number(p[2]) + '.' + Number(p[1]) + '.';
}

function fmt_(d) {
  const p = d.split('-');
  return WD[dow_(d)] + ' ' + Number(p[2]) + '.' + Number(p[1]) + '.';
}

function range_() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const days = [];
  for (let i = 0; i < CONFIG.WEEKS_AHEAD * 7; i++) days.push(addDays_(today, i));
  return {
    today: today,
    end: days[days.length - 1],
    dates: days.filter(function (d) { return CONFIG.WEEKDAYS.indexOf(dow_(d)) !== -1; }),
  };
}

/** '✓' kann, '✗' kann nicht, '?' noch nichts eingetragen */
function status_(m, d) {
  if (!m.answered) return '?';
  const marked = m.days.indexOf(d) !== -1;
  return (CONFIG.MODE === 'abwesend' ? !marked : marked) ? '✓' : '✗';
}

function appLink_() {
  return prop_('APP_LINK') || ('https://t.me/' + prop_('BOT_USERNAME') + '?startapp');
}

/* ───────────── Übersicht im Sheet ───────────── */

/** Menüpunkt: Cache verwerfen und Übersicht sofort neu zeichnen (z. B. nach Handänderungen im Sheet). */
function refreshOverview() {
  snapMemo_ = null;
  CacheService.getScriptCache().remove(SNAP_KEY);
  renderOverview_();
  CacheService.getScriptCache().remove('overview_dirty');
}

/** Läuft alle 10 Minuten per Trigger: zeichnet die Übersicht nur neu, wenn sich etwas geändert hat. */
function refreshOverviewIfDirty() {
  const cache = CacheService.getScriptCache();
  if (!cache.get('overview_dirty')) return;
  cache.remove('overview_dirty');
  renderOverview_();
}

function renderOverview_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_VIEW) || ss.insertSheet(SHEET_VIEW, 0);
  const all = readAll_();
  const dates = range_().dates;
  const booked = {};
  readBookings_().forEach(function (b) { booked[b.date] = (b.room ? 'R' + b.room + ' · ' : '') + b.by; });
  const header = ['Datum', 'Tag'].concat(all.map(function (m) { return m.name; })).concat(['Können', 'Gebucht']);
  const rows = [header];
  const bgs = [header.map(function () { return '#e8e8e8'; })];
  const colors = { '✓': '#d9f2e3', '✗': '#f8d7d7', '?': '#fff3cd' };

  dates.forEach(function (d) {
    const st = all.map(function (m) { return status_(m, d); });
    const yes = st.filter(function (s) { return s === '✓'; }).length;
    const full = all.length > 0 && yes === all.length;
    rows.push([d.split('-').reverse().join('.'), WD[dow_(d)]].concat(st)
      .concat([yes + '/' + all.length, booked[d] ? '📌 ' + booked[d] : '']));
    bgs.push(['#ffffff', '#ffffff']
      .concat(st.map(function (s) { return colors[s]; }))
      .concat([full ? '#8fd6a8' : '#ffffff', booked[d] ? '#cfe2ff' : '#ffffff']));
  });

  sh.clear();
  sh.getRange(1, 1, rows.length, header.length)
    .setNumberFormat('@')
    .setValues(rows)
    .setBackgrounds(bgs)
    .setHorizontalAlignment('center');
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
}

/* ───────────── Telegram ───────────── */

function tg_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token_() + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  const j = JSON.parse(res.getContentText());
  if (!j.ok) throw new Error('Telegram: ' + j.description);
  return j.result;
}

function button_() {
  return { inline_keyboard: [[{ text: '📅 Verfügbarkeit eintragen', url: appLink_() }]] };
}

/** Postet die Nachricht mit dem Button in die Gruppe und versucht, sie anzupinnen. */
function postButton() {
  const chatId = prop_('CHAT_ID');
  if (!chatId) throw new Error('CHAT_ID fehlt – erst „Chat-ID suchen“ ausführen.');
  const msg = tg_('sendMessage', {
    chat_id: chatId,
    text: '🎸 Probenplanung für die nächsten ' + CONFIG.WEEKS_AHEAD + ' Wochen\n\n' +
      (CONFIG.MODE === 'abwesend'
        ? 'Tippt die Tage an, an denen ihr NICHT könnt. Alles andere gilt als „kann“.'
        : 'Tippt die Tage an, an denen ihr könnt.') +
      '\nBitte regelmäßig aktuell halten 🙏',
    reply_markup: button_(),
  });
  try {
    tg_('pinChatMessage', { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
  } catch (e) {
    // Bot ist kein Admin – dann einfach manuell anpinnen.
  }
}

/** Wöchentliche Zusammenfassung + Erinnerung (wird per Trigger aufgerufen). */
function weeklySummary() {
  const chatId = prop_('CHAT_ID');
  if (!chatId) throw new Error('CHAT_ID fehlt.');
  const all = readAll_();
  const r = range_();
  const soonEnd = addDays_(r.today, CONFIG.SUMMARY_DAYS - 1);
  const lines = ['🎸 Proben-Check – nächste ' + CONFIG.SUMMARY_DAYS + ' Tage', ''];
  const booked = {};
  readBookings_().forEach(function (b) { booked[b.date] = b; });

  r.dates.filter(function (d) { return d <= soonEnd; }).forEach(function (d) {
    const missing = all.filter(function (m) { return status_(m, d) !== '✓'; });
    const yes = all.length - missing.length;
    if (booked[d]) {
      lines.push(fmt_(d) + '  📌 GEBUCHT' + (booked[d].room ? ' – ' + roomLabel_(booked[d].room) : '') +
        ' (' + yes + '/' + all.length + ')');
    } else if (missing.length === 0 && all.length > 0) {
      lines.push(fmt_(d) + '  ✅ ' + yes + '/' + all.length);
    } else {
      lines.push(fmt_(d) + '  ' + (missing.length === 1 ? '⚠️ ' : '❌ ') + yes + '/' + all.length +
        ' – fehlt: ' + missing.map(function (m) { return m.name + (m.answered ? '' : '?'); }).join(', '));
    }
  });

  const fullLater = r.dates.filter(function (d) {
    return d > soonEnd && all.length > 0 && all.every(function (m) { return status_(m, d) === '✓'; });
  });
  if (fullLater.length) {
    lines.push('', '🔥 Später alle frei: ' + fullLater.slice(0, 12).map(fmt_).join(', '));
  }

  tg_('sendMessage', { chat_id: chatId, text: lines.join('\n'), reply_markup: button_() });
}

/** Samstags-Erinnerung: erwähnt alle, die für die kommende Woche noch nichts eingetragen haben. */
function saturdayReminder() {
  const chatId = prop_('CHAT_ID');
  if (!chatId) throw new Error('CHAT_ID fehlt.');
  const missing = readAll_().filter(function (m) { return m.stale; });
  if (!missing.length) return; // alle haben eingetragen – keine Nachricht
  const html = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  // tg://user?id=… erzeugt eine echte Erwähnung → die Person bekommt eine Benachrichtigung
  const mentions = missing.map(function (m) {
    return /^\d+$/.test(m.id) ? '<a href="tg://user?id=' + m.id + '">' + html(m.name) + '</a>' : html(m.name);
  }).join(', ');
  tg_('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: missing.length === 1
      ? mentions + ' ey du dummer, trag dich mal in den Plan ein'
      : mentions + ' ey ihr dummen, tragt euch mal in den Plan ein',
    reply_markup: button_(),
  });
}

/* ───────────── Einrichtung (Menü im Sheet) ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bandprobe')
    .addItem('1. Chat-ID suchen', 'findChatId')
    .addItem('2. Button in Gruppe posten', 'postButton')
    .addItem('3. Automatik einrichten (Erinnerung, Übersicht)', 'setupTriggers')
    .addSeparator()
    .addItem('Erinnerung jetzt senden', 'saturdayReminder')
    .addItem('Übersicht aktualisieren', 'refreshOverview')
    .addItem('Code jetzt von GitHub neu laden', 'reloadCode')
    .addToUi();
}

/** Liest die letzten Bot-Updates und speichert die Gruppen-ID als CHAT_ID. */
function findChatId() {
  const updates = tg_('getUpdates', { allowed_updates: ['message', 'my_chat_member', 'edited_message'] });
  const groups = {};
  updates.forEach(function (u) {
    const m = u.message || u.my_chat_member || u.edited_message;
    const c = m && m.chat;
    if (c && (c.type === 'group' || c.type === 'supergroup')) groups[c.id] = c.title;
  });
  const ids = Object.keys(groups);
  const ui = SpreadsheetApp.getUi();
  if (ids.length === 0) {
    ui.alert('Keine Gruppe gefunden (' + updates.length + ' Updates gelesen). Bot zur Gruppe hinzufügen, dort /start@' +
      prop_('BOT_USERNAME') + ' schreiben und sofort erneut versuchen.');
  } else if (ids.length === 1) {
    PropertiesService.getScriptProperties().setProperty('CHAT_ID', ids[0]);
    ui.alert('CHAT_ID gesetzt: ' + ids[0] + ' („' + groups[ids[0]] + '“)');
  } else {
    ui.alert('Mehrere Gruppen gefunden – passende ID als Skripteigenschaft CHAT_ID eintragen:\n\n' +
      ids.map(function (id) { return id + '  ' + groups[id]; }).join('\n'));
  }
}

/** Richtet Samstags-Erinnerung und Übersicht ein (keine Sonntags-Zusammenfassung mehr). */
function setupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return ['weeklySummary', 'saturdayReminder', 'refreshOverviewIfDirty', 'autoUpdate']
        .indexOf(t.getHandlerFunction()) !== -1;
    })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshOverviewIfDirty').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('saturdayReminder').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(CONFIG.REMINDER_HOUR).create();
  SpreadsheetApp.getUi().alert('Eingerichtet: Erinnerung jeden Samstag gegen ' + CONFIG.REMINDER_HOUR +
    ' Uhr, Übersicht wird alle 10 Minuten aktualisiert.');
}
