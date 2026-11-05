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
const off = { enabled: false, reminder9h: false, reminder1h: false };
const all = { enabled: true, reminder9h: true, reminder1h: true };
let payloads = [];
const originalSend = webPush.sendNotification;

beforeEach(() => {
  db.exec(`DELETE FROM competition_notification_preferences; DELETE FROM notification_reminder_deliveries;
    DELETE FROM notification_reminder_attempts; DELETE FROM notification_reminder_skips; DELETE FROM predictions; DELETE FROM competition_notification_browsers;
    UPDATE notification_subscriptions SET is_enabled = 1;
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
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h:false });
  queries.upsertNotificationPreferences(101,102,{ ...all, reminder1h:false });
  queries.upsertNotificationSubscription(101,{endpoint:'https://push.example.test/overview',subscriptionJson:'{}',userAgent:'Firefox/120'},101);
  t.after(() => db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/overview'").run());
  // A different last recipient must not erase this user's configured browser list.
  queries.upsertNotificationSubscription(102,{endpoint:'https://push.example.test/overview',subscriptionJson:'{}',userAgent:'Firefox/120'});
  db.prepare('UPDATE competitions SET notification_reminders_enabled=0 WHERE id=101').run();
  const overview = await service.getNotificationSettings(101);
  assert.equal(overview.remindersEnabled,false);
  assert.deepEqual(overview.members,[
    {userId:102,username:'other',reminder1h:false,reminder9h:false,browsers:[]},
    {userId:101,username:'player',reminder1h:true,reminder9h:false,browsers:['Chrome/Chromium on Windows','Firefox']}
  ]);
  assert.deepEqual((await service.getNotificationSettings(102)).members,[
    {userId:101,username:'player',reminder1h:false,reminder9h:true,browsers:['Chrome/Chromium on Windows']}
  ]);
});

test('turning both reminders off clears only this competition browsers and re-enabling restores only the registering browser', (t) => {
  t.after(() => db.prepare("DELETE FROM notification_subscriptions WHERE endpoint='https://push.example.test/second'").run());
  queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/second', subscriptionJson: '{}', userAgent: 'Firefox/120' }, 101);
  queries.upsertNotificationPreferences(101,101,all);
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,2);
  service.updateUserNotificationPreferences(101,101,{ ...all, reminder9h:false });
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,2);
  const result = service.updateUserNotificationPreferences(101,101,off);
  assert.deepEqual(result.browsers,[]);
  assert.equal(service.getUserNotificationPreferences(101,102).browsers.length,1);
  restartDatabase();
  assert.deepEqual(service.getUserNotificationPreferences(101,101).browsers,[]);
  queries.upsertNotificationSubscription(101, { endpoint: 'https://push.example.test/second', subscriptionJson: '{}', userAgent: 'Firefox/120' }, 101);
  service.updateUserNotificationPreferences(101,101,{ ...all, reminder9h:false });
  assert.equal(service.getUserNotificationPreferences(101,101).browsers.length,1);
  assert.equal(service.getUserNotificationPreferences(101,101).browsers[0].name,'Firefox');
  assert.equal(db.prepare("SELECT is_enabled FROM notification_subscriptions WHERE endpoint='https://push.example.test/101'").get().is_enabled,1);
});

test('choices are independent by competition and timing; master off preserves timing selections', () => {
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h: false });
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
  queries.upsertNotificationPreferences(101,101,{ ...all, reminder9h: false });
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
  queries.upsertNotificationPreferences(101,101,{ enabled:true,reminder9h:false,reminder1h:true });
  assert.equal((await service.sendDuePredictionRemindersForCompetition(101)).sentCount,0);
  queries.upsertNotificationPreferences(101,101,{ enabled:true,reminder9h:true,reminder1h:false });
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
