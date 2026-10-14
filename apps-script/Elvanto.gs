/**
 * ============================================================
 *  ELVANTO — reading the schedule
 * ============================================================
 *
 * The scheduler only READS Elvanto. Elvanto's API doesn't let other programs
 * add people to a service, so the schedule is entered in Elvanto by hand. The
 * Monday report reads Elvanto and flags anyone not entered there yet.
 *
 * Connecting: Volunteer Scheduler → Connect Elvanto, and paste the church's
 * Elvanto API key (Elvanto → Settings → Developers → API; only admins can see
 * it). The key gives full access to the Elvanto account. It's stored in this
 * script's private settings (Script Properties), not in the spreadsheet, but
 * anyone who can edit the spreadsheet can open the script and see it, so keep
 * the editor list short.
 */

const ELVANTO_API = 'https://api.elvanto.com/v1/';

/** Calls the Elvanto API and returns its reply, or throws an error a person can read. */
function elvantoCall_(endpoint, params) {
  const key = PropertiesService.getScriptProperties().getProperty('ELVANTO_API_KEY');
  if (!key) throw new Error('Elvanto isn\'t connected yet. Use Volunteer Scheduler → Connect Elvanto.');
  const res = UrlFetchApp.fetch(ELVANTO_API + endpoint + '.json', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(params || {}),
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(key + ':') },
    muteHttpExceptions: true,
  });
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) {
    throw new Error('Elvanto sent an unexpected reply (code ' + res.getResponseCode() + ').');
  }
  if (!body || body.status !== 'ok') {
    const message = (body && body.error && body.error.message) || (body && body.status) || 'no reply';
    // Elvanto answers "No ... match your criteria" when a search finds nothing: an empty list.
    if (/match your criteria/i.test(message)) return { status: 'ok', empty: true };
    throw new Error('Elvanto said: ' + message);
  }
  return body;
}

function elvantoConnected_() {
  return !!PropertiesService.getScriptProperties().getProperty('ELVANTO_API_KEY');
}

/** Elvanto gives service times in UTC, like "2026-10-11 14:00:00". This is the local (church) date. */
function elvantoLocalDay_(text) {
  const m = String(text || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(text || '').slice(0, 10);
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Utilities.formatDate(utc, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Elvanto sometimes sends one item as an object and several as a list. This always gives a list. */
function asList_(x) {
  if (Array.isArray(x)) return x;
  return x ? [x] : [];
}

/** Every object anywhere inside `root` for which test(object) is true. */
function findAll_(root, test, found) {
  found = found || [];
  if (!root || typeof root !== 'object') return found;
  if (test(root)) found.push(root);
  Object.keys(root).forEach((k) => findAll_(root[k], test, found));
  return found;
}

/**
 * Everyone scheduled in Elvanto from `start` to `end` (the service named on
 * the Settings tab), as [{day, id, first, legalFirst, last, department, position, declined}].
 */
function elvantoRoster_(start, end) {
  const serviceName = getSettingText_('Elvanto service name').toLowerCase();
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const body = elvantoCall_('services/getAll', {
      start: ymd_(start), end: ymd_(end), page: page, page_size: 100, fields: ['volunteers'],
    });
    const services = asList_(body.services && body.services.service);
    services.filter((s) => !serviceName || String(s.name || '').trim().toLowerCase() === serviceName).forEach((service) => {
      const day = elvantoLocalDay_(service.date);
      findAll_(service.volunteers, (o) => o && typeof o === 'object' && 'position_name' in o).forEach((pos) => {
        findAll_(pos.volunteers, (o) => o && typeof o === 'object' && o.person && typeof o.person === 'object').forEach((holder) => {
          const person = holder.person;
          out.push({
            day: day, id: String(person.id || ''),
            first: String(person.preferred_name || person.firstname || '').trim(), legalFirst: String(person.firstname || '').trim(),
            last: String(person.lastname || '').trim(),
            department: String(pos.department_name || '').trim(), position: String(pos.position_name || '').trim(),
            declined: /declin/i.test(String(holder.status || '')),
          });
        });
      });
    });
    const total = Number(body.services && body.services.total) || 0;
    if (!services.length || page * 100 >= total) break;
  }
  return out;
}

// ---------- Menu item ----------

/** Menu item: saves the Elvanto API key in the script's private settings and checks it works. */
function connectElvanto() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('Connect Elvanto',
    'Paste the church\'s Elvanto API key (in Elvanto: Settings → Developers → API → Show).\n\n' +
    'It\'s saved in the script\'s private settings, not in this spreadsheet. Leave it blank and click OK to disconnect.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const key = String(answer.getResponseText() || '').trim();
  const props = PropertiesService.getScriptProperties();
  if (!key) {
    props.deleteProperty('ELVANTO_API_KEY');
    ui.alert('Elvanto is disconnected.');
    return;
  }
  props.setProperty('ELVANTO_API_KEY', key);
  try {
    elvantoCall_('services/getAll', { page_size: 10, all: 'yes' }); // any answer (even "no services") means the key works
  } catch (e) {
    props.deleteProperty('ELVANTO_API_KEY');
    ui.alert('That key didn\'t work, so it wasn\'t saved.\n\n' + e.message);
    return;
  }
  ui.alert('Connected to Elvanto. The Monday report will now flag anyone not entered in Elvanto yet.');
}
