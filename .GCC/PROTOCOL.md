# Git-Context-Controller (GCC) Protocol Specification

This protocol governs context persistence, architecture tracking, inter-agent scratchpad collaboration, and session handoff mechanics. It must be strictly executed by the AI agent at specific session milestones.

## 1. File Matrix

<file_matrix>
<file path=".GCC/main.md" lifecycle="persistent">
<scope>
Acts as the global project registry. Contains high-level milestones, objective, chronological decision log, and an active index of valid plans.
</scope>
</file>
<file path=".GCC/branches/plan_[name].md" lifecycle="transient">
<scope>
Step-by-step tactical implementation plan for complex, multi-session epics only.
</scope>
</file>
<file path=".GCC/resume.md" lifecycle="dynamic">
<scope>
Factual technical changelog and precise transition state. Overwritten at the absolute end of every session to ensure seamless state-recovery in fresh chat environments.
</scope>
</file>
<file path=".GCC/branches/test.md" lifecycle="persistent">
<scope>
Persistent test execution log, tracking completed tests, results, bugs found, and fixes applied.
</scope>
</file>
<file path=".GCC/branches/test_todo.md" lifecycle="persistent">
<scope>
Test backlog tracking all pending scenarios and test suites to be executed.
</scope>
</file>
<file path=".GCC/scratch.md" lifecycle="free">
<scope>
Free-form shared scratchpad and inter-agent forum owned by all agents and subagents. Any agent or subagent may freely read, write, edit, or prune entries without user permission and without template constraints. Optional read (not blocking in Protocol A). Only rules: decline your identity under every added block (`-[<harness>, <model>, <reasoning_effort>]`, fallback `unknown`) and obey Safety Invariant #2 (never write secrets, keys, tokens, or real `.env` values).
</scope>
</file>
<file path=".GCC/PROTOCOL.md" lifecycle="protected">
<scope>
Authoritative protocol specification and strict markdown templates. Never modify without explicit maintainer approval.
</scope>
</file>
</file_matrix>

---

## 2. Mandatory Agent Attribution

<attribution_rule priority="mandatory">
Every block of text added or updated by an agent or subagent in ANY writable `.GCC/` file (`main.md`, `resume.md`, `branches/plan_[name].md`, `branches/test.md`, `branches/test_todo.md`, `scratch.md`) MUST end with a signature line directly underneath the block:

```markdown
-[<harness>, <model>, <reasoning_effort>]
```

- **Examples**:
  - `-[Antigravity-app, Gemini 4 Neon, high]`
  - `-[Claude-Code, Claude Opus 4, high]`
  - `-[Codex-CLI, unknown, medium]`
  - `-[Cursor, Claude Sonnet 4, unknown]`
- **Anti-hallucination fallback (strict)**: If any of the three fields (`harness`, `model`, or `reasoning_effort`) is NOT explicitly present in your runtime or system context, you MUST write `unknown` for that field. NEVER guess, infer, or invent a harness, model name, or reasoning effort.
</attribution_rule>

---

## 3. Event-Driven Protocols

<event_driven_protocols>

### Protocol A: Session Bootstrap (`session_bootstrap`)
<trigger>Agent receives the first message from the user in a new chat/session.</trigger>
- **Step 1**: Read `.GCC/main.md` to load the project's macro state and retrieve active plans.
- **Step 2**: Read `.GCC/resume.md` (if it exists) to retrieve the precise technical transition state and immediate next-action directives.
- **Step 3 (Context Alignment)**: Complete context restoration (Step 1 and Step 2) prior to making any code or file modifications outside of `.GCC/`. Note: `.GCC/scratch.md` is optional and NOT blocking during bootstrap.
- **Step 4**: State the current technical objective loaded from `resume.md` to align with the user.

