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

## Current Boundary

This repository currently has only a starter health endpoint and architecture scaffolding. Future work should add product features inside the layer structure above rather than expanding files at the root.
