/**
 * ============================================================
 *  SCHEDULE — the monthly ask, finding cover, and your emails
 * ============================================================
 *
 * The Schedule tab has one row per Sunday, team and position: who is serving,
 * and whether they've confirmed (Waiting / Confirmed / Open).
 *
 *   Ask day, 10am (the 15th):  next month's rows are made from the rotation.
 *       Each person in it gets ONE text listing their Sundays, with a link to
 *       their own page: "Yes to all", or "Can't" for any Sunday.
 *       Empty spots (like 5th Sundays) open right away.
 *   3 days later:   a reminder text to anyone who hasn't answered.
 *   5 days later:   you get an email listing anyone still silent.
 *       (Both are timed from each person's own text, so someone added and
 *       texted later, or a test, gets their own timing.)
 *   Any "Can't":    you get an email right away (even if they'd confirmed),
 *       and the spot opens.
 *   An open spot:   everyone trained in that position, active, and not
 *       already serving that Sunday is texted. The first to say yes gets it
 *       and is texted a confirmation. (Texts only go out 8am–8pm; a spot that
 *       opens at night goes out in the morning.)
 *   Still open:     you get an email 3 days after a spot opened, after 1 day
 *       if that Sunday is less than a week away, or right away if nobody
 *       else is trained and free.
 *   Mondays, 8am:   the month ahead to you: every Sunday and position, who's
 *       on, what's open, who hasn't answered, and (with Elvanto connected)
 *       who isn't in Elvanto yet.
 *
 * Texts go to volunteers only; everything to you is by email. Elvanto's API
 * can't add people to a service, so you enter the schedule there yourself.
 */

const STATUS = { WAITING: 'Waiting', CONFIRMED: 'Confirmed', OPEN: 'Open' };
const ASK_HOUR = 10;
const REMIND_AFTER_DAYS = 3;
const NO_ANSWER_AFTER_DAYS = 5;
const UNCOVERED_AFTER_DAYS = 3;
const TEXT_HOURS = { from: 8, to: 20 };       // cover requests only go out between 8am and 8pm
const REPORT_TIME = { day: 1, hour: 8 };      // Monday 8am (1 = Monday … 7 = Sunday)
const REPORT_DAYS_AHEAD = 31;

// ---------- Links ----------

function webAppBase_() {
  return String(getSetting_('Web app link') || '').trim();
}

/** A volunteer's own page (the same link every month), by mobile number. */
function personLink_(mobile) {
  const base = webAppBase_();
  return base && mobile ? base + (base.indexOf('?') === -1 ? '?' : '&') + 'p=me&m=' + mobile + '&t=' + linkCode_('person', mobile) : '';
}

// ---------- Reading the Schedule tab ----------

/** Teams and their volunteers, read once for a whole job. */
function scheduleContext_() {
  const ctx = { teams: {}, vols: {} };
  teams_().forEach((t) => { ctx.teams[t.name] = t; ctx.vols[t.name] = teamVolunteers_(t); });
  ctx.byName = (team, name) => {
    const n = String(name || '').trim().toLowerCase();
    return n ? (ctx.vols[team] || []).find((v) => v.name.toLowerCase() === n) || null : null;
  };
  return ctx;
}

/**
 * Every Schedule row, each with _day, _team, _position, _key, _serving,
 * _mobile (of whoever is serving, from their team tab, so a name typed in by
 * hand works too), _cant and _texted (lists of mobiles).
 */
function scheduleRows_(ctx) {
  ctx = ctx || scheduleContext_();
  const list = (x) => String(x || '').split(',').map((s) => normalizePhone_(s)).filter((s) => s.length === 10);
  return readRows_(getTab_(TABS.SCHEDULE)).filter((r) => r['Sunday'] instanceof Date && r['Team'] && r['Position']).map((r) => {
    r._day = ymd_(r['Sunday']);
    r._team = String(r['Team']).trim();
    r._position = String(r['Position']).trim();
    r._key = r._day + '|' + r._team + '|' + r._position;
    r._serving = String(r['Serving'] || '').trim();
    const v = ctx.byName(r._team, r._serving);
    r._mobile = r._serving ? (v && v.mobile) || normalizePhone_(r['Mobile']) : '';
    r._status = String(r['Status'] || '').trim();
    r._cant = list(r['Can\'t']);
    r._texted = list(r['Cover texted']);
    return r;
  });
}

