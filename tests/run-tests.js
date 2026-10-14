/**
 * Local tests for the Volunteer Scheduler Apps Script.
 *
 * Google Sheets, Gmail and the other Apps Script services only exist inside
 * Google, so this file provides small stand-ins for them and then runs the
 * real script files against those stand-ins.
 *
 * Run with:  node tests/run-tests.js
 */
process.env.TZ = 'America/New_York';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ---------- Stand-ins for Apps Script services ----------

/** Something that accepts any method call and returns itself, for formatting calls we don't check. */
function anything() {
  const f = function () {};
  return new Proxy(f, { get: (t, p) => (p === 'then' ? undefined : anything()), apply: () => anything() });
}

function makeRange(sheet, r, c, nr, nc) {
  const range = {
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = [];
        for (let j = 0; j < nc; j++) { const v = (sheet.data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); }
        out.push(row);
      }
      return out;
    },
    getValue() { return range.getValues()[0][0]; },
    // What Sheets shows on screen. A time typed into a cell is stored as a date on Dec 30, 1899.
    getDisplayValues() {
      return range.getValues().map((row) => row.map((v) => {
        if (v instanceof Date || (v && typeof v.getFullYear === 'function')) {
          return v.getFullYear() < 1900
            ? v.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
            : v.toLocaleDateString('en-US');
        }
        return typeof v === 'boolean' ? String(v).toUpperCase() : String(v);
      }));
    },
    getDisplayValue() { return range.getDisplayValues()[0][0]; },
    setValues(v) {
      v.forEach((row, i) => row.forEach((val, j) => {
        const rr = r - 1 + i;
        while (sheet.data.length <= rr) sheet.data.push([]);
        sheet.data[rr][c - 1 + j] = val;
      }));
      return proxy;
    },
    setValue(v) { return range.setValues([[v]]); },
  };
  const proxy = new Proxy(range, { get: (t, p) => (p in t ? t[p] : () => proxy) });
  return proxy;
}

