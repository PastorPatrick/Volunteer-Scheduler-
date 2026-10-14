# Volunteer Scheduler

Confirms each month's serving schedule with volunteers by text, and finds cover when someone can't make it. Built on free Google tools (Google Sheets and Apps Script) plus the church's Twilio account for texts. It's its own spreadsheet and script, separate from the Guest Tracker. It starts with the media team and is set up so other serve teams can be added the same way.

## How it works

1. **You set up each team once:** who's trained in which positions (checkboxes), and the usual rotation, meaning who serves each position on the 1st through 5th Sunday of the month.
2. **On the 15th,** everyone in next month's rotation gets one text listing their Sundays, with a link to their own page. They tap **Yes to all**, or **Can't** for any Sunday.
3. **Open spots** go out for cover by text. That means every "Can't", every blank in the rotation, and every 5th Sunday. Each text goes to everyone trained in that position who is active and free that Sunday. The first to say yes gets it and is texted a confirmation.
4. **You hear by email:**
   - right away when anyone says they can't, even after confirming;
   - when a spot is still open after 3 days (1 day if that Sunday is less than a week away);
   - 5 days after the ask, about anyone who hasn't answered (they get a reminder text after 3 days);
   - **every Monday at 8am,** the month ahead: who's on each Sunday and position, what's open, who hasn't answered, and who isn't in Elvanto yet.
5. **You enter the schedule in Elvanto.** Elvanto doesn't let other programs add people to its schedule, so this step is by hand. Elvanto then sends its usual reminders.

Rules: one person per position, and one position per person each Sunday. Volunteers are reached by text only; everything to you comes by email.

Setup steps: [`docs/SETUP-GUIDE.md`](docs/SETUP-GUIDE.md).

## What's here

- `VolunteerScheduler.gs`: **the one file to paste into Apps Script.** It's all the files below joined together. Don't edit it directly: change a file in `apps-script/`, then run `node tools/build-single-file.js`.
- `apps-script/`: the same script, split into files by job
  - `Setup.gs`: the tabs (including each team's two tabs), settings, text wording, menu and hourly timer
  - `Teams.gs`: reading who's trained and the rotation; "Check the rotation"
  - `Schedule.gs`: the monthly texts, finding cover, the reminder, and your emails
  - `Pages.gs`: each volunteer's page and its buttons
  - `Elvanto.gs`: reading the Elvanto schedule (for the Monday report)
  - `Twilio.gs`: sending texts
  - `Helpers.gs`: shared tools
  - `appsscript.json`: project settings (Eastern time zone)
- `docs/SETUP-GUIDE.md`: step-by-step setup, plus how to change things later
- `tools/build-single-file.js`: rebuilds `VolunteerScheduler.gs` from the `apps-script/` files
- `tests/run-tests.js`: automated tests that run the script against stand-ins for Google's services (`node tests/run-tests.js`)

## Spreadsheet tabs

| Tab | Who edits it | What it holds |
|---|---|---|
| Teams | You | Each team, its positions, and (optionally) its leader's email for copies of your notices |
| Media Team (one per team) | You | Each volunteer: name, mobile, Active, and a checkbox for each position they're trained in |
| Media Rotation (one per team) | You | Each position against the 1st–5th Sunday: who usually serves |
| Schedule | The script (you can edit it) | One row per Sunday and position: who's serving, Waiting / Confirmed / Open, who was asked to cover |
| Message Templates | You | The wording of each text |
| Settings | You | Church name, report email, ask day, web app link, Elvanto service name |
| Activity Log | The script | Every text sent and every answer |
