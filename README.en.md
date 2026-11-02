# Agent Slity

[한국어 — 기본 문서](README.md)

**Build and run the team your task needs.**

Agent Slity is an open-source project developing a tool for measuring the actual value of multi-agent collaboration. The goal is to reduce redundant exploration, unnecessary delegation, waiting, and retries while preserving verified task quality.

## Status

**The stage 1 collection foundation is in progress.** The library reads a user-selected JSONL file and normalizes a limited set of Codex execution events. It does not modify the source or call a model. There is no installable application, CLI, thread linking, report generator, or desktop UI yet. Returned values may contain sensitive information and must be reviewed before publication.

The intended first environment is Windows 11 with WSL2 Ubuntu and Codex CLI. Support has not been validated. Windows without WSL, Linux, and macOS are future targets.

The project name is Agent Slity and the repository name is `Agent-Slity`. This is an independent project, not an official Google or OpenAI product.

### Current JSONL reader scope

The library's `readJsonlFile(path, options)` returns JSON values in order with one-based line numbers. It skips blank lines and preserves duplicates. Malformed JSON, invalid UTF-8, and oversized lines produce diagnostics without source content, and reading continues on the next line. A leading BOM is diagnosed as `invalid_json`. The default limit is 8 MiB of raw bytes per line, excluding LF and including CR, and can be changed with `maxLineBytes`. File read failures raise a `JsonlReadError` without the file path.

Reader values are raw JSON of type `unknown` and may contain sensitive content. Provenance, completeness, and compatibility with actual Codex stored-record formats require separate verification. It does not run the CLI or discover existing sessions automatically.

### Current event normalization scope

`normalizeCodexExecLine` accepts one reader result and maps only a limited set of event types shown in the official `codex exec --json` documentation. It copies explicit thread IDs and completed-turn usage only, keeps unknown fields as `null`, and preserves an actual zero. Raw messages and commands are excluded. Unsupported inputs and damaged-line diagnostics are returned separately with line numbers.

File contents are not authenticated, so `verification_status` is `unverified`. A per-file source ID, format version, and collection timestamp remain unknown. Thread linking, usage aggregation, and deduplication are not performed. Identifiers may also contain sensitive data; do not publish results automatically.

## What we intend to measure

- Repeated file, documentation, and command exploration across agents.
- Delegation, communication, idle time, failures, and retries.
- Whether code changes have evidence of actual validation.
- Requested model settings versus observable execution evidence.
- Quality, elapsed time, and observed usage under comparable team configurations.

These are planned capabilities, not implemented features or demonstrated improvements. Fewer agents alone is not a successful outcome. The [stage 0.2 research](docs/research/competitor-analysis.md) identifies substantial overlap; differentiation and performance improvements remain unverified.

## Data and privacy

The first collector is planned to import existing local Codex execution records without calling a model. Evidence sources and uncertainty will be preserved; missing usage will remain `unknown`, not zero. Analysis will distinguish confirmed observations from suspected inefficiency and insufficient evidence.

No logs are collected at this stage. Future public examples will use synthetic records. Do not attach authentication files, credentials, private conversations, or raw execution logs to issues or PRs. See [Security](SECURITY.md).

## Getting started

There is currently no product to install or run. To use the development tools, install Node.js 24 and Git, then run from the repository root:

```sh
npm ci
npm run check
```

`npm run check` runs type checking, linting, tests, and build in sequence. On Windows PowerShell, use `npm.cmd` if needed. See the [contribution workflow](CONTRIBUTING.md) and [agent guidelines](AGENTS.md). A model-free demo command and screenshots will be added when the relevant functionality exists.

## Roadmap

Each substage requires a separate explicit request; completion of one does not authorize the next.

| Stage | Intended deliverable |
| --- | --- |
| 0.1 | Completed: public repository and minimum project documents |
| 0.2 | Completed: independent prior-art research and hypotheses |
| 0.3 | Completed: core/UI boundaries and evidence model design |
| 0.4 | Completed: development tooling, issue/PR templates, and CI |
| 1 | In progress: model-free import, normalization, thread linkage, and JSON export |
| 2 | Evidence-backed efficiency reports in JSON and HTML |
| 3 | Explicit team selection and explainable rule-based recommendations |
| 4 | Reproducible experiments comparing quality, time, and observed usage |
| 5 | Desktop application built on the validated core |
| 6 | Optional Harness² adapter and separate improvement experiments |

## License and contributions

Copyright 2026 Agent Slity contributors. Project-authored material is licensed under [Apache-2.0](LICENSE). No third-party implementation or benchmark dataset is bundled. See [third-party notices](THIRD_PARTY_NOTICES.md) before introducing external material.

Contribute through focused issues and PRs following [CONTRIBUTING.md](CONTRIBUTING.md). Do not publish performance or novelty claims without reproducible evidence.
