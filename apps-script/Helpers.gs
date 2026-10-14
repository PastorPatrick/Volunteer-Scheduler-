/**
 * ============================================================
 *  HELPERS — small shared tools used by the other files
 * ============================================================
 * You shouldn't need to change anything in this file.
 */

/**
 * Stops a menu-only function from running anywhere but the spreadsheet menu.
 * Once the web app is published, a visitor could otherwise call these
 * functions from a page.
 */
function menuOnly_() {
  try {
    SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('Run this from the Volunteer Scheduler menu in the spreadsheet.');
  }
}

/** The current time. (The automated tests set their own clock here.) */
function clockNow_() {
  return new Date();
}

function getTab_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('The "' + name + '" tab is missing. Run Volunteer Scheduler → Run setup.');
  return sheet;
}

/** Returns {header name: column number} for a tab's first row. */
function columnIndex_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { if (h) map[String(h).trim()] = i + 1; });
  return map;
}

/**
 * The last row that really has data, judged by the first column. Google's own
 * getLastRow() also counts empty checkboxes as "data".
 */
function lastDataRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 1) return 0;
  const firstColumn = sheet.getRange(1, 1, last, 1).getValues();
  for (let i = firstColumn.length - 1; i >= 0; i--) {
    if (String(firstColumn[i][0]).trim() !== '') return i + 1;
  }
  return 0;
}

/** Reads a tab into a list of objects keyed by header name. Each has a _row number. */
function readRows_(sheet) {
  const last = lastDataRow_(sheet);
  if (last < 2) return [];
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  return sheet.getRange(2, 1, last - 1, width).getValues().map((values, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => { if (h) obj[String(h).trim()] = values[j]; });
    return obj;
  });
}

/**
 * Adds a row right after the last real row of a tab, using {header name: value}.
 * Unknown headers are ignored. The first column must be filled in. Returns the row number.
 */
function appendObject_(sheet, obj) {
  const cols = columnIndex_(sheet);
  const width = sheet.getLastColumn();
  const values = new Array(width).fill('');
  Object.keys(obj).forEach((k) => { if (cols[k]) values[cols[k] - 1] = obj[k]; });
  const row = lastDataRow_(sheet) + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  sheet.getRange(row, 1, 1, width).setValues([values]);
  return row;
}

/** Sets cells in one row by header name. */
function setCells_(sheet, row, values) {
  const cols = columnIndex_(sheet);
  Object.keys(values).forEach((h) => { if (cols[h]) sheet.getRange(row, cols[h]).setValue(values[h]); });
}

// ---------- Settings tab ----------

function getSetting_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TABS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const hit = rows.find((r) => String(r[0]).trim() === name);
  return hit ? hit[1] : '';
}

/** A setting as it looks on screen (typed numbers and dates come back as typed). */
function getSettingText_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TABS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  const hit = rows.find((r) => String(r[0]).trim() === name);
  return hit ? String(hit[1]).trim() : '';
}

function setSetting_(name, value) {
  const sheet = getTab_(TABS.SETTINGS);
  const rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  const i = rows.findIndex((r) => String(r[0]).trim() === name);
  if (i >= 0) sheet.getRange(i + 2, 2).setValue(value);
  else sheet.appendRow([name, value, '']);
}

/** Where summaries and problems go: the Report email setting, or the sheet owner. */
function reportEmail_() {
  return String(getSetting_('Report email') || '').trim() || Session.getEffectiveUser().getEmail();
}

function churchName_() {
  return getSettingText_('Church name') || 'Our church';
}

// ---------- Templates and the activity log ----------

function getTemplate_(name) {
  const hit = readRows_(getTab_(TABS.TEMPLATES)).find((t) => String(t['Template']).trim() === name);
  return hit ? String(hit['Message']) : '';
}

/**
 * Fills {placeholders} in a text template:
 *   {FirstName}   the volunteer
 *   {ChurchName}  from the Settings tab
 *   {Month}       the month being planned, like "November"
 *   {Sundays}     their spots, like "Camera Operator on Nov 8 and ProPresenter on Nov 22"
 *   {Link}        their own page
 */
function fillTemplate_(text, values) {
  const all = {
    FirstName: values.firstName || 'there',
    ChurchName: churchName_(),
    Month: values.month || 'next month',
    Sundays: values.sundays || '',
    Link: values.link || '',
  };
  return String(text).replace(/\{(\w+)\}/g, (m, key) => (key in all ? all[key] : m));
}

/** Adds a line to the Activity Log tab. */
function logActivity_(volunteer, what, details) {
  appendObject_(getTab_(TABS.ACTIVITY), {
    'When': new Date(), 'Volunteer': volunteer || '', 'What happened': what, 'Details': details || '',
  });
}

