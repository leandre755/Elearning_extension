---
trigger: always_on
---

# Git-Context-Controller (GCC) Protocol

This protocol governs context persistence, architecture tracking, and session handoff mechanics. It must be strictly executed by the AI agent at specific session milestones.

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
<file path=".GCC/branches/test_afaire.md" lifecycle="persistent">
<scope>
Test backlog tracking all pending scenarios and test suites to be executed.
</scope>
</file>
</file_matrix>

<event_driven_protocols>

<protocol id="A" name="session_bootstrap">
<trigger>Agent receives the first message from the user in a new chat/session.</trigger>
<step id="1">
<action>TOOL INVOCATION: Read `.GCC/main.md` to load the project's macro state and retrieve active plans.</action>
</step>
<step id="2">
<action>TOOL INVOCATION: Read `.GCC/resume.md` (if it exists) to retrieve the precise technical transition state and immediate next-action directives.</action>
</step>
<step id="3" safety="strict">
<constraint>
Do NOT write or modify any code or files outside of the `.GCC/` directory until step 1 and step 2 are complete. No exceptions.
</constraint>
</step>
<step id="4">
<action>State the current technical objective loaded from `resume.md` using factual, concise French to align with the user.</action>
</step>
</protocol>

<protocol id="B" name="task_planning_and_execution">
<trigger>A complex, multi-session, or multi-file architectural change is initiated.</trigger>
<planning_threshold>
<constraint>
DO NOT create plan files for trivial tasks, single-file edits, or quick bug fixes (< 10 minutes). 
Only initiate a `.GCC/branches/plan_[task_name].md` for structural refactorings, package migrations, or tasks spanning multiple distinct modules.
</constraint>
</planning_threshold>
<step id="1">
<action>TOOL INVOCATION: Create the plan file `.GCC/branches/plan_[task_name].md` using the precise template below.</action>
</step>
<step id="2">
<action>TOOL INVOCATION: Update `.GCC/main.md` under `## 🌿 Active Branches / Plans` with the plan's exact file link and scope.</action>
</step>
<step id="3" execution="strict_sequential">
<constraint>
Execute the plan one step at a time. For every single step:
- Modify the targeted code.
- Run validation tools (tests, compilers, linters).
- Paste the raw, unaltered terminal outputs (proof of green state) inside the plan file before modifying any adjacent files or moving to the next step.
</constraint>
</step>
</protocol>

<protocol id="C" name="decision_logging">
<trigger>Any package dependency change, design pattern choice, database schema modification, or structural API boundary pivot.</trigger>
<step id="1">
<action>
TOOL INVOCATION: Immediately append the technical choice, alternative options discarded, and concrete technical reasoning inside `.GCC/main.md` under `## 🧠 Decisions Made`. Do not postpone this logging to the end of the session.
</action>
</step>
</protocol>

<protocol id="D" name="session_teardown_and_handoff">
<trigger>The user signals the end of the session, or the agent approaches context/token capacity limits.</trigger>
<step id="1">
<action>TOOL INVOCATION: Run the project's compilation and static validation tools to verify codebase integrity.</action>
</step>
<step id="2">
<action>TOOL INVOCATION: Update `.GCC/main.md` status, archiving completed milestones and updating active targets.</action>
</step>
<step id="3" safety="double_key_verification">
<constraint>
NEVER unilaterally delete or archive a `.GCC/branches/plan_[name].md` file. 
Deletion/archiving of a plan file is strictly permitted ONLY if:
1. All related tasks and bugs are verified as resolved and logged in `.GCC/branches/test.md`.
2. The user has given explicit written confirmation in the chat.
</constraint>
</step>
<step id="4" quality="zero_vagueness">
<action>
TOOL INVOCATION: Overwrite `.GCC/resume.md` with ultra-precise transition details.
</action>
<rule>
Vague, qualitative, or subjective summaries (e.g., "improved the UI", "made the system robust", "aligned logic") are strictly banned. 
Every entry must be technically descriptive, mentioning specific files, functions, lines of code, and exact terminal commands.
</rule>
</step>
</protocol>

