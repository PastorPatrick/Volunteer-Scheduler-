/**
 * ============================================================
 *  TEAMS — who's trained, and the usual rotation
 * ============================================================
 *
 * Volunteers are told apart by their mobile number, so the same person can
 * be on more than one team. Anyone without a mobile number can't be texted;
 * they're listed in your emails so you can add one.
 */

/** Active teams on the Teams tab, as [{name, positions, leader, leaderEmail}]. */
function teams_() {
  return readRows_(getTab_(TABS.TEAMS))
    .filter((r) => String(r['Team'] || '').trim() && r['Active'] === true)
    .map((r) => ({
      name: String(r['Team']).trim(),
      positions: String(r['Positions'] || '').split(/[,;\n]/).map((p) => p.trim()).filter((p, i, all) => p && all.indexOf(p) === i),
      leader: String(r['Leader'] || '').trim(),
      leaderEmail: String(r['Leader email'] || '').trim(),
    }));
}

function teamByName_(name) {
  return teams_().find((t) => t.name === name) || null;
}

/** A team's volunteers (active or not), as [{name, first, mobile, active, trained: [positions]}]. */
function teamVolunteers_(team) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(team.name + TEAM_TAB_SUFFIX);
  if (!sheet) return [];
  return readRows_(sheet).filter((r) => String(r['Name'] || '').trim()).map((r) => {
    const name = String(r['Name']).trim();
    return {
      name: name, first: name.split(/\s+/)[0], mobile: normalizePhone_(r['Mobile']),
      active: r['Active'] === true, trained: team.positions.filter((p) => r[p] === true),
    };
  });
}

/** One volunteer of a team by name (as typed in the rotation or the Schedule tab). */
function volunteerByName_(team, name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? teamVolunteers_(team).find((v) => v.name.toLowerCase() === n) || null : null;
}

/** Everyone with a mobile number, across all teams: {mobile: {mobile, name, first}}. */
function peopleByMobile_() {
  const out = {};
  teams_().forEach((team) => teamVolunteers_(team).forEach((v) => {
    if (v.mobile.length === 10 && !out[v.mobile]) out[v.mobile] = { mobile: v.mobile, name: v.name, first: v.first };
  }));
  return out;
}

/** The usual rotation: {position: [1st, 2nd, 3rd, 4th, 5th Sunday names]}. */
function rotation_(team) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(team.name + ROTATION_TAB_SUFFIX);
  const out = {};
  if (!sheet) return out;
  readRows_(sheet).forEach((r) => {
    out[String(r['Position']).trim()] = WEEK_COLUMNS.map((w) => String(r[w] || '').trim());
  });
  return out;
}

/** 1 for the 1st Sunday of the month … 5 for the 5th. */
function weekOfMonth_(date) {
  return Math.ceil(date.getDate() / 7);
}

/** Problems with the rotation that would stop a text or break the one-position-a-Sunday rule. */
function rotationProblems_() {
  const problems = [];
  const mobiles = {}; // week → mobile → "Team Position"
  teams_().forEach((team) => {
    const rot = rotation_(team);
    team.positions.forEach((position) => {
      (rot[position] || []).forEach((name, i) => {
        if (!name) return;
        const where = team.name + ', ' + position + ', ' + WEEK_COLUMNS[i];
        const v = volunteerByName_(team, name);
        if (!v) { problems.push(where + ': "' + name + '" isn\'t on the ' + team.name + TEAM_TAB_SUFFIX + ' tab.'); return; }
        if (!v.active) problems.push(where + ': ' + v.name + ' isn\'t marked Active.');
        if (v.mobile.length !== 10) problems.push(where + ': ' + v.name + ' has no mobile number, so they can\'t be texted.');
        if (v.trained.indexOf(position) === -1) problems.push(where + ': ' + v.name + ' isn\'t checked as trained in ' + position + '.');
        const key = v.mobile || v.name.toLowerCase();
        const week = (mobiles[i] = mobiles[i] || {});
        if (week[key]) problems.push(WEEK_COLUMNS[i] + ': ' + v.name + ' is in two positions (' + week[key] + ' and ' + team.name + ' ' + position + '). One person can only fill one position a Sunday.');
        else week[key] = team.name + ' ' + position;
      });
    });
  });
  return problems;
}

/** Menu item: shows anything in the rotation that needs fixing. */
function checkRotation() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const problems = rotationProblems_();
  const notes = [];
  if (!twilioConfig_()) notes.push('Twilio isn\'t connected yet, so no texts can go out (Volunteer Scheduler → Connect Twilio).');
  if (!String(getSetting_('Web app link') || '').trim()) notes.push('The web app link isn\'t on the Settings tab yet (setup guide, Step 5).');
  const filled = teams_().reduce((n, team) => {
    const rot = rotation_(team);
    return n + team.positions.reduce((m, p) => m + (rot[p] || []).filter((x) => x).length, 0);
  }, 0);
  ui.alert((problems.length ? 'Things to fix:\n\n• ' + problems.join('\n• ') : 'The rotation looks good: ' + filled + ' spot' + (filled === 1 ? '' : 's') + ' filled.') +
    (notes.length ? '\n\nAlso:\n• ' + notes.join('\n• ') : '') +
    '\n\nEmpty spots (like 5th Sundays) are sent out for cover each month.');
}
