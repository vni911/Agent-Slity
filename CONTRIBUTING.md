# Contributing to Agmet Slity

## Work in explicit stages

The current scope is foundation stage 0.1: repository setup and minimum documents. Independent research belongs to 0.2, architecture to 0.3, and tooling/templates/CI to 0.4. There is no supported installation, build, lint, or test command yet.

For agent-assisted work, complete only the substage explicitly requested by the owner. Report results and wait for the next request. Do not start another milestone, build future scaffolding, or import legacy Agent Desk code as part of setup.

## Development workflow

Follow **Research → Issue → Design → Branch → Implementation → Validation → Review → PR → Merge**. Research depth and design documentation should fit the change. Capture evidence, acceptance criteria, and known limitations in the issue before implementation; do not invent evidence of earlier work.

The documentation bootstrap is the sole initial commit exception to the issue/branch/PR workflow. After it, give each issue one clear objective and use one feature branch and one PR for that objective. The repository owner decides whether to merge.

Use `<type>/<issue>-<description>` for branches, for example `docs/1-prior-art-research`. Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `ci`. Use lowercase, hyphen-separated descriptions.

Use small Conventional Commits, for example:

```text
chore: initialize repository documentation
docs: record prior-art findings
fix: preserve child thread identifiers
test: cover duplicate event replay
```

Do not fabricate historical commits. Stage explicit files after inspecting the diff. Do not force-push, publish releases, delete repositories, or change external account permissions without authorization.

## Validation and review

Define completion criteria before writing code. Add meaningful tests alongside new behavior; reproduce a reported bug before fixing it and keep a regression test. Never weaken requirements just to make tests pass. When tooling exists, document exact commands at the repository root.

For this documentation-only stage, check relative links, English/Korean consistency, whitespace, and the complete publication file list. Inspect content for secrets, personal information, and unlicensed material. Record checks actually run; no automated test or CI success can be claimed before those systems exist.

Keep implementation and review independent. A reviewer agent may inspect correctness, security, missing tests, and maintainability; record its real ID, task, and final state in the work report. An agent's review is not a human GitHub approval. Fix or report findings before declaring completion.

## Pull requests

Include the related issue, motivation, implemented behavior, changed files, exact validation commands and results, independent review outcome, security/performance impact, known limitations, and decisions needed from the owner. For UI work, attach screenshots of the actual implementation. Do not mark failing required CI checks as complete.

Issue/PR templates and CI will be added in stage 0.4. After CI exists, require PRs and the implemented checks on `main`; do not require an unavailable second human reviewer in a solo repository.

## Evidence and external material

Support research claims with source URLs, verification dates, and code/test evidence where needed. README marketing alone does not establish implementation quality or novelty. Record unavailable telemetry as `unknown`, and distinguish observed repetition from suspected waste.

Use synthetic public fixtures. Do not submit private conversations, credentials, company material, or raw execution logs. Follow [SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Submit only material you are entitled to contribute under [Apache-2.0](LICENSE).
