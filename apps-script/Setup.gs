/**
 * ============================================================
 *  SETUP — builds the tabs, the menu, and the hourly timer
 * ============================================================
 *
 * Run "Volunteer Scheduler → Run setup" from the spreadsheet menu.
 * It is safe to run more than once: it adds anything that's missing
 * and never deletes or changes what's already there.
 *
 * Each team on the Teams tab gets two tabs of its own:
 *   "<Team> Team"      one row per volunteer: mobile, Active, and a
 *                      checkbox for each position they're trained in
 *   "<Team> Rotation"  one row per position, one column per week of the
 *                      month (1st–5th Sunday): who usually serves
 * Add a team (or a position) on the Teams tab, then run setup again.
 */

// Tab names. If you rename a tab in the spreadsheet, change it here too.
const TABS = {
  TEAMS: 'Teams',
  SCHEDULE: 'Schedule',
  TEMPLATES: 'Message Templates',
  SETTINGS: 'Settings',
  ACTIVITY: 'Activity Log',
};

const TEAM_TAB_SUFFIX = ' Team';
const ROTATION_TAB_SUFFIX = ' Rotation';
const WEEK_COLUMNS = ['1st Sunday', '2nd Sunday', '3rd Sunday', '4th Sunday', '5th Sunday'];

// Column headers. The script finds columns by these names, so you can drag
// columns into a different order, but don't rename them.
const COLUMNS = {
  TEAMS: ['Team', 'Positions', 'Leader', 'Leader email', 'Active'],
  SCHEDULE: ['Sunday', 'Team', 'Position', 'Serving', 'Status', 'Usual', 'Mobile', 'Asked', 'Answered',
    'Open since', 'Cover texted', 'Can\'t', 'Uncovered notice', 'Reminded', 'No-answer notice', 'Notes'],
  TEMPLATES: ['Template', 'When it\'s sent', 'Message'],
  SETTINGS: ['Setting', 'Value', 'What it does'],
  ACTIVITY: ['When', 'Volunteer', 'What happened', 'Details'],
};

const DEFAULT_TEAMS = [
  ['Media', 'ProPresenter, Livestream Producer, Camera Operator, Livestream Audio', '', '', true],
];

// Settings tab rows: [setting name, starting value, explanation].
const DEFAULT_SETTINGS = [
  ['Church name', 'Our Church', 'Used in texts as {ChurchName}.'],
  ['Report email', '', 'Where your emails go: the Monday report and the right-away notices. If blank, they go to the account that owns this sheet.'],
  ['Ask day', '15', 'Day of the month (10am) when everyone in the rotation is texted their Sundays for next month. Leave blank to only send from the menu.'],
  ['Web app link', '', 'Paste the web app link here after publishing it (setup guide, Step 5). Every text links to a page from it.'],
  ['Elvanto service name', 'Sunday Service', 'The Elvanto service the Monday report checks against, so another campus\'s service isn\'t counted. Blank = every service that day.'],
];

// Texts to volunteers. Placeholders: {FirstName} {ChurchName} {Month} {Sundays} {Link}
const DEFAULT_TEMPLATES = [
  ['Monthly ask', 'The ask day (the 15th), to everyone in next month\'s rotation',
    'Hi {FirstName}! Here\'s when you\'re serving at {ChurchName} in {Month}: {Sundays}. Tap to confirm, or let us know which you can\'t make: {Link}'],
  ['Reminder', '3 days later, to anyone who hasn\'t answered',
    'Hi {FirstName}, just a reminder to confirm your {Month} Sundays at {ChurchName}: {Link}'],
  ['Cover request', 'When a spot opens, to everyone trained in that position who is free that Sunday',
    'Hi {FirstName}! Can you cover {Sundays} at {ChurchName}? First to say yes gets it: {Link}'],
  ['Cover confirmed', 'To the person who covers a spot',
    'Thank you, {FirstName}! You\'re serving {Sundays} at {ChurchName}. See you then!'],
];

