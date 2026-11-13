import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

import { config } from '../config/index.js';
import { hashPassword } from '../shared/utils/password.js';
import { migrateContentLocalization } from './migrations/content-localization.js';
import { migrateCroatianWeekWording } from './migrations/croatian-week-wording.js';

let databaseInitialized = false;

export function openDatabase() {
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const db = new Database(config.databasePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (databaseInitialized) {
    return db;
  }

  initializeDatabase(db);
  databaseInitialized = true;

  return db;
}

export type AppDatabase = ReturnType<typeof openDatabase>;

function initializeDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureUsersTableSupportsAdminRole(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 40),
      first_name TEXT NOT NULL CHECK(length(first_name) BETWEEN 1 AND 80),
      last_name TEXT NOT NULL CHECK(length(last_name) BETWEEN 1 AND 80),
      tiebreaker_name TEXT CHECK(tiebreaker_name IS NULL OR length(tiebreaker_name) BETWEEN 1 AND 80),
      password_hash TEXT NOT NULL CHECK(length(password_hash) <= 255),
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'user')),
      is_verified INTEGER NOT NULL DEFAULT 0 CHECK(is_verified IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO app_metadata (key, value)
    VALUES ('schema_version', '8')
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP;
  `);

  ensureUsersTableSupportsTiebreaker(db);
  ensureUsersTableSupportsVerification(db);
  ensureUsersTableSupportsCaseInsensitiveUsername(db);
  ensureCompetitionSchema(db);
  ensureSuperAdminCompetitionMembershipBlocked(db);
  ensureMatchesTableSupportsOdds(db);
  ensureMatchesTableSupportsPostponed(db);
  ensureMatchesTableSupportsPlayoffMappings(db);
  ensureFinishedCompetitionsHaveJobsDisabled(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('iban', 'keks', 'revolut', 'cash')),
      value TEXT NOT NULL DEFAULT '' CHECK(length(value) <= 200),
      iban_holder_name TEXT NOT NULL DEFAULT '' CHECK(length(iban_holder_name) <= 200),
      fast_pay_url TEXT NOT NULL DEFAULT '' CHECK(length(fast_pay_url) <= 500),
      is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, type)
    );

    CREATE TABLE IF NOT EXISTS payment_settings_config (
      competition_id INTEGER PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
      show_payment_info INTEGER NOT NULL DEFAULT 0 CHECK(show_payment_info IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      match_number INTEGER NOT NULL,
      stage TEXT NOT NULL,
      group_name TEXT,
      round_label TEXT NOT NULL,
      kickoff_at TEXT NOT NULL,
      source_time_zone TEXT NOT NULL,
      home_team_name TEXT NOT NULL,
      away_team_name TEXT NOT NULL,
      home_team_flag TEXT,
      away_team_flag TEXT,
      home_mapped_team_name TEXT,
      away_mapped_team_name TEXT,
      home_mapped_team_flag TEXT,
      away_mapped_team_flag TEXT,
      venue TEXT NOT NULL,
      city TEXT NOT NULL,
      home_win_odds REAL CHECK(home_win_odds IS NULL OR home_win_odds > 1),
      draw_odds REAL CHECK(draw_odds IS NULL OR draw_odds > 1),
      away_win_odds REAL CHECK(away_win_odds IS NULL OR away_win_odds > 1),
      odds_synced_at TEXT,
      released_for_predictions INTEGER NOT NULL DEFAULT 1 CHECK(released_for_predictions IN (0, 1)),
      is_postponed INTEGER NOT NULL DEFAULT 0 CHECK(is_postponed IN (0, 1)),
      final_home_score INTEGER CHECK(final_home_score IS NULL OR final_home_score >= 0),
      final_away_score INTEGER CHECK(final_away_score IS NULL OR final_away_score >= 0),
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      home_score INTEGER NOT NULL CHECK(home_score >= 0),
      away_score INTEGER NOT NULL CHECK(away_score >= 0),
      odds_outcome TEXT CHECK(odds_outcome IS NULL OR odds_outcome IN ('1', 'X', '2')),
      odds_value REAL CHECK(odds_value IS NULL OR odds_value > 1),
      odds_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS competition_notification_preferences (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
      reminder_9h INTEGER NOT NULL DEFAULT 0 CHECK(reminder_9h IN (0, 1)),
      reminder_1h INTEGER NOT NULL DEFAULT 0 CHECK(reminder_1h IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notification_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription_json TEXT NOT NULL,
      user_agent TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_reminder_skips (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
      prediction_round TEXT NOT NULL,
      reminder_hours INTEGER NOT NULL CHECK(reminder_hours IN (1, 9)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, user_id, subscription_id, prediction_round, reminder_hours)
    );

    CREATE TABLE IF NOT EXISTS notification_reminder_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prediction_round TEXT NOT NULL,
      reminder_hours INTEGER NOT NULL CHECK(reminder_hours IN (1, 9)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(competition_id, user_id, prediction_round, reminder_hours)
    );

    CREATE TABLE IF NOT EXISTS notification_reminder_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER REFERENCES notification_subscriptions(id) ON DELETE SET NULL,
      prediction_round TEXT NOT NULL,
      reminder_hours INTEGER NOT NULL CHECK(reminder_hours IN (1, 9)),
      status TEXT NOT NULL CHECK(status IN ('accepted', 'failed', 'disabled')),
      status_code INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS live_score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_event_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('scheduled', 'live', 'finished', 'unknown')),
      raw_status TEXT,
      home_score INTEGER CHECK(home_score IS NULL OR home_score >= 0),
      away_score INTEGER CHECK(away_score IS NULL OR away_score >= 0),
      raw_payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS live_score_job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'skipped', 'failed')),
      checked_matches INTEGER NOT NULL DEFAULT 0,
      updated_matches INTEGER NOT NULL DEFAULT 0,
      live_matches INTEGER NOT NULL DEFAULT 0,
      finished_matches INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS live_score_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES live_score_job_runs(id) ON DELETE SET NULL,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      previous_home_score INTEGER,
      previous_away_score INTEGER,
      new_home_score INTEGER NOT NULL,
      new_away_score INTEGER NOT NULL,
      provider_status TEXT NOT NULL,
      applied_to_final_score INTEGER NOT NULL DEFAULT 1 CHECK(applied_to_final_score IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const subscriptionColumns = db.prepare('PRAGMA table_info(notification_subscriptions)').all() as Array<{ name: string }>;
  if (!subscriptionColumns.some(column => column.name === 'browser_brand')) {
    db.exec('ALTER TABLE notification_subscriptions ADD COLUMN browser_brand TEXT');
  }
  const preferenceColumns = db.prepare('PRAGMA table_info(competition_notification_preferences)').all() as Array<{ name: string }>;
  if (!preferenceColumns.some(column => column.name === 'round_opened')) {
    db.exec('ALTER TABLE competition_notification_preferences ADD COLUMN round_opened INTEGER NOT NULL DEFAULT 0 CHECK(round_opened IN (0, 1))');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_round_openings (
      id INTEGER PRIMARY KEY,
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      prediction_round TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(competition_id, prediction_round)
    );
    CREATE TABLE IF NOT EXISTS notification_round_opening_attempts (
      opening_id INTEGER NOT NULL REFERENCES notification_round_openings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','disabled','skipped')),
      status_code INTEGER,
      error_message TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(opening_id, user_id, subscription_id)
    );
  `);
  ensureCompetitionNotificationBrowsers(db);
  ensureCompetitionTeamsTableSupportsName(db);
  ensureSuperAdminPredictionsBlocked(db);
  ensureFinishedCompetitionLiveSnapshotsClosed(db);
  seedRuleTemplates(db);
  migrateContentLocalization(db);
  migrateCroatianWeekWording(db);
  seedMissingCompetitionRules(db);
  ensureCompetitionScopedIndexes(db);

  // Older compatibility migrations. These are not specific to the competition layer.
  ensurePaymentSettingsSupportsFastPayUrl(db);
  ensurePaymentSettingsSupportsIbanHolderName(db);
  ensurePredictionsTableSupportsOddsSnapshot(db);
  ensureNotificationReminderDeliveriesSupportsOneHour(db);

  seedSuperAdmin(db);
}

function ensureCompetitionSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 120),
      slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 140),
      passcode_hash TEXT CHECK(passcode_hash IS NULL OR length(passcode_hash) <= 255),
      logo_url TEXT NOT NULL DEFAULT '' CHECK(length(logo_url) <= 200000),
      schedule_source_url TEXT NOT NULL DEFAULT '' CHECK(length(schedule_source_url) <= 500),
      odds_source_url TEXT NOT NULL DEFAULT '' CHECK(length(odds_source_url) <= 500),
      import_matches_with_odds_enabled INTEGER NOT NULL DEFAULT 0 CHECK(import_matches_with_odds_enabled IN (0, 1)),
      auto_import_matches_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_import_matches_enabled IN (0, 1)),
      auto_import_matches_weekday INTEGER NOT NULL DEFAULT 2 CHECK(auto_import_matches_weekday BETWEEN 0 AND 6),
      auto_import_matches_time TEXT NOT NULL DEFAULT '08:00' CHECK(length(auto_import_matches_time) = 5),
      auto_import_matches_time_zone TEXT NOT NULL DEFAULT 'Europe/Zagreb' CHECK(length(auto_import_matches_time_zone) BETWEEN 1 AND 80),
      notification_reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK(notification_reminders_enabled IN (0, 1)),
      live_score_sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK(live_score_sync_enabled IN (0, 1)),
      playoffs_enabled INTEGER NOT NULL DEFAULT 0 CHECK(playoffs_enabled IN (0, 1)),
      is_finished INTEGER NOT NULL DEFAULT 0 CHECK(is_finished IN (0, 1)),
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS competition_users (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      is_verified INTEGER NOT NULL DEFAULT 0 CHECK(is_verified IN (0, 1)),
      tiebreaker_name TEXT CHECK(tiebreaker_name IS NULL OR length(tiebreaker_name) BETWEEN 1 AND 80),
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS competition_teams (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 140),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 140),
      display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 140),
      logo_url TEXT NOT NULL DEFAULT '' CHECK(length(logo_url) <= 500),
      group_name TEXT CHECK(group_name IS NULL OR length(group_name) BETWEEN 1 AND 40),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, normalized_name)
    );

    CREATE TABLE IF NOT EXISTS rule_templates (
      key TEXT PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 80),
      text_template TEXT NOT NULL CHECK(length(text_template) BETWEEN 1 AND 500),
      value_label TEXT CHECK(value_label IS NULL OR length(value_label) BETWEEN 1 AND 120),
      default_value TEXT CHECK(default_value IS NULL OR length(default_value) <= 120),
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS competition_rules (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL REFERENCES rule_templates(key) ON DELETE CASCADE,
      value TEXT CHECK(value IS NULL OR length(value) <= 120),
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, template_key)
    );
  `);

  ensureCompetitionTableSupportsManagementFields(db);
  ensureCompetitionUsersTableSupportsScopedRole(db);
  ensureCompetitionTeamsTableSupportsGroupName(db);
}

function ensureCompetitionUsersTableSupportsScopedRole(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(competition_users)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length > 0 && !columnNames.has('role')) {
    db.exec("ALTER TABLE competition_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user'))");
  }
}

function ensureCompetitionTeamsTableSupportsGroupName(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(competition_teams)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length > 0 && !columnNames.has('group_name')) {
    db.exec('ALTER TABLE competition_teams ADD COLUMN group_name TEXT CHECK(group_name IS NULL OR length(group_name) BETWEEN 1 AND 40)');
  }
}

function ensureCompetitionTeamsTableSupportsName(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(competition_teams)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length > 0 && !columnNames.has('name')) {
    db.exec('ALTER TABLE competition_teams ADD COLUMN name TEXT');
  }

  if (columns.length > 0) {
    db.exec(`
      UPDATE competition_teams
      SET name = COALESCE(
        (
          SELECT team_sources.team_name
          FROM (
            SELECT competition_id, home_team_name AS team_name FROM matches
            UNION
            SELECT competition_id, away_team_name AS team_name FROM matches
          ) AS team_sources
          WHERE team_sources.competition_id = competition_teams.competition_id
            AND lower(trim(team_sources.team_name)) = competition_teams.normalized_name
          ORDER BY length(team_sources.team_name) DESC
          LIMIT 1
        ),
        NULLIF(name, ''),
        NULLIF(display_name, ''),
        normalized_name
      )
      WHERE name IS NULL
        OR name = ''
        OR name = display_name
    `);
  }
}

function seedRuleTemplates(db: Database.Database) {
  const templates = [
    {
      key: 'exact-score',
      text: 'Exact score predictions award 1 point.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'odds-outcome',
      text: 'Correct match outcome predictions award points equal to the selected odds coefficient.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'regular-time',
      text: 'Final scores are based on regular time only; extra time and penalties do not count.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'accumulate-points',
      text: 'Points accumulate match by match across the competition.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'rank-total-points',
      text: 'Users are ranked first by total points.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'winner-tiebreaker',
      text: 'The competition winner is the second ranking criterion in case of a tied result.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'buy-in',
      text: 'Buy-in is {{value}} per player.',
      valueLabel: 'Buy-in amount',
      defaultValue: '25 EUR'
    },
    {
      key: 'prize-split',
      text: 'Prize money is split 60% for 1st place, 30% for 2nd place, and 10% for 3rd place.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'split-ties',
      text: 'If users are still tied, prize money is split according to the configured prize distribution.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'round-deadline',
      text: 'Predictions must be submitted before the first match of each round.',
      valueLabel: null,
      defaultValue: null
    },
    {
      key: 'visible-after-deadline',
      text: 'After the deadline, all users can see all predictions for that round.',
      valueLabel: null,
      defaultValue: null
    }
  ];

  const statement = db.prepare(
    `
      INSERT INTO rule_templates (key, text_template, value_label, default_value, sort_order)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `
  );

  templates.forEach((template, index) => {
    statement.run(template.key, template.text, template.valueLabel, template.defaultValue, index + 1);
  });
}

function seedMissingCompetitionRules(db: Database.Database) {
  db.prepare(
    `
      INSERT INTO competition_rules (competition_id, template_key, value, sort_order)
      SELECT competitions.id, rule_templates.key, rule_templates.default_value, rule_templates.sort_order
      FROM competitions
      CROSS JOIN rule_templates
      WHERE competitions.is_archived = 0
        AND rule_templates.key NOT LIKE 'custom-%'
        AND NOT EXISTS (
          SELECT 1
          FROM competition_rules
          WHERE competition_rules.competition_id = competitions.id
        )
    `
  ).run();
}

function ensureCompetitionTableSupportsManagementFields(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(competitions)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has('passcode_hash')) {
    db.exec('ALTER TABLE competitions ADD COLUMN passcode_hash TEXT CHECK(passcode_hash IS NULL OR length(passcode_hash) <= 255)');
  }

  if (!columnNames.has('is_finished')) {
    db.exec('ALTER TABLE competitions ADD COLUMN is_finished INTEGER NOT NULL DEFAULT 0 CHECK(is_finished IN (0, 1))');
  }

  if (!columnNames.has('logo_url')) {
    db.exec("ALTER TABLE competitions ADD COLUMN logo_url TEXT NOT NULL DEFAULT '' CHECK(length(logo_url) <= 200000)");
  }

  if (!columnNames.has('playoffs_enabled')) {
    db.exec('ALTER TABLE competitions ADD COLUMN playoffs_enabled INTEGER NOT NULL DEFAULT 0 CHECK(playoffs_enabled IN (0, 1))');
  }

  if (!columnNames.has('import_matches_with_odds_enabled')) {
    db.exec(
      'ALTER TABLE competitions ADD COLUMN import_matches_with_odds_enabled INTEGER NOT NULL DEFAULT 0 CHECK(import_matches_with_odds_enabled IN (0, 1))'
    );
  }

  if (!columnNames.has('auto_import_matches_enabled')) {
    db.exec('ALTER TABLE competitions ADD COLUMN auto_import_matches_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_import_matches_enabled IN (0, 1))');
  }

  if (!columnNames.has('auto_import_matches_weekday')) {
    db.exec('ALTER TABLE competitions ADD COLUMN auto_import_matches_weekday INTEGER NOT NULL DEFAULT 2 CHECK(auto_import_matches_weekday BETWEEN 0 AND 6)');
  }

  if (!columnNames.has('auto_import_matches_time')) {
    db.exec("ALTER TABLE competitions ADD COLUMN auto_import_matches_time TEXT NOT NULL DEFAULT '08:00' CHECK(length(auto_import_matches_time) = 5)");
  }

  if (!columnNames.has('auto_import_matches_time_zone')) {
    db.exec(
      "ALTER TABLE competitions ADD COLUMN auto_import_matches_time_zone TEXT NOT NULL DEFAULT 'Europe/Zagreb' CHECK(length(auto_import_matches_time_zone) BETWEEN 1 AND 80)"
    );
  }
}

function ensureFinishedCompetitionsHaveJobsDisabled(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(competitions)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (
    columns.length === 0 ||
    !columnNames.has('is_finished') ||
    !columnNames.has('notification_reminders_enabled') ||
    !columnNames.has('live_score_sync_enabled')
  ) {
    return;
  }

  db.prepare(
    `
      UPDATE competitions
      SET
        notification_reminders_enabled = 0,
        live_score_sync_enabled = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE is_finished = 1
        AND (
          notification_reminders_enabled = 1
          OR live_score_sync_enabled = 1
        )
    `
  ).run();
}

function ensureFinishedCompetitionLiveSnapshotsClosed(db: Database.Database) {
  const tableNames = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('competitions', 'matches', 'live_score_snapshots')")
        .all() as Array<{ name: string }>
    ).map((table) => table.name)
  );

  if (!tableNames.has('competitions') || !tableNames.has('matches') || !tableNames.has('live_score_snapshots')) {
    return;
  }

  db.prepare(
    `
      UPDATE live_score_snapshots
      SET status = 'finished'
      WHERE status = 'live'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM matches
          INNER JOIN competitions ON competitions.id = matches.competition_id
          WHERE matches.id = live_score_snapshots.match_id
            AND competitions.is_finished = 1
        )
    `
  ).run();
}

function ensureSuperAdminCompetitionMembershipBlocked(db: Database.Database) {
  db.exec(`
    DELETE FROM competition_users
    WHERE EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = competition_users.user_id
        AND users.role = 'super_admin'
    );

    CREATE TRIGGER IF NOT EXISTS competition_users_prevent_super_admin_insert
    BEFORE INSERT ON competition_users
    WHEN EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.user_id
        AND users.role = 'super_admin'
    )
    BEGIN
      SELECT RAISE(ABORT, 'super_admin cannot join competitions');
    END;

    CREATE TRIGGER IF NOT EXISTS competition_users_prevent_super_admin_update
    BEFORE UPDATE OF user_id ON competition_users
    WHEN EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.user_id
        AND users.role = 'super_admin'
    )
    BEGIN
      SELECT RAISE(ABORT, 'super_admin cannot join competitions');
    END;

    CREATE TRIGGER IF NOT EXISTS users_remove_competition_membership_for_super_admin
    AFTER UPDATE OF role ON users
    WHEN NEW.role = 'super_admin'
    BEGIN
      DELETE FROM competition_users WHERE user_id = NEW.id;
    END;
  `);
}

function ensureSuperAdminPredictionsBlocked(db: Database.Database) {
  db.exec(`
    DELETE FROM predictions
    WHERE EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = predictions.user_id
        AND users.role = 'super_admin'
    );

    CREATE TRIGGER IF NOT EXISTS predictions_prevent_super_admin_insert
    BEFORE INSERT ON predictions
    WHEN EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.user_id
        AND users.role = 'super_admin'
    )
    BEGIN
      SELECT RAISE(ABORT, 'super_admin cannot submit predictions');
    END;

    CREATE TRIGGER IF NOT EXISTS predictions_prevent_super_admin_update
    BEFORE UPDATE OF user_id ON predictions
    WHEN EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = NEW.user_id
        AND users.role = 'super_admin'
    )
    BEGIN
      SELECT RAISE(ABORT, 'super_admin cannot submit predictions');
    END;

    CREATE TRIGGER IF NOT EXISTS users_remove_predictions_for_super_admin
    AFTER UPDATE OF role ON users
    WHEN NEW.role = 'super_admin'
    BEGIN
      DELETE FROM predictions WHERE user_id = NEW.id;
    END;
  `);
}

function seedSuperAdmin(db: Database.Database) {
  const existingSuperAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id ASC LIMIT 1")
    .get() as { id: number } | undefined;

  if (existingSuperAdmin) {
    return;
  }

  if (!config.superAdminPassword) {
    if (config.nodeEnv === 'production') {
      throw new Error('SUPER_ADMIN_PASSWORD is required to bootstrap the first super admin.');
    }

    console.warn('SUPER_ADMIN_PASSWORD is missing. Skipping development super admin bootstrap.');
    return;
  }

  db.prepare(
    `
      INSERT INTO users (username, first_name, last_name, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO NOTHING
    `
  ).run(
    config.superAdminUsername,
    config.superAdminFirstName,
    config.superAdminLastName,
    hashPassword(config.superAdminPassword),
    'super_admin'
  );
}

function ensurePaymentSettingsSupportsFastPayUrl(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(payment_settings)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0 || columnNames.has('fast_pay_url')) {
    return;
  }

  db.exec("ALTER TABLE payment_settings ADD COLUMN fast_pay_url TEXT NOT NULL DEFAULT '' CHECK(length(fast_pay_url) <= 500)");
}

function ensurePaymentSettingsSupportsIbanHolderName(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(payment_settings)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0 || columnNames.has('iban_holder_name')) {
    return;
  }

  db.exec("ALTER TABLE payment_settings ADD COLUMN iban_holder_name TEXT NOT NULL DEFAULT '' CHECK(length(iban_holder_name) <= 200)");
}

function ensureUsersTableSupportsAdminRole(db: Database.Database) {
  const existingTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { sql: string } | undefined;

  if (!existingTable || existingTable.sql.includes("'admin'")) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    BEGIN TRANSACTION;

    CREATE TABLE users_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE CHECK(length(username) BETWEEN 3 AND 40),
      first_name TEXT NOT NULL CHECK(length(first_name) BETWEEN 1 AND 80),
      last_name TEXT NOT NULL CHECK(length(last_name) BETWEEN 1 AND 80),
      tiebreaker_name TEXT CHECK(tiebreaker_name IS NULL OR length(tiebreaker_name) BETWEEN 1 AND 80),
      password_hash TEXT NOT NULL CHECK(length(password_hash) <= 255),
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'user')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO users_next (
      id,
      username,
      first_name,
      last_name,
      tiebreaker_name,
      password_hash,
      role,
      created_at,
      updated_at
    )
    SELECT
      id,
      username,
      first_name,
      last_name,
      NULL,
      password_hash,
      role,
      created_at,
      updated_at
    FROM users;

    DROP TABLE users;
    ALTER TABLE users_next RENAME TO users;

    COMMIT;

    PRAGMA foreign_keys = ON;
  `);
}