function makeSheet(name, id) {
  const sheet = {
    data: [], hidden: false,
    getName: () => name,
    getSheetId: () => id,
    getLastRow() {
      for (let i = sheet.data.length - 1; i >= 0; i--) if ((sheet.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      return 0;
    },
    getLastColumn() { return Math.max(0, ...sheet.data.map((r) => { let n = 0; (r || []).forEach((v, j) => { if (v !== '' && v !== undefined) n = j + 1; }); return n; })); },
    maxRows: 1000,
    getMaxRows: () => sheet.maxRows,
    insertRowsAfter(after, n) { sheet.maxRows += n; },
    getRange(a, b, c, d) { return typeof a === 'string' ? anything() : makeRange(sheet, a, b, c || 1, d || 1); },
    appendRow(arr) { const at = sheet.getLastRow(); while (sheet.data.length <= at) sheet.data.push([]); sheet.data[at] = arr.slice(); return sheet; },
    hideSheet() { sheet.hidden = true; return sheet; },
    deleteRow(r) { sheet.data.splice(r - 1, 1); return sheet; },
    getProtections: () => [],
    setConditionalFormatRules() {}, setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {},
  };
  return sheet;
}

function makeWorld(codeOverride) {
  const sheets = [makeSheet('Sheet1', 0)];
  let nextId = 100;
  const world = { sheets, sent: [], alerts: [], props: {}, triggers: [], labels: {}, gmail: [], searches: [], fetches: [], texts: [], folders: [] };
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n, nextId++); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEETID/edit',
  };
  world.ss = ss;

  const fmt = (date, tz, pattern) => {
    const part = (opts) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)).format(date);
    return pattern.replace(/EEEE|EEE|MMMM|MMM|yyyy|d|H|u|m/g, (tok) => ({
      m: String(Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: 'numeric' }).format(date))),
      H: String(Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(date))),
      u: String(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part({ weekday: 'short' })) + 1),
      EEEE: part({ weekday: 'long' }), EEE: part({ weekday: 'short' }),
      MMMM: part({ month: 'long' }), MMM: part({ month: 'short' }),
      yyyy: part({ year: 'numeric' }), d: part({ day: 'numeric' }),
    })[tok]);
  };

  // A stand-in Google Form that remembers its questions and responses.
  world.forms = [];
  const makeForm = () => {
    const form = {
      id: 'FORM' + (world.forms.length + 1), items: [], responses: [], settings: {},
      getId: () => form.id,
      getPublishedUrl: () => 'https://docs.google.com/forms/d/e/' + form.id + '/viewform',
      getEditUrl: () => 'https://docs.google.com/forms/d/' + form.id + '/edit',
      getResponses: (after) => form.responses.filter((r) => !after || r.getTimestamp() >= after),
    };
    const item = (type) => {
      const it = { type, title: '', required: false };
      const api = { setTitle: (t) => { it.title = t; return api; }, setRequired: (b) => { it.required = b; return api; } };
      form.items.push(it);
      return api;
    };
    form.addTextItem = () => item('text');
    form.addParagraphTextItem = () => item('paragraph');
    ['setTitle', 'setDescription', 'setConfirmationMessage', 'setAllowResponseEdits', 'setPublishingSummary',
      'setShowLinkToRespondAgain', 'setPublished'].forEach((m) => { form[m] = (v) => { form.settings[m] = v; return form; }; });
    world.forms.push(form);
    return form;
  };
  world.submitCard = (answers, when, form) => {
    form = form || world.forms[0];
    const id = 'resp' + (form.responses.length + 1);
    const ts = when || new Date();
    form.responses.push({
      getId: () => id,
      getTimestamp: () => ts,
      getItemResponses: () => Object.keys(answers).map((title) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => answers[title] })),
    });
  };

  world.signIn = (text, when) => world.submitCard({ 'Who came? One person per line: name and phone number': text }, when,
    world.forms.find((f) => f.id === world.props.MEET_THE_PASTOR_FORM_ID));

  world.context = {
    console,
    FormApp: {
      create: () => makeForm(),
      openById: (id) => { const f = world.forms.find((x) => x.id === id); if (!f) throw new Error('No item with the given ID could be found.'); return f; },
    },
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => {
        if (world.noUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
        return {
          alert: (m) => world.alerts.push(m),
          createMenu: () => anything(),
          prompt: () => {
            const answer = Array.isArray(world.promptAnswer) ? world.promptAnswer.shift() : world.promptAnswer;
            return { getSelectedButton: () => 'OK', getResponseText: () => answer || '' };
          },
          ButtonSet: { OK_CANCEL: 'OK_CANCEL' },
          Button: { OK: 'OK' },
        };
      },
      newDataValidation: () => anything(),
      newConditionalFormatRule: () => anything(),
      ProtectionType: { RANGE: 'RANGE' },
    },
    Session: {
      getScriptTimeZone: () => 'America/New_York',
      getEffectiveUser: () => ({ getEmail: () => 'church.connect@gmail.com' }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in world.props ? world.props[k] : null),
        setProperty: (k, v) => { world.props[k] = String(v); },
        deleteProperty: (k) => { delete world.props[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate: (date, tz, pattern) => pattern === 'yyyy-MM-dd'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
        : fmt(date, tz, pattern),
      base64Encode: (str) => Buffer.from(str).toString('base64'),
      getUuid: () => require('crypto').randomUUID(),
      // Apps Script returns signed bytes; base64EncodeWebSafe accepts them.
      computeHmacSha256Signature: (value, key) =>
        Array.from(require('crypto').createHmac('sha256', key).update(value).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
    // A stand-in Google Drive: folders and the files saved in them.
    DriveApp: {
      createFolder: (name) => {
        const folder = { id: 'DF' + (world.folders.length + 1), name, files: [], getId: () => folder.id,
          createFile: (blob) => { const f = { blob, id: 'DFILE' + (folder.files.length + 1) }; f.getUrl = () => 'https://drive.google.com/file/d/' + folder.id + '-' + f.id + '/view'; folder.files.push(f); return f; } };
        world.folders.push(folder);
        return folder;
      },
      getFolderById: (id) => { const f = world.folders.find((x) => x.id === id); if (!f) throw new Error('No folder'); return f; },
    },
    HtmlService: {
      createHtmlOutput: (html) => {
        const out = { html, title: '', setTitle(t) { out.title = t; return out; }, addMetaTag() { return out; }, getContent: () => html };
        return out;
      },
    },
    // A stand-in Elvanto API: world.elvanto(endpoint, body) returns the reply object.
    UrlFetchApp: {
      fetch: (url, opts) => {
        if (url.startsWith('https://api.twilio.com/')) {
          // A stand-in Twilio: world.twilio(url, opts) returns {code, body}; texts are recorded in world.texts.
          const r = world.twilio ? world.twilio(url, opts) : { code: 401, body: { code: 20003, message: 'Authenticate' } };
          if (r.code < 300 && /Messages\.json$/.test(url)) world.texts.push(Object.assign({ auth: opts.headers.Authorization }, opts.payload));
          return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body || {}) };
        }
        world.fetches.push({ url, opts, body: JSON.parse(opts.payload) });
        // Like the real Elvanto: page_size must be at least 10.
        const sent = JSON.parse(opts.payload);
        if ('page_size' in sent && (sent.page_size < 10 || sent.page_size > 1000)) {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ status: 'fail', error: { code: 250, message: 'Invalid page size' } }) };
        }
        const endpoint = url.replace('https://api.elvanto.com/v1/', '').replace('.json', '');
        const reply = world.elvanto ? world.elvanto(endpoint, JSON.parse(opts.payload), opts.headers) : { status: 'fail' };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(reply) };
      },
    },
    MailApp: { sendEmail: (o) => { if (world.failMail) throw new Error('Service invoked too many times'); world.sent.push(o); } },
    GmailApp: {
      search: (q) => { world.searches.push(q); return world.gmail; },
      getUserLabelByName: (n) => world.labels[n] || null,
      createLabel: (n) => (world.labels[n] = { name: n }),
    },
    ScriptApp: {
      getProjectTriggers: () => world.triggers,
      deleteTrigger: (t) => world.triggers.splice(world.triggers.indexOf(t), 1),
      newTrigger: (fn) => { world.triggers.push({ getHandlerFunction: () => fn }); return anything(); },
    },
  };
  vm.createContext(world.context);
  const dir = path.join(__dirname, '..', 'apps-script');
  const code = codeOverride || fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  vm.runInContext(code, world.context);
  // Reminders run after every inbox check. Give them a fixed, quiet time
  // (a Wednesday at 8am, before any reminder is due) so tests don't depend on today's date.
  vm.runInContext('clockNow_ = function () { return new Date(2026, 9, 7, 8, 0); };', world.context);
  world.run = (js) => vm.runInContext(js, world.context);
  world.tab = (name) => sheets.find((s) => s.getName() === name);
  world.rows = (name) => world.run('readRows_(getTab_(' + JSON.stringify(name) + '))');
  return world;
}