### Protocol B: Task Planning and Execution (`task_planning_and_execution`)
<trigger>A complex, multi-session, or multi-file architectural change is initiated.</trigger>
- **Planning Threshold**: Reserve plan creation (`.GCC/branches/plan_[task_name].md`) for structural refactorings, package migrations, or multi-module tasks. For simple, single-file edits or quick bug fixes, proceed directly with implementation without generating a plan file.
- **Step 1**: Create the plan file `.GCC/branches/plan_[task_name].md` using the strict template and sign added blocks with `-[<harness>, <model>, <reasoning_effort>]`.
- **Step 2**: Update `.GCC/main.md` under `## 🌿 Active Branches / Plans` with the plan's exact file link, scope, and attribution signature.
- **Step 3 (Sequential Verification)**:
  1. Modify targeted code for the active step.
  2. Run validation tools (tests, compilers, linters).
  3. Paste raw terminal outputs into the plan file as proof of verification and sign the added block with `-[<harness>, <model>, <reasoning_effort>]` before modifying adjacent files or proceeding.

### Protocol C: Decision Logging (`decision_logging`)
<trigger>Any package dependency change, design pattern choice, database schema modification, or structural API boundary pivot.</trigger>
- **Step 1**: Immediately append the technical choice, discarded alternative options, concrete technical reasoning, and attribution signature (`-[<harness>, <model>, <reasoning_effort>]`) inside `.GCC/main.md` under `## 🧠 Decisions Made` at the moment the decision is established.

### Protocol D: Session Teardown and Handoff (`session_teardown_and_handoff`)
<trigger>The user signals the end of the session, or the agent approaches context/token capacity limits.</trigger>
- **Step 1**: Run project compilation and static validation tools to verify codebase integrity.
- **Step 2**: Update `.GCC/main.md` status, archiving completed milestones, updating active targets, and signing every added/updated block with `-[<harness>, <model>, <reasoning_effort>]`.
- **Step 3**: Maintain plan files in an active state until all related tasks and bugs are verified and logged in `.GCC/branches/test.md`, and the user provides explicit written confirmation to archive the plan.
- **Step 4**: Overwrite `.GCC/resume.md` with ultra-precise transition details (file paths, function signatures, modified line numbers, exact terminal commands, raw error logs) and sign the handoff block with `-[<harness>, <model>, <reasoning_effort>]`.

### Protocol E: Test Session Sync (`test_session_sync`)
<trigger>Completion of any automated or manual test run.</trigger>
- **Step 1**: Move completed test scenarios from `.GCC/branches/test_todo.md` to `.GCC/branches/test.md` with explicit results and sign each added block with `-[<harness>, <model>, <reasoning_effort>]`.
- **Step 2**: Append newly discovered bugs, regressions, or integration blocks to `.GCC/branches/test.md` immediately upon discovery, signed with `-[<harness>, <model>, <reasoning_effort>]`.