function ensureUsersTableSupportsTiebreaker(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0 || columnNames.has('tiebreaker_name')) {
    return;
  }

  db.exec(
    'ALTER TABLE users ADD COLUMN tiebreaker_name TEXT CHECK(tiebreaker_name IS NULL OR length(tiebreaker_name) BETWEEN 1 AND 80)'
  );
}

function ensureUsersTableSupportsVerification(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0 || columnNames.has('is_verified')) {
    return;
  }

  db.exec('ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0 CHECK(is_verified IN (0, 1))');
}

function ensureUsersTableSupportsCaseInsensitiveUsername(db: Database.Database) {
  const duplicate = db
    .prepare(
      `
        SELECT lower(username) AS normalized_username
        FROM users
        GROUP BY normalized_username
        HAVING COUNT(*) > 1
        LIMIT 1
      `
    )
    .get() as { normalized_username: string } | undefined;

  if (duplicate) {
    console.warn(
      `Skipping case-insensitive username index because duplicate username casing exists for "${duplicate.normalized_username}".`
    );
    return;
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_unique ON users(username COLLATE NOCASE)');
}

function ensureMatchesTableSupportsOdds(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has('home_win_odds')) {
    db.exec('ALTER TABLE matches ADD COLUMN home_win_odds REAL CHECK(home_win_odds IS NULL OR home_win_odds > 1)');
  }

  if (!columnNames.has('draw_odds')) {
    db.exec('ALTER TABLE matches ADD COLUMN draw_odds REAL CHECK(draw_odds IS NULL OR draw_odds > 1)');
  }

  if (!columnNames.has('away_win_odds')) {
    db.exec('ALTER TABLE matches ADD COLUMN away_win_odds REAL CHECK(away_win_odds IS NULL OR away_win_odds > 1)');
  }

  if (!columnNames.has('odds_synced_at')) {
    db.exec('ALTER TABLE matches ADD COLUMN odds_synced_at TEXT');
  }

  if (!columnNames.has('released_for_predictions')) {
    db.exec('ALTER TABLE matches ADD COLUMN released_for_predictions INTEGER NOT NULL DEFAULT 1 CHECK(released_for_predictions IN (0, 1))');
  }
}

