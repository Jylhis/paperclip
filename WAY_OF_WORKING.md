# Way of Working

How Jylhis runs the loop on the Paperclip fork.

This file is a **pointer** to the day-to-day workflow already documented in
[`AGENTS.md`](./AGENTS.md), with the Jylhis-fork specifics that don't belong
upstream.

## 1. The loop

We operate Paperclip on top of Paperclip. The control plane assigns issues
to agents; agents wake on heartbeats, check out one issue, do durable work,
and update the issue to a clear final disposition. The full agent contract
lives in [`AGENTS.md`](./AGENTS.md) and in the bundled `paperclip` skill.

The Jylhis project this fork backs is the **Internal Developer Platform** goal
on the Jylhis board.

## 2. Reading order before changing code

Per `AGENTS.md` §2, read in this order:

1. [`doc/GOAL.md`](./doc/GOAL.md)
2. [`doc/PRODUCT.md`](./doc/PRODUCT.md)
3. [`doc/SPEC-implementation.md`](./doc/SPEC-implementation.md)
4. [`doc/DEVELOPING.md`](./doc/DEVELOPING.md)
5. [`doc/DATABASE.md`](./doc/DATABASE.md)

## 3. Branches

- `master` — Jylhis fork mainline. Tracks upstream master with periodic
  merge-ins.
- `upstream/master` — read-only reference from upstream, fetched ahead of
  any sync.
- Feature branches: `<author>/<issue-id>-<slug>` (e.g.
  `markus/jyl-29-onboard-canon`).
- Long-lived divergence branches are discouraged. If you start one, file an
  ADR explaining the lifetime and the upstream story.

## 4. Pull requests

Per `AGENTS.md` §10, every PR uses
[`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md):
Thinking Path, What Changed, Verification, Risks, **Model Used**, Checklist.
PRs that change behavior must keep contracts synced across `db`/`shared`/
`server`/`ui` (per `AGENTS.md` §5 rule 2).

## 5. Verification ladder

Default to the smallest verification that proves the change (`AGENTS.md` §7).
At PR-ready hand-off, or when scope is broad, run the full ladder:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

Browser suites (`pnpm test:e2e`, `pnpm test:release-smoke`) stay opt-in.

## 6. Upstream sync cadence

- **Trigger:** any upstream tagged release, plus a monthly check on master.
- **Process:** fetch upstream, merge into `master` (no rebase), re-run the
  full verification ladder, fix any breakage in a follow-up commit on the
  merge branch, then open the PR.
- **Patch inventory:** the diff above `upstream/master` is the live patch
  inventory. We do not maintain a duplicate list; if a patch is no longer
  needed because upstream landed the change, drop it during the merge.
- **Owner:** FoundingEngineer.

## 7. Issue lifecycle on the Paperclip board

We use Paperclip's own ticket model. Status meanings follow the
[`paperclip` skill](./skills/paperclip/SKILL.md) (Status Quick Guide):
`backlog` / `todo` / `in_progress` / `in_review` / `blocked` / `done` /
`cancelled`. The skill is the source of truth — re-read it when in doubt.

## 8. Where canon lives

- [`ENGINEERING_PRINCIPLES.md`](./ENGINEERING_PRINCIPLES.md) — what we won't
  trade away.
- [`WAY_OF_WORKING.md`](./WAY_OF_WORKING.md) — this file. How the loop runs.
- [`AGENTS.md`](./AGENTS.md) — the operational contract.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — PR mechanics and templates.
- `doc/adrs/` — architecture decisions; required for any product divergence
  from upstream.

If you find a contradiction between these, the conflict-resolution rule in
`ENGINEERING_PRINCIPLES.md` §Conflict resolution applies: **upstream wins
unless there is an ADR**.
