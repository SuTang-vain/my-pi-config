# Upstream report: bare tool-name tokens read as intent (submitted, closed)

Summary of a defect found while testing the dispatch mechanism, the report submitted upstream, and
the architectural change it triggered.

Local evidence: two real misfires during dispatch testing on 2026-09-20, a deterministic node
reproduction, and a counterfactual control.

## Timeline (2026-09-20, UTC)

| Time | Event |
|---|---|
| 06:03 | Report submitted as `pi-subagents#2351` |
| 06:32 | Maintainer implemented a fix in #2354 (`stripMarkdownToolsColumnValues`), crediting this report; all 148 tests plus a 24-case backslash-parity matrix passed |
| 06:48 | #2354 closed unmerged: "teaching the regex every data syntax is not a pragmatic long-term contract" |
| 06:49 | #2351 closed as NOT_PLANNED, together with #2353 |
| 07:27 | Tracking issue #2355 opened, naming this report, stating that it replaces the approaches closed in #2351, #2353 and #2354 |
| 08:15 | Implementation PR #2356 opened (unmerged at the time): net −3,521 lines, deleting `task-intent.ts`, `completion-guard.ts`, `llm-intent-arbiter.ts` and `completion-evidence.ts`; `inferLevel` now depends only on the declared `acceptanceRole` |

## Condition

A task string containing a bare tool name (for example a table cell such as `read` or `bash`) was
classified as an implementation intent. The classifier matched tokens in prose and data, so a task
that merely mentioned a tool could be treated as authorising writes.

## Outcome

The report changed an architectural decision rather than a regex: the maintainer's response was
that the finding "exposed that the architecture, not this table shape, needed to change". The
NOT_PLANNED close refers to the specific fix proposed in the report, not to the finding itself.
The published npm `latest` was still 0.70.0 at the time of writing, so the root-cause fix was not
yet available to users.

## Verification performed before filing

- The local copy was byte-identical to the published package (sha512 comparison of the npm
  distribution against the extracted tarball, plus hashes of five key source files).
- The reproduction ran on a clean tarball extraction, yielding `real → implementation/true` and
  `redacted → unknown/false`.
- To rule out framework injection, the classifier was re-run on the task string actually stored at
  runtime (2505 characters extracted from the failing child's `output-0.log`); it still classified
  as implementation/true.
- The acceptance contract chain was read end to end (`acceptance.js:55-101`), matching the
  contract injected into the child session.
