# Security

This repository is **configuration**, and pi loads its `extensions/` directory as code. A few facts worth knowing before you install it:

## What runs with your privileges

- Every `extensions/*.ts` file is loaded by pi and executes with **your user account's permissions**. That includes files written by other people once you copy this repo into `~/.pi/agent`.
- `scripts/*.sh` and `scripts/selftest.mjs` run only when you invoke them (or via `install.sh` and `npm run selftest`).
- The extensions here make no network calls of their own. `pi-web-access` (an npm package, not this repo) does reach the web; review it separately.

## What is deliberately not here

- **Credentials.** No `auth.json`, no API keys. `install.sh` never creates one. You supply your own `auth.json` with mode `0600`.
- **Machine bindings.** No host names, user names, absolute home paths, ssh configs or systemd units with real values — the ssh/systemd material is a template full of `（待填）` placeholders.
- **Session data.** No `sessions/`, `run-history.jsonl` or `models-store.json`.

## Reporting

Open an issue for anything suspicious in this repository. If the problem is in an extension package (`pi-subagents`, `pi-web-access`, `pi-goal-x`, `@juicesharp/*`), report it upstream — this repo pins them but does not maintain them.

## Before you adopt it

Read `extensions/` — it is small (a few hundred lines each) and readable. `settings.json` enables the packages listed in `npm/package.json`; remove any you do not want. `install.sh --dry-run` prints every copy it would perform.