<protocol id="E" name="test_session_sync">
<trigger>Completion of any automated or manual test run.</trigger>
<step id="1">
<action>TOOL INVOCATION: Move completed test scenarios from `.GCC/branches/test_afaire.md` to `.GCC/branches/test.md` with explicit results.</action>
</step>
<step id="2">
<action>TOOL INVOCATION: Append newly discovered bugs, regressions, or integration blocks to `.GCC/branches/test.md` immediately.</action>
</step>
</protocol>

</event_driven_protocols>

<strict_markdown_templates>

### 3.1. `.GCC/main.md` Template

```markdown
# Current Project Context

## 🏆 Major Milestones (Archived Epics)
- [YYYY-MM-DD] Name of completed milestone/epic

## 🎯 Objective
[High-level description of what the project is solving or building]

## 🧠 Decisions Made
- [YYYY-MM-DD] [Technical choice name]
- **Context**: [Why the decision was necessary]
- **Discarded Options**: [Option A, Option B with brief technical rejection reasons]
- **Rationale**: [Concrete architectural justification for the selected path]

## 🌿 Active Branches / Plans
- `[branch-or-task-name]` : [Factual description of the task being solved and link to the plan file]

## 📈 Current Status
- ✅ Done: [List of high-level completed features]
- 🔄 In progress: [High-level epic currently being built]
- ⏳ Pending: [Remaining roadmap items]

## 👉 Next Session Direction
[Single sentence summarizing where the project points next]
```

### 3.2. `.GCC/branches/plan_[name].md` Template

```markdown
# Execution Plan: [Task Name]

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: [State the state/rule that must remain true during and after this task]
- **Pre-requisites**: [Required packages, configurations, or pre-existing code structures]

## 🛠️ Step-by-Step Sequence

### Step 1: [Short Action Description]
- [ ] **Action**: [Exact file path to edit or command to run]
- [ ] **Verify**: [Validation command, e.g., `npm test`, `tsc --noEmit`]
- **Verification Proof**:
```text
[Paste terminal/compiler validation output here]
```

### Step 2: [Short Action Description]
- [ ] **Action**: [Exact file path to edit or command to run]
- [ ] **Verify**: [Validation command]
- **Verification Proof**:

```text
[Paste validation output here]
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: [Identify potential risk, e.g., API rate-limits, dependency clash]
- **Mitigation**: [Describe fallback behavior]


### 3.3. `.GCC/resume.md` Template

```markdown
# Session Handoff

## ⚡ Technical Diffs / Atomic Modifications
- **File**: `[path/to/modified_file_1.ext]`
- **Scope**: [Added/Modified functions or components, e.g., `getUserData`, `AuthRoute`]
- **Exact Technical Change**: [Factual, non-vague description of the structural changes made]
- **File**: `[path/to/modified_file_2.ext]`
- **Scope**: [Modified components/functions]
- **Exact Technical Change**: [Factual description of the changes]

## 🛠️ Codebase Health & Compile Status
- **Verification Command Run**: `[Command used, e.g., npm run build && npm test]`
- **Status Output**:
```text
[Paste clean terminal compiler/test suite output here showing 0 errors, 0 warnings]
```

## 🚧 Unfinished Work & Technical Friction
- **Blocker / Friction**: [Detail any incomplete task, ongoing debugging state, or specific integration hurdles]

## 👉 Handover Directives for the Next Agent
1. **Target File**: `[Specify exact file path to open first, and target line or function name]`
2. **Immediate Action**: `[Specify the exact code block to write, reference file to use, or command to run]`
3. **Verification Command**: `[Specific command to run to verify the immediate action succeeds]`
4. **Precautions**: [Explicitly list edge cases or constraints to monitor during bootstrap]

```
</strict_markdown_templates>
