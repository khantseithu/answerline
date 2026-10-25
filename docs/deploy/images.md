# Publish and use container images

The Images workflow builds and publishes these image repositories when a Git
tag is pushed:

- `ghcr.io/khantseithu/answerline/web`
- `ghcr.io/khantseithu/answerline/worker`
- `ghcr.io/khantseithu/answerline/agent`

Each tag contains `linux/amd64` and `linux/arm64`. Native runners build and
smoke-test all six images before the workflow publishes the combined manifests.
The web smoke test requests its health endpoint, the worker imports its queue modules and Python eval harness, and
the agent loads its bundled VAD and local end-of-turn models without networking.

## Publish a tag

Push a tag pointing to the reviewed commit. The workflow authenticates to GHCR
with the repository's `GITHUB_TOKEN`; no registry password is stored in the repo.
It publishes the Git tag, a `sha-<short-commit>` tag, and a version without the
leading `v` for semantic version tags. Stable semantic versions also update
`latest`; prerelease and non-version tags do not.

For example, `v1.2.3` publishes `v1.2.3`, `1.2.3`, its SHA tag, and `latest`.
`v1.2.3-rc.1` publishes its prerelease tags and SHA tag without updating `latest`.
A smoke-test tag such as `image-smoke-<commit>` also leaves `latest` unchanged.

Check all build and publish jobs in the Images workflow. The publish jobs verify
that the final manifests contain both architectures. A failed native smoke test
prevents publication of the combined tags.

## Deploy a published version

Set `ANSWERLINE_VERSION` in `.env.production` to the exact tag you want to run.
For a fork or alternate registry, also set `ANSWERLINE_IMAGE_REGISTRY`; the
production file appends `/web`, `/worker`, and `/agent` to that prefix.

```sh
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-build --wait
```

Pin a version for production. `latest` changes when a stable version is
published. Image tags alone do not make a database migration reversible; back up
the database before upgrading.

Package access follows the GitHub package's visibility and permissions. For a
private package, authenticate Docker to GHCR with a token that has
`read:packages` before pulling. Publishing images does not change repository or
package visibility. Do not put registry tokens in the deployment environment
file or a Dockerfile.
