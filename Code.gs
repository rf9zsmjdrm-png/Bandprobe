/******************************************************************
 * Bandprobe-Planer – LADER
 *
 * Diese Datei wird EINMAL in Apps Script eingefügt und danach nie mehr
 * angefasst. Der eigentliche Code steht in app.js auf GitHub und wird
 * von hier automatisch geladen (Zwischenspeicher: 10 Minuten).
 * Ist GitHub mal nicht erreichbar, läuft die zuletzt geladene Fassung weiter.
 ******************************************************************/

const SOURCE_URL = 'https://raw.githubusercontent.com/rf9zsmjdrm-png/Bandprobe/main/app.js';
const CACHE_SECONDS = 600;   // so lange wird der Code zwischengespeichert
const CHUNK = 4000;          // Sicherung in Stücken (Skripteigenschaften fassen max. 9 kB pro Wert)

let APP_ = null;

/* ───────────── Öffentliche Funktionen (Web-App, Menü, Trigger) ───────────── */

function doGet(e) { return call_('doGet', [e]); }

function doPost(e) {
  try {
    return call_('doPost', [e]);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Lader: ' + (err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function onOpen(e) {
  try {
    call_('onOpen', [e], false); // einfacher Trigger darf nichts aus dem Netz laden
  } catch (err) {
    SpreadsheetApp.getUi().createMenu('Bandprobe')
      .addItem('Code jetzt von GitHub neu laden', 'reloadCode')
      .addToUi();
  }
}

function findChatId() { return call_('findChatId', []); }
function postButton() { return call_('postButton', []); }
function setupTriggers() { return call_('setupTriggers', []); }
function saturdayReminder() { return call_('saturdayReminder', []); }
function refreshOverview() { return call_('refreshOverview', []); }
function refreshOverviewIfDirty() { return call_('refreshOverviewIfDirty', []); }
function weeklySummary() { return call_('weeklySummary', []); }

/* Reserve für spätere Menüpunkte/Trigger: rufen extra1 … extra5 aus app.js auf, falls vorhanden */
function extra1() { return call_('extra1', []); }
function extra2() { return call_('extra2', []); }
function extra3() { return call_('extra3', []); }
function extra4() { return call_('extra4', []); }
function extra5() { return call_('extra5', []); }

/* Alter Trigger aus dem ersten Auto-Update-Versuch – tut nichts mehr */
function autoUpdate() {}

/** Menüpunkt: Code sofort frisch von GitHub holen. */
function reloadCode() {
  CacheService.getScriptCache().remove('app_code');
  APP_ = null;
  let msg;
  try {
    const fresh = fetchCode_();
    if (!fresh) throw new Error('GitHub nicht erreichbar oder app.js fehlerhaft – die bisherige Fassung läuft weiter.');
    msg = 'Neuer Code geladen (' + Math.round(fresh.length / 1024) + ' kB, Stand ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm') + ').\n' +
      'Tipp: Sheet neu laden, damit das Menü aktuell ist.';
  } catch (err) {
    msg = 'Fehler: ' + (err.message || err);
  }
  SpreadsheetApp.getUi().alert(msg);
}

/* ───────────── Laden ───────────── */

function call_(name, args, allowFetch) {
  const fn = loadApp_(allowFetch !== false)(name);
  return fn.apply(null, args);
}

function compile_(code) {
  // Funktionen aus app.js laufen in einem eigenen Gültigkeitsbereich; über den Namen werden sie abgerufen
  return new Function(code + '\n;return function (n) { return eval(n); };')();
}

function loadApp_(allowFetch) {
  if (APP_) return APP_;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('app_code');
  if (cached) {
    try { APP_ = compile_(cached); return APP_; } catch (e) { cache.remove('app_code'); }
  }
  if (allowFetch && fetchCode_()) return APP_;
  const backup = readBackup_();
  if (!backup) throw new Error('Kein App-Code vorhanden – GitHub nicht erreichbar und noch keine Sicherung.');
  APP_ = compile_(backup);
  if (allowFetch) cache.put('app_code', backup, 60); // GitHub gerade weg: in 1 Min. erneut versuchen
  return APP_;
}

/** Holt app.js, prüft sie, merkt sie sich. Gibt den Code zurück oder null. */
function fetchCode_() {
  let code;
  try {
    const r = UrlFetchApp.fetch(SOURCE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    code = r.getContentText();
    if (code.indexOf('function doPost') === -1) return null;
    APP_ = compile_(code); // Syntaxfehler → Ausnahme → alte Fassung bleibt
  } catch (e) {
    APP_ = null;
    return null;
  }
  try { CacheService.getScriptCache().put('app_code', code, CACHE_SECONDS); } catch (e) { /* zu groß o. ä. */ }
  saveBackup_(code);
  return code;
}

function saveBackup_(code) {
  const p = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, code, Utilities.Charset.UTF_8));
  if (p.getProperty('APP_HASH') === hash) return;
  const parts = { APP_HASH: hash, APP_PARTS: String(Math.ceil(code.length / CHUNK)) };
  for (let i = 0; i * CHUNK < code.length; i++) parts['APP_CODE_' + i] = code.substr(i * CHUNK, CHUNK);
  p.setProperties(parts); // andere Eigenschaften (BOT_TOKEN usw.) bleiben erhalten
}

function readBackup_() {
  const all = PropertiesService.getScriptProperties().getProperties();
  const n = Number(all.APP_PARTS || 0);
  if (!n) return null;
  let code = '';
  for (let i = 0; i < n; i++) code += all['APP_CODE_' + i] || '';
  return code;
}
