# Tasks in Google Calendar

sel can sign in to Google and keep a calendar of its own in your account, **sel**, with an event for each open task that has a date. It then shows wherever your Google Calendar does: the web, Android, the iPhone (with your Google account added to the iPhone's Calendar, or in the Google Calendar app).

- A task with a day is an event of the whole day; with an hour, half an hour; one that repeats by its date is a series.
- One way: sel writes the calendar. What you change or delete there does not come back to sel, and is put back as the task says.
- A task done, deleted, or left without a date leaves the calendar.
- It is kept up to date while sel is open on the computer where you signed in (it looks every minute and talks to Google only when something changed). Sign in on **one** computer: each computer that signs in makes a calendar of its own.
- What is private from the AI stays out of it.

The one permission sel asks Google for is "make secondary calendars, and see, create, change and delete events on them" (`calendar.app.created`). It cannot see or change your other calendars.

## Why you have to make a "client"

Google lets an app sign in only with an OAuth client registered with Google by whoever is responsible for the app. sel is yours, and has no client of its own: you make one in your own Google account, once. It is free and takes about five minutes.

## Making the client

1. Open <https://console.cloud.google.com/> signed in with the Google account whose calendar you use. Make a project (any name, e.g. `sel`).
2. **APIs & Services → Library**: find **Google Calendar API** and press **Enable**.
3. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*). Fill in the app's name (`sel`) and your e-mail; audience **External**. Save.
4. On the same screen, **Audience → Publishing status → Publish app** ("In production"). This matters: while the app is "Testing", Google ends the sign-in every 7 days. Publishing needs no review from Google for this permission; the sign-in will show an "unverified app" notice, which is expected for an app only you use ("Advanced" → "Go to sel").
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**. Application type: **Desktop app**. Create.
6. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) and the **Client secret**.

## In sel

Settings → Today → **Tasks in Google Calendar**:

1. Paste the client ID and the client secret, and save. They are kept encrypted on this computer, never in the workspace, and are not synced.
2. **Sign in with Google**: your browser opens; choose the account and allow. The tab says "Signed in" and you go back to sel.
3. sel makes the calendar "sel" and sends the tasks. "Send now" does it at once.

"Sign out" forgets the sign-in and tells Google; the calendar stays in Google as it is. To remove it, delete the calendar "sel" in Google Calendar's settings.

## When it stops

- *"Google no longer accepts the sign-in"*: sign in again. If it happens every week, the app is still "Testing" (step 4).
- *"Google refused … client"*: the client ID or secret was pasted wrong, or the client is not of the type "Desktop app".
- Events doubled: two computers signed in. Sign out on one and delete its calendar "sel" in Google.
