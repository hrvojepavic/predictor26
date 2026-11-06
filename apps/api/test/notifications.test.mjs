import { runInNewContext } from 'node:vm';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webPush from 'web-push';
import express from 'express';

const directory = mkdtempSync(join(tmpdir(), 'predictor26-notifications-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
process.env.AUTH_TOKEN_SECRET = 'notification-test-secret';
const keys = webPush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { openDatabase } = await import('../dist/database/index.js');
const queries = await import('../dist/database/queries/notifications.queries.js');
const service = await import('../dist/modules/notifications/notifications.service.js');
const { browserBrandFromHints, formatBrowserLabel } = await import('../dist/shared/utils/notification-browser.js');
const releaseQueries = await import('../dist/database/queries/matches.queries.js');
const { notificationsRoutes } = await import('../dist/modules/notifications/notifications.routes.js');
const { createAuthToken } = await import('../dist/shared/utils/auth-token.js');
const db = openDatabase();
db.prepare("INSERT INTO users (id,username,first_name,last_name,password_hash,role) VALUES (101,'player','Test','Player','test','user'),(102,'other','Test','Other','test','user')").run();
db.prepare("INSERT INTO competitions (id,name,slug,notification_reminders_enabled) VALUES (101,'League A','league-a',1),(102,'League B','league-b',1)").run();
db.prepare('INSERT INTO competition_users (competition_id,user_id,is_verified) VALUES (101,101,1),(102,101,1)').run();
for (const id of [101,102]) {
  db.prepare(`INSERT INTO matches (id,competition_id,match_number,stage,round_label,kickoff_at,source_time_zone,home_team_name,away_team_name,venue,city)
    VALUES (?,?,1,'league','Week 1',?,'UTC','Home','Away','Ground','City')`).run(id,id,new Date(Date.now()+58*60000).toISOString());
}
queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/101', subscriptionJson: '{}', userAgent: 'Test' });
const off = { enabled: false, reminder9h: false, roundOpened: false, reminder1h: false };
const all = { enabled: true, reminder9h: true, roundOpened: false, reminder1h: true };
let payloads = [];
const originalSend = webPush.sendNotification;

beforeEach(() => {
  db.exec(`DELETE FROM notification_round_openings; DELETE FROM competition_notification_preferences; DELETE FROM notification_reminder_deliveries;
    DELETE FROM notification_reminder_attempts; DELETE FROM notification_reminder_skips; DELETE FROM predictions; DELETE FROM competition_notification_browsers;
    UPDATE notification_subscriptions SET is_enabled = 1, browser_brand = NULL;
    UPDATE competitions SET notification_reminders_enabled = 1,is_finished = 0,is_archived = 0;
    UPDATE competition_users SET is_verified = 1;
    DELETE FROM matches WHERE id > 102;`);
  db.prepare('UPDATE matches SET kickoff_at = ?,released_for_predictions = 1,is_postponed = 0').run(new Date(Date.now()+58*60000).toISOString());
  for (const competitionId of [101,102]) queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/101', subscriptionJson: '{}', userAgent: 'Chrome/120 Safari/537 Windows' }, competitionId);
  payloads = [];
  webPush.sendNotification = async (_subscription, payload) => { payloads.push(JSON.parse(payload)); return {}; };
});
after(() => { webPush.sendNotification = originalSend; db.close(); rmSync(directory, { recursive: true, force: true }); });

function restartDatabase() {
  const moduleUrl = new URL('../dist/database/index.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const {openDatabase}=await import(${JSON.stringify(moduleUrl)}); openDatabase().close();`], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('browser labels prefer specific client hint brands and retain honest User-Agent fallbacks', () => {
  const android='Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36';
  for (const brand of ['Google Chrome','Brave','Microsoft Edge','Opera','Vivaldi','Samsung Internet']) {
    const hints=`"Chromium";v="140", "Not A Brand";v="99", "${brand}";v="140"`;
    assert.equal(formatBrowserLabel(android,browserBrandFromHints(hints)),brand);
  }
  assert.equal(browserBrandFromHints('"Chromium";v="140", "Not A Brand";v="99"'),null);
  assert.equal(browserBrandFromHints('anything malformed'),null);
  assert.equal(formatBrowserLabel(android),'Chrome/Chromium');
  assert.equal(formatBrowserLabel(android+' SamsungBrowser/27.0'),'Samsung Internet');
  assert.equal(formatBrowserLabel(android+' EdgA/140.0'),'Edge');
  assert.equal(formatBrowserLabel('Mozilla/5.0 (iPhone) CriOS/140.0 Mobile Safari/604.1'),'Google Chrome');
  assert.equal(formatBrowserLabel('Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1'),'Safari');
  assert.equal(formatBrowserLabel(null),'Unknown browser');
});

test('browser brand persists during subscription sync and appears in settings, admin grid and attempts', async () => {
  const input={endpoint:'https://push.example.test/101',keys:{p256dh:'test',auth:'test'}};
  const android='Mozilla/5.0 (Linux; Android 10; K) Chrome/140.0.0.0 Mobile Safari/537.36';
  await service.savePushSubscription(101,input,android,101,'"Chromium";v="140", "Brave";v="140"');
  assert.equal(service.getUserNotificationPreferences(101,101).browsers[0].name,'Brave on Android');
  queries.upsertNotificationPreferences(101,101,all);
  assert.deepEqual((await service.getNotificationSettings(101)).members[0].browsers,['Brave on Android']);
  // Missing hints on a later request must not erase the previously identified brand.
  await service.savePushSubscription(101,input,android);
  restartDatabase();
  assert.equal(service.getUserNotificationPreferences(101,101).browsers[0].name,'Brave on Android');
  queries.recordReminderAttempt({competitionId:101,userId:101,subscriptionId:1,predictionRound:'Week 1',reminderHours:1,status:'accepted',statusCode:null,errorMessage:null});
  assert.equal((await service.getNotificationReminderJobSnapshot(101)).recentAttempts[0].browser,'Brave');
});

test('closed competitions disable notification setup and admin tests without deleting saved choices or other competitions', async () => {
  queries.upsertNotificationPreferences(101,101,{...all,roundOpened:true});
  for (const column of ['is_finished','is_archived']) {
    db.exec('UPDATE competitions SET is_finished=0,is_archived=0');
    db.prepare(`UPDATE competitions SET ${column}=1 WHERE id=101`).run();
    const settings=service.getUserNotificationPreferences(101,101);
    assert.equal(settings.competitionClosed,true);
    assert.equal(settings.competitionEnabled,false);
    assert.equal(settings.preferences.roundOpened,true);
    assert.equal(settings.browsers.length,1);
    const admin=await service.getNotificationSettings(101);
    assert.equal(admin.competitionClosed,true);
    assert.equal(admin.remindersEnabled,false);
    assert.equal(service.updateUserNotificationPreferences(101,101,all),null);
    assert.equal(await service.savePushSubscription(101,{endpoint:'https://push.example.test/closed',keys:{p256dh:'test',auth:'test'}},'Safari',101),false);
    assert.deepEqual(await service.sendTestNotification(101,101),{sent:0,subscriptions:0});
    assert.equal(payloads.length,0);
    assert.equal(service.getUserNotificationPreferences(101,102).competitionClosed,false);
  }
});

test('opening-only preferences retain browsers, derive enabled, and survive old clients and restart', async () => {
  const opening = { ...off, roundOpened: true };
  const result = service.updateUserNotificationPreferences(101,101,opening);
  assert.equal(result.preferences.enabled,true);
  assert.equal(result.browsers.length,1);
  const overview = await service.getNotificationSettings(101);
  assert.equal(overview.members[0].roundOpened,true);
  assert.equal(overview.members[0].browsers.length,1);
  assert.equal(queries.listReminderCandidates(101).length,0);
  const legacy = service.updateUserNotificationPreferences(101,101,{enabled:false,reminder1h:false,reminder9h:false});
  assert.equal(legacy.preferences.roundOpened,true);
  assert.equal(legacy.browsers.length,1);
  restartDatabase();
  assert.equal(queries.getNotificationPreferences(101,101).preferences.roundOpened,true);
  assert.equal(service.updateUserNotificationPreferences(101,101,{...off,roundOpened:'yes'}),null);
  service.updateUserNotificationPreferences(101,101,off);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,0);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,102).length,1);
});

