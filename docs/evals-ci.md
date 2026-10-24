# Run agent evals on pull requests

The [Agent evals workflow](../.github/workflows/evals.yml) runs the dental agent's text suite when a pull request changes `agents/` or `evals/`. You can also start it manually from GitHub Actions.

1. Add the repository secret `OPENROUTER_API_KEY` for the sample agent's configured LLM.
2. Set the repository variable `ANSWERLINE_EVALS_ENABLED` to `true`.
3. Open a pull request that changes an agent or eval suite.
4. Open the **Agent evals** check to inspect the pass rate, latency, and cost output.

The workflow creates a temporary Postgres database, applies migrations, and seeds the agent catalog before running `pnpm eval agents/bright-smile-dental.yaml`. Runs use mocked tools and real model requests. Model providers may charge for those requests. Missing prices produce unknown cost rather than zero cost.

The job skips pull requests from forks because they do not receive provider secrets. It uses `pull_request` rather than `pull_request_target`. Keep it disabled until you are ready to run repository-authored prompts with your provider key.

To evaluate another agent, change the final workflow command and supply secrets for its model providers. The workflow's database disappears when the job ends, so its run history is available only during that job. Local and self-hosted runs persist in the database used by the dashboard.