const HOST_BASE = 'https://script.google.com/macros/s/ABC123/exec';
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min || 0);

// ---------- Tests ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const POSITIONS = ['ProPresenter', 'Livestream Producer', 'Camera Operator', 'Livestream Audio'];
const MOBILE = { Tom: '8645550101', Jen: '8645550102', Mark: '8645550103', Sue: '8645550104', Old: '8645550105', Ann: '8645550106' };

/**
 * A set-up scheduler with the media team, Twilio connected, and this rotation
 * (November 2026 Sundays are the 1st, 8th, 15th, 22nd and 29th):
 *                        1st   2nd   3rd   4th   5th
 *   ProPresenter         Jen   Sue   Jen   Sue   -
 *   Livestream Producer  Tom   Tom   Mark  Tom   -
 *   Camera Operator      Mark  Mark  Tom   Mark  -
 *   Livestream Audio     Sue   -     Sue   -     -
 */
function scheduler() {
  const w = makeWorld();
  w.run('setup()');
  w.run('setSetting_("Report email", "pastor@example.com"); setSetting_("Church name", "Grace Church"); setSetting_("Web app link", ' + JSON.stringify(HOST_BASE) + ')');
  const team = w.tab('Media Team');
  //               Name          Mobile          Active ProP   LP     Cam    Audio
  team.appendRow(['Tom Smith', '(864) 555-0101', true, false, true, true, false]);
  team.appendRow(['Jen Park', '864-555-0102', true, true, true, false, false]);
  team.appendRow(['Mark Lee', '8645550103', true, false, true, true, true]);
  team.appendRow(['Sue Wong', '8645550104', true, true, false, false, true]);
  team.appendRow(['Old Guy', '8645550105', false, false, false, true, false]);
  team.appendRow(['Ann Free', '8645550106', true, false, true, false, false]);
  team.appendRow(['No Phone', '', true, true, false, false, false]);
  const rot = w.tab('Media Rotation');
  rot.data[1] = ['ProPresenter', 'Jen Park', 'Sue Wong', 'Jen Park', 'Sue Wong', ''];
  rot.data[2] = ['Livestream Producer', 'Tom Smith', 'Tom Smith', 'Mark Lee', 'Tom Smith', ''];
  rot.data[3] = ['Camera Operator', 'Mark Lee', 'Mark Lee', 'Tom Smith', 'Mark Lee', ''];
  rot.data[4] = ['Livestream Audio', 'Sue Wong', '', 'Sue Wong', '', ''];
  Object.assign(w.props, { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_KEY_SID: 'SK456', TWILIO_KEY_SECRET: 'shh', TWILIO_FROM: 'MG789' });
  w.twilio = () => ({ code: 201, body: { sid: 'SM1' } });
  w.jobs = (y, m, d, h, min) => w.run('runScheduledJobs_(new Date(' + at(y, m, d, h, min).getTime() + '))');
  w.clock = (y, m, d, h, min) => w.run('clockNow_ = function () { return new Date(' + at(y, m, d, h, min).getTime() + '); }');
  w.textsTo = (who) => w.texts.filter((t) => t.To === '+1' + MOBILE[who]).map((t) => t.Body);
  w.spot = (day, position) => w.rows('Schedule').find((r) => r['Sunday'].getDate() === day && r['Position'] === position);
  w.code = (who) => w.run('linkCode_("person", ' + JSON.stringify(MOBILE[who]) + ')');
  w.page = (who, t) => w.run('doGet({parameter: ' + JSON.stringify({ p: 'me', m: MOBILE[who], t: t === undefined ? w.code(who) : t }) + '}).getContent()');
  w.act = (who, action, day, position) => {
    const r = day ? w.spot(day, position) : null;
    const key = r ? '2026-11-' + String(day).padStart(2, '0') + '|Media|' + position : '';
    return w.run('pageAction(' + ['me:' + MOBILE[who], w.code(who), action, r ? r._row : 0, key].map((x) => JSON.stringify(x)).join(', ') + ')').message;
  };
  w.link = (who) => HOST_BASE + '?p=me&m=' + MOBILE[who] + '&t=' + w.code(who);
  w.clock(2026, 10, 15, 12);
  return w;
}