test('adding the opening preference to an existing database preserves prior reminder opt-ins', () => {
  queries.upsertNotificationPreferences(101,101,all);
  db.exec('ALTER TABLE competition_notification_preferences DROP COLUMN round_opened');
  restartDatabase();
  assert.deepEqual(queries.getNotificationPreferences(101,101).preferences,all);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,1);
});

test('release rolls back if its opening event cannot be recorded', () => {
  db.exec(`UPDATE matches SET released_for_predictions=0;
    CREATE TRIGGER fail_opening BEFORE INSERT ON notification_round_openings
    BEGIN SELECT RAISE(ABORT, 'test rollback'); END;`);
  try {
    assert.throws(() => releaseQueries.releaseMatchesForRound(101,'Week 1'),/test rollback/);
    assert.equal(db.prepare('SELECT released_for_predictions FROM matches WHERE id=101').get().released_for_predictions,0);
  } finally { db.exec('DROP TRIGGER fail_opening'); }
});

test('adding matches to an already released round never backfills an opening notification', async () => {
  queries.upsertNotificationPreferences(101,101,{...all,roundOpened:true});
  db.prepare(`INSERT INTO matches (id,competition_id,match_number,stage,round_label,kickoff_at,source_time_zone,
    home_team_name,away_team_name,venue,city,released_for_predictions)
    VALUES (103,101,2,'league','Week 1',?,'UTC','Home','Away','Ground','City',0)`)
    .run(new Date(Date.now()+3600000).toISOString());
  releaseQueries.releaseMatchesForRound(101,'Week 1');
  await service.sendRoundOpeningNotifications();
  assert.equal(payloads.length,0);
});

