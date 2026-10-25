# Back up and restore Answerline

Run these commands from the repository root with Docker Compose and rclone
installed. Schedule a maintenance window: the consistent snapshot below stops
calls and dashboard writes until the backup finishes.

Configure an rclone remote named `recordings` for your recording store. Use the
S3 API endpoint and a credential scoped to the bucket. For R2, follow
[Cloudflare's rclone setup](https://developers.cloudflare.com/r2/examples/rclone/).
Keep rclone credentials and backup encryption keys outside Git.

Define the Compose command and set the bucket name to your `S3_BUCKET`:

```sh
dc() { docker compose --env-file .env.production -f docker-compose.production.yml "$@"; }
recordings_bucket=recordings
```

## Create a consistent snapshot

1. Stop new calls, drain the agent, then stop dashboard and worker writes:

   ```sh
   dc stop caddy sip
   dc stop agent
   dc stop web worker
   dc logs --tail 100 egress
   ```

   Confirm every active recording has finished uploading before proceeding.
   Egress logs report `egress_complete` when a recording finishes; investigate
   failures before taking the snapshot. The agent has a 20-minute stop grace
   period. If a process is killed before draining, resolve unfinished calls and
   uploads before treating the backup as complete.

2. Stop the remaining queue/media writers and Redis. Keep Postgres running:

   ```sh
   dc stop egress livekit redis
   umask 077
   backup_dir=".data/backups/$(date -u +%Y%m%dT%H%M%SZ)"
   mkdir -p "$backup_dir"
   dc exec -T postgres pg_dump -U answerline -d answerline --format=custom > "$backup_dir/postgres.dump"
   dc run --rm --no-deps -T --entrypoint tar redis -C /data -cf - . > "$backup_dir/redis.tar"
   dc run --rm --no-deps -T --entrypoint tar worker -C /app/.data/knowledge -cf - . > "$backup_dir/knowledge.tar"
   dc run --rm --no-deps -T --entrypoint tar caddy -C /data -cf - . > "$backup_dir/caddy.tar"
   install -m 600 .env.production "$backup_dir/environment"
   git rev-parse HEAD > "$backup_dir/commit"
   dc images --format json > "$backup_dir/images.json"
   ```

   The Redis archive contains the whole stopped data directory, including the
   append-only log and its manifest. Copying only `dump.rdb` can lose queued jobs
   because this stack enables AOF. Knowledge files live outside Postgres and
   include uploaded ingestion sources. The Caddy archive contains private
   certificate keys. The environment snapshot contains provider and auth secrets.

3. Copy recordings without deleting existing backup data, then verify contents:

   ```sh
   rclone copy "recordings:$recordings_bucket" "$backup_dir/recordings"
   rclone check --download "recordings:$recordings_bucket" "$backup_dir/recordings"
   dc exec -T postgres pg_restore --list < "$backup_dir/postgres.dump" > "$backup_dir/postgres.contents"
   ```

   `--download` compares file contents instead of relying on provider checksum
   support. It reads the recordings again. Resolve any mismatch before accepting
   the snapshot. Keep object keys intact: calls store `s3://<bucket>/<key>`.

4. Restart the stack and verify health:

   ```sh
   dc up -d --no-build --wait
   dc ps
   ```

Copy the completed snapshot to separate, encrypted backup storage with restricted
access. A backup on the same VPS does not survive loss of that VPS. Retain dated
snapshots according to your call-data retention policy, and test restores
regularly. For a failed backup, restore service with the restart command above
and keep the incomplete snapshot separate from verified backups.

## Restore into a fresh deployment

Use fresh named volumes and the recorded application commit/image version.
Restore with the same Postgres and Redis major versions before upgrading.
For locally built images, also retain their full source changes or an image
archive; a commit ID does not capture uncommitted customizations.
Do not run startup migrations or the application against the empty target first.
Do not extract these archives over a running deployment or reuse an existing
Redis data directory.

1. Retrieve and decrypt the snapshot on the replacement host. Check out its
   recorded commit, then restore the environment with private permissions:

   ```sh
   backup_dir=/path/to/verified/snapshot
   install -m 600 "$backup_dir/environment" .env.production
   ```

   Adjust domains and public IP if the host changed. Configure the rclone remote
   for the target store. Preserve the bucket name and object keys so existing
   recording locations remain valid. Changing the bucket name requires a
   separate database metadata migration; changing only the endpoint does not.
   Keep the existing auth secret so restored sessions remain valid.

2. Rebuild the application images from the recorded source commit and any saved
   local changes:

   ```sh
   dc build
   ```

   If the snapshot records a pinned published version, set `ANSWERLINE_VERSION`
   to that exact tag in `.env.production` and use `dc pull` instead. The example
   environment leaves this variable unset, which means `latest`; do not pull
   `latest` during a restore. Checking out an old commit alone does not pin
   registry images. Authenticate Docker before pulling private packages.
   Restore volumes before starting their services:

   ```sh
   dc run --rm --no-deps -T --entrypoint tar redis -C /data -xf - < "$backup_dir/redis.tar"
   dc run --rm --no-deps -T --entrypoint sh worker -c 'tar -C /app/.data/knowledge -xf - && chown -R 1000:1000 /app/.data/knowledge' < "$backup_dir/knowledge.tar"
   dc run --rm --no-deps -T --entrypoint tar caddy -C /data -xf - < "$backup_dir/caddy.tar"
   dc up -d --wait postgres
   dc exec -T postgres pg_restore -U answerline -d answerline --exit-on-error --no-owner --no-acl < "$backup_dir/postgres.dump"
   rclone copy "$backup_dir/recordings" "recordings:$recordings_bucket"
   rclone check --download "$backup_dir/recordings" "recordings:$recordings_bucket"
   ```

   Use an empty recording bucket for a point-in-time replacement. `rclone copy`
   does not delete newer objects from an existing bucket. Set the target S3
   endpoint in the environment before starting Egress or the web service.

3. Start the restored stack:

   ```sh
   dc up -d --no-build --wait
   dc ps
   ```

   Initialization applies the recorded version's migrations and preserves
   restored agent settings and administrator credentials. Redis resumes queued
   work from the restored log.

4. Before switching DNS or resuming calls, verify administrator login, agent
   settings, call/transcript counts, knowledge sources, queued jobs, and recording
   playback. Check Egress and worker logs for errors, then make a test call.
   Keep the previous deployment stopped so two workers cannot process the same
   restored work independently.

See PostgreSQL's [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) references and
[rclone check](https://rclone.org/commands/rclone_check/) for command details.
