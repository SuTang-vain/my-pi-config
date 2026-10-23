# Upstream report: host package resolution (submitted)

Summary of an issue found while auditing this configuration, the evidence submitted upstream, and
its outcome. The local evidence lives in `scripts/selftest.mjs`, which keeps checking host package
resolution.

## Submitted

| Finding | Destination | Form | Reference |
|---|---|---|---|
| Host package resolution failure and an unreliable workaround | `nicobailon/pi-subagents` | comment on an existing issue, not a new one | `pi-subagents#2346` |
| `pi-goal-x` peer range excludes pi 0.86 | `tmonk/pi-goal-x` | new issue #77 | `tmonk/pi-goal-x#77` |

The first finding was submitted as a comment because the issue already existed and was open, with
two independent reproductions filed before this one.

## Condition

With pi-subagents 0.70.0 installed on a machine where the host `@earendil-works/pi-coding-agent`
package resolves outside the extension's own `node_modules` tree, a foreground child session
failed to resolve the host package at launch. In-process children therefore could not start, while
background children (separate processes) were unaffected.

## Workaround used here

`npm/package.json` pinned the host package with a `file:` symlink so the bare specifier resolved
from the extension's own tree. This is a local workaround, not a fix: it ties the dependency to
one machine layout.

## Outcome

Issue #2346 was closed as completed on 2026-09-20 (UTC) by #2352
(`fix(child-session): preserve host SDK ownership`), which loads the host package from the resolved
package root instead of a bare specifier. At the time of writing the published npm `latest` was
still 0.70.0, so the fix was not yet available to users.

The workaround remains necessary in this repository because #2352 changed only `child-session.ts`;
three further bare-specifier sites remain in the package (`fleet.js`, `prompt-audit.js`,
`llm-intent-arbiter.js`).

## Note on the filing process

Duplicate checking before filing found `pi-subagents#2346` already open with the same title and two
independent reproductions, so the evidence was attached as a comment. A new issue would have
fragmented the report.