/** The scheduler after the November ask went out on Oct 15 at 10am. */
function asked() {
  const w = scheduler();
  w.jobs(2026, 10, 15, 10, 0);
  return w;
}

test('setup builds the tabs, the media team\'s two tabs, and one hourly timer; safe to run twice', () => {
  const w = makeWorld();
  w.run('setup()');
  w.run('setup()');
  const names = w.sheets.map((s) => s.getName());
  ['Teams', 'Media Team', 'Media Rotation', 'Schedule', 'Message Templates', 'Settings', 'Activity Log'].forEach((n) => assert(names.includes(n), n));
  assert(!names.includes('Sheet1'));
  assert.deepStrictEqual(w.tab('Media Team').data[0], ['Name', 'Mobile', 'Active'].concat(POSITIONS).concat(['Notes']));
  assert.deepStrictEqual(w.tab('Media Rotation').data[0], ['Position', '1st Sunday', '2nd Sunday', '3rd Sunday', '4th Sunday', '5th Sunday']);
  assert.deepStrictEqual(w.rows('Media Rotation').map((r) => r['Position']), POSITIONS, 'one row per position, not duplicated');
  assert.deepStrictEqual(w.triggers.map((t) => t.getHandlerFunction()), ['runScheduledJobs']);
  assert.strictEqual(w.rows('Message Templates').length, 4);
  assert.strictEqual(w.rows('Settings').length, 5);
  assert.strictEqual(w.rows('Teams').length, 1);
});

test('a new position on the Teams tab gets a checkbox column and a rotation row', () => {
  const w = scheduler();
  w.run('setCells_(getTab_("Teams"), 2, {"Positions": "ProPresenter, Livestream Producer, Camera Operator, Livestream Audio, Lighting"})');
  w.run('setup()');
  assert(w.tab('Media Team').data[0].includes('Lighting'));
  assert.strictEqual(w.rows('Media Rotation').length, 5);
  assert.strictEqual(w.rows('Media Rotation')[0]['1st Sunday'], 'Jen Park', 'the rotation is kept');
});

test('"Check the rotation" flags names not on the team, inactive, untrained, no mobile, and two positions in one week', () => {
  const w = scheduler();
  w.run('checkRotation()');
  assert(w.alerts.pop().startsWith('The rotation looks good: 14 spots filled.'));
  const rot = w.tab('Media Rotation');
  rot.data[4][2] = 'Old Guy';      // Audio, 2nd: inactive and not trained
  rot.data[4][4] = 'No Phone';     // Audio, 4th: no mobile, not trained
  rot.data[1][5] = 'Nobody Here';  // ProPresenter, 5th: not on the team tab
  rot.data[4][5] = 'Jen Park';     // Audio, 5th: not trained
  rot.data[2][3] = 'Jen Park';     // Livestream Producer, 3rd: Jen is ProPresenter that week too
  w.run('checkRotation()');
  const a = w.alerts.pop();
  assert(a.includes('Media, Livestream Audio, 2nd Sunday: Old Guy isn\'t marked Active.'), a);
  assert(a.includes('Media, Livestream Audio, 4th Sunday: No Phone has no mobile number, so they can\'t be texted.'), a);
  assert(a.includes('Media, ProPresenter, 5th Sunday: "Nobody Here" isn\'t on the Media Team tab.'), a);
  assert(a.includes('Media, Livestream Audio, 5th Sunday: Jen Park isn\'t checked as trained in Livestream Audio.'), a);
  assert(a.includes('3rd Sunday: Jen Park is in two positions (Media ProPresenter and Media Livestream Producer).'), a);
});

