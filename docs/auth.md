# Authentication persistence

M5 uses Better Auth, as decided in #128. The database foundation is tracked in #244 under #73. Sign-in endpoints, dashboard protection, and optional OAuth configuration remain planned. First-run administrator provisioning is separate work in #74.

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

The database package includes Better Auth and its Drizzle adapter as development dependencies for compatibility testing. They are not production dependencies of the database package.

## Verification

With `DATABASE_URL` set and migrations applied, `pnpm --filter @answerline/db test` exercises the real adapter through credential sign-up, failed and successful sign-in, session lookup, and sign-out. Database tests also cover identity uniqueness, OAuth fields, verification records, foreign keys, and deletion cascades.

Apply the schema with `pnpm db:migrate`. This migration adds tables and does not create users, issue credentials, or enable login. The first-run administrator and web auth flows remain pending.

References: [Better Auth core schema](https://better-auth.com/docs/concepts/database) and [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
