# Security policy

## Supported versions

Coretex is pre-1.0 software. Security fixes are applied to the current `main` branch and the latest published desktop release.

## Reporting a vulnerability

Do not include credentials, personal data, exploit payloads, or sensitive logs in a public issue.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/MDCran/coretex/security/advisories/new). Include the affected component, reproduction conditions, impact, and the smallest safe proof of concept you can provide.

## Repository hygiene

- Never commit `.env` files, tokens, certificates, private keys, browser profiles, database exports, or personal documents.
- Store secrets through Coretex settings or vault surfaces, not in source files.
- Run `npm audit` and the configured Gitleaks scan before release commits.
- Treat generated logs, screenshots, test workspaces, and local QA state as private unless reviewed and sanitized.
- Rotate any credential immediately if it may have entered Git history or a shared build artifact.
