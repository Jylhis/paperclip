# Engineering Principles

Jylhis engineering canon for the Paperclip fork.

This file is a **pointer** to the authoritative working rules that already
live in [`AGENTS.md`](./AGENTS.md). The principles below extend those rules
with fork-specific commitments. If anything in this file conflicts with
upstream Paperclip practice, the resolution rule is at the bottom.

## 1. Upstream contract is sacred

Paperclip's public contract — the API, the database schema, the agent and
adapter protocol, the activity-log invariants — is owned by
[paperclipai/paperclip](https://github.com/paperclipai/paperclip). This fork
does not diverge from it without an ADR under [`doc/adrs/`](./doc/) and a
plan to either upstream the change or carry it on a clearly labelled branch.

See `AGENTS.md` §5 *Core Engineering Rules* for the day-to-day expression of
this rule (company-scoped changes, synced contracts across `db`/`shared`/
`server`/`ui`, preserved control-plane invariants).

## 2. Operational hygiene before product expansion

Jylhis-owned changes are restricted to operational/build hygiene by default
(CI, packaging, nix, prompt-cache telemetry, security hardening). Product
features ship upstream first or come back through an ADR.

## 3. Definition of done is `AGENTS.md` §11

A change is done when behavior matches `doc/SPEC-implementation.md`,
typecheck/tests/build pass, contracts are synced across db/shared/server/ui,
docs are updated when behavior or commands change, and the PR template is
filled in (including `Model Used`).

## 4. Fork-sync over rebase

Upstream is merged in (with a merge commit), not rebased onto. This keeps
upstream history navigable and makes blame correct. See `AGENTS.md` §11
*Fork-Specific* for the procedure.

## 5. ADRs are cheap; product divergence is expensive

Any of the following requires an ADR before merge:

- changing public API shapes Paperclip ships;
- changing the agent or adapter protocol;
- relicensing or removing upstream copyright headers;
- introducing a dependency that blocks upstream merges.

Place ADRs at `doc/adrs/NNNN-slug.md`. Number sequentially. Title with the
decision, not the question.

## 6. Verification is graded

`AGENTS.md` §7 *Verification Before Hand-off* governs which checks run. The
short version: run the smallest verification that proves the change.
Full `pnpm -r typecheck && pnpm test:run && pnpm build` is required only at
PR-ready hand-off or when scope is broad. Browser suites stay opt-in.

## Conflict resolution

If a Jylhis principle here contradicts upstream Paperclip practice, the
default is **upstream wins** unless the conflict is explicitly captured in an
ADR under `doc/adrs/`. When in doubt, open an ADR before merging the change.

## See also

- [`WAY_OF_WORKING.md`](./WAY_OF_WORKING.md) — how we run the loop day to day.
- [`AGENTS.md`](./AGENTS.md) — the operational contract for humans and agents.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — PR mechanics and review expectations.
- [`doc/SPEC-implementation.md`](./doc/SPEC-implementation.md) — the V1 build
  contract upstream owns.
