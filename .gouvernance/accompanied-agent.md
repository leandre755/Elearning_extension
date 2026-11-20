# Policy: Accompanied Agent

## Scope and Boundary

This policy is the default choice for a developer working with an AI coding assistant in their IDE or terminal. The agent can explore the repository, edit files within the workspace, and execute permitted validation commands. Operations that modify Git history or publish it require **explicit human approval (`ask`)**, while irreversible actions (merging, publishing, modifying governance guardrails) remain strictly prohibited.

---

## Authorizations and Approvals

- **Direct Execution (`allow`)**: Read non-sensitive project source files, edit application code in the workspace, run documented formatting/linting/test/build commands, inspect `git status`, `git diff`, `git log`, `node --check`, `node --test`, and the local gates in `.githooks/`.
- **Subject to Explicit Human Approval (`ask`)**:
  - Staging and committing (`git add`, `git commit` with Conventional Commits message).
  - Pushing to `origin master` (`git push origin master`).
  - Package installation (`npm install`, `pip install`, `composer install`).

---

## Mandatory Denials (`deny`)

The agent must never execute:
- Tag creation/pushes and any push that has not been explicitly approved by the human (`git push` is `ask`, force pushes are denied).
- Control bypass flags: `--no-verify`, `--force`, `--force-with-lease`, `--skip-hooks`, `git reset --hard`, `git clean -fd`.
- Merging and destructive rebasing: `git merge`, `git rebase`, `gh pr merge`.
- Publishing and deployment: `gh release`, `npm publish`, `docker push`, cloud deployments.
- Elevated privilege commands: `sudo`, changing file ownership or access permissions.

After loading `AGENTS.md`, this active policy (`.gouvernance/accompanied-agent.md`), and project-specific instructions, the agent never reads or writes secrets, real `.env` files, private keys (`.pem`, `.key`), files outside the workspace, `.git/`, agent policies, `CODEOWNERS`, CI workflows, hooks, or setup scripts. It never modifies `AGENTS.md`, the `.gouvernance/` policies, or the bounded project instructions without explicit confirmation.

---

## Workflow — Local-Only Review (active mode for this repository)

This repository has **no remote reviewer** (no PR bots, no required PR review). Every safeguard is local, so none may be skipped:

1. **Initialization**: read `AGENTS.md`, this file, and `.gouvernance/review-policy.md`.
2. **Implement** with minimal scope on `master` (no PR flow), then run the full validation command from `AGENTS.md` §2.
3. **Independent local review** (mandatory before every commit that touches code, `manifest.json`, `system.md` or `.semgrep/`): launch the `antibug` sub-agent with a fresh context, giving it only the diff and the acceptance criteria. Fix 100% of its proven findings in one batch, then re-run it until it reports no finding.
4. **Commit** (`ask`) with a Conventional Commits message. The `.githooks/pre-commit` gate runs automatically and must pass.
5. **Push** (`ask`) to `origin master` only after the human explicitly approves. The `.githooks/pre-push` gate (tests + full-repository gate) must pass.

An agent never approves its own work: review is always done by the independent `antibug` sub-agent or the human maintainer.

---

## Incident Response

Stop immediately and request human guidance if a secret is encountered, a command attempts to leave the workspace, a critical quality check fails, the task touches a protected path, or an action may have irreversible external side effects. Never attempt workarounds or bypasses.
