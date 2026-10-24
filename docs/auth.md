# Authentication

Answerline uses Better Auth with database-backed sessions. Dashboard pages and `/api/v1/*` require a signed-in operator. The landing page, health check, and sign-in page remain public. Public registration is disabled for both email/password and GitHub OAuth.

All provisioned operators can manage the configured `TENANT`. Workspace membership and roles remain M9 work. A session does not select a tenant from a request parameter.

## First administrator

`pnpm bootstrap` and `pnpm admin:init` create an administrator only when the `users` table is empty. The default email is `admin@answerline.local`; set `ADMIN_EMAIL` to change it. Set `ADMIN_PASSWORD` to use an operator-selected password of at least 12 characters. Otherwise, a random password is written to `.data/admin-credentials` with owner-only permissions. The initializer prints the file path, never the password. The file is ignored by Git; retrieve it securely and remove it after use.

The initializer sets `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in the root `.env` when they are missing, preserving existing settings. The URL defaults to `http://localhost:$PORT`. It marks the initial email verified only when `ADMIN_EMAIL_VERIFIED=true` is explicitly set by the operator. This setting attests that the operator controls the configured email; it does not send a verification email.

Initialization is safe to rerun. It will not create another user or change credentials once any user exists. It provisions the Better Auth user and credential account directly in Postgres.

## Configure sign-in

Set `DATABASE_URL`, apply migrations with `pnpm db:migrate`, and seed the configured tenant with `pnpm db:seed`.

Set `BETTER_AUTH_URL` to the exact origin where operators open the dashboard, including the port in development. Set `BETTER_AUTH_SECRET` to a persistent random value of at least 32 characters. For example, generate a value with `openssl rand -base64 48` and save it in your deployment environment. Restart the web process after changing its configuration.

Open `/login` and use an operator account provisioned by the administrator. This auth implementation does not expose an account-registration endpoint to create operators.

The sign-out control in the dashboard header revokes the database session. Revoked and expired sessions cannot access the dashboard APIs. Cookie caching is disabled, so authorization checks read the current database session.

## Enable optional GitHub sign-in

Email/password works without a GitHub application. To add GitHub sign-in:

1. Create a GitHub OAuth application and set its callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github`.
2. Set both `AUTH_GITHUB_CLIENT_ID` and `AUTH_GITHUB_CLIENT_SECRET`, then restart the web process.
3. Provision the operator locally first and verify their email ownership before marking the local account verified. Use the same email address on GitHub. GitHub must report that address as verified.

GitHub sign-in links only to an existing verified local account with a matching verified provider email. It cannot create a new user, even when the caller explicitly requests signup. An unverified local account or GitHub address cannot be linked implicitly. The provider uses the `user:email` scope to check email ownership.

Live GitHub callbacks require your own OAuth credentials. Automated tests simulate the provider responses while running the actual Better Auth callback and database flow.

## Database records

The schema in `packages/db/src/schema.ts` stores the four core Better Auth records:

| Export | SQL table | Purpose |
| --- | --- | --- |
| `users` | `users` | Display name, unique email, verification state, and optional image |
| `sessions` | `sessions` | Unique session token, expiry, optional request metadata, and user reference |
| `accounts` | `accounts` | Credential password hash or OAuth provider identity and optional tokens |
| `verifications` | `verifications` | Identifier, value, expiry, and timestamps for verification flows |

All IDs are UUIDs. SQL column names use snake_case; TypeScript properties retain Better Auth's names. Accounts and sessions cascade on user deletion. Provider/account pairs are unique. Verification records are independent of users and may share an identifier.

`apps/web/src/lib/auth/config.ts` maps these exports to Better Auth and enables UUID generation. `apps/web/src/lib/auth/server.ts` creates the runtime lazily. Operator provisioning can use `hashPassword` from `better-auth/crypto` to create a credential account directly without opening public registration.

## Authorization boundaries

The Next.js proxy validates database sessions for every `/api/v1/*` request and protected dashboard page. It returns 401 for signed-out API requests and redirects signed-out page requests to `/login`. It rejects cross-origin mutations. Non-browser clients may send a valid session cookie without an Origin header. Browser clients must use the configured origin. Auth endpoints retain Better Auth's own origin and OAuth state checks.

Server data access uses `getDashboardContext()` from `@/lib/dashboard/context`, returning the authenticated user, database, and configured tenant ID. Request handlers can use `DashboardAuthError` and `dashboardErrorResponse` from `@/lib/dashboard/errors` to return a 401 for signed-out callers. Sensitive reads are not placed in a shared cache.

Server Component session reads do not refresh session expiry. The proxy handles refreshes for full document requests and forwards the updated cookie; API requests use the same proxy path. This keeps the database expiry and browser cookie expiry aligned.

## Verification

With `DATABASE_URL` set and migrations applied, `pnpm --filter @answerline/web test` checks closed registration, provisioned credential sign-in, revoked and expired sessions, cross-origin mutations, session renewal, and allowed or rejected GitHub account linking. `pnpm --filter @answerline/db test` checks persistence, uniqueness, foreign keys, and cascades.

Apply the schema with `pnpm db:migrate`. The migration adds tables without creating users. Run `pnpm admin:init` after migrations to provision the first administrator.

References: [Better Auth core schema](https://better-auth.com/docs/concepts/database), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), and [GitHub provider setup](https://better-auth.com/docs/authentication/github).
