# Store listings

Draft copy for the App Store and Google Play listings. Not used by the app
build. Keep this in step with `README.md` when features land — the three drift
apart easily, and the listings are the ones customers read.

Field lengths are Apple's and Google's hard limits; the counts in brackets are
the current drafts. Verify in the console before submitting, since both stores
count characters slightly differently around emoji and newlines.

---

## Apple App Store

### App Name — limit 30

```
lifeGLANCE: Life Timeline
```

`lifeGLANCE` alone (10) is the safer brand-pure choice. The longer form buys the
words "life" and "timeline" in search, which the keyword field cannot repeat.

### Subtitle — limit 30

```
Your life, at a glance.
```

### Promotional text — limit 170

Editable without a new review, so use it for whatever is current.

```
lifeGLANCE comes to iPhone and iPad: your whole life on one timeline, synced through iCloud with nothing to set up. Widgets, Lock Screen countdowns, Siri and Spotlight.
```

### Keywords — limit 100

Comma-separated, no spaces. Deliberately avoids words already in the name and
subtitle, which Apple indexes anyway.

```
milestone,memories,countdown,journal,memoir,chapter,anniversary,birthday,history,offline,private
```

### Description — limit 4000

```
lifeGLANCE turns your life into a single, beautiful timeline you can actually see. Every milestone and memory in your past that you want to remember, plus everything you're counting down to.

Pan and zoom from the day you were born to decades ahead. Drop in your graduation, the trip you'll never forget, the home you bought, the goal you're chasing now. Watch your story take shape.

No accounts. No analytics. Your milestones stay on your device and only leave it when you choose.

lifeGLANCE requires a subscription or a one-time lifetime unlock to use. A 7-day free trial is included. After the trial, subscribe or buy the lifetime unlock. Manage or cancel anytime in your Apple ID settings.

WHY YOU'LL LIKE IT
• Your whole life at a glance: past and future on one continuous timeline.
• Add a milestone in seconds: a title, a date (as exact or as fuzzy as you like), a note, a link, even a photo, audio, or video.
• Group your life into chapters (school years, a city you lived in, an era) shown as ribbons along the timeline.
• Live countdowns to the moments you're looking forward to.
• "On this day" resurfaces milestones from today's date in past years.
• Color-coded categories you can rename and recolor to fit your life.
• Milestones that repeat every year, search across everything you've written, and undo for when you change your mind.

WATCH MODE
• Sit back and let lifeGLANCE tour your timeline on its own, with ambient sound.
• Choose the tour: your full timeline, this year, what's coming up, or only milestones with photos.
• Start it any time, or let it begin on its own when your device goes idle. Any tap exits.

ON YOUR HOME AND LOCK SCREEN
• Home Screen widgets: your next milestone, today's date and your age, your current chapter, on this day, your milestone totals, a glance at the timeline around today, and one-tap add.
• Lock Screen widgets: keep your next milestone right on the Lock Screen, with your current chapter and today's date available there too.
• Pin up to four countdowns to their own color-coded widgets, so the dates that matter most are always in view.
• Ask Siri to add a milestone, or add one from the Shortcuts app.
• Your milestones turn up in Spotlight, so system search takes you straight to the right moment.
• Share a link or a note from any app and lifeGLANCE keeps it as a draft, waiting the next time you open it.
• Roomy layouts on iPad, including an extra-large timeline widget.

PRIVATE BY DESIGN
• Your life is yours. lifeGLANCE works fully offline.
• On iPhone and iPad, iCloud keeps every device signed in to your Apple ID in step, with nothing to set up — and a fresh install always asks before restoring anything.
• Prefer to run your own? Sync to a WebDAV server or a GLANCEvault instance you control, end-to-end encrypted with a passphrase only you know.
• Already have a syncing folder? Point lifeGLANCE at a file in iCloud Drive, Dropbox, Nextcloud, or anything else in the Files app, and let that tool do the moving.
• Keep your own local backups of your timeline, and export whenever you like.

MORE
• Light and dark themes.
• Import dates from a calendar (.ics).
• Export what you see on screen as an image to keep or share.
• Adjustable text size.
• Localized for multiple languages, with dates in your local format.
• Part of the GLANCE family: lifeGLANCE links up with its sibling apps so your timeline can fill itself in.

Whether you're celebrating how far you've come or counting down to what's next, lifeGLANCE keeps your whole story in view.
```

### What's New — limit 4000

First release, so this can simply be:

```
The first release of lifeGLANCE for iPhone and iPad.

• Your whole life on one zoomable timeline, past and future.
• iCloud sync with nothing to set up.
• Home Screen and Lock Screen widgets, including four pinnable color countdowns.
• Siri and Shortcuts support for adding a milestone.
• Spotlight search across your milestones.
• Watch mode: sit back and let your timeline tour itself.
```

### App Review notes

Reviewers need a way past the hard paywall (Guideline 2.1 / App Access).

```
lifeGLANCE requires a subscription or a one-time lifetime unlock. To review the
app without purchasing, tap "Reviewer access" at the bottom of the paywall and
enter one of the codes below.

  <current month's code>
  <next month's code>

The code rotates on the 1st of each month, so both months are listed in case
review spans the boundary.

The app has no accounts and no backend of its own. Nothing needs to be set up
to exercise the timeline — the app opens to an empty timeline and milestones are
added with the + button.

iCloud sync is on by default and requires only that the device is signed in to
an Apple ID; it syncs to the app's own iCloud container and never leaves the
user's account.
```