// ---------- Private links ----------

/** A short code that proves a link was made by this script for this page. */
function linkCode_(kind, id) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('LINK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('LINK_SECRET', secret);
  }
  const signature = Utilities.computeHmacSha256Signature(String(kind) + (id ? '|' + id : ''), secret);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '').slice(0, 20);
}

// ---------- Formatting ----------

/** Keeps just the last 10 digits, so "(555) 555-0100" and "555.555.0100" match. */
function normalizePhone_(s) {
  return String(s || '').replace(/\D/g, '').slice(-10);
}

function formatPhone_(s) {
  const d = normalizePhone_(s);
  return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(s || '').trim();
}

function smsNumber_(phone) {
  const d = normalizePhone_(phone);
  return d.length === 10 ? '+1' + d : String(phone).replace(/[^\d+]/g, '');
}

function formatDay_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEEE, MMMM d');
}

function ymd_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** "Nov 8": the short date used in texts. */
function shortDay_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM d');
}

function monthName_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM');
}

/** "a", "a and b", "a, b and c" */
function joinWords_(list) {
  if (list.length <= 2) return list.join(' and ');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/** Calendar days from d to now (whatever the time of day). */
function daysSince_(d, now) {
  if (!(d instanceof Date)) return 0;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(now) - day(d)) / 86400000);
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Emails ----------

/**
 * Sends one email (MailApp options) and records it on the Activity Log:
 * "Email sent" with who it went to, or "Email NOT sent" with Google's reason.
 * A failed email never stops a volunteer's answer from being saved.
 */
function sendEmail_(options) {
  try {
    MailApp.sendEmail(options);
    logActivity_('', 'Email sent', 'To ' + options.to + ': ' + options.subject);
    return '';
  } catch (e) {
    try { logActivity_('', 'Email NOT sent', 'To ' + options.to + ': ' + options.subject + ' (' + e.message + ')'); } catch (e2) { /* nothing more to do */ }
    return e.message;
  }
}

/** Menu item: sends a test email to the report email, and says what happened. */
function sendTestEmail() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const to = reportEmail_();
  const problem = sendEmail_({ to: to, subject: 'Volunteer Scheduler test email', name: churchName_() + ' Volunteer Scheduler',
    body: 'This is a test from the Volunteer Scheduler. If you\'re reading it, your emails will arrive here.' });
  let left = '';
  try { left = '\n\nEmails left today: ' + MailApp.getRemainingDailyQuota() + '.'; } catch (e) { /* not shown */ }
  ui.alert(problem
    ? 'Google wouldn\'t send the email:\n\n' + problem
    : 'Sent to ' + to + ' from ' + Session.getEffectiveUser().getEmail() + '.\n\n' +
      'If it doesn\'t arrive in a minute or two, search that inbox for "Volunteer Scheduler" in every folder (including Spam).' + left);
}

function notifyProblem_(text) {
  sendEmail_({ to: reportEmail_(), subject: 'Volunteer Scheduler: needs your attention', body: text, name: 'Volunteer Scheduler' });
}

/** Sends an email of sections ({title, items: [{text, link}], empty}) as plain text and simple HTML. */
function sendSectionsEmail_(to, subject, greeting, intro, sections) {
  const text = (greeting ? greeting + '\n\n' : '') + intro + '\n\n' + sections.map((s) =>
    (s.title ? s.title.toUpperCase() + '\n' : '') +
    (s.items.length ? s.items.map((i) => '• ' + i.text + (i.link ? ': ' + i.link : '')).join('\n') : (s.empty || ''))).join('\n\n');
  sendEmail_({
    to: to, subject: subject, name: churchName_() + ' Volunteer Scheduler',
    body: text, htmlBody: sectionsHtml_(greeting ? escapeHtml_(greeting) : '', escapeHtml_(intro), sections),
  });
}

function sectionsHtml_(greeting, intro, sections) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#16252a;max-width:600px">' +
    (greeting ? '<p style="margin:0 0 8px">' + greeting + '</p>' : '') +
    '<p style="margin:0 0 16px">' + intro + '</p>' +
    sections.map((s) =>
      (s.title ? '<h3 style="font-size:16px;margin:18px 0 6px">' + escapeHtml_(s.title) + '</h3>' : '') +
      (s.items.length
        ? '<ul style="margin:0;padding-left:20px">' + s.items.map((i) => '<li style="margin:0 0 6px">' +
          (i.link ? '<a href="' + escapeHtml_(i.link) + '">' + escapeHtml_(i.text) + '</a>' : escapeHtml_(i.text)) + '</li>').join('') + '</ul>'
        : '<p style="margin:0;color:#5a6b70">' + escapeHtml_(s.empty || '') + '</p>')).join('') +
    '</div>';
}
