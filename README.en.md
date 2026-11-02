# Agent Slity

[한국어 — 기본 문서](README.md)

**Build and run the team your task needs.**

Agent Slity is an open-source project developing a tool for measuring the actual value of multi-agent collaboration. The goal is to reduce redundant exploration, unnecessary delegation, waiting, and retries while preserving verified task quality.

## Status

**Documentation-only foundation (stage 0.1).** There is no installable application, CLI, collector, report generator, desktop UI, or automated test suite yet. CI is planned for stage 0.4. No model is invoked by these documents.

The intended first environment is Windows 11 with WSL2 Ubuntu and Codex CLI. Support has not been validated. Windows without WSL, Linux, and macOS are future targets.

The project name is Agent Slity and the repository name is `Agent-Slity`. This is an independent project, not an official Google or OpenAI product.

## What we intend to measure

- Repeated file, documentation, and command exploration across agents.
- Delegation, communication, idle time, failures, and retries.
- Whether code changes have evidence of actual validation.
- Requested model settings versus observable execution evidence.
- Quality, elapsed time, and observed usage under comparable team configurations.

These are planned capabilities, not implemented features or demonstrated improvements. Fewer agents alone is not a successful outcome. Competitive overlap and differentiation remain unverified until stage 0.2; reproducible performance results do not exist yet.

## Data and privacy

The first collector is planned to import existing local Codex execution records without calling a model. Evidence sources and uncertainty will be preserved; missing usage will remain `unknown`, not zero. Analysis will distinguish confirmed observations from suspected inefficiency and insufficient evidence.

No logs are collected at this stage. Future public examples will use synthetic records. Do not attach authentication files, credentials, private conversations, or raw execution logs to issues or PRs. See [Security](SECURITY.md).

## Getting started

There is currently nothing to install or run. Start with the [contribution workflow](CONTRIBUTING.md) and [agent guidelines](AGENTS.md). A short, model-free demo command will be documented when the collector/report functionality exists. Screenshots will be added after a working UI is available.

## Roadmap

Each substage requires a separate explicit request; completion of one does not authorize the next.

| Stage | Intended deliverable |
| --- | --- |
| 0.1 | Public repository and minimum project documents; current scope |
| 0.2 | Independent prior-art research and differentiation hypotheses |
| 0.3 | Core/UI boundaries, evidence model, and architecture decisions |
| 0.4 | Development tooling, issue/PR templates, and CI |
| 1 | Model-free import, normalization, thread linkage, and JSON export |
| 2 | Evidence-backed efficiency reports in JSON and HTML |
| 3 | Explicit team selection and explainable rule-based recommendations |
| 4 | Reproducible experiments comparing quality, time, and observed usage |
| 5 | Desktop application built on the validated core |
| 6 | Optional Harness² adapter and separate improvement experiments |

## License and contributions

Copyright 2026 Agent Slity contributors. Project-authored material is licensed under [Apache-2.0](LICENSE). No third-party implementation or benchmark dataset is bundled. See [third-party notices](THIRD_PARTY_NOTICES.md) before introducing external material.

Contribute through focused issues and PRs following [CONTRIBUTING.md](CONTRIBUTING.md). Do not publish performance or novelty claims without reproducible evidence.