/** True if this person (by mobile) is already serving anywhere that Sunday. */
function busyThatDay_(rows, day, mobile) {
  return rows.some((r) => r._day === day && r._serving && r._mobile === mobile);
}

/** "Camera Operator on Nov 8" */
function spotWords_(r) {
  return r._position + ' on ' + shortDay_(r['Sunday']);
}

/** The Sundays in the month that `date` falls in. */
function sundaysInMonth_(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  const out = [];
  while (d.getMonth() === date.getMonth()) { out.push(new Date(d)); d.setDate(d.getDate() + 7); }
  return out;
}

// ---------- Texting ----------

/** Texts one person a template. Returns '' if sent, or why not. */
function textPerson_(person, templateName, fill) {
  const c = twilioConfig_();
  if (!c) return 'Twilio isn\'t connected';
  if (!person.mobile || person.mobile.length !== 10) return 'no mobile number';
  const text = fillTemplate_(getTemplate_(templateName), Object.assign({ firstName: person.first, link: personLink_(person.mobile) }, fill));
  const problem = sendText_(c, person.mobile, text);
  logActivity_(person.name, problem ? templateName + ' text not sent' : templateName + ' text sent', problem || text);
  return problem;
}

// ---------- The monthly ask ----------

/** Adds next month's rows from the rotation (only ones not already there). Returns notes about the rotation. */
function buildMonth_(month, now) {
  const tab = getTab_(TABS.SCHEDULE);
  const ctx = scheduleContext_();
  const rows = scheduleRows_(ctx);
  const have = rows.map((r) => r._key);
  const serving = {}; // day → [mobile or name]
  rows.forEach((r) => { if (r._serving) (serving[r._day] = serving[r._day] || []).push(r._mobile || r._serving.toLowerCase()); });
  const notes = [];
  sundaysInMonth_(month).forEach((sunday) => {
    const day = ymd_(sunday);
    const week = weekOfMonth_(sunday);
    Object.keys(ctx.teams).forEach((teamName) => {
      const team = ctx.teams[teamName];
      const rot = rotation_(team);
      team.positions.forEach((position) => {
        if (have.indexOf(day + '|' + teamName + '|' + position) !== -1) return;
        const usual = (rot[position] || [])[week - 1] || '';
        let v = ctx.byName(teamName, usual);
        let note = '';
        if (usual && !v) note = '"' + usual + '" isn\'t on the ' + teamName + TEAM_TAB_SUFFIX + ' tab';
        else if (v && !v.active) { note = v.name + ' isn\'t marked Active'; v = null; }
        else if (v && (serving[day] || []).indexOf(v.mobile || v.name.toLowerCase()) !== -1) { note = v.name + ' is already serving another position that Sunday'; v = null; }
        if (v) (serving[day] = serving[day] || []).push(v.mobile || v.name.toLowerCase());
        if (note) notes.push(position + ', ' + formatDay_(sunday) + ': ' + note + ', so the spot is open.');
        appendObject_(tab, {
          'Sunday': sunday, 'Team': teamName, 'Position': position, 'Serving': v ? v.name : '',
          'Status': v ? STATUS.WAITING : STATUS.OPEN, 'Usual': usual, 'Mobile': v ? formatPhone_(v.mobile) : '',
          'Open since': v ? '' : now, 'Notes': note,
        });
      });
    });
  });
  return notes;
}

/**
 * Makes next month's rows and texts each person in the rotation their
 * Sundays (only people not already asked), then sends open spots out for
 * cover. Safe to run again. Returns what happened, and emails it to you.
 */
