# Recording

Call recording is off by default and opt-in per agent.

## Enable it

In the agent YAML (or the same shape in the database config):

```yaml
recording:
  enabled: true
  notice: "This call may be recorded for quality and training purposes."
```

`notice` is optional and defaults to the sentence above. When `enabled` is true the agent starts the recording, then speaks the notice, then the greeting. If the recording cannot be started, the failure is logged, the notice is skipped, and the call continues unrecorded. When `enabled` is false nothing is recorded and no egress request is made.

## How it works

The agent asks LiveKit Egress for an audio-only room composite (caller and agent mixed into one Ogg/Opus file). Without a layout this takes the SDK path and does not launch Chrome, so LiveKit budgets it at 0.5 CPU per active recording (a Chrome-based composite is budgeted at 3).

Files land in the `recordings` bucket at `<tenant>/<room_name>.ogg`. `call.ended` carries `recording_url` as `s3://<bucket>/<tenant>/<room_name>.ogg`, and the worker stores it in `calls.recording_url`. The URL is reported as soon as egress starts, so a call that failed mid-recording can point at a missing or partial object.

## Storage

`pnpm infra:up` starts MinIO, creates the bucket, and starts the egress worker. Egress holds the storage credentials; the agent only needs `S3_BUCKET`.

| | |
|---|---|
| S3 API | `http://localhost:9000` |
| Console | `http://localhost:9001` |
| Dev credentials | `answerline` / `answerline-secret` |
| Bucket | `recordings` |

Override the `S3_*` and `MINIO_*` variables in `.env` (see `.env.example`). To use AWS S3 or any other S3-compatible store, point the `egress` service's `storage.s3` block at it instead of MinIO. The dev credentials are for local use only.

## Consent

Recording laws vary by country and state, and many require consent from every party. The default notice is a starting point, not legal advice. Set `notice` to what your jurisdiction requires, and check retention and access rules for stored recordings.
