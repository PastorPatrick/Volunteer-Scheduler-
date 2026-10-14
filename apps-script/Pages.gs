/**
 * ============================================================
 *  PAGES — each volunteer's own page
 * ============================================================
 *
 * Every text links to the volunteer's own page (one link per mobile number,
 * the same every month). It shows:
 *   Your Sundays:    each spot they're on, with "I'll be there" and "Can't"
 *                    (and "Yes to all" when several are waiting).
 *   Can you cover?   open spots in positions they're trained in, on Sundays
 *                    they're free, with "I can cover". First yes gets it.
 *
 * The page only works after the script is published as a web app (setup
 * guide, Step 5). Each link carries a security code made from a secret kept
 * in this script, so nobody can guess another volunteer's link.
 *
 * Opening a link never changes anything. Only tapping a button does. (Phones
 * load links to show previews, and that must not record an answer by accident.)
 */

/** Runs when someone opens their link. Never changes anything. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const mobile = normalizePhone_(p.m);
  const person = p.p === 'me' && mobile.length === 10 && String(p.t || '') === linkCode_('person', mobile) ? peopleByMobile_()[mobile] : null;
  return HtmlService.createHtmlOutput(pageShell_(person ? renderPersonPage_(person) : renderNotFound_(), person ? 'me:' + mobile : '', person ? String(p.t) : ''))
    .setTitle(churchName_() + ' – Serving')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Called by the page's buttons. Returns {html, message} so the page can redraw.
 * action: yesall | yes | cant | cover
 */