function askMonth_(month, now) {
  if (!webAppBase_()) throw new Error('Publish the web app first (setup guide, Step 5) and paste its link on the Settings tab.');
  if (!twilioConfig_()) throw new Error('Connect Twilio first (Volunteer Scheduler → Connect Twilio). Volunteers are reached by text.');
  const monthKey = ymd_(month).slice(0, 7);
  const name = monthName_(month);
  const notes = buildMonth_(month, now);
  const tab = getTab_(TABS.SCHEDULE);
  const ctx = scheduleContext_();
  const toAsk = scheduleRows_(ctx).filter((r) => r._day.slice(0, 7) === monthKey && r._status === STATUS.WAITING && r._serving && !r['Asked']);
  const byPerson = {};
  toAsk.forEach((r) => { const k = r._mobile || 'name:' + r._serving; (byPerson[k] = byPerson[k] || []).push(r); });
  const asked = [], notReached = [];
  Object.keys(byPerson).forEach((k) => {
    const rows = byPerson[k];
    const person = { name: rows[0]._serving, first: rows[0]._serving.split(/\s+/)[0], mobile: rows[0]._mobile };
    const problem = textPerson_(person, 'Monthly ask', { month: name, sundays: joinWords_(rows.map(spotWords_)) });
    if (problem) { notReached.push(person.name + ' (' + problem + ')'); return; }
    rows.forEach((r) => setCells_(tab, r._row, { 'Asked': now }));
    asked.push(person.name);
  });

  const covers = sendCoverRequests_(now, true);
  const open = scheduleRows_().filter((r) => r._day.slice(0, 7) === monthKey && r._status === STATUS.OPEN && !r._serving);
  if (asked.length || notReached.length || open.length) {
    sendSectionsEmail_(reportEmail_(), name + ' schedule sent', '',
      asked.length + ' volunteer' + (asked.length === 1 ? ' was' : 's were') + ' texted their ' + name + ' Sundays. You\'ll get an email when anyone says they can\'t.', [
        { title: 'Texted', items: asked.length ? [{ text: asked.join(', ') }] : [], empty: 'Nobody new.' },
        { title: 'Couldn\'t text', items: notReached.map((t) => ({ text: t })) },
        { title: 'Open spots sent out for cover', items: open.map((r) => ({ text: spotWords_(r) + ': ' +
          (covers[r._key] && covers[r._key].length ? 'asked ' + joinWords_(covers[r._key]) : 'nobody else is trained and free that day') })) },
        { title: 'From the rotation', items: notes.map((t) => ({ text: t })) },
      ].filter((s) => s.items.length || s.empty));
  }
  logActivity_('', name + ' schedule sent', asked.length + ' texted' + (notReached.length ? '; not reached: ' + notReached.join(', ') : ''));
  return { asked: asked, notReached: notReached, open: open.length, month: name };
}

// ---------- Finding cover ----------

/** Who could cover an open spot: active, trained, with a mobile, free that Sunday, and didn't say they can't. */
function coverCandidates_(r, rows, ctx) {
  return (ctx.vols[r._team] || []).filter((v) => v.active && v.mobile.length === 10 && v.trained.indexOf(r._position) !== -1 &&
    r._cant.indexOf(v.mobile) === -1 && !busyThatDay_(rows, r._day, v.mobile));
}

/**
 * Texts everyone who could cover an open spot and hasn't been asked about it
 * yet; one text per person, listing all their spots. Only 8am–8pm unless
 * `anyTime`. Returns {spot key: [first names texted]}.
 */
function sendCoverRequests_(now, anyTime) {
  const hour = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'H'));
  if (!anyTime && (hour < TEXT_HOURS.from || hour >= TEXT_HOURS.to)) return {};
  if (!twilioConfig_() || !webAppBase_()) return {};
  const ctx = scheduleContext_();
  const rows = scheduleRows_(ctx);
  const today = ymd_(now);
  const perPerson = {};
  rows.filter((r) => r._status === STATUS.OPEN && !r._serving && r._day > today).forEach((r) => {
    coverCandidates_(r, rows, ctx).filter((v) => r._texted.indexOf(v.mobile) === -1).forEach((v) => {
      (perPerson[v.mobile] = perPerson[v.mobile] || { v: v, rows: [] }).rows.push(r);
    });
  });
  const tab = getTab_(TABS.SCHEDULE);
  const texted = {};
  Object.keys(perPerson).forEach((mobile) => {
    const p = perPerson[mobile];
    if (textPerson_(p.v, 'Cover request', { sundays: joinWords_(p.rows.map(spotWords_)) })) return;
    p.rows.forEach((r) => {
      r._texted.push(mobile);
      (texted[r._key] = texted[r._key] || []).push(p.v.first);
      setCells_(tab, r._row, { 'Cover texted': r._texted.map(formatPhone_).join(', ') });
    });
  });
  return texted;
}