### Protocol F: Free Scratchpad & Inter-Agent Forum (`scratchpad_and_agent_forum`)
<trigger>Optional — whenever any agent or subagent wants to jot down working notes, hypotheses, intermediate discoveries, open questions, or leave messages for other agents/subagents.</trigger>
- **Zero-permission ownership**: Any agent or subagent may read, append, edit, reorganize, or prune `.GCC/scratch.md` autonomously without asking the user or any other agent for permission.
- **Shared forum**: Multiple agents and subagents may converse, leave breadcrumbs, flag leads, or hand off raw observations in `.GCC/scratch.md`.
- **Only two rules**:
  1. Decline your identity directly beneath every block you add: `-[<harness>, <model>, <reasoning_effort>]` (use `unknown` for any field not explicitly present in your context — never guess).
  2. Never write secrets, private keys, API tokens, or real `.env` values (Safety Invariant #2 always applies).

</event_driven_protocols>

---

## 4. Strict Markdown Templates

### 4.1. `.GCC/main.md` Template

```markdown
# Current Project Context

## 🏆 Major Milestones (Archived Epics)
- [YYYY-MM-DD] Name of completed milestone/epic
-[<harness>, <model>, <reasoning_effort>]

## 🎯 Objective
[High-level description of what the project is solving or building]
-[<harness>, <model>, <reasoning_effort>]

## 🧠 Decisions Made
- [YYYY-MM-DD] [Technical choice name]
  - **Context**: [Why the decision was necessary]
  - **Discarded Options**: [Option A, Option B with brief technical rejection reasons]
  - **Rationale**: [Concrete architectural justification for the selected path]
-[<harness>, <model>, <reasoning_effort>]

## 🌿 Active Branches / Plans
- `[branch-or-task-name]` : [Factual description of the task being solved and link to the plan file]
-[<harness>, <model>, <reasoning_effort>]

## 📈 Current Status
- ✅ Done: [List of high-level completed features]
- 🔄 In progress: [High-level epic currently being built]
- ⏳ Pending: [Remaining roadmap items]
-[<harness>, <model>, <reasoning_effort>]

## 👉 Next Session Direction
[Single sentence summarizing where the project points next]
-[<harness>, <model>, <reasoning_effort>]
```

### 4.2. `.GCC/branches/plan_[name].md` Template

```markdown
# Execution Plan: [Task Name]

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: [State the state/rule that must remain true during and after this task]
- **Pre-requisites**: [Required packages, configurations, or pre-existing code structures]
-[<harness>, <model>, <reasoning_effort>]

## 🛠️ Step-by-Step Sequence

### Step 1: [Short Action Description]
- [ ] **Action**: [Exact file path to edit or command to run]
- [ ] **Verify**: [Validation command, e.g., `npm test`, `tsc --noEmit`]
- **Verification Proof**:
```text
[Paste terminal/compiler validation output here]
```
-[<harness>, <model>, <reasoning_effort>]

### Step 2: [Short Action Description]
- [ ] **Action**: [Exact file path to edit or command to run]
- [ ] **Verify**: [Validation command]
- **Verification Proof**:
```text
[Paste validation output here]
```
-[<harness>, <model>, <reasoning_effort>]

## ⚠️ Mitigations & Edge Cases
- **Risk**: [Identify potential risk, e.g., API rate-limits, dependency clash]
- **Mitigation**: [Describe fallback behavior]
-[<harness>, <model>, <reasoning_effort>]
```

### 4.3. `.GCC/resume.md` Template

```markdown
# Session Handoff

## 🎯 Functional Outcome & Task Reality
- **Requested Task**: [Brief description of what was asked]
- **Functional Status**: [SUCCESS | PARTIAL | FAILED]
- **Behavioral Proof**: [Factual output of runtime test, execution result, or physical check proving whether the feature actually WORKS, independent of compilation]

## ⚡ Technical Diffs / Atomic Modifications
- **File**: `[path/to/modified_file_1.ext]`
- **Scope**: [Added/Modified functions or components]
- **Exact Technical Change**: [Factual description of the changes]

## 🛠️ Static Codebase Health
- **Verification Command Run**: `[e.g., npm run build && tsc --noEmit]`
- **Linter/Compiler Status**: [Paste clean terminal output showing 0 errors, 0 warnings]

## 🚧 Unfinished Work & Technical Failures
- **Blocker / Failure Explanation**: [If Functional Status is PARTIAL or FAILED, explain explicitly WHY it failed, raw error logs, and why static compilation was not enough]

## 👉 Handover Directives for the Next Agent
1. **Target File**: `[Specify exact file path to open first]`
2. **Immediate Action**: `[Specify exact next action or fix to apply]`
3. **Verification Command**: `[Command to run]`

-[<harness>, <model>, <reasoning_effort>]
```

### 4.4. `.GCC/branches/test.md` Template

```markdown
# Test Execution Log

## Verification Runs

### Run: [Short Run Name]
- **Date**: YYYY-MM-DD
- **Target**: [Module / Suite]
- **Status**: [PASS | FAIL | PENDING]
- **Output / Evidence**:
  ```text
  [Paste raw test output here]
  ```
-[<harness>, <model>, <reasoning_effort>]
```

### 4.5. `.GCC/branches/test_todo.md` Template

```markdown
# Test Backlog

## Pending Test Scenarios

### [Category]
- [ ] Scenario: [Scenario description]
  - Verification: [Exact command or check]
-[<harness>, <model>, <reasoning_effort>]
```

### 4.6. `.GCC/scratch.md` (Free-Form Space / Inter-Agent Forum)

No rigid template applies to `.GCC/scratch.md`. Agents and subagents may write, discuss, edit, or clean up freely without user permission. Only sign every added block and never store secrets:

```markdown
# Agent Scratchpad & Forum

[Free-form note, hypothesis, discovery, or message to another agent/subagent]
-[<harness>, <model>, <reasoning_effort>]
```