function ensureMatchesTableSupportsPostponed(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0 || columnNames.has('is_postponed')) {
    return;
  }

  db.exec('ALTER TABLE matches ADD COLUMN is_postponed INTEGER NOT NULL DEFAULT 0 CHECK(is_postponed IN (0, 1))');
}

function ensureMatchesTableSupportsPlayoffMappings(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has('home_mapped_team_name')) {
    db.exec('ALTER TABLE matches ADD COLUMN home_mapped_team_name TEXT');
  }

  if (!columnNames.has('away_mapped_team_name')) {
    db.exec('ALTER TABLE matches ADD COLUMN away_mapped_team_name TEXT');
  }

  if (!columnNames.has('home_mapped_team_flag')) {
    db.exec('ALTER TABLE matches ADD COLUMN home_mapped_team_flag TEXT');
  }

  if (!columnNames.has('away_mapped_team_flag')) {
    db.exec('ALTER TABLE matches ADD COLUMN away_mapped_team_flag TEXT');
  }
}

function ensurePredictionsTableSupportsOddsSnapshot(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(predictions)').all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length === 0) {
    return;
  }

  if (!columnNames.has('odds_outcome')) {
    db.exec("ALTER TABLE predictions ADD COLUMN odds_outcome TEXT CHECK(odds_outcome IS NULL OR odds_outcome IN ('1', 'X', '2'))");
  }

  if (!columnNames.has('odds_value')) {
    db.exec('ALTER TABLE predictions ADD COLUMN odds_value REAL CHECK(odds_value IS NULL OR odds_value > 1)');
  }

  if (!columnNames.has('odds_synced_at')) {
    db.exec('ALTER TABLE predictions ADD COLUMN odds_synced_at TEXT');
  }
}