/** Emails you about open spots nobody has taken (once per spot each time it opens). */
function checkUncovered_(now) {
  const ctx = scheduleContext_();
  const rows = scheduleRows_(ctx);
  const today = ymd_(now);
  const due = rows.filter((r) => {
    if (r._status !== STATUS.OPEN || r._serving || r._day <= today || r['Uncovered notice']) return false;
    const since = r['Open since'] instanceof Date ? r['Open since'] : now;
    const hours = (now.getTime() - since.getTime()) / 3600000;
    const daysAway = -daysSince_(r['Sunday'], now);
    return !coverCandidates_(r, rows, ctx).length || daysSince_(since, now) >= UNCOVERED_AFTER_DAYS || (daysAway < 7 && hours >= 24);
  });
  if (!due.length) return 0;
  const names = (r) => r._texted.map((m) => { const v = (ctx.vols[r._team] || []).find((x) => x.mobile === m); return v ? v.name : formatPhone_(m); });
  sendSectionsEmail_(recipientsFor_(due.map((r) => r._team)), 'Still open: ' + due.map(spotWords_).join(', '), '',
    'Nobody has said yes to ' + (due.length === 1 ? 'this spot' : 'these spots') + ' yet. You may need to find someone yourself.', [
      { title: '', items: due.map((r) => ({ text: r._team + ' ' + spotWords_(r) + ': ' +
        (r._texted.length ? 'asked ' + joinWords_(names(r)) + ', no yes yet' : 'nobody else is trained, active, and free that Sunday') })) },
    ]);
  const tab = getTab_(TABS.SCHEDULE);
  due.forEach((r) => setCells_(tab, r._row, { 'Uncovered notice': now }));
  return due.length;
}

/** The report email, plus the leaders of these teams (if they have an email on the Teams tab). */
function recipientsFor_(teamNames) {
  const out = [reportEmail_()];
  teamNames.forEach((n) => { const t = teamByName_(n); if (t && t.leaderEmail && out.indexOf(t.leaderEmail) === -1) out.push(t.leaderEmail); });
  return out.join(',');
}

// ---------- Reminder and no-answer ----------

/**
 * Spots still Waiting that someone was texted about at least `days` days ago,
 * and that haven't had `column` filled in yet. Each spot is timed from its own
 * text, so a test send or a late addition never throws off anyone else.
 */
function waitingSince_(now, days, column) {
  const today = ymd_(now);
  return scheduleRows_().filter((r) => r._status === STATUS.WAITING && r._serving && r._day >= today &&
    r['Asked'] instanceof Date && daysSince_(r['Asked'], now) >= days && !r[column]);
}

/** 3 days after their text: a reminder to anyone who hasn't answered. */
function remindNoAnswer_(now) {
  const rows = waitingSince_(now, REMIND_AFTER_DAYS, 'Reminded');
  const tab = getTab_(TABS.SCHEDULE);
  const byPerson = {};
  rows.forEach((r) => { if (r._mobile) (byPerson[r._mobile] = byPerson[r._mobile] || []).push(r); });
  Object.keys(byPerson).forEach((mobile) => {
    const mine = byPerson[mobile];
    const first = mine[0];
    textPerson_({ name: first._serving, first: first._serving.split(/\s+/)[0], mobile: mobile }, 'Reminder', { month: monthName_(first['Sunday']) });
    mine.forEach((r) => setCells_(tab, r._row, { 'Reminded': now }));
  });
  return Object.keys(byPerson).length;
}

