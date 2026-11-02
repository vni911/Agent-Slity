# Repository Guidelines

## Purpose & Current Structure

Agmet Slity is a working name for an open-source tool that will measure multi-agent collaboration efficiency while preserving task quality. This is the documentation-only foundation: no runtime, package manifest, test suite, or CI exists. See [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Add directories only when their implementation stage is authorized.

## Stage Boundaries

Perform one explicitly requested substage per user request. Stop and report after it; wait for explicit instructions before advancing. Foundation stages are 0.1 repository/documents, 0.2 independent research, 0.3 architecture, and 0.4 tooling/templates/CI. Do not pre-implement later stages or broadly refactor unrelated work.

## Communication & Evidence

Respond to the user in Korean without emojis or excessive praise. Mark uncertain statements as `확인 필요`; verify current information against cited sources. Keep requested settings, observed events, and verified outcomes separate. Preserve missing telemetry as `unknown`, never as zero. Do not claim access to private internal reasoning, unrun tests, or unconfirmed agent activity.

## Agent Collaboration

Use subagents only for independent work that benefits from delegation; allow at most three concurrent subagents. Specify inputs, outputs, assigned files, and completion criteria. Give each edited file one owner. Keep verification and review independent from implementation. Record real agent IDs, tasks, and final states. Begin the Search/Verification pair in stage 0.2 only. Identify relayed messages as relayed.

## Development & Validation

No build, test, or lint commands are available yet. Stage 0.4 will establish them; do not invent commands now. Define acceptance criteria before implementation. Add meaningful tests with behavior changes and reproduce bugs before fixing them. Record exact commands and results; passing local checks does not prove live integration. Use consistent indentation and descriptive names; language-specific formatting awaits tooling selection.

## Git & Security

Follow the workflow and Conventional Commits in [CONTRIBUTING.md](CONTRIBUTING.md). After the bootstrap commit, use one issue, one branch, and one PR per objective. Only the owner decides merges. Stage explicit files; never force-push, delete repositories, publish releases, or change external account permissions without authorization.

Follow [SECURITY.md](SECURITY.md). Never publish credentials, private conversations, or raw execution logs. Prefer synthetic fixtures. Default the eventual analyzer to read-only operation; model calls and code changes require explicit actions. Preserve sandbox restrictions. Import legacy code only after license/security review in a separate PR.

## Completion Report

Report completed scope, changed files, commit SHA/PR status, actual checks, unresolved problems, and the next step. Identify blocked and unverified work explicitly, then stop.
