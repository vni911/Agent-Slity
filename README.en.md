# Agent Slity

[한국어 — 기본 문서](README.md)

**Build and run the team your task needs.**

Agent Slity is an open-source project developing a tool for measuring the actual value of multi-agent collaboration. The goal is to reduce redundant exploration, unnecessary delegation, waiting, and retries while preserving verified task quality.

## Status

**The stage 1 collection foundation is in progress.** The library and development CLI read a user-selected JSONL file and normalize a limited set of Codex execution events. They do not modify the source or call a model. There is no installable application, thread linking, report generator, or desktop UI yet. Returned values may contain sensitive information and must be reviewed before publication.

The intended first environment is Windows 11 with WSL2 Ubuntu and Codex CLI. Support has not been validated. Windows without WSL, Linux, and macOS are future targets.

The project name is Agent Slity and the repository name is `Agent-Slity`. This is an independent project, not an official Google or OpenAI product.

### Current JSONL reader scope

The library's `readJsonlFile(path, options)` returns JSON values in order with one-based line numbers. It skips blank lines and preserves duplicates. Malformed JSON, invalid UTF-8, and oversized lines produce diagnostics without source content, and reading continues on the next line. A leading BOM is diagnosed as `invalid_json`. The default limit is 8 MiB of raw bytes per line, excluding LF and including CR, and can be changed with `maxLineBytes`. File read failures raise a `JsonlReadError` without the file path.

Reader values are raw JSON of type `unknown` and may contain sensitive content. Provenance, completeness, and compatibility with actual Codex stored-record formats require separate verification. It does not run the CLI or discover existing sessions automatically.

### Current event normalization scope

In normalized `thread/read` results, `parent_thread_id_status` distinguishes a valid ID (`present`), explicit `null` (`explicit_null`), and missing, invalid, or inaccessible values (`unknown`). Explicit `null` does not prove an actual root thread. Older results may lack this field and should be treated as unknown. Parent candidate `unassociated` entries preserve the status and use `unknown` for contradictions between ID and status. Candidate groups compare IDs without validating status. This field is additive; compatibility with consumers that reject additional fields is unverified.

`findParentThreadCandidates(results)` groups input indices where explicit parent and thread IDs match within the same source alias in normalized `thread/read` results. It preserves order, duplicates, conflicting observations, missing source or parent IDs, and absent candidates. A matching self-ID is included; session and fork IDs do not imply a relationship. Matching IDs do not prove a parent relationship or execution, and results are `unverified`. IDs may be sensitive, and all results are held in memory.

The development CLI finds parent candidates in JSONL containing one `thread/read` `result` object per line. This synthetic example uses candidate indices into the output `records` array; each record's `line` and `input_index` identify its source position. `input_index` is zero-based, includes diagnostics, and excludes blank lines. All results are held in memory and IDs may be sensitive.

```sh
node dist/cli/main.js --parents-jsonl tests/fixtures/parent-candidates-demo.jsonl sample
```

`normalizeCodexItemsPageV0166` extracts explicit turn, item, sender, receiver, tool, and status fields from `collabAgentToolCall` entries in one `thread/items/list` result object using the 0.166.0 schema. It preserves order, duplicates, and unsupported entries, leaving missing values `null`. `next_page` indicates cursor presence only; it does not establish page or run completeness. Cursor, prompt, and message contents are excluded, but IDs may be sensitive. A page and its total receiver IDs are each limited to 10,000 entries. An oversized page is unsupported; an item that exceeds the remaining receiver limit has `null` receiver IDs. Missing and limit-exceeded receiver IDs are not distinguished. The whole schema and authenticity are not validated; results are `unverified`. No server or model is called.

The development CLI processes JSONL containing one page `result` object per line. This synthetic example shows duplicate pages and a malformed-line diagnostic. The default line limit is 8 MiB, and all results are held in memory. IDs may be sensitive and should be reviewed before sharing.

```sh
node dist/cli/main.js --items-page-jsonl tests/fixtures/items-page-demo.jsonl sample
```

