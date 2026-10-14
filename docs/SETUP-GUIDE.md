# Volunteer Scheduler: setup guide

About 30 minutes. You'll need a Google account (the one the Guest Tracker uses is fine), the church's Twilio details, and, optionally, the Elvanto API key. Twilio and Elvanto are the same ones the Guest Tracker uses.

## Step 1: Create the spreadsheet

1. Go to [sheets.new](https://sheets.new) while signed in to the account that should send the emails.
2. Name it **Volunteer Scheduler**.

## Step 2: Add the script

1. In the spreadsheet, click **Extensions → Apps Script**.
2. Delete everything in `Code.gs`, paste the whole of `VolunteerScheduler.gs` in, and click **Save**.
3. Click the **gear icon (Project Settings)** and set the time zone to **(GMT-05:00) Eastern Time**.

## Step 3: Run setup

1. Go back to the spreadsheet and reload the page. A **Volunteer Scheduler** menu appears.
2. Click **Volunteer Scheduler → Run setup**. Google asks for permission the first time: click **Continue**, choose the account, then **Advanced → Go to Volunteer Scheduler (unsafe) → Allow**. ("Unsafe" only means Google hasn't reviewed a script you wrote yourself.)
3. Run setup once more if it stopped to ask for permission.

Setup makes a **Media Team** tab and a **Media Rotation** tab, with the positions ProPresenter, Livestream Producer, Camera Operator and Livestream Audio.

## Step 4: Fill in the team

1. **Settings tab:** your church name and **Report email** (where your emails go). **Ask day** is the 15th.
2. **Media Team tab:** one row per volunteer, with their name, mobile number, **Active** checked, and a check under each position they're trained in. Cover requests go to everyone checked for that position, so only check what they can actually do.
3. **Media Rotation tab:** for each position, pick who usually serves on the 1st, 2nd, 3rd, 4th and 5th Sunday (each cell is a dropdown of the team). Leave a cell blank when nobody usually serves; that spot is sent out for cover each month. The 5th Sunday column is usually blank.
4. Click **Volunteer Scheduler → Check the rotation**. It lists anything to fix, such as someone without a mobile number, someone not checked as trained, or someone in two positions on the same Sunday.

## Step 5: Publish the web app

Every text links to the volunteer's own page. The pages come from this script:

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to **Select type** and choose **Web app**.
3. **Execute as:** Me. **Who has access:** Anyone. (Each link carries a private code, so nobody can open someone else's page.)
4. Click **Deploy**, allow access if asked, and copy the **Web app URL**.
5. Paste it into the **Web app link** row on the Settings tab.

## Step 6: Connect Twilio

Click **Volunteer Scheduler → Connect Twilio** and enter the Account SID, the API key (SK…), its secret, and the number or Messaging Service (MG…) to send from. Then click **Send a test text** to text your own phone.

## Step 7: Connect Elvanto (optional)

Click **Volunteer Scheduler → Connect Elvanto** and paste the church's Elvanto API key (Elvanto → Settings → Developers → API). Check **Elvanto service name** on the Settings tab ("Sunday Service" to start). The Monday report then flags anyone not entered in Elvanto yet. It matches by name, so use the same names as in Elvanto.

## Step 8: Try it

Click **Volunteer Scheduler → Send next month's schedule now**. Everyone in next month's rotation gets their text, open spots go out for cover, and you get an email of what was sent. It's safe to run again: only people not yet texted about that month get a text. If you'd rather not wait for the 15th, this is also how to send early.

---

## Each month

| When | Who | What |
|---|---|---|
| The 15th, 10am | Everyone in next month's rotation (text) | One text listing their Sundays and a link: **Yes to all**, or **Can't** for any Sunday |
| The 15th | You (email) | What was sent, which spots are open, and anyone who couldn't be texted |
| The 18th, 10am | Anyone who hasn't answered (text) | A reminder |
| The 20th, 10am | You (email) | Anyone who still hasn't answered, with their mobile number |
| Mondays, 8am | You (email) | The month ahead: every Sunday and position, who's on, what's open, who hasn't answered, who isn't in Elvanto yet |

## When someone can't

- **You get an email right away,** even if they'd already confirmed. If they were already in Elvanto, take them off there.
- **A cover request is texted** to everyone trained in that position who is active and free that Sunday. (Texts go out 8am–8pm. A "Can't" at night goes out at 8am.)
- **The first to say yes gets it.** They get a confirmation text, and you get a "Covered" email so you can add them in Elvanto. Anyone who taps after that is told it's already covered.
- **If nobody says yes,** you get an email after 3 days, or after 1 day if that Sunday is less than a week away. If nobody else is trained and free, you're told right away.

Open spots from the rotation (blank cells and 5th Sundays) work the same way, starting on the 15th.

## Changing the schedule by hand

The **Schedule** tab has a row for each Sunday and position. To put someone on a spot yourself, type their name in **Serving** (exactly as on the team tab) and set **Status** to Confirmed. Their page and the Monday report pick it up. Nobody is texted when you do this.

## Adding another team

1. On the **Teams** tab, add a row: the team name, its positions separated by commas, the leader's name and email (optional: the leader gets a copy of your notices for that team), and **Active** checked.
2. Click **Volunteer Scheduler → Run setup**. It makes the team's two tabs.
3. Fill them in as in Step 4.

Someone on two teams is recognized by their mobile number: one link, one page, and still only one position each Sunday. To add a position, add it to the team's **Positions** on the Teams tab and run setup again.

## How to change things

- **The wording of the texts:** the **Message Templates** tab. Keep `{Link}` in the monthly ask, the reminder and the cover request.
- **The ask day:** the Settings tab. Leave it blank to only send from the menu.
- **Timings:** `REMIND_AFTER_DAYS`, `NO_ANSWER_AFTER_DAYS`, `UNCOVERED_AFTER_DAYS`, `TEXT_HOURS` and `REPORT_TIME` near the top of the schedule section of the script.

## Installing an updated script

1. In Apps Script, select everything in `Code.gs`, delete it, paste the new `VolunteerScheduler.gs` in, and click **Save**.
2. In the spreadsheet, click **Volunteer Scheduler → Run setup**.
3. Update the web app: **Deploy → Manage deployments**, the **pencil icon**, **Version: New version**, **Deploy**. The link stays the same.

## Privacy notes

- A volunteer's page shows only their own Sundays and the open spots they could cover. It doesn't show anyone's phone number.
- The Twilio and Elvanto keys are kept in the script's private settings, not the spreadsheet. Anyone who can edit the spreadsheet can open the script, so keep the editor list short.
