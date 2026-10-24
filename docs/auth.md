# Authentication persistence

M5 uses Better Auth, as decided in #128. The database foundation is tracked in #244 under #73. First-run administrator provisioning is tracked in #74. Sign-in endpoints, dashboard protection, and optional OAuth configuration remain planned.

## First administrator

`pnpm bootstrap` and `pnpm admin:init` create an administrator only when the `users` table is empty. The default email is `admin@answerline.local`; set `ADMIN_EMAIL` to change it. Set `ADMIN_PASSWORD` to use an operator-selected password of at least 12 characters. Otherwise, a random password is written to `.data/admin-credentials` with owner-only permissions. The initializer prints the file path, never the password. The file is ignored by Git; retrieve it securely and remove it after use.

The initializer sets `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in the root `.env` when they are missing, preserving existing settings. The URL defaults to `http://localhost:$PORT`. It marks the initial email verified only when `ADMIN_EMAIL_VERIFIED=true` is explicitly set by the operator. This setting attests that the operator controls the configured email; it does not send a verification email.

Initialization is safe to rerun. It will not create another user or change credentials once any user exists. It provisions the Better Auth user and credential account directly in Postgres; interactive sign-in is delivered by the web auth implementation.

## Tables

The schema in `packages/db/src/schema.ts` defines Better Auth's four core records:

| Export | SQL table | Purpose |
| --- | --- | --- |
| `users` | `users` | Display name, unique email, verification state, and optional image |
| `sessions` | `sessions` | Unique session token, expiry, optional request metadata, and user reference |
| `accounts` | `accounts` | Credential password hash or OAuth provider identity and optional tokens |
| `verifications` | `verifications` | Identifier, value, expiry, and timestamps for verification flows |

All IDs are UUIDs. SQL column names use snake_case; TypeScript properties retain Better Auth's names. Timestamps include a timezone. Accounts and sessions reference users and cascade on user deletion. Provider/account pairs are unique. Verification records have no user reference because verification can precede user creation; multiple records may share an identifier.

Users are independent of tenant membership. M9 will define workspace membership and permissions. These tables alone do not authorize access to a tenant.

## Adapter configuration for the auth implementation

The follow-up web auth implementation must map the plural exports to Better Auth's model names and generate UUIDs:

```ts
import { accounts, sessions, users, verifications } from "@answerline/db";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

const auth = betterAuth({
	advanced: { database: { generateId: "uuid" } },
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			account: accounts,
			session: sessions,
			user: users,
			verification: verifications,
		},
		transaction: true,
	}),
});
```

This fragment assumes the caller supplies `db` and the remaining auth configuration, including the secret and application URL. It does not create an active auth service. Password hashing, email normalization, session expiry enforcement, token handling, and verification policy belong to Better Auth and its configuration.

The database package includes Better Auth and its Drizzle adapter for compatibility testing and initial administrator password hashing.

## Verification

With `DATABASE_URL` set and migrations applied, `pnpm --filter @answerline/db test` exercises the real adapter through credential sign-up, failed and successful sign-in, session lookup, and sign-out. Database tests also cover identity uniqueness, OAuth fields, verification records, foreign keys, and deletion cascades.

Apply the schema with `pnpm db:migrate`. The migration adds tables without creating users. Run `pnpm admin:init` after migrations to provision the first administrator.

References: [Better Auth core schema](https://better-auth.com/docs/concepts/database) and [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