test('both release query paths queue only a newly opened round and dispatch once, even concurrently', async () => {
  for (const id of [101,102]) queries.upsertNotificationPreferences(101,id,{...off,enabled:true,roundOpened:true});
  db.exec('UPDATE matches SET released_for_predictions=0');
  await service.sendRoundOpeningNotifications();
  assert.equal(payloads.length,0);
  assert.equal(releaseQueries.releaseMatchesForRound(101,'Week 1'),1);
  assert.equal(releaseQueries.releaseMatchesByIds(102,[102]),1);
  assert.equal(payloads.length,0); // Sending happens after release commits.
  await Promise.all([service.sendRoundOpeningNotifications(),service.sendRoundOpeningNotifications()]);
  assert.equal(payloads.length,2);
  assert.equal(payloads[0].data.url,'/competition/league-a/predictions');
  assert.equal(payloads[0].data.userId,101);
  assert.match(payloads[0].title,/Week 1/);
  assert.notEqual(payloads[0].tag,payloads[1].tag);
  assert.equal(releaseQueries.releaseMatchesForRound(101,'Week 1'),0);
  restartDatabase();
  await service.sendRoundOpeningNotifications();
  assert.equal(payloads.length,2);
});

test('opening queue respects release-time opt-in and current recipient, membership and competition gates', async () => {
  queries.upsertNotificationPreferences(101,101,{...all,roundOpened:true});
  db.exec('UPDATE matches SET released_for_predictions=0');
  releaseQueries.releaseMatchesForRound(101,'Week 1');
  releaseQueries.releaseMatchesForRound(102,'Week 1'); // No opt-in at release time.
  queries.upsertNotificationPreferences(101,102,{...all,roundOpened:true});
  queries.upsertNotificationSubscription(102,{endpoint:'https://push.example.test/101',subscriptionJson:'{}',userAgent:'Safari'});
  await service.sendRoundOpeningNotifications();
  assert.equal(payloads.length,0);
  queries.upsertNotificationSubscription(101,{endpoint:'https://push.example.test/101',subscriptionJson:'{}',userAgent:'Safari'});
  await service.sendRoundOpeningNotifications();
  assert.equal(payloads.length,0); // Account switches cannot replay an opening.
});

