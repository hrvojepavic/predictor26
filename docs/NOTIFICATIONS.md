# Competition notifications

## User controls

`/competition/:slug/settings` shows three notification switches: 1 hour and 9 hours before prediction round closes, and when a prediction round opens. All start off. Changes save automatically. There is no master switch, select-all action, save button, or separate browser setup section.

Turning a reminder on automatically requests browser permission if needed, registers this browser for this competition, and saves the choice. If setup or saving fails, the switch returns to its saved state and a short error appears. Turning all three options off stops reminders and clears browser registrations for this user and competition. Re-enabling registers only the current browser; other browsers must be added explicitly again. Global push subscriptions and other competitions are unaffected.

Permission results distinguish undecided/dismissed (`default`) from browser-denied (`denied`). Dismissal leaves preferences unchanged and allows another explicit click to request permission. Browsers can suppress repeated prompts independently of an explicit blocked-site entry; the app cannot force a prompt or identify the exact reason. If no prompt appears, the message directs the user to site permissions. A denied result specifically explains allowing notifications in browser settings or removing the site from the blocked list before retrying.

Registered browsers appear beneath the switches only while at least one notification option is on, by browser/OS name, with the current browser marked. With all three options off, the browser list and add/remove actions are hidden; registrations for this competition have been cleared. Browser permission is remembered by the browser, so a previously granted permission does not prompt again. When reminders are already enabled and the visitor is using a browser not on the list, "Add this browser" registers it without changing the timing choices. "Remove" appears only when more than one active browser is registered. The server also prevents removing the last active browser. Browser removal applies only to the selected competition; it never unsubscribes the browser globally or affects other leagues.

The automatic arrival drawer remains removed. The admin competition switch and verified-member requirement remain delivery conditions, but explanatory setup paragraphs are not shown in this compact UI.

## Persistence and authorization

`competition_notification_preferences` stores `enabled`, `reminder_9h`, and `reminder_1h`, keyed by competition and user. The startup migration is `CREATE TABLE IF NOT EXISTS`; absence of a preference row returns all false. Existing WC/HNL members and future memberships require no seeding. Only an explicit preference update changes a row. Later application restarts/deployments do not reset choices.

- `GET /api/competitions/:competitionId/notification-preferences`
- `PUT /api/competitions/:competitionId/notification-preferences`
- Body: `{ "enabled": true, "reminder9h": true, "reminder1h": false }`
- Response: `{ "preferences": { ... }, "competitionEnabled": true, "eligible": true, "browsers": [...] }`
- `POST /api/competitions/:competitionId/notification-browsers` accepts the current push subscription.
- `DELETE /api/competitions/:competitionId/notification-browsers/:browserId` removes a registration; returns 409 for the last browser.

Browser registration uses `competition_notification_browsers`, keyed by competition, user and subscription. Its one-time creation preserves previously opted-in users' active subscriptions; it never opts default-off users in. Later startups do not re-add removed browsers or reset preferences. Returned browser records contain an ID, display name and endpoint fingerprint, not push endpoint URLs or keys. Account switches preserve all users' saved competition/browser associations. The subscription's `user_id` now identifies the last logged-in recipient. Login synchronizes existing subscriptions automatically without requesting permission or changing reminder choices; logout does not clear the recipient. Only that account receives on this browser, even after logout. Returning to an earlier account restores its saved associations without another opt-in.

The frontend persists the recipient in Cache Storage and synchronizes the server on authenticated session restoration/login. Focus/online events retry only a failed synchronization for the current session; successful or in-flight synchronization causes no additional focus/online request; an older tab cannot claim the browser using a stale session. Web Locks serialize account/setup requests across tabs where supported. The service worker checks payload `data.userId` against the persisted recipient and drops mismatches (including pushes in transit); missing recipient data fails closed. This requires users to visit the updated app once to initialize the browser-side recipient. No queued push is retained for replay by the app.

At the scheduled send, mismatched recipients are permanently recorded in `notification_reminder_skips` per competition/user/browser/round/timing. Switching accounts back inside the due window does not replay that reminder. Other registered devices and future rounds remain eligible. The skip table is created without resetting preferences or browser registrations. Associations removed by older versions before this change cannot be reconstructed automatically; users must add that browser again.

The existing `enabled` storage field is internal: new UI saves set it to whether any of the three options is on.

All preference and browser endpoints require authentication and competition access. The user comes from the verified authentication token, never a request user ID. Regular users must belong to the requested competition. Super admins may inspect their own settings for any existing competition but do not receive scheduled reminders without a verified membership. Invalid booleans are rejected. There is no fallback to another competition if the requested ID is invalid.

## Delivery rules

The competition admin switch, a non-finished/non-archived competition, verified membership, internal enabled state, selected reminder time, and an active browser subscription registered for that competition must all permit sending. The admin switch is independent of user preferences and never opts users in.

The scheduler runs at `NOTIFICATION_REMINDER_INTERVAL_MS` (default five minutes). It sends in the existing ten-minute window immediately after the selected threshold, never after the prediction deadline. It does not backfill old reminders after a longer outage or late opt-in.

Only released, non-postponed matches count toward reminders and their round deadlines. Round names use the same helper as prediction locking. Completed predictions still receive the selected reminder with wording that permits last-minute changes. Notifications include the competition name; tags include competition/user/round/timing, and links open that competition's predictions page. Push TTL is limited to the time remaining before locking.