function ensureNotificationReminderDeliveriesSupportsOneHour(db: Database.Database) {
  const existingTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notification_reminder_deliveries'")
    .get() as { sql: string } | undefined;

  if (!existingTable || existingTable.sql.includes('reminder_hours IN (1, 9)')) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    BEGIN TRANSACTION;

    CREATE TABLE notification_reminder_deliveries_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prediction_round TEXT NOT NULL,
      reminder_hours INTEGER NOT NULL CHECK(reminder_hours IN (1, 9)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, prediction_round, reminder_hours)
    );

    INSERT INTO notification_reminder_deliveries_next (id, user_id, prediction_round, reminder_hours, created_at)
    SELECT id, user_id, prediction_round, reminder_hours, created_at
    FROM notification_reminder_deliveries
    WHERE reminder_hours IN (1, 9);

    DROP TABLE notification_reminder_deliveries;
    ALTER TABLE notification_reminder_deliveries_next RENAME TO notification_reminder_deliveries;

    COMMIT;

    PRAGMA foreign_keys = ON;
  `);
}

function ensureCompetitionScopedIndexes(db: Database.Database) {
  const matchColumns = db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>;
  const matchColumnNames = new Set(matchColumns.map((column) => column.name));
  const liveScoreColumns = db.prepare('PRAGMA table_info(live_score_job_runs)').all() as Array<{ name: string }>;
  const liveScoreColumnNames = new Set(liveScoreColumns.map((column) => column.name));
  const reminderAttemptColumns = db.prepare('PRAGMA table_info(notification_reminder_attempts)').all() as Array<{ name: string }>;
  const reminderAttemptColumnNames = new Set(reminderAttemptColumns.map((column) => column.name));

  if (matchColumnNames.has('competition_id')) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS matches_competition_match_number_unique ON matches(competition_id, match_number)');
    db.exec('CREATE INDEX IF NOT EXISTS matches_competition_id_index ON matches(competition_id)');
  }

  if (liveScoreColumnNames.has('competition_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS live_score_job_runs_competition_id_index ON live_score_job_runs(competition_id)');
  }

  if (reminderAttemptColumnNames.has('competition_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS notification_reminder_attempts_competition_id_index ON notification_reminder_attempts(competition_id)');
  }
}

function ensureCompetitionNotificationBrowsers(db: Database.Database) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'competition_notification_browsers'").get()) return;
  db.transaction(() => {
    db.exec(`CREATE TABLE competition_notification_browsers (
      competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (competition_id, user_id, subscription_id)
    );
    INSERT INTO competition_notification_browsers (competition_id, user_id, subscription_id)
      SELECT p.competition_id, p.user_id, s.id
      FROM competition_notification_preferences p
      JOIN notification_subscriptions s ON s.user_id = p.user_id AND s.is_enabled = 1
      WHERE p.enabled = 1;`);
  })();
}