test('opening delivery rechecks opt-out, expired deadline, removed browser and competition/member eligibility', async () => {
  for (const change of [
    'UPDATE competition_notification_preferences SET round_opened=0',
    'UPDATE competitions SET notification_reminders_enabled=0',
    'UPDATE competitions SET is_archived=1',
    'UPDATE competitions SET is_finished=1',
    'UPDATE competition_users SET is_verified=0',
    'DELETE FROM competition_notification_browsers',
    "UPDATE notification_round_openings SET deadline_at='2000-01-01T00:00:00Z'"
  ]) {
    db.exec('DELETE FROM notification_round_openings; UPDATE matches SET released_for_predictions=0; UPDATE competitions SET notification_reminders_enabled=1,is_finished=0,is_archived=0; UPDATE competition_users SET is_verified=1');
    queries.upsertNotificationSubscription(101,{endpoint:'https://push.example.test/101',subscriptionJson:'{}',userAgent:'Safari'},101);
    queries.upsertNotificationPreferences(101,101,{...all,roundOpened:true});
    releaseQueries.releaseMatchesForRound(101,'Week 1');
    db.exec(change);
    await service.sendRoundOpeningNotifications();
    assert.equal(payloads.length,0,change);
  }
});

test('push failures do not undo a release, disable expired endpoints and do not repeat attempts', async () => {
  queries.upsertNotificationPreferences(101,101,{...all,roundOpened:true});
  db.exec('UPDATE matches SET released_for_predictions=0');
  releaseQueries.releaseMatchesForRound(101,'Week 1');
  let calls=0;
  webPush.sendNotification=async () => {calls++; throw {statusCode:410,body:'Expired'};};
  await service.sendRoundOpeningNotifications();
  await service.sendRoundOpeningNotifications();
  assert.equal(calls,1);
  assert.equal(db.prepare('SELECT released_for_predictions FROM matches WHERE id=101').get().released_for_predictions,1);
  assert.equal(db.prepare('SELECT status FROM notification_round_opening_attempts').get().status,'disabled');
});

test('existing browser subscriptions do not opt anyone into either competition; migration is repeatable', () => {
  db.exec('DROP TABLE competition_notification_preferences');
  restartDatabase();
  assert.deepEqual(queries.getNotificationPreferences(101,101).preferences, off);
  assert.deepEqual(queries.getNotificationPreferences(101,102).preferences, off);
  assert.equal(queries.listReminderCandidates(101).length,0);
  queries.upsertNotificationPreferences(101,101,all);
  restartDatabase();
  restartDatabase();
  assert.deepEqual(queries.getNotificationPreferences(101,101).preferences,all);
  assert.deepEqual(queries.getNotificationPreferences(101,102).preferences,off);
});

test('admin notification overview includes all members, defaults off, and isolates competition choices', async (t) => {
  db.prepare('INSERT INTO competition_users (competition_id,user_id,is_verified) VALUES (101,102,0)').run();
  t.after(() => db.prepare('DELETE FROM competition_users WHERE competition_id=101 AND user_id=102').run());
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h:false, roundOpened: false });
  queries.upsertNotificationPreferences(101,102,{ ...all, reminder1h:false });
  queries.upsertNotificationSubscription(101,{endpoint:'https://push.example.test/overview',subscriptionJson:'{}',userAgent:'Firefox/120'},101);
  t.after(() => db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/overview'").run());
  // A different last recipient must not erase this user's configured browser list.
  queries.upsertNotificationSubscription(102,{endpoint:'https://push.example.test/overview',subscriptionJson:'{}',userAgent:'Firefox/120'});
  db.prepare('UPDATE competitions SET notification_reminders_enabled=0 WHERE id=101').run();
  const overview = await service.getNotificationSettings(101);
  assert.equal(overview.remindersEnabled,false);
  assert.deepEqual(overview.members,[
    {userId:102,username:'other',reminder1h:false,reminder9h:false, roundOpened: false,browsers:[]},
    {userId:101,username:'player',reminder1h:true,reminder9h:false, roundOpened: false,browsers:['Chrome/Chromium on Windows','Firefox']}
  ]);
  assert.deepEqual((await service.getNotificationSettings(102)).members,[
    {userId:101,username:'player',reminder1h:false,reminder9h:true, roundOpened: false,browsers:['Chrome/Chromium on Windows']}
  ]);
});

