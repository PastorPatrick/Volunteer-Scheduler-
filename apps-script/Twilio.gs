/**
 * ============================================================
 *  TWILIO — texts to volunteers
 * ============================================================
 *
 * When Twilio is connected, volunteers get each message as a text (from the
 * church's Twilio number) as well as an email. Numbers come from the Phone
 * column on the Volunteers tab; anyone without one gets email only.
 *
 * Connecting: Volunteer Scheduler → Connect Twilio. It asks for the Account
 * SID, an API key (SK...) and its secret, and the number or Messaging Service
 * (MG...) to send from. They're stored in this script's private settings
 * (Script Properties), not in the spreadsheet; anyone who can edit the
 * spreadsheet can open the script and see them, so keep the editor list short.
 */

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts/';
const TWILIO_PROPS = ['TWILIO_ACCOUNT_SID', 'TWILIO_KEY_SID', 'TWILIO_KEY_SECRET', 'TWILIO_FROM'];

/** The saved Twilio details, or null if Twilio isn't connected. */
function twilioConfig_() {
  const p = PropertiesService.getScriptProperties();
  const c = {
    account: p.getProperty('TWILIO_ACCOUNT_SID'), key: p.getProperty('TWILIO_KEY_SID'),
    secret: p.getProperty('TWILIO_KEY_SECRET'), from: p.getProperty('TWILIO_FROM'),
  };
  return c.account && c.key && c.secret && c.from ? c : null;
}

function twilioAuth_(c) {
  return { Authorization: 'Basic ' + Utilities.base64Encode(c.key + ':' + c.secret) };
}

/** Sends one text. Returns '' on success or a message saying what went wrong. */
function sendText_(c, toPhone, body) {
  const to = smsNumber_(toPhone);
  if (normalizePhone_(to).length < 10) return 'no usable phone number';
  const payload = { To: to, Body: body };
  if (/^MG/i.test(c.from)) payload.MessagingServiceSid = c.from;
  else payload.From = smsNumber_(c.from);
  try {
    const res = UrlFetchApp.fetch(TWILIO_API + encodeURIComponent(c.account) + '/Messages.json', {
      method: 'post', payload: payload, headers: twilioAuth_(c), muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 300) return '';
    let msg = 'error ' + res.getResponseCode();
    try { const b = JSON.parse(res.getContentText()); msg = (b.message || msg) + (b.code ? ' (Twilio code ' + b.code + ')' : ''); } catch (e) { /* keep code */ }
    return msg;
  } catch (e) {
    return e.message;
  }
}

// ---------- Menu items ----------

/** Menu item: saves the Twilio details in the script's private settings after checking them. */
function connectTwilio() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const ask = (title, text) => {
    const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? String(r.getResponseText() || '').trim() : null;
  };
  const account = ask('Connect Twilio (1 of 4)',
    'Account SID (starts with AC). It\'s on the Twilio Console home page under Account Info.\n\n' +
    'Leave it blank and click OK to disconnect Twilio.');
  if (account === null) return;
  const props = PropertiesService.getScriptProperties();
  if (!account) {
    TWILIO_PROPS.forEach((k) => props.deleteProperty(k));
    ui.alert('Twilio is disconnected. Volunteers get email only.');
    return;
  }
  const key = ask('Connect Twilio (2 of 4)', 'API key SID (starts with SK). From Account → API keys & tokens.');
  if (!key) return;
  const secret = ask('Connect Twilio (3 of 4)', 'The API key\'s secret (shown once when you created the key).');
  if (!secret) return;
  const from = ask('Connect Twilio (4 of 4)',
    'Send texts from: your Messaging Service SID (starts with MG) if you have one, otherwise the Twilio phone number (e.g. +18645550100).');
  if (!from) return;

  // Check the details work before saving them, by reading (not sending) the latest message.
  const c = { account: account, key: key, secret: secret, from: from };
  let ok = false, why = '';
  try {
    const res = UrlFetchApp.fetch(TWILIO_API + encodeURIComponent(account) + '/Messages.json?PageSize=1',
      { method: 'get', headers: twilioAuth_(c), muteHttpExceptions: true });
    ok = res.getResponseCode() === 200;
    if (!ok) { try { why = JSON.parse(res.getContentText()).message || ''; } catch (e) { why = 'error ' + res.getResponseCode(); } }
  } catch (e) { why = e.message; }
  if (!ok) {
    ui.alert('Twilio didn\'t accept those details, so nothing was saved.\n\n' + why +
      '\n\nCheck that the API key belongs to this account and that the secret was copied completely.');
    return;
  }
  TWILIO_PROPS.forEach((k, i) => props.setProperty(k, [account, key, secret, from][i]));
  ui.alert('Connected to Twilio.\n\nUse Volunteer Scheduler → Send a test text to send one to your own phone.');
}

/** Menu item: sends a test text to a number you type in. */
function sendTestText() {
  menuOnly_();
  const ui = SpreadsheetApp.getUi();
  const c = twilioConfig_();
  if (!c) { ui.alert('Twilio isn\'t connected yet. Use Volunteer Scheduler → Connect Twilio first.'); return; }
  const r = ui.prompt('Send a test text', 'Your mobile number:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const problem = sendText_(c, r.getResponseText(), churchName_() + ' Volunteer Scheduler: this is a test text.');
  ui.alert(problem ? 'The text wasn\'t sent: ' + problem : 'Sent! It should arrive in a few seconds.');
}