function pageAction(page, code, action, row, key) {
  const mobile = String(page || '').indexOf('me:') === 0 ? String(page).slice(3) : '';
  const person = mobile && String(code || '') === linkCode_('person', mobile) ? peopleByMobile_()[mobile] : null;
  if (!person) return { html: renderNotFound_(), message: '' };
  if (['yesall', 'yes', 'cant', 'cover'].indexOf(action) === -1) return { html: renderPersonPage_(person), message: 'That button isn\'t available here.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { html: '', message: 'Busy right now. Please try again in a moment.' };
  let message;
  try {
    message = applyAction_(person, action, Number(row), String(key || ''), clockNow_());
  } catch (e) {
    message = 'Something went wrong: ' + e.message + '. Please try again.';
  } finally {
    lock.releaseLock();
  }
  return { html: renderPersonPage_(person), message: message };
}

function applyAction_(person, action, row, key, now) {
  const tab = getTab_(TABS.SCHEDULE);
  const ctx = scheduleContext_();
  const rows = scheduleRows_(ctx);
  const today = ymd_(now);
  const mine = (r) => r._serving && r._mobile === person.mobile;

  if (action === 'yesall') {
    const waiting = rows.filter((r) => mine(r) && r._status === STATUS.WAITING && r._day >= today);
    if (!waiting.length) return 'You\'re all set. Thank you!';
    waiting.forEach((r) => setCells_(tab, r._row, { 'Status': STATUS.CONFIRMED, 'Answered': now }));
    logActivity_(person.name, 'Confirmed', joinWords_(waiting.map(spotWords_)));
    return 'Thank you! You\'re confirmed for ' + joinWords_(waiting.map(spotWords_)) + '.';
  }

  const r = rows.find((x) => x._row === row && x._key === key);
  if (!r) return 'The schedule changed while you were looking. Please try again.';
  if (r._day < today) return 'That Sunday has already passed.';

  if (action === 'yes') {
    if (!mine(r)) return 'You\'re not on ' + spotWords_(r) + ' anymore.';
    if (r._status !== STATUS.CONFIRMED) setCells_(tab, r._row, { 'Status': STATUS.CONFIRMED, 'Answered': now });
    logActivity_(person.name, 'Confirmed', spotWords_(r));
    return 'Thank you! You\'re confirmed for ' + spotWords_(r) + '.';
  }

  if (action === 'cant') {
    if (!mine(r)) return 'You\'re not on ' + spotWords_(r) + '.';
    const wasConfirmed = r._status === STATUS.CONFIRMED;
    setCells_(tab, r._row, {
      'Serving': '', 'Mobile': '', 'Status': STATUS.OPEN, 'Answered': now, 'Open since': now, 'Uncovered notice': '',
      'Cover texted': '', 'Can\'t': r._cant.concat([person.mobile]).map(formatPhone_).join(', '),
      'Notes': [String(r['Notes'] || ''), person.name + ' can\'t (' + shortDay_(now) + ')'].filter((x) => x).join('; '),
    });
    logActivity_(person.name, 'Can\'t serve', spotWords_(r));
    const asked = sendCoverRequests_(now, false)[r._key] || [];
    tellCoordinatorCant_(person, r, wasConfirmed, asked, now);
    return 'Thanks for letting us know. We\'ll find someone to cover ' + spotWords_(r) + '.';
  }

  // cover
  if (mine(r)) return 'You\'re already on ' + spotWords_(r) + '. Thank you!';
  if (r._serving || r._status !== STATUS.OPEN) return 'Thank you! ' + (r._serving ? r._serving.split(/\s+/)[0] + ' already said yes' : 'It\'s already covered') + ', so you\'re not needed for this one.';
  const v = (ctx.vols[r._team] || []).find((x) => x.mobile === person.mobile);
  if (!v || !v.active || v.trained.indexOf(r._position) === -1) return 'You\'re not set up for ' + r._position + '. Please check with your team leader.';
  const other = rows.find((x) => x._day === r._day && mine(x));
  if (other) return 'You\'re already serving ' + other._position + ' that Sunday, and it\'s one position a Sunday.';
  setCells_(tab, r._row, {
    'Serving': v.name, 'Mobile': formatPhone_(v.mobile), 'Status': STATUS.CONFIRMED, 'Answered': now,
    'Notes': [String(r['Notes'] || ''), 'Covered by ' + v.name + ' (' + shortDay_(now) + ')'].filter((x) => x).join('; '),
  });
  logActivity_(v.name, 'Covered', spotWords_(r));
  textPerson_(v, 'Cover confirmed', { sundays: spotWords_(r) });
  if (r._cant.length || r['Uncovered notice']) tellCoordinatorCovered_(v, r);
  return 'Thank you! ' + spotWords_(r) + ' is yours. We\'ve texted you a confirmation.';
}

/** Right away, to you (and the team leader): someone can't serve. */
function tellCoordinatorCant_(person, r, wasConfirmed, asked, now) {
  const hour = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'H'));
  const rows = scheduleRows_();
  const fresh = rows.find((x) => x._key === r._key) || r;
  const nobody = !coverCandidates_(fresh, rows, scheduleContext_()).length;
  const cover = asked.length ? 'A cover request was texted to ' + joinWords_(asked) + '. The first to say yes gets it; you\'ll hear if nobody does.'
    : nobody ? 'Nobody else on ' + r._team + ' is trained in ' + r._position + ', active, and free that Sunday, so you\'ll need to find someone.'
      : hour < TEXT_HOURS.from || hour >= TEXT_HOURS.to ? 'The cover request will be texted at ' + TEXT_HOURS.from + 'am.' : 'A cover request will go out shortly.';
  const subject = person.name + ' can\'t serve ' + r._position + ' on ' + formatDay_(r['Sunday']);
  const body = person.name + (wasConfirmed ? ' had confirmed, but' : '') + ' just said they can\'t serve ' + r._position + ' (' + r._team + ') on ' +
    formatDay_(r['Sunday']) + '.\n\n' + cover + (wasConfirmed ? '\n\nIf they were already in Elvanto, take them off there.' : '');
  sendEmail_({ to: recipientsFor_([r._team]), subject: subject, name: churchName_() + ' Volunteer Scheduler', body: body,
    htmlBody: sectionsHtml_('', escapeHtml_(body).replace(/\n/g, '<br>'), []) });
}

/** To you: a spot someone couldn't make has been covered. */
function tellCoordinatorCovered_(v, r) {
  const body = v.name + ' will cover ' + r._position + ' (' + r._team + ') on ' + formatDay_(r['Sunday']) + '. Add them in Elvanto.';
  sendEmail_({ to: recipientsFor_([r._team]), subject: 'Covered: ' + r._position + ' on ' + formatDay_(r['Sunday']) + ' (' + v.name + ')',
    name: churchName_() + ' Volunteer Scheduler', body: body, htmlBody: sectionsHtml_('', escapeHtml_(body), []) });
}

