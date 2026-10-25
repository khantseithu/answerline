# Configure production LiveKit

Use this guide to configure LiveKit for Answerline web and SIP calls. The root
Compose file currently starts LiveKit in development mode. This configuration
is a production template; it does not change that development service.

## Use the bundled production stack

`docker-compose.production.yml` runs the web, worker, agent, Postgres, Redis,
LiveKit, SIP, Egress, and Caddy together. Copy `.env.production.example` to
`.env.production` and fill every required value using the
[environment reference](environment.md). Generate the Postgres password,
LiveKit key/secret, and auth secret with `openssl rand -hex 32`; hex passwords
also avoid URL-encoding issues in the database URL. Set a separate administrator
password of at least 12 characters and your model provider keys.

Point `APP_DOMAIN`, `LIVEKIT_DOMAIN`, and `TURN_DOMAIN` at the VPS, set
`SIP_PUBLIC_IP` to its public IPv4 address, and configure external recording
storage as described in [recording storage](recordings.md). Keep public TCP
ports 80 and 443 available for Caddy. Open the RTC, TURN UDP, SIP, and RTP ports
listed below in the host and cloud firewalls.

```sh
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --wait
```

The `migrate` service applies migrations, creates missing default agents without
overwriting edits, and initializes the first administrator before web and worker
start. Persistent volumes hold the database, Redis state, knowledge files, and
Caddy certificates. The production stack has no MinIO service.
Use the [backup and restore procedure](backups.md) before upgrading or moving the stack.

Caddy obtains and renews certificates and routes the three domains on TCP 443.
It terminates TURN TLS and forwards private TCP traffic to LiveKit. This stack
generates LiveKit configuration from the deployment environment; it does not use
`infra/livekit/livekit.yaml` or require manually mounted TURN certificates.
The remaining configuration steps describe a separately managed LiveKit server.

## Prepare domains and certificates

1. Create DNS records for `livekit.example.com` and `turn.example.com` that point
   to your public server addresses. Disable HTTP-only CDN proxying for these
   records.
2. Obtain trusted certificates for both names. Terminate HTTPS for
   `livekit.example.com` at a reverse proxy that forwards HTTP and WebSocket
   requests to LiveKit on port 7880.
3. Reserve TCP port 443 for TURN on the TURN address. If HTTPS and TURN share one
   public IP, use a layer 4 proxy that routes TLS by SNI, passing TURN traffic
   through without terminating TLS. A normal HTTP reverse proxy cannot route TURN.
   Alternatively, give TURN a separate public IP. Do not bind two services to the
   same address and port.
4. Mount the TURN certificate chain and private key read-only at
   `/etc/livekit/certs/fullchain.pem` and `/etc/livekit/certs/privkey.pem` in the
   LiveKit container. Grant its runtime user read access. Renew the certificate
   before expiry and restart LiveKit to load the renewed files.

## Configure the server

1. Copy `infra/livekit/livekit.yaml` to an untracked deployment directory:

   ```sh
   mkdir -p .data/deploy
   cp infra/livekit/livekit.yaml .data/deploy/livekit.yaml
   ```

2. Set `turn.domain` to your TURN domain. Set `redis.address` to the private Redis
   address reachable from LiveKit. The template uses the Compose service name
   `redis`; do not publish Redis to the internet.
3. Generate an API key and a secret with `openssl rand -hex 16` and
   `openssl rand -hex 32`. Store them as `LIVEKIT_API_KEY` and
   `LIVEKIT_API_SECRET` in your deployment's secret environment. Supply the same
   pair to the web, worker, agent, SIP, and Egress services.
4. Supply LiveKit's `LIVEKIT_KEYS` environment variable as a YAML mapping:
   `LIVEKIT_KEYS="${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"`. LiveKit reads this
   variable directly. The YAML template contains no credentials and does not
   expand environment variable placeholders.
5. Mount the deployment config at `/etc/livekit/livekit.yaml` and start
   `livekit-server --config /etc/livekit/livekit.yaml`. Remove `--dev` from the
   production command. Mount the certificate files from the previous section.
6. Publish TCP 7881, UDP 3478, and UDP 50000–50100 directly to the same ports in
   the container. Route TURN TCP 443 to the container's TCP 443 through the
   dedicated address or layer 4 proxy. Keep port 7880 on the private network
   behind the HTTPS proxy. Open these ports in the host and cloud firewalls.

The template uses public-IP discovery through STUN. If the detected address is
incorrect, set `rtc.use_external_ip: false` and `rtc.node_ip` to your public IPv4
address. Keep NAT forwarding port-preserving. Do not configure `rtc.udp_port`
with this template: that setting replaces the configured UDP range.

Set Answerline's public `LIVEKIT_URL` to `wss://livekit.example.com`. The browser
must reach this URL, and the web server and agent must also be able to reach it.
SIP and Egress can use `ws://livekit:7880` on the private Compose network, with
the same API key and secret. Serve the dashboard over HTTPS so browsers permit
microphone access.

If a layer 4 load balancer terminates TURN TLS instead of passing it through,
set `turn.external_tls: true`, remove `cert_file` and `key_file`, and forward
unencrypted TCP to the configured `turn.tls_port`. Keep the advertised public
TURN port equal to `turn.tls_port`; Docker port mapping alone does not change
ICE candidates.

## Verify connectivity

1. Run `livekit-server --config /etc/livekit/livekit.yaml ports` inside the
   configured container. Confirm that the output matches your firewall rules.
2. Check the LiveKit startup logs for Redis connectivity, the public node IP,
   TURN listeners, and the absence of development-mode warnings.
3. Make an Answerline web call from a network outside the VPS. Confirm two-way
   audio and inspect the browser's WebRTC connection details.
4. Repeat from a network that permits only outbound TCP 443, blocking both UDP
   and direct ICE/TCP on 7881. Confirm that the selected connection uses the TURN
   TLS relay on port 443. Blocking UDP alone can select ICE/TCP instead. Loading
   the dashboard or connecting the WebSocket alone does not verify media
   connectivity.
5. For phone calls, also expose SIP signaling TCP/UDP 5060 and the configured SIP
   RTP range (the development default is UDP 10000–10100). Configure the SIP
   service's public IP separately; the LiveKit RTC range does not cover SIP RTP.

See the upstream [deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/),
[port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
and [configuration sample](https://github.com/livekit/livekit/blob/master/config-sample.yaml)
for additional networking options.
