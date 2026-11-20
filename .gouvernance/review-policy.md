# AI Code Review Policy — Local-Only Mode (active)

## Golden Rule of AI Review

> **An AI coding agent must NEVER approve its own code.**
> Review is performed by an independent sub-agent (`antibug`, fresh context) or by the human maintainer.

This repository has **no remote reviewer**: no CodeRabbit/Greptile/Codex bot, no required pull-request review, no GitHub Actions. The whole defense is local and layered. A change reaches `origin` only if it crosses **every** layer below.

---

## 1. Defense layers (in order)

| # | Layer | Enforced by | Catches |
|---|---|---|---|
| 1 | Syntax gate | `.githooks/pre-commit` → `node --check` on the **staged blob** of every JS file + `JSON.parse(manifest.json)` | Broken scripts, invalid manifest |
| 2 | Secret gate | `.githooks/pre-commit` → forbidden filenames, `gitleaks git --staged`, key patterns | Leaked API keys / tokens / `.env` / `git_credential.json` |
| 3 | Project-invariant rules | `.semgrep/rules.yml` (Semgrep, offline) + `tests/invariants.test.js` (`node:test`) | Stealth regressions (`data-qh-*`, public `system.md`), `eval`/`new Function`, remote code, SSRF guard removal, key logging, new unsafe `innerHTML` interpolation |
| 4 | Suppression ban | `.githooks/pre-commit` → added lines containing `eslint-disable`, `@ts-ignore`, `nosemgrep`… | Silencing a check instead of fixing the code |
| 5 | Conventional Commits | `.githooks/commit-msg` | Untraceable history |
| 6 | Full-repository gate + tests | `.githooks/pre-push` → `node --test tests/*.test.js`, then `pre-commit` with `QUALITY_GATE_SCOPE=full` | Anything the staged-only gate could miss |
| 7 | Independent local review | `antibug` sub-agent, fresh context (see §2) | Logic bugs, races, leaks, broken error handling that no static rule models |
| 8 | Human sign-off | The maintainer approves every `git push` | Everything else |

Layers 1–6 are mechanical and bypassable with `--no-verify`; that flag is denied in the agent permission profiles and forbidden by `AGENTS.md`, but **no server-side check exists**. Layers 7–8 are therefore not optional.

## 2. Mandatory local review procedure

Before every commit touching code, `manifest.json`, `system.md` or `.semgrep/`:

1. Run the full validation command (`AGENTS.md` §2). All green, raw output kept.
2. Launch the `antibug` sub-agent with a **fresh context**. Give it only: the diff (`git diff --cached`), the acceptance criteria, and the invariants from `AGENTS.md` §2. Never give it your explanation of why the change is correct.
3. It must return raw evidence (file, line, failing input) for each finding. A finding without a reproducible failure is discarded; a finding with one is fixed.
4. Fix **100%** of proven findings in a single batch, re-run step 1 then step 2 until the sub-agent reports no finding.
5. Only then `git commit`. Record the review outcome in `.GCC/branches/test.md`.

## 3. Review Quality Gate & Acceptance Criteria

Before declaring a change review-complete, verify:
- [ ] Reviewed by an entity distinct from the authoring agent (`antibug` run recorded).
- [ ] 0 blocking defects remain; each fixed defect has a regression test when a test is feasible.
- [ ] Full validation passes (raw output, not a summary).
- [ ] No secret, token, or private key committed (`gitleaks` clean).
- [ ] No suppression comment added; no hook, rule or test weakened to make the change pass.

## 4. Known limits (do not hide them)

- No ESLint/Prettier installed locally (no `package.json`, no new dependency without maintainer approval): undefined variables and style are **not** caught mechanically; layer 7 must cover them.
- Semgrep rules and invariant tests only encode what is written in them; they are not a proof of correctness.
- Weakening `.githooks/`, `.semgrep/` or `tests/invariants.test.js` requires explicit maintainer approval (protected paths).