function renderPersonPage_(person) {
  const now = clockNow_();
  const today = ymd_(now);
  const ctx = scheduleContext_();
  const rows = scheduleRows_(ctx).filter((r) => r._day >= today)
    .sort((a, b) => (a._day < b._day ? -1 : a._day > b._day ? 1 : a._row - b._row));
  const mine = rows.filter((r) => r._serving && r._mobile === person.mobile);
  const cover = rows.filter((r) => r._status === STATUS.OPEN && !r._serving && r._day > today &&
    coverCandidates_(r, rows, ctx).some((v) => v.mobile === person.mobile));
  const attrs = (r) => ' data-row="' + r._row + '" data-key="' + escapeHtml_(r._key) + '"';
  const waiting = mine.filter((r) => r._status === STATUS.WAITING);
  let html = '<header><p class="eyebrow">' + escapeHtml_(churchName_()) + ' · Serving</p><h1>Hi ' + escapeHtml_(person.first) + '!</h1></header>';

  html += '<h2>Your Sundays</h2>';
  if (!mine.length) html += '<section class="card"><p class="hint">You\'re not on the schedule right now.</p></section>';
  if (waiting.length > 1) html += '<section class="card"><button class="primary big" data-action="yesall">Yes to all ' + waiting.length + '</button></section>';
  mine.forEach((r) => {
    const confirmed = r._status === STATUS.CONFIRMED;
    html += '<section class="card' + (confirmed ? ' is-done' : '') + '"><p><b>' + escapeHtml_(formatDay_(r['Sunday'])) + '</b><br>' +
      escapeHtml_(r._position) + (confirmed ? ' <span class="done">✓ Confirmed</span>' : '') + '</p>' +
      (confirmed ? '' : '<button class="primary" data-action="yes"' + attrs(r) + '>I\'ll be there</button> ') +
      '<button data-action="cant"' + attrs(r) + '>' + (confirmed ? 'I can\'t make it after all' : 'Can\'t') + '</button></section>';
  });

  if (cover.length) {
    html += '<h2>Can you cover?</h2><p class="hint">The first person to say yes gets it.</p>';
    cover.forEach((r) => {
      html += '<section class="card"><p><b>' + escapeHtml_(formatDay_(r['Sunday'])) + '</b><br>' + escapeHtml_(r._position) + '</p>' +
        '<button class="primary" data-action="cover"' + attrs(r) + '>I can cover</button></section>';
    });
  }
  return html;
}

function renderNotFound_() {
  return '<section class="card"><h1>This link doesn\'t work</h1>' +
    '<p>It may have been copied incompletely. Ask your volunteer coordinator for a fresh link.</p></section>';
}

/** The page around the content: styles and the small script that runs the buttons. */
function pageShell_(body, page, code) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' +
    ':root{--bg:#f3f6f5;--card:#fff;--ink:#16252a;--muted:#5a6b70;--line:#d7e0df;--accent:#1f5e73;--good:#2b7148;--warn:#fff4cc}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#0e1618;--card:#152125;--ink:#e3ecec;--muted:#98aaae;--line:#26373b;--accent:#72b6cc;--good:#6dc18d;--warn:#372b14}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
    'main{max-width:720px;margin:0 auto;padding:16px}h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:16px 0 6px}' +
    '.eyebrow{margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.facts{margin:0 0 16px;color:var(--muted)}' +
    '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:0 0 10px}.card p{margin:0 0 8px}.card h2{margin-top:0}' +
    '.hint{color:var(--muted);font-size:15px}.warn{background:var(--warn);padding:2px 8px;border-radius:8px}' +
    'button{font:inherit;font-weight:600;padding:12px 18px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;margin-top:6px}' +
    '.primary{background:var(--accent);border-color:var(--accent);color:#fff}.big{width:100%}.done{color:var(--good);font-weight:700;font-size:16px}' +
    '.is-done{opacity:.85}a{color:var(--accent)}' +
    '#msg{position:sticky;top:0;z-index:2;background:var(--accent);color:#fff;padding:10px 14px;border-radius:10px;margin:0 0 12px}' +
    'button:disabled{opacity:.5}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '</style></head><body><main><div id="msg" hidden></div><div id="app">' + body + '</div></main>' +
    '<script>' + PAGE_CLIENT_JS.replace('__PAGE__', JSON.stringify(page)).replace('__CODE__', JSON.stringify(code)) + '</script></body></html>';
}

// The pages' own script: press a button, save, and redraw.
const PAGE_CLIENT_JS = [
  'var PAGE=__PAGE__,CODE=__CODE__;',
  'function show(m){var el=document.getElementById("msg");if(!m){el.hidden=true;return;}el.textContent=m;el.hidden=false;window.scrollTo(0,0);}',
  'document.addEventListener("click",function(ev){var b=ev.target.closest("button");if(!b||!b.dataset.action)return;',
  ' b.disabled=true;show("Saving…");',
  ' google.script.run.withSuccessHandler(function(r){if(r.html)document.getElementById("app").innerHTML=r.html;show(r.message);})',
  ' .withFailureHandler(function(e){b.disabled=false;show("Couldn\'t save: "+e.message+". Please try again.");})',
  ' .pageAction(PAGE,CODE,b.dataset.action,b.dataset.row||0,b.dataset.key||"");',
  '});',
].join('\n');
