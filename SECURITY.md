# Security Policy

## Current status

Agmet Slity is at the documentation-only foundation stage. There are no released application versions or supported runtime versions yet. This document defines contribution rules and intended security boundaries; it does not claim that a collector or redaction system has been implemented.

## Report a vulnerability privately

If **Report a vulnerability** is available in the repository's security section, use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately). Include a minimal, sanitized reproduction, impact, affected revision, and relevant environment details. Do not include live credentials, private conversation text, or company data.

If private reporting is unavailable, open an issue requesting a private reporting channel without describing the vulnerability or attaching sensitive material. Wait for the maintainer to provide a private channel before sending details. Do not use public issues or PRs to disclose exploitable details. No response-time commitment is currently offered.

## Public contribution boundaries

- Never commit API keys, OAuth tokens, authentication files, private environment variables, or private keys.
- Never copy actual Codex authentication files, personal conversations, or raw execution logs into the repository.
- Use synthetic fixtures for public examples and tests. Real records may contain credentials, private code, filesystem paths, and third-party content even after obvious identifiers are removed.
- Review the complete staged diff before publication. Ignore rules are a guardrail, not a substitute for review, and do not protect files already tracked by Git.
- If a credential is exposed, revoke or rotate it with its provider and notify the owner privately. Deleting a file does not remove an exposed credential from history. Do not rewrite shared history without the owner's decision.

## Planned runtime boundaries

The future analyzer should operate locally and read-only by default. Model calls, code changes, and experiments must be separate explicit actions. Local records and exported reports must not be automatically published.

Preserve evidence provenance and missing-data states. Do not invent usage values or claim that private internal reasoning is available. Preserve configured sandbox restrictions; workspace-write permission does not imply full-system access. Do not disable a sandbox or elevate privileges to solve a connection failure.

Any later dependency or legacy-code import requires license and security review before it enters a separate PR. See [third-party notices](THIRD_PARTY_NOTICES.md).
