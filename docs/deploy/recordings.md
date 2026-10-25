# Store recordings in Cloudflare R2

Use Cloudflare R2 as the production recording store. Answerline uses the S3 API
for uploads and private playback, so other S3-compatible providers use the same
adapter. MinIO in the root Compose file is for local development.

## Configure R2

1. Create a private R2 bucket, such as `answerline-recordings`.
2. Create an R2 S3 API token with object read and write access scoped to that
   bucket. Save its Access Key ID and Secret Access Key in your deployment's
   secret environment. Use the S3 credentials, not a Cloudflare bearer token.
3. Set the following variables, replacing the account ID and credentials:

   ```dotenv
   S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
   S3_EGRESS_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=answerline-recordings
   S3_ACCESS_KEY=YOUR_ACCESS_KEY_ID
   S3_SECRET_KEY=YOUR_SECRET_ACCESS_KEY
   ```

   For a jurisdiction-specific bucket, use the S3 endpoint shown by Cloudflare.
   Do not use an R2 public/custom domain as the S3 API endpoint.
4. Supply the S3 variables to the web service and Egress configuration. Supply
   `S3_BUCKET` to the agent so the recorded database location matches the upload
   bucket. Restart the services after changing storage settings.

The web adapter reads `S3_ENDPOINT`, signs a GET URL for the configured bucket,
and expires it after five minutes. The browser must be able to reach that
endpoint. Egress reads its upload endpoint from `S3_EGRESS_ENDPOINT` in the
Compose configuration. These endpoints can differ for local/private networks,
but they must address the same bucket in the same store.

For a separately deployed Egress service, configure these fields using your
secret environment or a private configuration file:

```yaml
storage:
  s3:
    access_key: YOUR_ACCESS_KEY_ID
    secret: YOUR_SECRET_ACCESS_KEY
    region: auto
    endpoint: https://ACCOUNT_ID.r2.cloudflarestorage.com
    bucket: answerline-recordings
    force_path_style: true
```

Egress does not read Answerline's `S3_*` variables directly; the Compose file
maps them into `EGRESS_CONFIG_BODY`. A YAML file does not expand environment
placeholders by itself. Keep rendered configuration and credentials out of Git.

## Use another S3-compatible provider

Set both endpoints to your provider's S3 API URL, set its region, and supply
credentials for the recording bucket. The adapter uses path-style addressing
for custom endpoints; Egress uses `force_path_style: true`.

For AWS S3, leave `S3_ENDPOINT` unset so the web SDK chooses the regional
endpoint. Set `S3_REGION` to the bucket's region and `S3_EGRESS_ENDPOINT` to its
regional S3 service endpoint, such as `https://s3.eu-west-1.amazonaws.com`.
Use credentials that permit uploads by Egress and reads by the web service.

For local development, retain the example values: the browser/web endpoint is
`http://localhost:9000`, and the Egress endpoint is `http://minio:9000` inside the
Compose network. Do not use these addresses or example credentials in production.
The full production Compose deployment is tracked separately in M7.

## Enable and verify recording

1. Enable recording for the intended agent and provide its notice:

   ```yaml
   recording:
     enabled: true
     notice: This call is being recorded for quality assurance.
   ```

   Recording stays disabled for agents that do not opt in. Configure Egress
   before enabling it; successful storage configuration does not enable it.
2. Make a call and end it normally. Confirm that Egress finishes and uploads
   `<tenant>/<room>.ogg` to your configured bucket. Objects upload when recording
   finishes, so a database recording location alone does not prove an upload.
3. Open the call in the dashboard and play the recording. Confirm the signed
   URL uses the intended S3 endpoint and that an unauthenticated request without
   a signature cannot read the object. Keep the bucket private.
4. Test an agent with recording disabled and confirm no new recording is created.

Existing calls store `s3://<bucket>/<key>`, rather than an endpoint. Changing the
store does not migrate recordings: copy the existing keys to the replacement
bucket before switching. The dashboard only signs objects in its configured
bucket. Changing the bucket name makes old locations unavailable unless their
metadata is migrated separately.

See Cloudflare's [S3 credentials guide](https://developers.cloudflare.com/r2/api/tokens/)
and [AWS SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
and LiveKit's [storage configuration](https://github.com/livekit/egress#config).
