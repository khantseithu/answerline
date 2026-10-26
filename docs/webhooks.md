# Workspace webhooks

Workspace owners manage endpoints at `/api/v1/webhooks`. Create an endpoint with a name, HTTP(S) URL, and event subscriptions. The response includes a random signing secret once; it is encrypted at rest with `PROVIDER_KEYS_ENCRYPTION_KEY`. Store the secret before leaving the response.

Each request is a JSON envelope with `id`, `type`, `created_at`, and event-specific `data`. Answerline sends `X-Answerline-Event`, `X-Answerline-Delivery`, and `X-Answerline-Signature` headers. The signature header is `t=<unix timestamp>,v1=<hex digest>`, where the digest is HMAC-SHA256 using the endpoint secret over `<timestamp>.<exact raw request body>`. Verify against the raw body before parsing JSON and compare digests with a constant-time comparison. Receivers should reject timestamps outside their chosen replay window and deduplicate the stable event `id`.

The worker retries failed requests up to five times with exponential backoff starting at five seconds. Each request has a ten-second timeout and redirects are rejected. Owners can inspect delivery payloads and the last response at `/api/v1/webhooks/{id}/deliveries`, then replay a non-pending delivery with `POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/replay`. Deleting an endpoint disables it and keeps its delivery history.

`call.ended` includes `data.transcript_url`, which points to the workspace call detail API. Retrieving that resource requires a workspace API key with `calls:read`. Current event producers include `call.started`, `call.ended`, `lead.created`, `booking.created`, and `eval.completed`.

Event data fields are defined by the shared webhook contract. `call.started` includes the agent slug, call ID, channel, direction, optional phone numbers, and start time. `call.ended` includes the agent slug, call ID, duration, end time, status, transcript URL, and optional recording URL. `lead.created` includes the agent slug, call and lead IDs, caller name, phone, and reason. `booking.created` includes agent and call IDs, attendee name, optional phone, and appointment start time. `eval.completed` includes agent and eval run IDs, suite, pass and total counts, and latency and cost metrics.
