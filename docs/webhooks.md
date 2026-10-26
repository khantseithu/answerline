# Workspace webhooks

Workspace owners manage endpoints at `/api/v1/webhooks`. Create an endpoint with a name, HTTP(S) URL, and event subscriptions. The response includes a random signing secret once; it is encrypted at rest with `PROVIDER_KEYS_ENCRYPTION_KEY`. Store the secret before leaving the response.

Each request is a JSON envelope with `id`, `type`, `created_at`, and event-specific `data`. Answerline sends `X-Answerline-Event`, `X-Answerline-Delivery`, and `X-Answerline-Signature` headers. The signature header is `t=<unix timestamp>,v1=<hex digest>`, where the digest is HMAC-SHA256 using the endpoint secret over `<timestamp>.<exact raw request body>`. Verify against the raw body before parsing JSON and compare digests with a constant-time comparison. Receivers should reject timestamps outside their chosen replay window and deduplicate the stable event `id`.

The worker retries failed requests up to five times with exponential backoff starting at five seconds. Each request has a ten-second timeout and redirects are rejected. Owners can inspect delivery payloads and the last response at `/api/v1/webhooks/{id}/deliveries`, then replay a non-pending delivery with `POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/replay`. Deleting an endpoint disables it and keeps its delivery history.

`call.ended` includes `data.transcript_url`, which points to the workspace call detail API. Retrieving that resource requires a workspace API key with `calls:read`. Current event producers include `call.started`, `call.ended`, and `lead.created`; booking and eval event producers are tracked in [#116](https://github.com/khantseithu/answerline/issues/116).
