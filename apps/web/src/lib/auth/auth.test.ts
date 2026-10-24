import assert from "node:assert/strict";
import { test } from "node:test";
import { accounts, createDb, sessions, users } from "@answerline/db";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendAuthCookies, guardApiRequest } from "./access.ts";
import { createAuth } from "./config.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const baseURL = "http://localhost:3010";

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

function authRequest(path: string, body: unknown) {
  return new Request(`${baseURL}/api/auth/${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: baseURL },
    method: "POST",
  });
}

test("only provisioned credentials can sign in and revoked or expired sessions fail the API guard", {
  skip,
}, async () => {
  const db = createDb();
  const email = `auth-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const auth = createAuth(db, { baseURL, secret: crypto.randomUUID() });
  try {
    const registration = await auth.handler(
      authRequest("sign-up/email", { email, name: "Public user", password })
    );
    assert.equal(registration.status, 400);
    assert.deepEqual(await db.select().from(users).where(eq(users.email, email)), []);
    const [user] = await db.insert(users).values({ email, name: "Operator" }).returning();
    assert.ok(user);
    await db.insert(accounts).values({
      accountId: user.id,
      password: await hashPassword(password),
      providerId: "credential",
      userId: user.id,
    });
    const invalid = await auth.handler(
      authRequest("sign-in/email", { email, password: crypto.randomUUID() })
    );
    assert.equal(invalid.status, 401);
    const signIn = await auth.handler(authRequest("sign-in/email", { email, password }));
    assert.equal(signIn.status, 200);
    const cookie = cookieHeader(signIn);
    assert.ok(cookie);
    const [sessionBeforeRenewal] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    assert.ok(sessionBeforeRenewal);
    const previousExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ expiresAt: previousExpiry })
      .where(eq(sessions.id, sessionBeforeRenewal.id));
    const renewedSession = await auth.api.getSession({
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    assert.ok(renewedSession.response);
    assert.ok(
      renewedSession.headers
        .getSetCookie()
        .some((value) => value.includes("better-auth.session_token") && value.includes("Max-Age"))
    );
    const forwardedHeaders = new Headers();
    appendAuthCookies(renewedSession.headers, forwardedHeaders);
    assert.deepEqual(forwardedHeaders.getSetCookie(), renewedSession.headers.getSetCookie());
    const [sessionAfterRenewal] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionBeforeRenewal.id));
    assert.ok(sessionAfterRenewal);
    assert.ok(sessionAfterRenewal.expiresAt > previousExpiry);
    const resolveSession = (headers: Headers) => auth.api.getSession({ headers });
    const apiRequest = (headers: HeadersInit = {}) =>
      new Request(`${baseURL}/api/v1/knowledge`, { headers });
    assert.equal((await guardApiRequest(apiRequest(), resolveSession, baseURL))?.status, 401);
    assert.equal(
      (
        await guardApiRequest(
          apiRequest({ cookie: "better-auth.session_token=forged" }),
          resolveSession,
          baseURL
        )
      )?.status,
      401
    );
    assert.equal(await guardApiRequest(apiRequest({ cookie }), resolveSession, baseURL), undefined);
    assert.equal(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id,
      user.id
    );
    const crossOrigin = new Request(`${baseURL}/api/v1/knowledge`, {
      headers: { cookie, origin: "https://other.example" },
      method: "POST",
    });
    assert.equal((await guardApiRequest(crossOrigin, resolveSession, baseURL))?.status, 403);
    const crossSite = new Request(`${baseURL}/api/v1/knowledge`, {
      headers: { cookie, "sec-fetch-site": "cross-site" },
      method: "DELETE",
    });
    assert.equal((await guardApiRequest(crossSite, resolveSession, baseURL))?.status, 403);
    const sameOrigin = new Request(`${baseURL}/api/v1/knowledge`, {
      headers: { cookie, origin: baseURL },
      method: "POST",
    });
    assert.equal(await guardApiRequest(sameOrigin, resolveSession, baseURL), undefined);
    const signOut = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-out`, {
        headers: { cookie, origin: baseURL },
        method: "POST",
      })
    );
    assert.equal(signOut.status, 200);
    assert.equal(
      (await guardApiRequest(apiRequest({ cookie }), resolveSession, baseURL))?.status,
      401
    );
    const again = await auth.handler(authRequest("sign-in/email", { email, password }));
    const expiredCookie = cookieHeader(again);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.userId, user.id));
    assert.equal(
      (await guardApiRequest(apiRequest({ cookie: expiredCookie }), resolveSession, baseURL))
        ?.status,
      401
    );
  } finally {
    await db.delete(users).where(eq(users.email, email));
    await db.$client.end();
  }
});

for (const scenario of [
  {
    allowed: true,
    local: true,
    localVerified: true,
    name: "links a provisioned verified account",
    providerVerified: true,
  },
  {
    allowed: false,
    local: false,
    localVerified: false,
    name: "rejects a new GitHub user even with explicit signup",
    providerVerified: true,
  },
  {
    allowed: false,
    local: true,
    localVerified: false,
    name: "rejects linking to an unverified local account",
    providerVerified: true,
  },
  {
    allowed: false,
    local: true,
    localVerified: true,
    name: "rejects an unverified GitHub email",
    providerVerified: false,
  },
]) {
  test(`GitHub OAuth ${scenario.name}`, { skip }, async (context) => {
    const db = createDb();
    const email = `oauth-${crypto.randomUUID()}@example.com`;
    const auth = createAuth(db, {
      baseURL,
      github: { clientId: crypto.randomUUID(), clientSecret: crypto.randomUUID() },
      secret: crypto.randomUUID(),
    });
    context.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve(
          Response.json({ access_token: crypto.randomUUID(), token_type: "bearer" })
        );
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve(
          Response.json({
            avatar_url: null,
            email,
            id: 12_345,
            login: "test-operator",
            name: "Test Operator",
          })
        );
      }
      if (url === "https://api.github.com/user/emails") {
        return Promise.resolve(
          Response.json([{ email, primary: true, verified: scenario.providerVerified }])
        );
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    });
    try {
      if (scenario.local) {
        await db
          .insert(users)
          .values({ email, emailVerified: scenario.localVerified, name: "Provisioned Operator" });
      }
      const flow = await auth.handler(
        authRequest("sign-in/social", {
          callbackURL: "/overview",
          disableRedirect: true,
          errorCallbackURL: "/login?error=oauth",
          provider: "github",
          requestSignUp: true,
        })
      );
      assert.equal(flow.status, 200);
      const authorization = z.object({ url: z.url() }).parse(await flow.json());
      const state = new URL(authorization.url).searchParams.get("state");
      assert.ok(state);
      const callback = await auth.handler(
        new Request(
          `${baseURL}/api/auth/callback/github?code=provider-code&state=${encodeURIComponent(state)}`,
          { headers: { cookie: cookieHeader(flow) } }
        )
      );
      assert.equal(callback.status, 302);
      const target = new URL(callback.headers.get("location") ?? "", baseURL);
      assert.equal(target.pathname, scenario.allowed ? "/overview" : "/login");
      if (scenario.allowed) {
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader(callback) }),
        });
        assert.equal(session?.user.email, email);
      } else {
        assert.equal(
          await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(callback) }) }),
          null
        );
        assert.equal(
          (await db.select().from(users).where(eq(users.email, email))).length,
          scenario.local ? 1 : 0
        );
      }
    } finally {
      context.mock.restoreAll();
      await db.delete(users).where(eq(users.email, email));
      await db.$client.end();
    }
  });
}