Generate the codes with `npm run reviewer-code`, which prints the current and
next month's.

### URLs

| Field | Value |
|---|---|
| Privacy Policy URL | `https://www.glance-apps.com/privacy` |
| EULA / Terms of Use | `https://www.glance-apps.com/eula` |
| Marketing URL | `https://lifeglance.app` |
| Support URL | needs deciding — the repo's issues page, or a page on glance-apps.com |

Both of the first two must match the links the paywall itself renders
(`PaywallModal.jsx`), which they currently do.

---

## Google Play

The existing listing is accurate but incomplete. The full description below adds
what is missing and corrects the widget list; everything else is the current
copy, lightly tightened.

### What changed and why

| Change | Reason |
|---|---|
| Added **Watch mode** section | Shipped on both platforms and genuinely distinctive; the listing never mentioned it. |
| Added **folder sync** (Direct Access) | The listing implied the only sync was a server you configure. Nextcloud/Syncthing/Dropbox users are a core audience. |
| Corrected the **widget list** | Said five; Android ships ten. "Today" and "Milestones" were missing, and the four color countdown slots read as one widget. |
| Named **WebDAV / GLANCEvault** | "Optional cloud sync" undersold it for the self-hosting audience. |
| Added **recurrence, search, undo** | Material features absent from the listing. |
| Added **GLANCE family** line | Cross-app integration was in the README but not the listing. |
| Added **adjustable text size** | Accessibility, and cheap to mention. |

### Full description — limit 4000

```
lifeGLANCE turns your life into a single, beautiful timeline you can actually see. Every milestone and memory in your past that you want to remember, plus everything you're counting down to.

Pan and zoom from the day you were born to decades ahead. Drop in your graduation, the trip you'll never forget, the home you bought, the goal you're chasing now. Watch your story take shape.

No accounts. No analytics. Your milestones stay on your device and only leave it when you choose.

lifeGLANCE requires a subscription or one-time lifetime unlock to use. A 7-day free trial is included. After that, subscribe or buy the lifetime unlock. Cancel anytime in your Google Play account settings.

WHY YOU'LL LIKE IT
• Your whole life at a glance: past and future on one continuous timeline.
• Add a milestone in seconds: a title, a date (as exact or as fuzzy as you like), a note, a link, even a photo, audio, or video.
• Group your life into chapters (school years, a city you lived in, an era) shown as ribbons along the timeline.
• Live countdowns to the moments you're looking forward to.
• "On this day" resurfaces milestones from today's date in past years.
• Color-coded categories you can rename and recolor to fit your life.
• Milestones that repeat every year, full-text search across titles and notes, and undo for when you change your mind.

WATCH MODE
• Sit back and let lifeGLANCE tour your timeline on its own, with ambient sound.
• Choose the tour: your full timeline, this year, what's coming up, or only milestones with photos.
• Start it any time, or let it begin on its own when your device goes idle. Any tap exits.

CHECK IN FROM ANYWHERE
• Home screen widgets: your next milestone, today's date and your age, your current chapter, on this day, your milestone totals, and one-tap add.
• Pin up to four countdowns to their own color-coded widgets, so the dates that matter most are always in view.
• A Quick Settings tile and long-press shortcuts to add a milestone or search instantly.
• Share a link or note from any app straight into a new milestone.

PRIVATE BY DESIGN
• Your life is yours. lifeGLANCE works fully offline.
• Optional sync to a WebDAV server or a GLANCEvault instance you choose and control, end-to-end encrypted with a passphrase only you know.
• Already have a syncing folder? Point lifeGLANCE at a folder kept in step by Nextcloud, Syncthing, FolderSync, Dropbox, Drive, or OneDrive, and let that tool do the moving.
• Keep your own local backups.

MORE
• Light and dark themes.
• Import dates from a calendar (.ics).
• Export what you see on screen as an image to keep or share.
• Adjustable text size.
• Localized for multiple languages, with dates in your local format.
• Part of the GLANCE family: lifeGLANCE links up with its sibling apps so your timeline can fill itself in.

Whether you're celebrating how far you've come or counting down to what's next, lifeGLANCE keeps your whole story in view.
```

### Short description — limit 80

Unchanged if one is already set; otherwise:

```
Your whole life on one zoomable timeline. Past milestones, future countdowns.
```

---

## Before submitting

- [ ] **Confirm the trial really is 7 days** in App Store Connect. The paywall
      reads trial length from the store rather than hardcoding it, so the
      listing is the only place the number is asserted — if the configured
      introductory offer differs, the copy misstates the terms.
- [ ] **App Store screenshots do not exist yet.** `play-assets/` holds Play
      sizes only. Needed: 6.9" iPhone and 13" iPad, landscape (the app is
      landscape-locked).
- [ ] **Reviewer codes in the review notes**, current and next month.
- [ ] **Privacy questionnaire**: no data collected, no tracking, no third-party
      analytics. RevenueCat handles purchases — check whether its SDK's
      identifiers need declaring under Purchases.
- [ ] Nothing in the Apple copy may reference Android or Google Play.
- [ ] Widget and photo claims: widgets render text and dates only, so do not
      promise photos in widgets on either store.