test('a test with a test team doesn\'t stop the real ask day, and reminders are timed from each person\'s own text', () => {
  const w = scheduler();
  // Set up a Test team with just Pat, and switch the media team off for the test.
  w.tab('Teams').appendRow(['Test', 'Test Position', '', '', true]);
  w.run('setCells_(getTab_("Teams"), 2, {"Active": false})');
  w.run('setup()');
  w.tab('Test Team').appendRow(['Pat Pastor', '8645550199', true, true]);
  w.tab('Test Rotation').data[1] = ['Test Position', 'Pat Pastor', '', '', '', ''];
  w.clock(2026, 10, 10, 12);
  w.run('sendNextMonthNow()');
  assert(w.texts.every((t) => t.To === '+18645550199'), 'only Pat');
  assert.deepStrictEqual(w.texts.map((t) => t.Body.split('!')[1].trim().split(' ').slice(0, 3).join(' ')), ['Here\'s when you\'re', 'Can you cover'],
    'Pat sees both kinds of text: their Sundays, and a cover request for the empty Sundays');
  assert(w.page('Tom', w.code('Tom')).includes('This link doesn\'t work'), 'the media team is switched off');
  w.jobs(2026, 10, 13, 10, 0);
  assert.deepStrictEqual(w.texts.filter((t) => t.Body.includes('just a reminder')).map((t) => t.To), ['+18645550199'], 'Pat\'s own reminder, 3 days after the test');
  // Clean up: delete the test rows, switch the media team back on.
  const sched = w.tab('Schedule');
  sched.data.length = 1;
  w.run('setCells_(getTab_("Teams"), 3, {"Active": false}); setCells_(getTab_("Teams"), 2, {"Active": true})');
  w.texts.length = 0;
  w.jobs(2026, 10, 15, 10, 0);
  assert.strictEqual(w.texts.filter((t) => /Here's when/.test(t.Body)).length, 4, 'the ask day still texts the whole media team');
  assert.strictEqual(w.rows('Schedule').length, 20);
  w.jobs(2026, 10, 16, 10, 0);
  assert.strictEqual(w.texts.filter((t) => /Here's when/.test(t.Body)).length, 4, 'once');
  w.jobs(2026, 10, 17, 10, 0);
  assert(!w.texts.some((t) => t.Body.includes('just a reminder')), 'not yet');
  w.jobs(2026, 10, 18, 10, 0);
  assert.strictEqual(w.texts.filter((t) => t.Body.includes('just a reminder')).length, 4, '3 days after their own text');
});

test('the 15th at 10am: one text per person listing their Sundays; nothing before 10am, and only once', () => {
  const w = scheduler();
  w.jobs(2026, 10, 15, 9, 0);
  assert.strictEqual(w.rows('Schedule').length, 0, 'not before 10am');
  w.jobs(2026, 10, 15, 10, 0);
  assert.strictEqual(w.rows('Schedule').length, 20, '5 Sundays x 4 positions');
  assert.deepStrictEqual(w.textsTo('Tom').filter((t) => !t.includes('Can you cover')), ['Hi Tom! Here\'s when you\'re serving at Grace Church in November: Livestream Producer on Nov 1, Livestream Producer on Nov 8, ' +
    'Camera Operator on Nov 15 and Livestream Producer on Nov 22. Tap to confirm, or let us know which you can\'t make: ' + w.link('Tom')]);
  assert.strictEqual(w.spot(1, 'Livestream Producer')['Status'], 'Waiting');
  assert.strictEqual(w.spot(29, 'ProPresenter')['Status'], 'Open', '5th Sundays are open');
  assert.strictEqual(w.spot(8, 'Livestream Audio')['Status'], 'Open', 'a blank cell is open');
  const count = w.texts.length;
  w.jobs(2026, 10, 16, 10, 0);
  assert.strictEqual(w.rows('Schedule').length, 20);
  assert.strictEqual(w.texts.filter((t) => /Here's when/.test(t.Body)).length, 4, 'Tom, Jen, Mark and Sue, each once');
  assert(w.texts.length >= count);
});

test('open spots go out for cover: one text per person, only those trained, active, and free that Sunday', () => {
  const w = asked();
  // Nov 29 is all open. Jen and Sue do ProPresenter; Tom, Jen, Mark, Ann do Livestream Producer; Tom and Mark do Camera; Mark and Sue do Audio.
  const jen = w.textsTo('Jen').filter((t) => t.includes('Can you cover'));
  assert.deepStrictEqual(jen, ['Hi Jen! Can you cover ProPresenter on Nov 29 and Livestream Producer on Nov 29 at Grace Church? First to say yes gets it: ' + w.link('Jen')]);
  assert(!w.textsTo('Old').length, 'inactive');
  assert(w.textsTo('Ann')[0].startsWith('Hi Ann! Can you cover Livestream Producer on Nov 29'));
  assert.strictEqual(w.spot(29, 'ProPresenter')['Cover texted'], '(864) 555-0102, (864) 555-0104');
  // Nov 8 Livestream Audio: Mark (Camera) and Sue (ProPresenter) are already serving that Sunday.
  assert.strictEqual(w.spot(8, 'Livestream Audio')['Cover texted'], '');
  const sent = w.sent.find((m) => m.subject === 'November schedule sent');
  assert.strictEqual(sent.to, 'pastor@example.com');
  assert(sent.body.includes('Livestream Audio on Nov 8: nobody else is trained and free that day'), sent.body);
  assert(sent.body.includes('ProPresenter on Nov 29: asked Jen and Sue'), sent.body);
  const still = w.sent.find((m) => m.subject.startsWith('Still open'));
  assert(still && still.body.includes('Media Livestream Audio on Nov 8: nobody else is trained, active, and free that Sunday'), 'told right away when nobody can cover');
  // The next hour doesn't text anyone again.
  const n = w.texts.length;
  w.jobs(2026, 10, 15, 11, 0);
  assert.strictEqual(w.texts.length, n);
});

test('a volunteer\'s page: their Sundays, "Yes to all", and spots they could cover; another code doesn\'t open it', () => {
  const w = asked();
  assert(w.page('Tom', 'nope').includes('This link doesn\'t work'));
  assert(w.page('Tom', w.code('Jen')).includes('This link doesn\'t work'));
  const html = w.page('Tom');
  assert(html.includes('Hi Tom!') && html.includes('Yes to all 4') && html.includes('Sunday, November 22'));
  assert(html.includes('Can you cover?'), 'Tom is free on Nov 29');
  assert.strictEqual(w.act('Tom', 'yesall'), 'Thank you! You\'re confirmed for Livestream Producer on Nov 1, Livestream Producer on Nov 8, Camera Operator on Nov 15 and Livestream Producer on Nov 22.');
  assert.strictEqual(w.spot(8, 'Livestream Producer')['Status'], 'Confirmed');
  assert(w.page('Tom').includes('✓ Confirmed') && !w.page('Tom').includes('Yes to all'));
  assert.strictEqual(w.act('Jen', 'yes', 1, 'ProPresenter'), 'Thank you! You\'re confirmed for ProPresenter on Nov 1.');
  assert.strictEqual(w.act('Jen', 'yes', 1, 'Livestream Producer'), 'You\'re not on Livestream Producer on Nov 1 anymore.', 'can\'t confirm someone else\'s spot');
});

test('"Can\'t", even after confirming: you\'re emailed right away and the first to say yes covers it', () => {
  const w = asked();
  w.act('Tom', 'yesall');
  w.sent.length = 0; w.texts.length = 0;
  assert.strictEqual(w.act('Tom', 'cant', 22, 'Livestream Producer'), 'Thanks for letting us know. We\'ll find someone to cover Livestream Producer on Nov 22.');
  const r = w.spot(22, 'Livestream Producer');
  assert.deepStrictEqual([r['Serving'], r['Status'], r['Can\'t']], ['', 'Open', '(864) 555-0101']);
  // Free and trained on Nov 22: Jen and Ann (Mark is on Camera, Tom said no).
  assert.deepStrictEqual(w.texts.map((t) => t.To).sort(), ['+18645550102', '+18645550106']);
  assert.strictEqual(w.sent.length, 1);
  assert.strictEqual(w.sent[0].to, 'pastor@example.com');
  assert.strictEqual(w.sent[0].subject, 'Tom Smith can\'t serve Livestream Producer on Sunday, November 22');
  assert(w.sent[0].body.startsWith('Tom Smith had confirmed, but just said they can\'t serve Livestream Producer (Media) on Sunday, November 22.'), w.sent[0].body);
  assert(w.sent[0].body.includes('A cover request was texted to Jen and Ann.'));
  assert(w.page('Ann').includes('I can cover'));

  w.sent.length = 0; w.texts.length = 0;
  assert.strictEqual(w.act('Jen', 'cover', 22, 'Livestream Producer'), 'Thank you! Livestream Producer on Nov 22 is yours. We\'ve texted you a confirmation.');
  assert.deepStrictEqual(w.textsTo('Jen'), ['Thank you, Jen! You\'re serving Livestream Producer on Nov 22 at Grace Church. See you then!']);
  assert.deepStrictEqual([w.spot(22, 'Livestream Producer')['Serving'], w.spot(22, 'Livestream Producer')['Status']], ['Jen Park', 'Confirmed']);
  assert.strictEqual(w.sent[0].subject, 'Covered: Livestream Producer on Sunday, November 22 (Jen Park)');
  assert.strictEqual(w.act('Ann', 'cover', 22, 'Livestream Producer'), 'Thank you! Jen already said yes, so you\'re not needed for this one.');
  assert(!w.page('Ann').includes('Sunday, November 22'));
  assert.strictEqual(w.act('Tom', 'cover', 22, 'Livestream Producer'), 'Thank you! Jen already said yes, so you\'re not needed for this one.');
});

test('one position a Sunday: someone already serving can\'t cover another spot that day', () => {
  const w = asked();
  w.act('Tom', 'cant', 22, 'Livestream Producer');
  assert.strictEqual(w.act('Mark', 'cover', 22, 'Livestream Producer'), 'You\'re already serving Camera Operator that Sunday, and it\'s one position a Sunday.');
  assert.strictEqual(w.act('Sue', 'cover', 22, 'Livestream Producer'), 'You\'re not set up for Livestream Producer. Please check with your team leader.');
  assert(w.page('Jen').includes('Livestream Producer</p><button class="primary" data-action="cover"'));
  w.act('Jen', 'cover', 29, 'ProPresenter');
  assert(!/November 29<\/b><br>Livestream Producer/.test(w.page('Jen')), 'once Jen is on Nov 29, she isn\'t offered another spot that day');
});

test('a "Can\'t" at night: you\'re told now, cover texts wait until 8am', () => {
  const w = asked();
  w.clock(2026, 10, 20, 22, 30);
  w.sent.length = 0; w.texts.length = 0;
  w.act('Mark', 'cant', 15, 'Livestream Producer');
  assert.strictEqual(w.texts.length, 0);
  assert(w.sent[0].body.includes('The cover request will be texted at 8am.'), w.sent[0].body);
  assert(w.sent[0].body.startsWith('Mark Lee just said'), 'Mark hadn\'t confirmed');
  w.jobs(2026, 10, 21, 3, 0);
  assert.strictEqual(w.texts.length, 0);
  w.jobs(2026, 10, 21, 8, 0);
  assert.deepStrictEqual(w.texts.map((t) => t.To), ['+18645550106'], 'only Ann: Jen is on ProPresenter and Tom on Camera that day');
});

test('3 days after the ask, a reminder to anyone who hasn\'t answered; 2 days later, you get their names and numbers', () => {
  const w = asked();
  w.act('Tom', 'yesall');
  w.act('Jen', 'yesall');
  w.texts.length = 0; w.sent.length = 0;
  w.jobs(2026, 10, 17, 10, 0);
  assert(!w.texts.some((t) => t.Body.includes('reminder')));
  w.jobs(2026, 10, 18, 10, 0);
  const reminders = w.texts.filter((t) => t.Body.includes('just a reminder'));
  assert.deepStrictEqual(reminders.map((t) => t.To).sort(), ['+18645550103', '+18645550104'], 'Mark and Sue');
  assert.strictEqual(reminders[0].Body.split(':')[0], 'Hi ' + (reminders[0].To === '+18645550103' ? 'Mark' : 'Sue') + ', just a reminder to confirm your November Sundays at Grace Church');
  w.jobs(2026, 10, 19, 10, 0);
  assert.strictEqual(w.texts.filter((t) => t.Body.includes('just a reminder')).length, 2, 'reminded once');
  w.act('Sue', 'yesall');
  w.jobs(2026, 10, 20, 10, 0);
  const mail = w.sent.find((m) => m.subject.startsWith('No answer yet'));
  assert.strictEqual(mail.subject, 'No answer yet: Mark Lee');
  assert(mail.body.includes('Mark Lee, (864) 555-0103: Camera Operator on Nov 1, Camera Operator on Nov 8, Livestream Producer on Nov 15 and Camera Operator on Nov 22'), mail.body);
  w.jobs(2026, 10, 21, 10, 0);
  assert.strictEqual(w.sent.filter((m) => m.subject.startsWith('No answer yet')).length, 1);
});

test('an open spot nobody takes: you\'re told after 3 days, once', () => {
  const w = asked();
  w.sent.length = 0;
  w.jobs(2026, 10, 17, 10, 0);
  assert(!w.sent.some((m) => m.subject.startsWith('Still open')), 'not yet');
  w.jobs(2026, 10, 18, 10, 0);
  const mail = w.sent.find((m) => m.subject.startsWith('Still open'));
  assert(mail.body.includes('Media ProPresenter on Nov 29: asked Jen Park and Sue Wong, no yes yet'), mail.body);
  w.jobs(2026, 10, 19, 10, 0);
  assert.strictEqual(w.sent.filter((m) => m.subject.startsWith('Still open')).length, 1);
});

test('an open spot less than a week away: you\'re told after 1 day', () => {
  const w = asked();
  w.clock(2026, 11, 3, 12);
  w.act('Tom', 'cant', 8, 'Livestream Producer'); // Jen and Ann are asked
  w.sent.length = 0;
  w.jobs(2026, 11, 4, 11, 0);
  assert(!w.sent.some((m) => m.subject.includes('Livestream Producer on Nov 8')));
  w.jobs(2026, 11, 4, 12, 0);
  assert(w.sent.some((m) => m.subject === 'Still open: Livestream Producer on Nov 8'));
});

test('Monday 8am: the month ahead, with what needs attention and who isn\'t in Elvanto yet', () => {
  const w = asked();
  w.act('Tom', 'yesall');
  w.act('Jen', 'yesall');
  w.props.ELVANTO_API_KEY = 'key';
  w.elvanto = (endpoint) => (endpoint === 'services/getAll' ? { status: 'ok', services: { total: 1, service: [{
    name: 'Sunday Service', date: '2026-11-01 15:00:00',
    volunteers: { plan: { positions: { position: [{ position_name: 'Livestream', department_name: 'Media', volunteers: { volunteer: [
      { person: { id: '1', firstname: 'Thomas', preferred_name: 'Tom', lastname: 'Smith' }, status: 'Confirmed' }] } }] } } },
  }] } } : { status: 'fail' });
  w.sent.length = 0;
  w.jobs(2026, 10, 19, 7, 0);
  assert(!w.sent.some((m) => m.subject.startsWith('Serving schedule')), 'not before 8am');
  w.jobs(2026, 10, 19, 8, 0);
  const mail = w.sent.find((m) => m.subject.startsWith('Serving schedule'));
  assert.strictEqual(mail.subject, 'Serving schedule: the month ahead (1 open)');
  const b = mail.body;
  assert(b.includes('NEEDS ATTENTION\n• Open: Livestream Audio, Sunday, November 8\n• No answer: Mark Lee (864) 555-0103, Camera Operator, Sunday, November 1'), b);
  assert(b.includes('• Not in Elvanto yet: Jen Park, ProPresenter, Sunday, November 1'), b);
  assert(b.includes('SUNDAY, NOVEMBER 1\n• ProPresenter: Jen Park (not in Elvanto yet)\n• Livestream Producer: Tom Smith ✓ in Elvanto\n• Camera Operator: Mark Lee (hasn\'t confirmed) (not in Elvanto yet)'), b);
  assert(!b.includes('NOVEMBER 22'), 'a month ahead');
  w.jobs(2026, 10, 19, 9, 0);
  assert.strictEqual(w.sent.filter((m) => m.subject.startsWith('Serving schedule')).length, 1, 'once');
});

test('a name typed into the Schedule tab by hand gets that person\'s page and buttons', () => {
  const w = asked();
  const r = w.spot(29, 'ProPresenter');
  w.run('setCells_(getTab_("Schedule"), ' + r._row + ', {"Serving": "Sue Wong", "Status": "Confirmed"})');
  assert(w.page('Sue').includes('Sunday, November 29'));
  assert.strictEqual(w.act('Jen', 'cover', 29, 'ProPresenter'), 'Thank you! Sue already said yes, so you\'re not needed for this one.');
});

test('menu: "Send next month\'s schedule now" needs Twilio and the web app, and only texts people not yet asked', () => {
  const w = scheduler();
  ['TWILIO_ACCOUNT_SID', 'TWILIO_KEY_SID', 'TWILIO_KEY_SECRET', 'TWILIO_FROM'].forEach((k) => { w.props['SAVE_' + k] = w.props[k]; delete w.props[k]; });
  w.run('sendNextMonthNow()');
  assert(w.alerts.pop().startsWith('Connect Twilio first'));
  ['TWILIO_ACCOUNT_SID', 'TWILIO_KEY_SID', 'TWILIO_KEY_SECRET', 'TWILIO_FROM'].forEach((k) => { w.props[k] = w.props['SAVE_' + k]; });
  w.run('sendNextMonthNow()');
  assert(w.alerts.pop().startsWith('Texted 4 volunteers their November Sundays.'));
  w.run('sendNextMonthNow()');
  assert(w.alerts.pop().startsWith('Everyone in the'));
  w.noUi = true;
  assert.throws(() => w.run('sendNextMonthNow()'), /Run this from the Volunteer Scheduler menu/);
});

test('names on the page are escaped', () => {
  const w = scheduler();
  w.tab('Media Team').data[1][0] = '<b>Tom</b> Smith';
  w.tab('Media Rotation').data[2][1] = '<b>Tom</b> Smith';
  w.jobs(2026, 10, 15, 10, 0);
  assert(!w.page('Tom').includes('<b>Tom</b>'));
});

test('the all-in-one VolunteerScheduler.gs is up to date and works on its own', () => {
  const { buildSingleFile } = require('../tools/build-single-file.js');
  const built = buildSingleFile();
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'VolunteerScheduler.gs'), 'utf8'), built,
    'VolunteerScheduler.gs is out of date: run node tools/build-single-file.js');
  const w = makeWorld(built);
  w.run('setup()');
  assert(w.tab('Media Rotation'));
});

test('Connect Elvanto saves a working key and refuses a bad one', () => {
  const w = makeWorld();
  w.run('setup()');
  w.elvanto = () => ({ status: 'fail', error: { message: 'Invalid API key' } });
  w.promptAnswer = 'bad';
  w.run('connectElvanto()');
  assert(!w.props.ELVANTO_API_KEY && w.alerts.pop().includes('Invalid API key'));
  w.elvanto = () => ({ status: 'fail', error: { code: 404, message: 'No services match your criteria.' } });
  w.promptAnswer = 'good';
  w.run('connectElvanto()');
  assert.strictEqual(w.props.ELVANTO_API_KEY, 'good');
});

test('Connect Twilio checks the details before saving', () => {
  const w = makeWorld();
  w.run('setup()');
  w.promptAnswer = ['AC1', 'SK1', 'secret', '+18645550100'];
  w.run('connectTwilio()');
  assert(!w.props.TWILIO_ACCOUNT_SID, 'refused');
  w.twilio = () => ({ code: 200, body: {} });
  w.promptAnswer = ['AC1', 'SK1', 'secret', '+18645550100'];
  w.run('connectTwilio()');
  assert.strictEqual(w.props.TWILIO_FROM, '+18645550100');
});

// ---------- Run ----------
let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('  ✓ ' + t.name); }
  catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 8).join('\n      ')); }
}
console.log(`\n${tests.length - failed} of ${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
