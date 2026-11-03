# Deploy with Docker Compose

Run the full stack on one server with `docker-compose.production.yml`: web, worker, voice agent, Postgres with pgvector, Redis, LiveKit, LiveKit SIP, Egress, and Caddy for HTTPS.

## Before you start

You need:

- A server with a public IPv4 address, Docker, and the Compose plugin
- Three hostnames pointing at that address: the dashboard, LiveKit, and TURN
- S3-compatible object storage reachable from the server, such as Cloudflare R2. The stack does not include MinIO, and Compose requires these settings even if no agent records calls. See [recording storage](recordings.md).
- API keys for the models your agents use. The sample agent needs Deepgram, Cartesia, and OpenRouter, with OpenAI and Google as LLM fallbacks. Knowledge base embeddings use Google by default.

Open these ports in the host and cloud firewalls:

| Port | Protocol | Used for |
|---|---|---|
| 80, 443 | TCP | HTTPS, certificate issuance, and TURN over TLS |
| 7881 | TCP | WebRTC over TCP |
| 50000-50100 | UDP | WebRTC media |
| 3478 | UDP | TURN |
| 5060 | UDP and TCP | SIP signaling (phone calls only) |
| 10000-10100 | UDP | SIP media (phone calls only) |

## Configure

```sh
git clone https://github.com/khantseithu/answerline.git
cd answerline
cp .env.production.example .env.production
```

Fill in `.env.production`:

- Set `APP_DOMAIN`, `LIVEKIT_DOMAIN`, and `TURN_DOMAIN` to your hostnames, and `SIP_PUBLIC_IP` to the server's public IPv4 address.
- Run `openssl rand -hex 32` once each for `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
- Set `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters.
- Set the `S3_*` values and the keys for the providers you use. You can leave other provider keys empty.

The [environment reference](environment.md) covers every setting, including optional ones.

Check the file. This confirms the required values are present, but not that your credentials, DNS, or firewall work:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
```

## Start

```sh
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait
```

This builds the images from your checkout. The `migrate` service applies database migrations, creates any missing default agents without overwriting your edits, and creates the first administrator. Then the other services start. Caddy requests certificates for all three hostnames.

To use published images instead of building, follow [container images](images.md).

## Verify

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl https://$APP_DOMAIN/api/health
```

Replace `$APP_DOMAIN` with your dashboard hostname. Open that hostname in a browser, sign in as the administrator, and click **Talk to agent**.

If a call can't connect, check the `agent` and `livekit` logs with `docker compose ... logs`, then check the firewall ports above.

To answer phone calls, [connect a phone number](../telephony.md).

## Upgrade

[Back up the database and knowledge files](backups.md) first, because migrations run automatically and aren't reversible by rolling back an image. Then:

```sh
git pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait
```

Active calls keep the old agent container running for up to 20 minutes while they finish.

## More

- [Production LiveKit](livekit.md)
- [Recording storage](recordings.md)
- [Backups and restore](backups.md)
- [Environment reference](environment.md)