test('turning both reminders off clears only this competition browsers and re-enabling restores only the registering browser', (t) => {
  t.after(() => db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/second'").run());
  queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/second', subscriptionJson: '{}', userAgent: 'Firefox/120' }, 101);
  queries.upsertNotificationPreferences(101,101,all);
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,2);
  service.updateUserNotificationPreferences(101,101,{ ...all, reminder9h:false, roundOpened: false });
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,2);
  const result = service.updateUserNotificationPreferences(101,101,off);
  assert.deepEqual(result.browsers,[]);
  assert.equal(service.getUserNotificationPreferences(101,102).browsers.length,1);
  restartDatabase();
  assert.deepEqual(service.getUserNotificationPreferences(101,101).browsers,[]);
  queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/second', subscriptionJson: '{}', userAgent: 'Firefox/120' }, 101);
  service.updateUserNotificationPreferences(101,101,{ ...all, reminder9h:false, roundOpened: false });
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,1);
  assert.equal(service.getUserNotificationPreferences(101,101).browsers[0].name,'Firefox');
  assert.equal(db.prepare("SELECT is_enabled FROM notification_subscriptions WHERE endpoint='https://push.example.test/101'").get().is_enabled,1);
});

test('choices are independent by competition and timing; master off preserves timing selections', () => {
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h: false, roundOpened: false });
  assert.deepEqual(queries.listReminderCandidates(101).map(x=>x.reminder_hours),[1]);
  assert.equal(queries.listReminderCandidates(102).length,0);
  queries.upsertNotificationPreferences(101,102,{ ...all, reminder1h: false });
  assert.deepEqual(queries.listReminderCandidates(102).map(x=>x.reminder_hours),[9]);
  queries.upsertNotificationPreferences(101,101,{ ...all, enabled:false });
  assert.equal(queries.listReminderCandidates(101).length,0);
  assert.equal(queries.getNotificationPreferences(101,101).preferences.reminder1h,true);
  assert.equal(queries.listReminderCandidates(102).length,1);
});

test('opting in with 21 hours remaining sends both reminders for that existing round when each becomes due', async () => {
  db.prepare('UPDATE matches SET kickoff_at=? WHERE id=101').run(new Date(Date.now()+21*60*60000).toISOString());
  service.updateUserNotificationPreferences(101,101,all);
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,0);
  // Move the same round into each due window, without changing the opt-in again.
  db.prepare('UPDATE matches SET kickoff_at=? WHERE id=101').run(new Date(Date.now()+538*60000).toISOString());
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,1);
  assert.equal(payloads[0].data.reminderHours,9);
  db.prepare('UPDATE matches SET kickoff_at=? WHERE id=101').run(new Date(Date.now()+58*60000).toISOString());
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,2);
  assert.equal(payloads[1].data.reminderHours,1);
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,2);
});