/** 5 days after their text: everyone who still hasn't answered, to you. */
function emailNoAnswer_(now) {
  const rows = waitingSince_(now, NO_ANSWER_AFTER_DAYS, 'No-answer notice');
  if (!rows.length) return 0;
  const byPerson = {};
  rows.forEach((r) => { (byPerson[r._serving] = byPerson[r._serving] || []).push(r); });
  sendSectionsEmail_(recipientsFor_(rows.map((r) => r._team)), 'No answer yet: ' + Object.keys(byPerson).join(', '), '',
    'These volunteers haven\'t confirmed their Sundays, even after a reminder. They\'re still on the schedule; you may want to check with them.', [
      { title: '', items: Object.keys(byPerson).map((n) => ({ text: n + (byPerson[n][0]._mobile ? ', ' + formatPhone_(byPerson[n][0]._mobile) : ', no mobile number') +
        ': ' + joinWords_(byPerson[n].map(spotWords_)) })) },
    ]);
  const tab = getTab_(TABS.SCHEDULE);
  rows.forEach((r) => setCells_(tab, r._row, { 'No-answer notice': now }));
  return Object.keys(byPerson).length;
}

// ---------- The Monday report ----------

/** The month ahead, to you. Returns false when there's nothing scheduled. */
function sendReport_(now) {
  const today = ymd_(now);
  const until = ymd_(new Date(now.getFullYear(), now.getMonth(), now.getDate() + REPORT_DAYS_AHEAD, 12));
  const rows = scheduleRows_().filter((r) => r._day >= today && r._day <= until)
    .sort((a, b) => (a._day < b._day ? -1 : a._day > b._day ? 1 : a._row - b._row));
  if (!rows.length) return false;
  const teamCount = rows.map((r) => r._team).filter((t, i, all) => all.indexOf(t) === i).length;
  const label = (r) => (teamCount > 1 ? r._team + ' · ' : '') + r._position;

  // Elvanto: who's on the schedule there, to flag anyone not entered yet.
  let roster = null, elvantoNote = '';
  if (elvantoConnected_()) {
    try {
      const first = rows[0]['Sunday'], last = rows[rows.length - 1]['Sunday'];
      roster = elvantoRoster_(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1, 12), new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1, 12));
    } catch (e) { elvantoNote = 'Couldn\'t check Elvanto: ' + e.message; }
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const inElvanto = (r) => roster.some((e) => e.day === r._day && !e.declined &&
    [e.first + e.last, e.legalFirst + e.last].map(norm).indexOf(norm(r._serving)) !== -1);

  const open = rows.filter((r) => !r._serving);
  const waiting = rows.filter((r) => r._serving && r._status === STATUS.WAITING);
  const missing = roster ? rows.filter((r) => r._serving && !inElvanto(r)) : [];
  const attention = []
    .concat(open.map((r) => ({ text: 'Open: ' + label(r) + ', ' + formatDay_(r['Sunday']) + (r._texted.length ? ' (' + r._texted.length + ' asked, no yes yet)' : '') })))
    .concat(waiting.map((r) => ({ text: 'No answer: ' + r._serving + (r._mobile ? ' ' + formatPhone_(r._mobile) : '') + ', ' + label(r) + ', ' + formatDay_(r['Sunday']) })))
    .concat(missing.map((r) => ({ text: 'Not in Elvanto yet: ' + r._serving + ', ' + label(r) + ', ' + formatDay_(r['Sunday']) })))
    .concat(elvantoNote ? [{ text: elvantoNote }] : []);

  const days = rows.map((r) => r._day).filter((d, i, all) => all.indexOf(d) === i);
  const sections = [{ title: 'Needs attention', items: attention, empty: 'Nothing. Every spot is filled and confirmed' + (roster ? ' and in Elvanto.' : '.') }]
    .concat(days.map((day) => {
      const onDay = rows.filter((r) => r._day === day);
      return { title: formatDay_(onDay[0]['Sunday']), items: onDay.map((r) => ({
        text: label(r) + ': ' + (!r._serving ? 'OPEN' : r._serving + (r._status === STATUS.WAITING ? ' (hasn\'t confirmed)' : '') +
          (roster ? (inElvanto(r) ? ' ✓ in Elvanto' : ' (not in Elvanto yet)') : '')),
      })) };
    }));
  sendSectionsEmail_(reportEmail_(), 'Serving schedule: the month ahead' + (open.length ? ' (' + open.length + ' open)' : ''), '',
    'Here\'s every Sunday for the next month.', sections);
  logActivity_('', 'Monday report sent', '');
  return true;
}