`normalizeCodexThreadReadV0166` accepts the `result` object of a `thread/read` response, not the whole JSON-RPC envelope, and preserves explicit thread, parent, session, and fork-origin IDs separately. A missing thread ID yields an unsupported result; other missing IDs become `null`, regardless of schema requirements. `0.166.0` is the caller-selected schema reference, not validation of the whole schema, input version, or authenticity. Results are `unverified` and IDs may be sensitive. The function does not start a server, run the Codex CLI, or collect records. See the [schema research](docs/research/codex-app-server-schema.md).

The development CLI reads JSONL with one `result` object per line. This synthetic example preserves order, line numbers, duplicates, and malformed-line diagnostics on standard output. All results are held in memory and identifiers may be sensitive. No server is started and sessions are not discovered automatically.

```sh
node dist/cli/main.js --thread-read-jsonl tests/fixtures/thread-read-demo.jsonl sample
```

`normalizeCodexExecLine` accepts one reader result and maps only a limited set of event types shown in the official `codex exec --json` documentation. It preserves explicit thread IDs, supported item types, and completed-turn usage, keeps unknown fields as `null`, and preserves an actual zero. Raw messages and commands are excluded. Unsupported inputs and damaged-line diagnostics are returned separately with line numbers.

For item start and completion events, `payload.item_type` preserves only `command_execution` and `agent_message`, as shown in the official examples. Other or missing types become `null`; the type does not establish execution success or message delivery. This field is additive in version 1 JSON, and older results without it export as `null`.

An item event's explicit `item.id` is preserved as `payload.item_id`. It is distinct from event, thread, and agent IDs and does not prove a shared run or parent relationship. Item IDs may contain sensitive information; review them before sharing. Older results without this field export as `null`. Compatibility with existing consumers that reject additional version 1 JSON fields is unverified.

`groupItemObservations(results)` groups item events with the same source alias and item ID as review candidates, preserving input indices, line numbers, event types, item types, and explicit thread IDs. Item events without an alias or ID are listed separately with the reason. Matching values do not prove the same actual item or run; duplicates, reversed order, and differing item types are preserved. Results are unverified and identifiers may be sensitive. It copies all results into memory, so use care with large inputs.

`groupThreadObservations(results)` groups events with the same explicitly provided thread ID and source alias as review candidates, preserving positions and item evidence. Events without IDs are not attached to a preceding thread and are listed with the reason. Diagnostics and unsupported records are listed separately. Matching values do not prove the same actual thread or a parent-child relationship. Identifiers may be sensitive, and all results are copied in memory.

Pass an optional source alias, for example `normalizeCodexExecLine(line, "source_1")`, to preserve it on events, diagnostics, and unsupported results. Aliases use 1–64 ASCII letters, digits, underscores, or hyphens; omission yields `null`. Callers must manage distinct aliases per file and must not include paths or sensitive information.

File contents and aliases are not authenticated, so `verification_status` is `unverified`. Format version and collection timestamp remain unknown. Thread linking, usage aggregation, and deduplication are not performed. Identifiers may also contain sensitive data; do not publish results automatically.

`exportNormalizationJson(results)` returns a versioned JSON string from an array of normalization results. It preserves event, diagnostic, and unsupported-result order and duplicates without writing a file. The whole result is held in memory, so use care with large inputs. Review the output before sharing: thread IDs and source aliases may contain sensitive data.

`findSourceOverlaps(results)` reports repeated source-alias and line-number candidates using zero-based input indices. `matching_normalized` means only that normalized results match; it does not establish identical source records or actual events. Groups with differences are marked `conflict`, and no input is removed. Records without an alias are not compared; callers must manage aliases per source. It copies all results into memory, so use care with large inputs.

## What we intend to measure

- Repeated file, documentation, and command exploration across agents.
- Delegation, communication, idle time, failures, and retries.
- Whether code changes have evidence of actual validation.
- Requested model settings versus observable execution evidence.
- Quality, elapsed time, and observed usage under comparable team configurations.

