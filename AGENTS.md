# Predictor26 Working Notes

This file is the project memory for future Codex work. Keep it current when architecture decisions change.

## Stack

- Frontend: Angular 21 standalone components in `apps/web`.
- Backend: Express 5 with TypeScript in `apps/api`.
- Database: SQLite, accessed through a dedicated database layer.
- Root package: npm workspaces for `apps/web` and `apps/api`.

## Frontend Architecture

The Angular app follows the structure from `C:\Users\hrvoj\dekod\event-discovery\entrio-frontend`.

Use this shape:

- `app/core`: app-wide singleton logic and infrastructure.
- `app/core/constants`: stable app constants.
- `app/core/guards`: route guards.
- `app/core/interceptors`: HTTP interceptors.
- `app/core/models`: shared frontend interfaces and types.
- `app/core/providers`: Angular provider factory functions.
- `app/core/resolvers`: route resolvers.
- `app/core/services`: signal-owning app services.
- `app/core/services/providers`: low-level API provider classes. HTTP calls belong here.
- `app/core/state`: reusable signal state primitives or app-wide state services.
- `app/core/strategies`: Angular strategies such as route reuse.
- `app/environments`: environment-specific frontend config.
- `app/features`: routed product features. Prefer lazy-loaded standalone components.
- `app/layout`: shell-level layout such as header, footer, nav.
- `app/shared`: reusable presentation and utilities with no feature ownership.
- `app/shared/components`: reusable UI components.
- `app/shared/directives`: reusable directives.
- `app/shared/pipes`: reusable pipes.
- `app/shared/tokens`: Angular injection tokens.
- `app/shared/utils`: pure frontend utility functions.

Frontend path aliases:

- `@core/*` -> `app/core/*`
- `@services/*` -> `app/core/services/*`
- `@guards/*` -> `app/core/guards/*`
- `@interceptors/*` -> `app/core/interceptors/*`
- `@models/*` -> `app/core/models/*`
- `@features/*` -> `app/features/*`
- `@shared/*` -> `app/shared/*`
- `@environments/*` -> `app/environments/*`

Frontend conventions:

- Prefer standalone components and lazy feature routes.
- Prefer signals for component and service state.
- Display match kickoffs and prediction deadlines in the viewer's device timezone using Angular's DatePipe without a fixed offset. Never hardcode UTC+2: local offsets depend on daylight saving for the displayed date. Keep stored UTC timestamps and countdown/locking comparisons independent of display formatting.
- Prefer reactive forms (`ReactiveFormsModule`, `FormBuilder`, and `formControlName`) for Angular forms. Avoid template-driven forms and `ngModel` unless there is a specific, justified need.
- Services own writable signals privately and expose readonly state.
- `AppStateService` in `app/core/state` is the frontend source of truth for auth session state. It stores the login token and user in `localStorage` so refreshes keep the user logged in, and logout must clear that stored session.
- API-specific HTTP methods should live in provider classes under `core/services/providers`.
- Feature components orchestrate UI and call services; they should not contain raw endpoint strings or query mapping.
- Avoid calling component methods directly from Angular templates except for event actions. Derive display values, booleans, labels, and classes through signals/computed view models so change detection does not repeatedly execute template methods.
- Shared components should be reusable and avoid domain-specific data fetching.
- The header drawer owns account/competition navigation, Rules, and Logout. Home and header share `PredictionSummaryService` for the next open round and missing-prediction count, plus the shared `prediction-action-icon` and `prediction-count-badge` components. Keep these displays consistent rather than duplicating badge logic or icon styles.
- Competition Settings is a lazy-loaded `/competition/:slug/settings` route protected by the auth and competition slug guards. Its cog link is third in the competition drawer section, after Rankings (the competition home page) and Match Day, followed by Stats. It contains per-user notification preferences and browser setup. Preference APIs use an explicit competition ID, derive the user from authentication, and validate competition access server-side.
- Use `app/shared/components/modal-shell` for modal backdrop, panel layout, and enter/leave animation. Modal content components should project inside that shell instead of redefining modal positioning or animation CSS. Add modal padding inside the projected modal content component, not in `modal-shell`, so existing modals do not receive accidental extra spacing.
- Use the existing admin edit icon pattern for small edit actions: a 24px button with `border: 0`, `border-radius: 6px`, `background: #f3f4f6`, `color: #374151`, hover/focus `background: #e5e7eb`, and the pencil entity inside `<span aria-hidden="true">&#9998;</span>`. Keep this consistent instead of creating new edit icon variants.
- Avoid viewport-unit height/layout sizing such as `vh`, `dvh`, `svh`, `lvh`, `vw`, and similar units unless there is a specific, justified need. Prefer natural document flow, content-based sizing, flex/grid behavior, and explicit component spacing so empty pages do not create layout shift or unwanted scrollbars.