/** Adds the "Volunteer Scheduler" menu whenever the spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Volunteer Scheduler')
    .addItem('Check the rotation', 'checkRotation')
    .addItem('Send next month\'s schedule now', 'sendNextMonthNow')
    .addItem('Send the Monday report now', 'sendReportNow')
    .addSeparator()
    .addItem('Connect Twilio', 'connectTwilio')
    .addItem('Send a test text', 'sendTestText')
    .addItem('Connect Elvanto', 'connectElvanto')
    .addSeparator()
    .addItem('Run setup', 'setup')
    .addToUi();
}

/** Builds everything. Safe to run again at any time. */
function setup() {
  menuOnly_();
  const ss = SpreadsheetApp.getActive();

  const teams = ensureTab_(ss, TABS.TEAMS, COLUMNS.TEAMS);
  if (teams.getLastRow() < 2) DEFAULT_TEAMS.forEach((t) => teams.appendRow(t));
  setupCheckboxColumns_(teams, ['Active']);
  teams_().forEach((team) => setupTeamTabs_(ss, team));

  const schedule = ensureTab_(ss, TABS.SCHEDULE, COLUMNS.SCHEDULE);
  const statusCol = columnIndex_(schedule)['Status'];
  schedule.getRange(2, statusCol, Math.max(schedule.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS.WAITING, STATUS.CONFIRMED, STATUS.OPEN], true).setAllowInvalid(true).build());
  addMissingTemplates_(ensureTab_(ss, TABS.TEMPLATES, COLUMNS.TEMPLATES));
  setupSettingsTab_(ensureTab_(ss, TABS.SETTINGS, COLUMNS.SETTINGS));
  ensureTab_(ss, TABS.ACTIVITY, COLUMNS.ACTIVITY);

  // Remove the blank "Sheet1" a new spreadsheet starts with, if it's still empty.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  linkCode_('setup'); // creates the secret used to make private links
  installTrigger_();

  tellUser_(
    'Setup finished.\n\n' +
    'Next:\n' +
    '1. Settings tab: your church name and report email.\n' +
    '2. ' + teams_().map((t) => '"' + t.name + TEAM_TAB_SUFFIX + '"').join(', ') + ': each volunteer, their mobile, Active, and the positions they\'re trained in.\n' +
    '3. ' + teams_().map((t) => '"' + t.name + ROTATION_TAB_SUFFIX + '"').join(', ') + ': who usually serves each position on each Sunday of the month.\n' +
    '4. Publish the web app and connect Twilio (setup guide, Steps 5 and 6).\n\n' +
    'Then use Volunteer Scheduler → Check the rotation.');
}

/** The two tabs for one team: who's trained, and the usual rotation. */
function setupTeamTabs_(ss, team) {
  const people = ensureTab_(ss, team.name + TEAM_TAB_SUFFIX, ['Name', 'Mobile', 'Active'].concat(team.positions).concat(['Notes']));
  setupCheckboxColumns_(people, ['Active'].concat(team.positions));
  const mobileCol = columnIndex_(people)['Mobile'];
  people.getRange(2, mobileCol, Math.max(people.getMaxRows() - 1, 1), 1).setNumberFormat('@'); // keep phone numbers as text

  const rotation = ensureTab_(ss, team.name + ROTATION_TAB_SUFFIX, ['Position'].concat(WEEK_COLUMNS));
  const have = readRows_(rotation).map((r) => String(r['Position']).trim());
  team.positions.filter((p) => have.indexOf(p) === -1).forEach((p) => appendObject_(rotation, { 'Position': p }));
  // Each cell is a name from the team tab (a dropdown).
  rotation.getRange(2, 2, Math.max(rotation.getMaxRows() - 1, 1), WEEK_COLUMNS.length).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(people.getRange(2, 1, Math.max(people.getMaxRows() - 1, 1), 1), true).setAllowInvalid(true).build());
}

/** Shows a message box in the spreadsheet, or writes to the log when run from the script editor. */
function tellUser_(message) {
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { console.log(message); }
}

/** Returns the tab with this name, creating it with bold, frozen headers if needed. */
function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Add any headers that are missing (a new position, or an update to this script).
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
    headers.filter((h) => existing.indexOf(h) === -1).forEach((h) => {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h).setFontWeight('bold');
    });
  }
  return sheet;
}

function addMissingTemplates_(sheet) {
  const have = readRows_(sheet).map((t) => String(t['Template']).trim());
  DEFAULT_TEMPLATES.filter((d) => have.indexOf(d[0]) === -1).forEach((d) => appendObject_(sheet, {
    'Template': d[0], 'When it\'s sent': d[1], 'Message': d[2],
  }));
  sheet.setColumnWidth(3, 520);
}

/** Puts checkboxes (validation only, so empty rows stay empty) on the named columns of a tab. */
function setupCheckboxColumns_(sheet, headers) {
  const cols = columnIndex_(sheet);
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  headers.forEach((h) => { if (cols[h]) sheet.getRange(2, cols[h], rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()); });
}

function setupSettingsTab_(sheet) {
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map((r) => r[0])
    : [];
  DEFAULT_SETTINGS.filter((s) => existing.indexOf(s[0]) === -1).forEach((s) => sheet.appendRow(s));
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 480);
}

/** Makes sure exactly one hourly timer exists. */
function installTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runScheduledJobs')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runScheduledJobs').timeBased().everyHours(1).create();
}