These are planned capabilities, not implemented features or demonstrated improvements. Fewer agents alone is not a successful outcome. The [stage 0.2 research](docs/research/competitor-analysis.md) identifies substantial overlap; differentiation and performance improvements remain unverified.

## Data and privacy

The first collector is planned to import existing local Codex execution records without calling a model. Evidence sources and uncertainty will be preserved; missing usage will remain `unknown`, not zero. Analysis will distinguish confirmed observations from suspected inefficiency and insufficient evidence.

Logs are not collected automatically. Public examples use synthetic records. Do not attach authentication files, credentials, private conversations, or raw execution logs to issues or PRs. See [Security](SECURITY.md).

## Getting started

To use the development CLI, install Node.js 24 and Git, then run from the repository root:

```sh
npm ci
npm run check
```

`npm run check` runs type checking, linting, unit tests, build, and CLI process integration tests in sequence. To run integration tests separately, run `npm run build` first, then `npm run test:integration`. On Windows PowerShell, use `npm.cmd` if needed. See the [contribution workflow](CONTRIBUTING.md) and [agent guidelines](AGENTS.md).

Run the synthetic example without a model call:

```sh
node dist/cli/main.js tests/fixtures/demo.jsonl demo
```

Run `node dist/cli/main.js --help` to see usage and precautions.

To inspect explicitly observed thread candidates, replace the path and provide the required source alias:

```sh
node dist/cli/main.js --threads my-run.jsonl sample
```

Events without explicit IDs, diagnostics, and unsupported records remain listed with their positions and reasons. Matching IDs and aliases do not prove the same actual thread or a parent-child relationship. Indices refer to normalized results after blank lines are skipped. Thread and item IDs may be sensitive, and the whole result is held in memory; use care when sharing or processing large inputs.

To inspect item observation candidates, replace the path below with your JSONL file. A source alias is required.

```sh
node dist/cli/main.js --items my-run.jsonl sample
```

Results are candidates with matching aliases and item IDs; they do not prove the same run or thread relationship. Duplicates and order are preserved, and missing item IDs are reported with index and line. Diagnostics and unsupported records are listed with their positions and codes or reasons; other events are listed by index. Indices refer to normalized results after blank lines are skipped. Item and thread IDs may be sensitive, and the whole result is held in memory; use care when sharing or processing large inputs.

To save normalized JSON to a new file, explicitly use `--output`:

```sh
node dist/cli/main.js --output tests/fixtures/demo.jsonl demo-result.json demo
```

The input is processed before a new output file is created; existing files and the input are not overwritten. A failed write may leave a partial new file. On POSIX, creation requests mode 0600; permission handling differs on Windows, so check file access permissions yourself. Output may contain sensitive identifiers and must be reviewed before sharing.

On Windows, alternate data streams and device paths are rejected as output targets.

Summarize event types, unsupported reasons, and diagnostic codes read from an input:

```sh
node dist/cli/main.js --summary tests/fixtures/demo.jsonl
```

Counts describe normalized results read after blank lines are skipped and include duplicates. They do not establish unique event counts, missing-record rates, or source authenticity. The command aggregates as it reads and does not print raw content or paths.

Compare position-overlap candidates from records you identify as the same source. This example reads the synthetic fixture twice:

```sh
node dist/cli/main.js --overlaps demo tests/fixtures/demo.jsonl tests/fixtures/demo.jsonl
```

The `inputs` array gives each input's starting index and result count. Indices are zero-based in the normalized results after blank lines are skipped. `matching_normalized` does not prove identical source records; reusing an alias for different sources may produce misleading candidates. Paths and raw content are not printed, and inputs are not deleted.

For the normal single-file command, replace the path with a JSONL file you choose; the second argument is an optional source alias. This command uses standard output and holds results entirely in memory. Compatibility with actual Codex stored records is unverified. Review output for sensitive identifiers before sharing. When redirecting output, use a different file from the input: redirecting to the source can overwrite it before the CLI reads it.

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
