# Repository Governance (local-only)

How this repository is managed. It is deliberately **not** a GitHub-automated repository.

## 1. Automation

| Mechanism | Where | Trigger | What it does |
|---|---|---|---|
| `pre-commit` | `.githooks/pre-commit` | every `git commit` | Staged-diff Quality Gate: forbidden files, secrets (gitleaks), suppression ban, `node --check` on staged blobs, manifest validity, Semgrep project rules, invariant tests |
| `commit-msg` | `.githooks/commit-msg` | every `git commit` | Conventional Commits |
| `pre-push` | `.githooks/pre-push` | every `git push` | `node --test tests/*.test.js` + full-repository gate (`QUALITY_GATE_SCOPE=full`) |

There is **no** `.github/` directory: no CI, no issue templates, no PR template, no Dependabot, no release workflow. Nothing runs server-side, so nothing can catch a `--no-verify` bypass (see `.gouvernance/review-policy.md` §1).

## 2. Delivery

- Direct commits on `master`, no pull requests.
- Local `git add` / `git commit` are `allow` (guarded by `.githooks/pre-commit`, `.githooks/commit-msg`, `--no-verify`/`-n` denial, and prior `antibug` review).
- Every `git push` is `ask`: the human approves each push explicitly. Force pushes, tags, merges and rebases are denied to agents.
- Every code commit is preceded by an independent `antibug` sub-agent review (`.gouvernance/review-policy.md` §2).

## 3. Issues, releases, dependencies

- Issues and releases: not managed through GitHub automation. The roadmap is `Docs/task_tracking.md`; session state is in `.GCC/`.
- Dependencies: none (vanilla JS, `lib/` vendored files). Adding one requires maintainer approval.

## 4. Policy files

`AGENTS.md`, `CLAUDE.md`, `.gouvernance/**`, `.githooks/**`, `.semgrep/**`, `tests/invariants.test.js` and `.GCC/PROTOCOL.md` are protected: agents never modify them without explicit maintainer approval.