## Backend Architecture

Mirror the frontend separation with clear backend layers:

- `src/index.ts`: process entrypoint only.
- `src/config`: environment parsing and typed runtime config.
- `src/database`: SQLite connection setup and database bootstrap.
- `src/database/migrations`: schema migration files or migration runners.
- `src/database/queries`: SQL/query helpers. Raw SQL belongs here, not in routes.
- `src/modules`: feature modules. Each module owns its route, controller, service, repository, and interfaces.
- `src/shared/constants`: backend-wide constants.
- `src/shared/errors`: typed application errors and error mapping.
- `src/shared/interfaces`: cross-module request, response, and DTO interfaces.
- `src/shared/middleware`: Express middleware.
- `src/shared/utils`: pure backend utilities.

Recommended module shape:

```text
src/modules/<feature>/
  <feature>.routes.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.repository.ts
  <feature>.interfaces.ts
```

Backend conventions:

- Routes define HTTP paths and middleware only.
- Controllers translate HTTP requests/responses and call services.
- Services own business rules and transaction boundaries.
- Repositories call database query helpers and map rows to domain objects.
- User roles are `super_admin`, `admin`, and `user`. The seeded `super_admin` account is created during database bootstrap if missing, and future admin promotion should update a normal user's role to `admin`.
- Interfaces/DTOs live beside the feature when feature-specific, or in `shared/interfaces` when reused.
- SQL and SQLite-specific details stay in `database/queries` or repositories, never in controllers.
- Keep endpoint response interfaces explicit so the Angular API providers can import or mirror stable contracts later.
- Imported match batches use `matches.released_for_predictions` as the curation gate. User-facing match endpoints must only expose released matches, and prediction saves must reject unreleased matches. Admin match endpoints can see unreleased matches so admins can complete missing data and release a round.
- Competition-level auto match import is configured on competition settings and runs server-side from the admin matches service scheduler. It imports fixtures and odds together, validates the imported round, and only releases it automatically when all required teams are present, match details are complete, and odds exist for every match.

## Notification Preferences

- `competition_notification_preferences` is keyed by `(competition_id, user_id)`. Missing rows mean `enabled`, `reminder9h`, and `reminder1h` are all false. Startup only creates the table if absent; never seed or reset opted-in values on deployment.
- Push endpoints are browser/device records; `notification_subscriptions.user_id` is the last logged-in recipient, independent of saved competition associations. Turning both reminder timings off clears browser associations for that user and competition transactionally, without unsubscribing browsers globally or affecting other competitions. Re-enabling registers only the current browser; other browsers must be added explicitly again. Settings shows only 1h and 9h switches that auto-save. Turning one on automatically registers this browser (requesting permission from that click if needed); the arrival drawer and its local-storage decisions were removed.
- Delivery requires the competition admin switch, an active/non-archived competition, verified membership, the internal enabled state (derived from either timing being on), the selected 9h/1h timing, and an enabled subscription registered for that competition. Completed predictions still receive the selected reminder with completion wording.
- Reminder queries exclude unreleased/postponed matches and share prediction-round naming with the matches service. Notification tags include competition and user IDs; click targets point to that competition. Push TTL ends at the deadline.
- Browser associations live in `competition_notification_browsers`. Show browser/OS names below the two switches; offer Add this browser on an unregistered browser when reminders are on. Allow removal only with more than one active browser, enforced transactionally in the API. Preserve prior explicit opt-ins on first table creation; never re-add removed browsers on restart.
- Login (including restored sessions) synchronizes an existing browser subscription without requesting permission or opting in. Logout preserves the last recipient. Saved competition/browser associations survive account switches; only the last recipient can receive on that endpoint. The service worker persists/checks the recipient in Cache Storage and drops mismatched queued pushes. Older tabs cannot reclaim the endpoint; login and setup requests serialize across tabs with Web Locks when available. Failed synchronization retries on focus/online.
- Due reminders for a different recipient are permanently recorded per competition/user/browser/round/timing in `notification_reminder_skips`; switching back does not replay them. Other devices and future rounds remain eligible.
- Jobs serialize per competition. Failed sends can retry within the existing 10-minute due window (60-second cooldown, at most three attempts per subscription); accepted reminders are not repeated. Admin tests require competition admin access, bypass preference switches, and do not change preferences or disable other devices.
- See `docs/NOTIFICATIONS.md` for rollout and validation. Backend notification tests use a temporary SQLite database and mocked push transport.

## Current Boundary

This repository currently has only a starter health endpoint and architecture scaffolding. Future work should add product features inside the layer structure above rather than expanding files at the root.