test('admin switch, finished/archived competitions, verification, release and postponement gate reminders', () => {
  queries.upsertNotificationPreferences(101,101,all);
  for (const sql of [
    'UPDATE competitions SET notification_reminders_enabled=0 WHERE id=101',
    'UPDATE competitions SET notification_reminders_enabled=1,is_finished=1 WHERE id=101',
    'UPDATE competitions SET is_finished=0,is_archived=1 WHERE id=101'
  ]) { db.exec(sql); assert.equal(queries.listReminderCandidates(101).length,0); }
  db.exec('UPDATE competitions SET is_archived=0 WHERE id=101; UPDATE competition_users SET is_verified=0 WHERE competition_id=101');
  assert.equal(queries.listReminderCandidates(101).length,0);
  db.exec('UPDATE competition_users SET is_verified=1; UPDATE matches SET released_for_predictions=0 WHERE id=101');
  assert.equal(queries.listReminderCandidates(101).length,0);
  db.exec('UPDATE matches SET released_for_predictions=1,is_postponed=1 WHERE id=101');
  assert.equal(queries.listReminderCandidates(101).length,0);
});

test('unreleased/postponed matches do not change deadlines or missing prediction counts', () => {
  queries.upsertNotificationPreferences(101,101,all);
  for (const [id,released,postponed] of [[103,0,0],[104,1,1]]) {
    db.prepare(`INSERT INTO matches (id,competition_id,match_number,stage,round_label,kickoff_at,source_time_zone,home_team_name,away_team_name,venue,city,released_for_predictions,is_postponed)
      VALUES (?,101,?,'league','Week 1','2000-01-01T00:00:00Z','UTC','Home','Away','Ground','City',?,?)`).run(id,id,released,postponed);
  }
  const candidate = queries.listReminderCandidates(101)[0];
  assert.equal(candidate.expected_count,1);
  assert.equal(candidate.submitted_count,0);
  assert.ok(Date.parse(candidate.deadline_at)>Date.now());
});

test('delivery carries competition identity and does not repeat; both competitions can send the same round', async () => {
  queries.upsertNotificationPreferences(101,101,all);
  queries.upsertNotificationPreferences(101,102,all);
  const reports = await Promise.all([service.sendDuePredictionRemindersForCompetition(101),service.sendDuePredictionRemindersForCompetition(102)]);
  assert.deepEqual(reports.map(r=>r.competitionId),[101,102]);
  assert.deepEqual(reports.map(r=>r.sentCount),[1,1]);
  assert.notEqual(payloads[0].tag,payloads[1].tag);
  assert.ok(payloads.some(p=>p.data.url==='/competition/league-a/predictions' && p.title.includes('League A')));
  assert.ok(payloads.some(p=>p.data.url==='/competition/league-b/predictions'));
  await service.sendDuePredictionRemindersForCompetition(101);
  assert.equal(payloads.length,2);
});

test('failed sends can retry with a cooldown and a three-attempt cap; dead endpoints are disabled', async () => {
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h: false, roundOpened: false });
  webPush.sendNotification = async () => { throw { statusCode:503 }; };
  for (let i=0;i<3;i++) {
    assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).failedCount,1);
    assert.equal(queries.listReminderCandidates(101).length,0);
    db.exec("UPDATE notification_reminder_attempts SET created_at=datetime('now','-2 minutes')");
  }
  assert.equal(queries.listReminderCandidates(101).length,0);
  db.exec('DELETE FROM notification_reminder_attempts');
  webPush.sendNotification = async () => { throw { statusCode:410 }; };
  assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).disabledSubscriptionCount,1);
  assert.equal(queries.listNotificationSubscriptionsForUser(101).length,0);
});

test('completed predictions still get the chosen reminder; expired deadlines do not send', async () => {
  queries.upsertNotificationPreferences(101,101,all);
  db.prepare('INSERT INTO predictions (user_id,match_id,home_score,away_score) VALUES (101,101,1,0)').run();
  await service.sendDuePredictionRemindersForCompetition(101);
  assert.match(payloads[0].title,/predictions complete/);
  db.exec('DELETE FROM notification_reminder_deliveries; DELETE FROM notification_reminder_attempts');
  db.prepare('UPDATE matches SET kickoff_at=? WHERE id=101').run(new Date(Date.now()-60000).toISOString());
  assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).sentCount,0);
});

