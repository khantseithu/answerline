# Environment configuration

[Dotenvx](https://dotenvx.com/docs/quickstart) is installed as a root pnpm dev dependency. After `pnpm bootstrap` (or `pnpm install && uv sync`), use `pnpm exec dotenvx` instead of installing a global CLI.

## Local development

Bootstrap creates `.env` from `.env.example` only when absent. Add your provider keys there. The example remains plaintext and usable without a decryption key. Keep `.env` plaintext locally: Docker Compose, bootstrap's checks, and `scripts/worktree-setup.sh` read and update it directly. Worktree setup still copies the main checkout's file and overrides slot-specific values.

- `pnpm dev` starts Turbo; web and worker each run `dotenvx run -f ../../.env -- ...` **inside** the workspace, after Turbo's environment filtering. This preserves slot-specific settings without passing all secrets through Turbo's build cache configuration.
- `pnpm agent:dev` runs `dotenvx run -- uv run answerline-agent dev`. Python dependencies and execution remain managed by uv.
- Web build/start, worker start/eval, and database generate/migrate/seed/studio also use Dotenvx.

Dotenvx injects values into the child process before Zod (web/worker) or Pydantic Settings (agent) validates them. Existing process environment variables take precedence, so deployment-injected secrets remain authoritative. Restart dev processes after editing the env file. Never source `.env` as a shell script.

`.env`, `.env.keys`, and environment-specific files are gitignored; `.env.example` is intentionally tracked. Never commit provider keys or private decryption keys, including encrypted real credentials in this repository.

## Try the quickstart encryption flow

Use a separate file containing **only placeholder/dev values**, not the local `.env` used by infrastructure:

```bash
printf 'HELLO="dev placeholder"\n' > .env.demo
pnpm exec dotenvx encrypt -f .env.demo
pnpm exec dotenvx run -f .env.demo -- node -e 'console.log(process.env.HELLO)'
```

Encryption replaces values with `encrypted:...` ciphertext and writes the private key to `.env.keys` beside the file. The final command prints `dev placeholder`, demonstrating just-in-time decryption. Keep `.env.keys` private and backed up outside git. The quickstart permits committing encrypted files; if you deliberately share a demo here, force-add **only** the encrypted placeholder file, never `.env.keys` or a populated local `.env`. No encrypted file is required for local development.

## Deployment

For your own deployment, encrypt a separate environment-specific file (for example `.env.production`) using `pnpm exec dotenvx encrypt -f .env.production`. Securely provision the matching `DOTENV_PRIVATE_KEY_PRODUCTION` through your deployment's secret manager; do not put it in source code, logs, or Docker images. A local `.env.keys` can supply the key during development, but must not be committed.

Run commands under that file explicitly, for example from the repository root:

```bash
pnpm exec dotenvx run --strict -f .env.production -- pnpm --filter @answerline/worker start
pnpm exec dotenvx run --strict -f .env.production -- uv run answerline-agent start
```

The web equivalent wraps `pnpm --filter @answerline/web build` and `pnpm --filter @answerline/web start`. Install pnpm dev dependencies in the build/runtime environment when using these CLI scripts. Alternatively inject decrypted variables with your deployment tooling. Docker Compose does not decrypt files itself: keep its infrastructure env file plaintext and outside git. Never replace the bootstrap/worktree `.env` with an encrypted deployment file.
