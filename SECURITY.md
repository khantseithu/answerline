# Security Policy

## Supported versions

Answerline is pre-1.0. Only the latest release and the `main` branch receive security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue, pull request or discussion.

Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**.

Include as much of the following as you can:

- The affected component (`apps/web`, `apps/worker`, `apps/agent`, a package) and version or commit
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Any suggested fix or mitigation

## What to expect

- Acknowledgment within 3 business days.
- An initial assessment and a plan or request for more detail within 10 business days.
- Credit in the advisory once a fix is released, unless you prefer to stay anonymous.

Please give us reasonable time to ship a fix before any public disclosure.

## Scope

Answerline is self-hosted. Operators own their deployment, infrastructure, API keys and call data.

In scope: vulnerabilities in Answerline's own code and default configuration, such as authentication or authorization bypass, injection, SSRF, secret exposure, or unsafe defaults in the shipped Docker images and compose files.

Out of scope: misconfigured or unhardened deployments (exposed ports, weak or leaked credentials, missing TLS), vulnerabilities in third-party providers or services you connect, and issues that require an already compromised host or admin account.

If you find a leaked secret in this repository, report it the same way and rotate it if it is yours.