test('only the selected nine-hour reminder sends during its window', async () => {
  db.prepare('UPDATE matches SET kickoff_at=? WHERE id=101').run(new Date(Date.now()+538*60000).toISOString());
  queries.upsertNotificationPreferences(101,101,{ enabled:true,reminder9h:false, roundOpened: false,reminder1h:true });
  assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).sentCount,0);
  queries.upsertNotificationPreferences(101,101,{ enabled:true,reminder9h:true, roundOpened: false,reminder1h:false });
  assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).sentCount,1);
  assert.equal(payloads[0].data.reminderHours,9);
});

test('overlapping jobs share a run, and opting out during delivery stops remaining subscriptions', async () => {
  queries.upsertNotificationPreferences(101,101,all);
  queries.upsertNotificationSubscription(101,{ endpoint:'https://push.example.test/second',subscriptionJson:'{}',userAgent:'Test' },101);
  let release;
  webPush.sendNotification = async () => { await new Promise(resolve => { release=resolve; }); return {}; };
  const first = service.sendDuePredictionRemindersForCompetition(101);
  const second = service.sendDuePredictionRemindersForCompetition(101);
  // The scheduler pauses at the first push. Revoke before any remaining device is sent to.
  while (!release) await new Promise(resolve=>setImmediate(resolve));
  queries.upsertNotificationPreferences(101,101,{ ...all, enabled:false });
  release();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(a,b);
  assert.equal(a.attemptedSubscriptionCount,1);
  db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/second'").run();
});

test('API requires login and membership, ignores forged user identity, and validates booleans', async () => {
  const app = express(); app.use(express.json()); app.use('/api', notificationsRoutes);
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/competitions/101/notification-preferences`;
  const token = createAuthToken({ userId:101, username:'player', role:'user' });
  const other = createAuthToken({ userId:102, username:'other', role:'user' });
  try {
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${other}`}})).status,403);
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const adminSettingsUrl = new URL('/api/admin/notifications/settings',url);
    assert.equal((await fetch(adminSettingsUrl)).status,401);
    assert.equal((await fetch(adminSettingsUrl,{headers:{...headers,'X-Competition-Id':'101'}})).status,403);
    assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({...all,enabled:'true'})})).status,400);
    assert.equal((await fetch(url,{method:'PUT',headers,body:JSON.stringify({...all,userId:102})})).status,200);
    assert.deepEqual(queries.getNotificationPreferences(101,101).preferences,all);
    assert.deepEqual(queries.getNotificationPreferences(102,101).preferences,off);
    assert.equal((await fetch(url.replace('/101/','/999/'),{headers})).status,403);
    const browsersUrl=url.replace('notification-preferences','notification-browsers');
    assert.equal((await fetch(browsersUrl,{method:'POST',headers:{...headers,Authorization:`Bearer ${other}`},body:'{}'})).status,403);
    const added=await fetch(browsersUrl,{method:'POST',headers,body:JSON.stringify({ endpoint:'https://push.example.test/api-browser',keys:{p256dh:'test',auth:'test'} })});
    assert.equal(added.status,201);
    const browserId=(await added.json()).browsers.at(-1).id;
    assert.equal((await fetch(`${browsersUrl}/${browserId}`,{method:'DELETE',headers})).status,200);
    const lastId=service.getUserNotificationPreferences(101,101).browsers[0].id;
    assert.equal((await fetch(`${browsersUrl}/${lastId}`,{method:'DELETE',headers})).status,409);
    db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/api-browser'").run();
    assert.equal((await fetch(url.replace('/competitions/101/notification-preferences','/admin/notifications/test'),{method:'POST',headers:{...headers,'X-Competition-Id':'101'},body:'{}'})).status,403);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('browser removal is competition scoped, cannot remove the last browser, and survives restart', () => {
  queries.upsertNotificationSubscription(101,{endpoint:'https://push.example.test/second',subscriptionJson:'{}',userAgent:'Firefox/120 Linux'},101);
  const browsers = service.getUserNotificationPreferences(101,101).browsers;
  assert.equal(browsers.length,2);
  assert.equal(browsers[0].name,'Chrome/Chromium on Windows');
  assert.equal(browsers[0].fingerprint.length,64);
  assert.equal('endpoint' in browsers[0],false);
  assert.equal(queries.removeCompetitionNotificationBrowser(102,101,browsers[0].id),'not_found');
  assert.equal(queries.removeCompetitionNotificationBrowser(101,101,browsers[0].id),'removed');
  assert.equal(queries.removeCompetitionNotificationBrowser(101,101,browsers[1].id),'last_browser');
  assert.equal(queries.listCompetitionNotificationBrowsers(101,102).length,1);
  restartDatabase();
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,1);
  queries.upsertNotificationPreferences(101,101,all);
  assert.ok(queries.listReminderCandidates(101).every(candidate=>candidate.subscription_id===browsers[1].id));
  db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/second'").run();
});