// ---------- The hourly timer ----------

function runScheduledJobs() {
  runScheduledJobs_(clockNow_());
}

function runScheduledJobs_(now) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const tz = Session.getScriptTimeZone();
    const hour = Number(Utilities.formatDate(now, tz, 'H'));
    const weekday = Number(Utilities.formatDate(now, tz, 'u'));
    const props = PropertiesService.getScriptProperties();

    // The monthly ask: on the ask day (or later, if it was missed), about next
    // month, once. Sending from the menu (for example a test) doesn't count:
    // the ask day still sends to everyone not texted yet.
    const askDay = Math.min(Number(getSettingText_('Ask day')) || 0, 28);
    const nextKey = ymd_(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12)).slice(0, 7);
    if (askDay && now.getDate() >= askDay && hour >= ASK_HOUR && props.getProperty('AUTO_ASKED') !== nextKey) {
      try {
        askMonth_(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12), now);
        props.setProperty('AUTO_ASKED', nextKey);
      } catch (e) { reportProblemOnce_('monthly text', now, e); }
    }
    if (hour >= ASK_HOUR) {
      try { remindNoAnswer_(now); } catch (e) { reportProblemOnce_('reminder', now, e); }
      try { emailNoAnswer_(now); } catch (e) { reportProblemOnce_('no-answer email', now, e); }
    }

    try { sendCoverRequests_(now, false); } catch (e) { reportProblemOnce_('cover request', now, e); }
    try { checkUncovered_(now); } catch (e) { reportProblemOnce_('open-spot check', now, e); }

    if (weekday === REPORT_TIME.day && hour >= REPORT_TIME.hour && props.getProperty('LAST_REPORT') !== ymd_(now)) {
      props.setProperty('LAST_REPORT', ymd_(now));
      try { sendReport_(now); } catch (e) { reportProblemOnce_('Monday report', now, e); }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Emails a problem to you, at most once a day for each job. */
function reportProblemOnce_(job, now, e) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('PROBLEM_' + job) === ymd_(now)) return;
  props.setProperty('PROBLEM_' + job, ymd_(now));
  try { notifyProblem_('The Volunteer Scheduler\'s ' + job + ' didn\'t finish: ' + e.message); } catch (e2) { /* nothing more to do */ }
}

// ---------- Menu items ----------

/** Menu item: makes next month's schedule and texts it now (only people not already asked). */
function sendNextMonthNow() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const now = clockNow_();
  let result;
  try {
    result = askMonth_(new Date(now.getFullYear(), now.getMonth() + 1, 1, 12), now);
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  ui.alert((result.asked.length ? 'Texted ' + result.asked.length + ' volunteer' + (result.asked.length === 1 ? '' : 's') + ' their ' + result.month + ' Sundays.'
    : 'Everyone in the ' + result.month + ' rotation has already been texted.') +
    (result.notReached.length ? '\n\nCouldn\'t text: ' + result.notReached.join(', ') : '') +
    (result.open ? '\n\n' + result.open + ' open spot' + (result.open === 1 ? '' : 's') + ' sent out for cover.' : '') +
    '\n\nThe details are in your email.');
}

/** Menu item: sends the Monday report now. */
function sendReportNow() {
  menuOnly_();
  const sent = sendReport_(clockNow_());
  SpreadsheetApp.getUi().alert(sent ? 'Sent to ' + reportEmail_() + '.' : 'Nothing is scheduled for the next month yet.');
}