Overlapping jobs for the same competition share a run. Different competitions cannot reuse each other's run reports. Preferences and subscription ownership are rechecked before each send. Previously accepted reminders are not repeated. If no subscription accepted a reminder, failed sends can retry with a 60-second cooldown and a cap of three attempts per subscription, within the due window. A successful delivery to any device completes that user's reminder; other failed devices are not retried afterward. HTTP 404/410 disables expired subscriptions. A push service accepting a request does not prove that the device displayed it.

## Deployment and enabling HNL

1. Deploy the API and frontend together, preserving the persistent SQLite database and VAPID key pair. Existing deployment environment setup preserves keys when present. Do not rotate VAPID keys routinely; development fallback keys change on process restart, so use fixed local keys when testing real push delivery.
2. API startup creates the preferences table. Existing user opt-ins remain off unless the user explicitly saves new preferences. No preference backfill or bulk reset is needed; browser associations preserve existing explicit opt-ins during their one-time migration.
3. In HNL's admin Notifications page, enable the competition delivery switch using the existing confirmation flow. WC and other competitions remain independent. Finished competitions continue to have jobs disabled.
4. A verified HNL member turns on a reminder in Settings and grants browser permission if prompted; setup and saving happen automatically.
5. Use admin "Enable this browser" and "Send test" for a real-device smoke test. These require competition admin access for sending, bypass user reminder preferences, and send only to the signed-in admin's active subscriptions. Tests include the competition identity and link to Settings. Registering the current browser no longer resets other devices.
6. Check the competition's admin Jobs view for due users and delivery/attempt results. Test an actual scheduled reminder with a controlled fixture in a test competition; do not change real production deadlines merely to trigger it.

Application code does not automatically enable HNL or reset any competition admin switch on every deployment. The production admin enable action is separate from deploying this change.

## Automated validation

- `npm run test --workspace api`: fresh SQLite startup; upgrade/default-off semantics; repeated startup preserving choices; competition/timing isolation; verification/admin/release/postponement gates; independent notification tags/links; duplicate suppression; retries; expiry; opt-out during a run; authenticated membership checks and forged user IDs. Push transport is mocked; no real notifications are sent.
- `npm run test --workspace web -- --watch=false`: routing, menu regression, Settings controls, saved state, stale competition responses, browser permission flow, subscription reuse and account-switch protection.
- `npm run build`: API and frontend compilation.

Real-device permission prompts and push delivery still need a browser/device smoke test after deployment.

Admin Notifications includes a read-only member table with 1h/9h choices for the selected competition. All competition members appear, including unverified members and users without preference rows (both off). The admin-only settings response supplies the table; the competition delivery switch does not change the displayed saved choices.

## Round opened

`roundOpened` defaults to false via an additive migration; existing preferences are
preserved. Older clients that omit it preserve its saved value. The API derives
`enabled` from all three options. Opening-only users keep their browser registrations
and appear with the new choice and browser list in the admin preferences grid.

Automatic import, admin import-with-odds, and manual round release all dispatch
opening notifications after the release transaction commits. That transaction
creates one event per competition/prediction round and snapshots eligible opted-in
users and registered browsers. Importing unreleased fixtures does not notify.
Additional matches in an already-open round and repeated releases do not notify.
Late opt-ins are not backfilled. Already-released rounds are not announced on rollout.

Delivery rechecks membership, competition state, preferences, browser registration,
last logged-in recipient and deadline. Links open competition predictions; tags and
recipient data are competition/user scoped. TTL ends at the recorded round deadline.
No periodic job is added. Startup resumes pending attempts left before dispatch.
Each attempt is claimed durably before sending; accepted, skipped, failed and disabled
attempts are not replayed. HTTP 404/410 disables expired subscriptions. Push failures
never roll back the released round. There is no retry of failed or ambiguous in-flight
opening sends: a process crash after claiming can lose that notification rather than
risk duplicate delivery. Outcomes are stored in `notification_round_opening_attempts`;
the timed-reminder job report continues to show only 1h/9h reminders.

## Browser display names

Subscription registration and login synchronization store recognized `Sec-CH-UA`
brands separately from the User-Agent. Settings, the admin preferences grid and
push attempt labels use this metadata to distinguish Google Chrome, Brave, Edge,
Opera, Vivaldi and Samsung Internet where disclosed. User-Agent tokens handle
Safari, Firefox, Chrome on iOS and other identifiable browsers. Ambiguous Chrome
User-Agents remain Chrome/Chromium rather than being guessed as Google Chrome.
Existing records gain brand metadata on their next subscription synchronization;
no re-subscription or preference changes are needed. Missing hints preserve an
already recorded brand. Browser privacy settings or proxies can omit hints, so
precise identification is best-effort and is never used for authorization.

## Finished competitions

`competitions.is_finished` (frontend `isFinished`) is the completion flag;
`is_archived` also blocks notifications. Finishing a competition already turns off
its competition notification switch, and all automatic delivery paths check both
flags. Notification settings expose `competitionClosed` so user switches appear
off and disabled, browser setup is hidden, and admin enable/setup/test buttons are
disabled with an explanation. APIs reject preference/browser setup for closed
competitions and admin tests cannot send. Existing preferences and browser records
are preserved, including associations with other competitions. A competition whose
admin notification switch is merely paused remains configurable by its users.