test('browser migration preserves prior opt-ins once and never re-adds removed browsers', () => {
  queries.upsertNotificationPreferences(101,101,all);
  db.exec('DROP TABLE competition_notification_browsers');
  restartDatabase();
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,1);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,102).length,0);
  restartDatabase();
  assert.deepEqual(queries.getNotificationPreferences(101,101).preferences,all);
});

test('shared-browser login preserves both accounts choices, selects the last account and never catches up skipped reminders', async (t) => {
  db.prepare('INSERT INTO competition_users (competition_id,user_id,is_verified) VALUES (101,102,1)').run();
  t.after(() => db.prepare('DELETE FROM competition_users WHERE competition_id=101 AND user_id=102').run());
  queries.upsertNotificationPreferences(101,101,all);
  const browser = {endpoint:'https://push.example.test/101',subscriptionJson:'{}',userAgent:'Firefox/120'};
  // Login as B without opting in: retain A associations, send to neither account.
  queries.upsertNotificationSubscription(102,browser);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,1);
  assert.equal(queries.listCompetitionNotificationBrowsers(102,101).length,0);
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_reminder_skips').get().count,1);
  // A returns inside the due window: the skipped reminder is not replayed.
  queries.upsertNotificationSubscription(101,browser);
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,0);
  // B opts in on the same browser and is now its recipient.
  queries.upsertNotificationSubscription(102,browser,101);
  queries.upsertNotificationPreferences(102,101,all);
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,1);
  assert.equal(payloads[0].data.userId,102);
  assert.equal(queries.listCompetitionNotificationBrowsers(101,101).length,1);
  assert.equal(queries.listCompetitionNotificationBrowsers(102,101).length,1);
  restartDatabase();
  assert.deepEqual(queries.getNotificationPreferences(101,101).preferences,all);
  // A's next round resumes with its saved association, without another opt-in.
  queries.upsertNotificationSubscription(101,browser);
  db.prepare("UPDATE matches SET round_label='Week 2' WHERE id=101").run();
  await service.sendDuePredictionReminders(101);
  assert.equal(payloads.length,2);
  assert.equal(payloads[1].data.userId,101);
});

test('service worker drops pushes for a different account or missing recipient and never replays them', async () => {
  let recipient = {userId:102};
  const shown = [];
  const handlers = {};
  runInNewContext(readFileSync(new URL('../../web/public/notification-sw.js', import.meta.url),'utf8'), {
    self: {addEventListener:(name,handler) => {handlers[name]=handler;},
      registration:{showNotification:async (title,options) => {shown.push({title,options});}}},
    caches:{open:async () => ({match:async () => recipient ? {json:async () => recipient} : undefined})}
  });
  const push = async (userId) => {
    let work;
    handlers.push({data:{json:() => ({title:'Reminder',data:{userId}})},waitUntil:promise => {work=promise;}});
    await work;
  };
  await push(101);
  assert.equal(shown.length,0);
  recipient = {userId:101};
  assert.equal(shown.length,0);
  await push(101);
  assert.equal(shown.length,1);
  recipient = null;
  await push(101);
  assert.equal(shown.length,1);
});
