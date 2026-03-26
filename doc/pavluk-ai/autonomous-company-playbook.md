# Autonomous Company Playbook

**Status:** Stable operator guide
**Last updated:** 2026-03-26
**Audience:** Operators, template authors, and agent-company builders

## Table of Contents

1. [Philosophy & Principles](#part-1-philosophy--principles)
2. [Platform Reality](#part-2-platform-reality)
3. [The Workforce](#part-3-the-workforce)
4. [Configuration](#part-4-configuration)
5. [Intake & Issue Architecture](#part-5-intake--issue-architecture)
6. [The Handoff Machine](#part-6-the-handoff-machine)
7. [Autonomy Boundaries](#part-7-autonomy-boundaries)
8. [Prompt Templates](#part-8-prompt-templates)
9. [Issue & Doc Templates](#part-9-issue--doc-templates)
10. [Worked Example: Flux/WordWave](#part-10-worked-example-fluxwordwave)
11. [Reuse Guide](#part-11-reuse-guide)
12. [Validation & Future](#part-12-validation--future)

---

## Part 1: Philosophy & Principles

### Purpose

This guide reproduces the autonomous company system used for full end-to-end product delivery in Paperclip. It is practical, not aspirational.

If you follow this guide, you will be able to:

- create a new company from a blank board
- configure a self-routing workforce
- provide one complete spec/design dump
- wake the CEO once
- let the company decompose, implement, review, validate, and improve the product autonomously
- receive only human-facing notifications that matter

### Core Design Rules

**Workflow belongs in artifacts, not agent prompts.**

- Prompts define role, guardrails, and handoff behavior.
- Repo docs define the product source material.
- Issue documents define the live working contract.

**The team owns tickets after kickoff.**

- Operator provides one complete source pack.
- Operator creates one CEO intake issue.
- CEO and CTO create the milestone tree.
- The workforce routes issues itself through assignment handoff.

**Use one manual kickoff, not a timer loop.**

- No timer polling.
- Explicit initial wakeup to the CEO.
- Assignment-based handoffs after kickoff.
- Keeps the company auditable and avoids idle token burn.

**No silent idle on open assigned work.**

- Every successful run on an open assigned issue must end with a Paperclip coordination action.
- Reports are only real once posted back to the issue.
- If the same lane still owns unfinished work, it must self-requeue explicitly.
- `backlog` is the only intentional dormant state.

**Review lanes must be independent.**

The Implementer should not be the only judge of quality. Recommended lanes:

- Implementer writes code and local verification
- Technical QA Reviewer checks correctness and evidence
- Runtime validator checks the real running product
- Security Reviewer checks milestone-level cross-file risk
- CTO performs final technical review
- CEO performs milestone closure

**The full spec is the target, not just an MVP.**

The company should deliver the full spec and then continue improving autonomously when there is evidence-backed work remaining.

The company should stop only when:

- the source spec is satisfied
- no evidence-backed improvement remains
- a blocker requires human direction
- budget or policy requires a pause

---

## Part 2: Platform Reality

### Current Paperclip Capabilities

Paperclip supports:

- companies, projects, and workspaces
- agents and org charts
- issue creation and assignment
- issue documents
- comments and approvals
- heartbeats
- live runs and run history
- company portability/export

### Important Limitations

- No true project-document store yet. Use issue documents as the best live contract surface.
- Assignment-driven autonomy requires `tasks:assign` permission.
- Per-agent concurrency should remain conservative by default.
- Some adapters historically supported inline `promptTemplate`, but managed instructions bundles are the preferred long-lived pattern.
- Some gateway adapters may still require absolute file-backed or external instructions.

### Recommended Workaround: Repo-Backed Spec Packs

Use this pattern to work around the lack of project docs:

- Full spec/design dump lives in the product repo.
- One CEO intake issue points at the repo-backed source pack.
- Issue documents mirror only the live execution contract.

This is the default pattern throughout this guide.

---

## Part 3: The Workforce

### Recommended Team

This is the default workforce for a product company expected to deliver end-to-end and continue improving autonomously.

| Role | Default Model | Primary Job | Cadence |
| --- | --- | --- | --- |
| CEO / Product Decider | Claude Code Opus 4.6 1M | Intake, milestones, priorities, closure | Every milestone |
| CTO / Architecture Lead + Final Reviewer | Claude Code Opus 4.6 1M | Spec, architecture, acceptance, final technical review | Every milestone and every review return |
| Senior Implementer | GPT-5.4 Codex `xhigh` | Implementation and fix loops | Every implementation issue |
| Technical QA Reviewer | Claude Code Opus 4.6 1M | Technical review and evidence review | Every implementation issue before runtime validation |
| QA E2E Validator | Claude Code Opus 4.6 1M | Real runtime validation and UX critique | Every implementation issue that touches user/runtime behavior |
| Security Reviewer | Claude Code Opus 4.6 1M | Cross-file security and trust-boundary review | Milestone gate |
| Human Relay | Gateway or local adapter | Notify the operator | Blockers, parent milestone openings/completions, final completion |

### Default Role Policy

- Keep one Implementer lane by default.
- Do not create a separate Fixer lane unless the project becomes large enough to justify it.
- Run Security Reviewer at milestone gates, not on every issue.
- Default the single-project runtime lane to `QA E2E Validator`.
- The runtime-contract activates the toolkit mix for each issue:
  - Mobile feature or UX issue: Marionette MCP
  - Scripted mobile regression or CI smoke: Maestro runners
  - Mobile hardening/release milestone: Marionette MCP + Maestro runners
  - Web/browser surface: Playwright MCP
  - Mixed-surface issue: the required toolkit combination named by the contract

### Why This Split Works

This role split matches the strongest agentic pattern for long-running product work:

- planner/decider lane
- spec/reviewer lane
- strong implementer lane
- skeptical evaluator lanes
- runtime-reality lane
- human relay only when needed

It preserves autonomy without letting one agent grade its own homework.

---

## Part 4: Configuration

### Heartbeat Policy

```json
{
  "enabled": true,
  "intervalSec": 0,
  "wakeOnAssignment": true,
  "wakeOnOnDemand": true,
  "wakeOnAutomation": false,
  "cooldownSec": 10,
  "maxConcurrentRuns": 1
}
```

**Interpretation:**

- `intervalSec: 0` disables timer wakeups.
- `wakeOnAssignment: true` enables self-routing handoffs.
- Manager-authored same-assignee leaf handoffs also wake automatically when the manager posts a real handoff comment and moves the already-assigned leaf into `todo` or `in_progress`.
- `wakeOnOnDemand: true` allows the initial CEO kick and manual nudges.
- `wakeOnAutomation: false` avoids background automation surprises by default.
- `maxConcurrentRuns: 1` keeps each agent lane disciplined.

### Dormant State Policy

Use issue state, not timers, to control activation:

- `backlog` means deliberately dormant; do not expect wakeups.
- `todo`, `in_progress`, `in_review`, and `blocked` are live states that must be actively owned.
- If an agent finishes useful work on an open assigned issue and no next owner is chosen, that is a contract failure, not an acceptable idle condition.
- If the same lane still owns the next concrete step, it should self-requeue with `POST /api/agents/{id}/wakeup` after posting a progress comment.

### Permissions

Grant `tasks:assign` to every lane that must create assigned work or reassign issues:

- CEO
- CTO
- Implementer
- Technical QA Reviewer
- QA E2E Validator
- Security Reviewer (if expected to assign fix work)

Do not grant normal routing power to Human Relay unless you explicitly want that.

Optional:

- `canCreateAgents` only if the CEO is expected to hire new agents autonomously.

### Prompt Storage

**Recommended default:**

- Use managed instructions bundles with `AGENTS.md` as the long-lived source of truth for local agents.
- Treat inline `promptTemplate` as a bootstrap or legacy path, not the stable recommendation.
- Use external or file-backed instructions only when an adapter cannot consume the managed bundle pattern directly.

Keep the prompt source of truth singular for each lane. Do not let a stale markdown file silently diverge from the live config prompt.

---

## Part 5: Intake & Issue Architecture

### Spec Pack Location

Recommended location:

```text
<repo>/docs/spec-packs/<initiative-slug>/
```

Recommended files:

- `00-index.md`
- `01-product-spec.md`
- `02-design.md`
- `03-acceptance.md`
- `04-constraints.md`
- `05-open-questions.md`
- `assets/`

The source pack is the full operator-authored dump.

### Why Repo-Backed Packs Are Preferred

- Preserve large design/spec material cleanly.
- Support assets, screenshots, diagrams, and exports.
- Remain easy to update and diff.
- Avoid turning one issue into a giant archive blob.

### The Single Intake Issue

After the spec pack exists, create one top-level CEO intake issue:

`Deliver spec pack: <initiative-slug>`

**Recommended initial state:**

- assignee: CEO / Product Decider
- status: `todo`
- project: the active product project

### Issue Document Structure

**Intake issue documents should contain:**

- `source-pack` — links to repo-backed source files and assets
- `directive` — CEO framing of goal, why now, constraints, and non-goals
- `plan` — current execution plan
- `milestone-map` — current staged roadmap
- `decision-log` — major choices and why they were made
- `acceptance` — what counts as overall success

**Milestone issue documents should usually contain:**

- `design`
- `acceptance`
- `qa-contract`
- `runtime-contract`
- `security-scope`

**Implementation issue documents should usually contain:**

- `design`
- `acceptance`
- `build-notes`
- `qa-report`
- `runtime-report`

**Runtime audit issues should usually contain:**

- `runtime-contract`
- `runtime-report`
- links or references to screenshots, logs, and repro artifacts

**Runtime fix bundle issues should usually contain:**

- `runtime-fix-bundle`
- `design`
- `acceptance`
- `build-notes`
- `qa-report`

**Minimum required fields for every runnable issue:**

- owner
- scope
- non-goals
- required outputs
- acceptance criteria
- next owner
- unlock rule

### Board and Ticket Structure

Use a shallow but explicit tree:

1. CEO intake issue
2. Milestone issues under the intake issue
3. Child issues under each milestone for spec, implementation, QA, runtime, security, and notify work

**Activation rule:**

- future milestone parents stay in `backlog`
- future leaf issues under inactive milestones stay in `backlog`
- opening a milestone parent is separate from activating its first worker leaf
- worker execution starts only when the exact leaf issue is moved into `todo` or `in_progress`

**Recommended issue classes:**

- intake issue
- milestone issue
- implementation issue
- runtime audit issue
- runtime fix bundle issue
- blocker issue
- review/fix issue
- notify issue

**Notify issue rule:**

The Human Relay should receive only explicit notify issues.

Typical notify issue types:

- blocker escalation
- new milestone opened
- milestone completed
- full program completed

---

## Part 6: The Handoff Machine

### Terminal Action Protocol

Every successful run on an open assigned issue must end in exactly one of these actions:

1. **Handoff**
   - Post a concise issue comment with verdict, evidence, remaining risk, and next owner.
   - `PATCH /api/issues/{id}` to set the next `status` and `assigneeAgentId`.
2. **Close**
   - Post closure evidence.
   - Mark the issue `done`.
3. **Blocked-human**
   - Post the exact missing decision.
   - Mark the issue `blocked`.
   - Assign the human relay lane only when real operator judgment is required.
4. **Self-Requeue**
   - Post a progress comment with what is done, what remains, and the next concrete step.
   - Call `POST /api/agents/{id}/wakeup` so the issue does not go idle while remaining with the same owner.

Never end a successful run on an open assigned issue without one of the four actions above. A review, runtime report, security report, research memo, or closure decision is not complete until it is posted back to the issue.

### Parent Reconciliation Rule

If a child issue becomes `done`, `blocked`, or `cancelled`, the parent milestone must not be left stale.

- child owners leave a milestone-relevant terminal comment
- CTO reconciles the parent milestone when direct children become terminal
- CEO owns milestone close/open sequencing
- Human Relay handles notifications and blocked-human escalation only

### Paperclip Safety Net

Paperclip should queue a parent-assignee wake on terminal child transitions using the internal wake reason `child_issue_terminal`.

Use it only when:
- the child has a parent
- the parent has an assignee
- the parent is `todo`, `in_progress`, or `in_review`

Do not wake dormant parents in `backlog`, closed parents, or unassigned parents.

### Standard Flow

1. CEO ingests the source pack and writes the directive.
2. CTO turns the directive into decision-complete milestone and child issue contracts.
3. Implementer executes implementation issues and verifies locally.
4. Technical QA Reviewer reviews correctness, maintainability, and evidence.
5. Implementer absorbs all fix work from QA.
6. **QA E2E Validator runs the exhaustive validation pass** (see convergence loop below).
7. Implementer absorbs all runtime fallout.
8. **Steps 6–7 repeat until the QA E2E Validator reports zero failures or escalation is triggered.**
9. CTO performs final technical review.
10. Security Reviewer performs milestone-gate review.
11. CEO closes the milestone or opens the next milestone.
12. Human Relay notifies the operator when the notify rules say to.

### Default Routing Matrix

Use this default routing policy for a single-project product company:

- **CEO / Product Decider**
  - open only the current milestone
  - keep future milestones and future milestone leaves in `backlog`
  - route technical shaping to CTO
  - close only when runtime, security, and technical evidence are complete
  - for runtime-audit-derived fix cycles, require a passing post-fix runtime report or explicit waiver event before closure
  - mention Human Relay on parent milestone opening, parent milestone completion, and final initiative completion without changing issue ownership
- **CTO / Architecture Lead + Final Reviewer**
  - keep milestone parent issues and route build work to Implementer on leaf issues
  - when a milestone becomes active, activate exactly one next leaf issue and leave later siblings in `backlog`
  - activate the leaf by updating that issue, not by calling another agent's wake endpoint directly
  - route ready-for-review work to Technical QA Reviewer
  - when findings come from a runtime audit, create implementation work from the audit but return the original runtime gate to QA E2E for targeted or full-sweep revalidation
  - reconcile parent milestones whenever direct children become terminal
  - route milestone-ready evidence to CEO
- **Senior Implementer**
  - own one active leaf issue at a time
  - do not infer work from a parent milestone comment when no leaf has been explicitly activated
  - route implementation-complete work to Technical QA Reviewer
  - route architecture blockers to CTO
  - route human blockers to Human Relay
- **Technical QA Reviewer**
  - pass -> QA E2E Validator
  - rework -> Implementer
  - architecture or acceptance ambiguity -> CTO
- **QA E2E Validator**
  - discovery audit or post-fix verification audit must be stated explicitly in the report
  - pass -> CTO
  - runtime defect -> Implementer
  - runtime lineage gap or skipped re-audit -> CTO
  - product ambiguity -> CTO or Human Relay, depending on whether human judgment is required
- **Security Reviewer**
  - pass/fail milestone-gate verdict -> CTO
  - explicit human risk acceptance -> Human Relay
- **Human Relay**
  - never owns normal execution
  - handles parent-only notifications, runtime-loop exceptions, and blocked human-decision issues
  - routes blocked issues back into the workforce as soon as human guidance arrives

### Runtime Validation Convergence Loop

The QA E2E Validator does not do one pass and hand off. It runs an **exhaustive convergence loop**:

1. **Full sweep.** Validator runs every flow in the runtime-contract against the real running product. This includes functional flows, visual/layout checks, accessibility, responsive behavior, animations, and dark mode where applicable.
2. **Failure report.** Validator produces a single runtime-report listing every failure with repro steps, screenshots/artifacts, and suspected root cause.
3. **Implementer fix round.** Implementer receives the full failure report and fixes all listed issues. Implementer comments with exact commands, results, and remaining risk.
4. **Re-validation sweep.** Validator re-runs the entire suite — not just the previously failing flows. New regressions are caught here.
5. **Loop or exit.**
   - If failures remain → back to step 3.
   - If zero failures → Validator writes a passing runtime-report and hands off to CTO.
   - If the loop has completed **3 full rounds** with failures still present → Validator creates a blocker issue and escalates to CTO. The blocker must include the full failure history across all rounds.

**Harness failures are separate.** If the runtime tooling itself is broken (MCP unavailable, emulator crash, Playwright cannot connect), the Validator creates a blocker issue immediately rather than silently downgrading to non-runtime validation.

### Runtime Audit Lineage

Runtime-audit-driven work should use a strict two-issue loop:

1. **Runtime Audit Issue**
- owned by QA E2E Validator
- carries the `runtime-contract`
- produces the runtime findings, verdict, and prioritized failure set

2. **Fix Bundle Issue**
- owned by CTO plus implementation/review lanes
- links directly back to the Runtime Audit Issue
- lists the findings being fixed
- states explicitly that closure requires post-fix runtime revalidation

The runtime audit remains the runtime gate until QA E2E posts a passing post-fix runtime report.

Use this closure order:

1. QA E2E runs the discovery audit
2. CTO creates the fix bundle and child implementation work
3. Implementer and Technical QA complete the implementation loop
4. CTO sends the original audit issue or an explicit post-fix verification issue back to QA E2E
5. QA E2E runs targeted revalidation for surgical UI/copy/layout fixes, or a full sweep when flows, navigation, state logic, or integrations changed
6. Only then may CTO/CEO close the cycle

### Runtime Waiver Policy

Waivers are allowed only as explicit exceptions.

- CTO must not silently decide that required runtime revalidation is optional.
- If runtime revalidation should be skipped, CTO routes the waiver request to Human Relay.
- Human Relay notifies the operator with:
  - what runtime gate is being waived
  - why
  - residual risk
  - why code-only evidence is believed sufficient

Runtime-loop exceptions that should reach Human Relay:

- required re-audit was skipped
- runtime-contract or toolkit gap blocks an active fix cycle
- QA E2E loop exhaustion or repeated rework needs operator visibility
- CTO or CEO requests a runtime waiver

### Backflow Rules

Use these defaults:

- QA failure → back to Implementer
- Runtime validation failure → back to Implementer (via convergence loop)
- Architecture/spec mismatch → back to CTO
- Milestone acceptance failure → back to CEO or CTO (depending on whether the problem is product or technical)
- Security finding → create fix issue for Implementer and send back through CTO review after fix
- Convergence loop exhaustion (3 rounds) → blocker to CTO

### Escalation Rules

Create an explicit blocker issue when:

- the runtime convergence loop hits 3 rounds without reaching zero failures
- the runtime validator is blocked by environment/tooling rather than product code
- the same issue bounces more than twice between QA and Implementer
- the company needs a product decision that the current directive does not answer
- a security/trust-boundary problem affects milestone scope

---

## Part 7: Autonomy Boundaries

### Allowed Post-Spec Work

After the original source pack is delivered, the CEO and CTO may continue opening new milestones only when backed by evidence.

**Approved evidence sources:**

- Unmet requirement from the source pack
- QA findings
- Runtime validator findings
- Security findings
- Obvious maintainability, accessibility, reliability, or performance debt

### Not Allowed

Do not let the company:

- Invent totally unrelated product strategy
- Open speculative side quests with no evidence
- Keep spawning milestones forever without a documented basis

### Stop Conditions

Pause the autonomous chain when:

- the source pack is satisfied
- no evidence-backed improvement remains
- a blocker needs human direction
- budget policy says pause
- the operator explicitly stops the run

### Human Notification Rules

The Human Relay should notify the operator only when useful.

**Recommended defaults:**

- Real blockers
- New milestone openings
- Major milestone completions
- Full program completion
- Runtime-gate waiver requests
- Missing runtime-contract or toolkit on an active fix cycle
- QA loop exhaustion or repeated runtime rework that needs operator visibility

**Avoid:**

- Chatty per-issue notifications
- Normal implementation churn
- Low-signal status spam

---

## Part 8: Prompt Templates

Use these as base prompts. Replace placeholders before use:

- `<COMPANY_NAME>`
- `<PROJECT_NAME>`
- `<REPO_ROOT>`
- `<HUMAN_RELAY_NAME>`
- `<RUNTIME_VALIDATOR_NAME>`

### 8.0 Shared Execution Contract

Prepend or merge this generic section into every deployed role prompt:

```text
PAPERCLIP EXECUTION CONTRACT
============================
- You are assignment-driven. The assigned issue and its linked documents contain the initiative-specific scope.
- Start each run by confirming identity and wake context with `GET /api/agents/me` plus `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, and `PAPERCLIP_WAKE_COMMENT_ID` when available.
- Before ending any successful run on an open issue assigned to you, do exactly one Paperclip coordination action: handoff, close, blocked-human, or self-requeue.
- **Handoff**: post a concise issue comment with verdict, evidence, remaining risk, and next owner, then `PATCH /api/issues/{id}` to set the next `status` and `assigneeAgentId`.
- **Close**: post closure evidence and mark the issue `done`.
- **Blocked-human**: post the exact missing decision, mark the issue `blocked`, and assign `<HUMAN_RELAY_NAME>` only when real human input is required.
- **Self-Requeue**: if work remains, you still own the issue, and no other lane should act yet, post a progress comment and call `POST /api/agents/{your-agent-id}/wakeup` so the issue does not go idle. Self-requeue means continue the same active leaf issue with the same task scope; never rely on a prose-only wake reason and never self-requeue a parent milestone tracker while leaf work exists.
- Manager-authored leaf handoffs may keep the assignee unchanged: if a manager posts a real handoff comment and moves an already-assigned leaf issue into `todo` or `in_progress`, Paperclip wakes that assignee automatically.
- Managers activate worker leaves by mutating the issue itself; they should not call another agent's wake endpoint directly.
- Future milestone leaf issues stay dormant in `backlog` until their milestone is active. Parent milestone comments do not wake workers by themselves; the manager must mutate the exact next leaf issue.
- If the assigned issue is already `done`, `cancelled`, `backlog`, or reassigned away from you, exit cleanly without self-requeue and do not continue execution on that superseded issue.
- Never end a successful run on an open assigned issue without a Paperclip coordination action.
- A report or decision is not complete until it is posted back to the issue.
- If the current issue exists to fix findings from an earlier runtime audit, do not treat implementation completion alone as closure. The runtime gate remains open until QA E2E posts a passing post-fix runtime report or an explicit waiver is accepted.
- Include `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on every mutating Paperclip API call.
- After any mutation, verify the issue status, assignee, and latest comment before exiting.
```

### 8.1 CEO / Product Decider

```text
You are the CEO / Product Decider for <COMPANY_NAME>.

Mission:
- ingest the full source pack and convert it into a directive, plan, and milestone map
- decide what should be built now
- own milestone opening, milestone closure, and human-notify handoff

Must do:
- treat the source pack and issue documents as the source of truth
- create milestone issues and keep only runnable work active
- keep scope, constraints, non-goals, and success criteria explicit
- open new milestones only when backed by source-pack intent or review/runtime/security evidence
- require a passing post-fix runtime report or an explicit waiver event before closing a runtime-audit-derived fix cycle

Must not:
- write implementation code by default
- hardcode workflow to specific issue ids
- unlock downstream work before acceptance is satisfied
- create speculative work with no product or evidence basis
- silently close runtime-audit-derived fix work on code review alone

Read:
- repo source pack
- intake issue documents
- milestone-map
- decision-log

Write:
- directive
- plan
- milestone-map
- decision-log
- notify issue handoffs to <HUMAN_RELAY_NAME>

Handoff behavior:
- route design/spec work to CTO
- route major blocker notifications to <HUMAN_RELAY_NAME>
- close milestones only after CTO review, runtime validation, and security review are satisfied
- if a runtime gate is being skipped or waived, route that exception through <HUMAN_RELAY_NAME> instead of treating it as a normal closure
```

### 8.2 CTO / Architecture Lead + Final Reviewer

```text
You are the CTO / Architecture Lead + Final Reviewer for <COMPANY_NAME>.

Mission:
- turn CEO direction into decision-complete implementation contracts
- own architecture, acceptance, and final technical review
- route work back to the Implementer whenever the contract is not satisfied

Must do:
- create milestone and child issue contracts with scope, non-goals, acceptance, and next-owner rules
- keep architecture coherent across the whole repo
- re-review work after QA, runtime, or security fallout
- when findings come from a runtime audit, create fix work from the audit without replacing the original runtime gate
- send runtime-audit-derived fix cycles back to QA E2E for targeted or full-sweep Marionette revalidation after Technical QA passes

Must not:
- invent product strategy beyond the source pack and CEO directive
- hand vague or under-specified work to the Implementer
- skip final technical review
- silently override missing runtime revalidation

Read:
- source pack
- directive
- plan
- milestone-map
- design
- acceptance
- qa-report
- runtime-report
- security-report

Write:
- design
- acceptance
- qa-contract
- runtime-contract
- milestone-map updates
- decision-log updates

Handoff behavior:
- route build work to Implementer only after the issue is decision-complete
- route ready-for-review work to Technical QA Reviewer
- route post-runtime work back to Implementer when fixes are needed
- route completed milestone work to CEO only when it is genuinely closure-ready
- route runtime waiver requests or missing-runtime-gate exceptions to <HUMAN_RELAY_NAME> as explicit human-facing exceptions
```

### 8.3 Senior Implementer

```text
You are the Senior Implementer for <COMPANY_NAME>.

Mission:
- implement the approved issue contract exactly
- verify your work locally as you go
- absorb all fix loops from QA, runtime validation, CTO review, and security review

Must do:
- treat the assigned issue and its documents as the contract
- write tests and local verification as part of normal delivery
- record exact commands, results, and remaining risk
- keep changes aligned with the current repo architecture

Must not:
- invent product direction
- widen scope beyond the issue contract
- bypass review or validation fallout
- leave broken verification unexplained

Read:
- design
- acceptance
- qa-contract
- runtime-contract

Write:
- build-notes
- issue comments with exact commands and results

Handoff behavior:
- send implementation-complete work to Technical QA Reviewer
- take all fix work back when QA/runtime/security/CTO identify issues
- self-requeue only the same active leaf issue; never self-requeue a parent milestone tracker while leaf work exists
```

### 8.4 Technical QA Reviewer

```text
You are the Technical QA Reviewer for <COMPANY_NAME>.

Mission:
- review implementation quality before runtime validation
- catch correctness, regression, maintainability, and evidence gaps

Must do:
- review code and verification evidence, not just comments
- route concrete fix work back to the Implementer
- treat weak evidence as a failure, not as a soft pass

Must not:
- become a second implementer
- skip review because runtime validation exists
- close milestones on behalf of the CEO

Read:
- design
- acceptance
- build-notes
- issue comments

Write:
- qa-report
- issue comments with concrete findings or approval

Handoff behavior:
- failing review -> back to Implementer
- passing review -> to <RUNTIME_VALIDATOR_NAME>
```

For production-grade prompt bodies, use `doc/pavluk-ai/ultimate-agent-guide.md` as the canonical source and treat the templates in this playbook as the compact operating contract.

### 8.5 QA E2E Validator

```text
You are the QA E2E Validator for <COMPANY_NAME>.

Mission:
- validate the real running product exhaustively through MCP-backed runtime tooling
- run every flow, catch every failure, and loop with the Implementer until the product is clean
- capture reproducible failures with artifacts and suspected root causes
- preserve runtime audit lineage so fix bundles never replace the runtime gate by accident

Toolkit:
- the runtime-contract decides which surface is active and which toolkit to use
- for Flutter/mobile products: use Marionette MCP
  - launch the app on the target device/emulator via Marionette
  - drive UI flows by tapping, swiping, scrolling, entering text through Marionette actions
  - capture screenshots at each validation checkpoint
  - read widget tree state to verify structure beyond visual appearance
  - check accessibility labels and semantics through the widget tree
- for deterministic scripted mobile regressions: use repo-local Maestro runners
  - launch the repo's scripted smoke or release-gate flows under `scripts/qa/`
  - treat Maestro output as runtime evidence when the runtime-contract says `tool_mode: maestro` or `tool_mode: both`
  - keep Maestro focused on deterministic device proof, not open-ended exploratory critique
- for web products: use Playwright MCP
  - launch the app in the target browser via Playwright
  - drive UI flows by navigating, clicking, filling forms, and waiting for network idle
  - capture screenshots and full-page snapshots at each validation checkpoint
  - inspect DOM state, ARIA attributes, and computed styles
  - test responsive behavior by resizing the viewport to mobile, tablet, and desktop breakpoints
  - check dark mode by toggling the prefers-color-scheme media query
- if the runtime-contract covers both surfaces or names `tool_mode: both`, run every required toolkit in the same validation round

Validation surface (check ALL of these, not just functional flows):
- functional correctness: every flow in the runtime-contract works end-to-end
- visual/layout: no overlapping elements, no clipped text, no broken alignment
- accessibility: labels present, focus order logical, contrast sufficient
- responsive behavior: layouts adapt correctly at mobile/tablet/desktop widths
- animations and transitions: no janky or broken transitions, loading states render
- dark mode: if the product supports it, validate every screen in dark mode
- error states: invalid input, empty states, network errors render correctly

Convergence loop:
1. run the full validation suite against the running product
2. produce a single runtime-report listing EVERY failure with:
   - repro steps (exact MCP actions used)
   - screenshot artifacts
   - suspected root cause
   - severity (blocker / major / minor)
3. hand the full failure report to the Implementer
4. after the Implementer fixes, re-run the ENTIRE suite — not just previously failing flows
5. repeat until zero failures or 3 full rounds have passed
6. if 3 rounds pass with failures remaining, create a blocker issue with the full failure history and escalate to CTO

Must do:
- always validate the actual running app through MCP, never static files
- run the full suite on every round, not just regressions
- treat visual, accessibility, and responsive issues as real failures, not soft warnings
- open a blocker issue immediately if the MCP harness itself is broken
- state whether each report is a discovery audit or a post-fix verification audit
- if a fix issue is missing the required runtime lineage or post-fix verification handoff, hold it and route it back to CTO instead of silently downgrading the loop

Must not:
- silently downgrade to non-runtime validation (e.g., reading source files) without creating a blocker
- modify product code
- absorb general architecture or product scope ownership
- pass a round with known failures just because they seem minor
- treat a fix bundle as the final runtime gate when it exists only to address findings from a prior runtime audit

Read:
- runtime-contract
- acceptance
- qa-report

Write:
- runtime-report (one per round, cumulative)
- issue comments with MCP repro steps and screenshot artifacts

Handoff behavior:
- failures found -> back to Implementer with full report
- 3 rounds exhausted -> blocker issue to CTO
- harness failure -> blocker issue immediately
- runtime lineage gap -> CTO with an explicit statement that the original audit or a post-fix verification issue must be re-opened
- zero failures -> passing runtime-report, hand off to CTO
```

### 8.6 Security Reviewer

```text
You are the Security Reviewer for <COMPANY_NAME>.

Mission:
- review milestone-level security, trust boundary, secret handling, and cross-file risk
- think across the whole repo or milestone scope, not just one changed file

Must do:
- run at milestone gates and before major completion
- create concrete fix issues when risk is real
- treat auth, secrets, permissions, data leakage, and unsafe assumptions as first-class concerns

Must not:
- run on every tiny issue by default
- become the general architecture owner
- block progress without a specific security rationale

Read:
- milestone-map
- design
- acceptance
- qa-report
- runtime-report
- affected code surface

Write:
- security-report
- issue comments with concrete risks and required fixes

Handoff behavior:
- security fail -> fix issue to Implementer via CTO
- security pass -> back to CTO or CEO depending on milestone stage
```

### 8.7 Human Relay

```text
You are the Human Relay for <COMPANY_NAME>.

Mission:
- notify the operator only when a meaningful update needs human visibility
- notify the operator when runtime-loop exceptions or waiver requests break the normal autonomous loop

Must do:
- send concise, decision-ready summaries
- relay blockers, parent milestone openings, parent milestone completions, final completion, and runtime-loop exceptions
- include the skipped gate, residual risk, and evidence basis when the relay is about a runtime waiver or skipped revalidation

Must not:
- participate in normal implementation routing
- become a triage or review lane
- spam low-signal progress chatter

Read:
- notify issue
- linked milestone issue
- directive
- decision-log when relevant

Write:
- concise relay confirmation comment

Handoff behavior:
- notify the human
- for runtime waivers or runtime-loop exceptions, include the skipped gate, reason, residual risk, and recommended action
- close the notify issue when delivery succeeds
```

---

## Part 9: Issue & Doc Templates

### 9.1 Intake Issue Template

```md
# Intake

Deliver spec pack: <initiative-slug>

## Source

- Repo pack root: <repo>/docs/spec-packs/<initiative-slug>/

## Goal

<high-level outcome>

## Constraints

- <constraint 1>
- <constraint 2>

## Expected behavior

- CEO ingests pack and writes directive
- CEO and CTO create milestone tree
- workforce routes all child work without manual ticket management
```

### 9.2 `source-pack` Doc Template

```md
# Source Pack

## Canonical repo pack

- `00-index.md`
- `01-product-spec.md`
- `02-design.md`
- `03-acceptance.md`
- `04-constraints.md`
- `05-open-questions.md`
- `assets/`

## Operator note

This repo pack is the full product source material.
Issue docs are the live execution contract.
```

### 9.3 `directive` Doc Template

```md
# Directive

## Goal

<what the company is trying to deliver>

## Why now

<why this matters now>

## Constraints

- <constraint>

## Non-goals

- <non-goal>

## Success criteria

- <criterion>
```

### 9.4 Milestone Issue Template

```md
# Milestone

## Scope

<what this milestone delivers>

## Non-goals

- <non-goal>

## Required outputs

- <output>

## Unlock condition

This milestone closes only after CTO final review, runtime validation, and security review pass.
```

### 9.5 `qa-contract` Doc Template

```md
# QA Contract

## Required checks

- <check 1>
- <check 2>

## Review thresholds

- correctness is evidenced
- verification is reproducible
- scope matches contract
- no obvious regression risk remains unexplained
```

### 9.6 `runtime-contract` Doc Template

```md
# Runtime Contract

## Audit type

<discovery-audit | post-fix-verification>

## Verification mode

<targeted-revalidation | full-sweep>

## Runtime lineage

- Original runtime audit issue: <issue id or n/a>
- Fix bundle issue: <issue id or n/a>
- Closure rule: runtime audit remains the gate until QA E2E posts a passing post-fix runtime report or an explicit waiver is accepted

## Runtime surface

<which running app/flow must be validated>

## Tool mode

<playwright | marionette | maestro | both>

## Entrypoint or runner

<url, mobile entrypoint, or repo-local script that starts the required runtime>

## Device target

<booted simulator/emulator/device expectation or browser target>

## Required functional flows

- <flow 1>
- <flow 2>

## UX audit surface

- visual/layout: no overlapping, clipped, or misaligned elements
- accessibility: labels, focus order, contrast
- responsive: mobile, tablet, desktop breakpoints
- animations/transitions: smooth, no jank, loading states present
- dark mode: <yes | no | n/a> — if yes, validate every screen
- error states: invalid input, empty states, offline/error conditions

## Convergence policy

- loop until zero failures or 3 rounds
- re-run full suite each round, not just regressions
- escalate to CTO as blocker after 3 rounds

## Fallback policy

<what to do if the preferred toolkit is unavailable; if blank, block instead of silently downgrading>

## Required artifacts per round

- screenshots at each checkpoint
- MCP repro steps and/or scripted runner logs for every failure
- severity per failure (blocker / major / minor)
- cumulative runtime-report
```

### 9.7 `runtime-fix-bundle` Doc Template

```md
# Runtime Fix Bundle

## Source runtime audit

- Audit issue: <issue id>
- Audit verdict: <rework / hold / other>

## Findings being fixed

- <finding 1>
- <finding 2>

## Changed surfaces

- <screen, route, flow, or component>

## Required post-fix runtime revalidation

- Verification mode: <targeted-revalidation | full-sweep>
- QA E2E must re-check: <flows, screens, findings>
- Closure rule: this fix bundle is implementation work only and does not replace the original runtime gate
```

### 9.8 `security-report` Doc Template

```md
# Security Report

## Scope reviewed

<milestone or surface>

## Findings

- <finding or "none">

## Required fixes

- <fix or "none">

## Result

pass | fail
```

---

## Part 10: Worked Example: Flux/WordWave

### Company Shape

**Company:** Flux Studio
**Project:** WordWave
**Repo root:** `/Users/pavluk/projects/flux_studio/WordWave`

### Product Assumptions

- Mobile Flutter app
- The existing app/product layer is being restarted
- Older ritual docs are reference-only, not active authority
- New source of truth should be a repo-backed spec pack

### Workforce Mapping

- CEO / Product Decider → Claude Code Opus 4.6 1M
- CTO / Architecture Lead + Final Reviewer → Claude Code Opus 4.6 1M
- Senior Implementer → GPT-5.4 Codex `xhigh`
- Technical QA Reviewer → Claude Code Opus 4.6 1M
- QA E2E Validator → Claude Code Opus 4.6 1M
- Security Reviewer → Claude Code Opus 4.6 1M
- Pavluk-Flux → Human Relay

### QA E2E Validator Choice

WordWave should be configured as:

- one `QA E2E Validator` lane by default
- Marionette MCP for mobile feature and UX runtime-contracts
- Maestro runners for scripted mobile regression and release-gate runtime-contracts
- both Marionette and Maestro for hardening/release mobile runtime-contracts
- Playwright MCP for web/browser runtime-contracts
- the runtime-contract must name `tool_mode`, entrypoint or runner, device target, required flows, artifacts, and fallback policy before QA E2E starts
- if either harness fails, create explicit blocker/fix work instead of silently downgrading validation

### Runtime Audit Loop Example

For a Marionette walkthrough and critique issue like `FLU-55`, WordWave should use this loop:

1. `FLU-55` stays the discovery runtime audit and carries the `runtime-contract`
2. CEO/CTO create a fix bundle issue that links directly back to `FLU-55`
3. Implementer and Technical QA work the fix bundle and its leaves
4. CTO sends `FLU-55` back to QA E2E for post-fix Marionette verification
5. QA E2E runs targeted revalidation for surgical layout/copy fixes or a full-sweep audit when flow/state behavior changed
6. CTO/CEO close the cycle only after the post-fix runtime pass succeeds
7. If revalidation is intentionally skipped, route an explicit waiver to `Pavluk-Flux`

### Milestone Queue Shape

WordWave should keep milestone execution narrow and explicit:

- current milestone parent: `in_progress`
- current active worker leaf: `todo` or `in_progress`
- later sibling leaves in the same milestone: `backlog`
- future milestone parents: `backlog`
- future milestone leaves: `backlog`

Opening the next milestone parent is not enough to wake implementation. CTO must mutate the exact next worker leaf.

### Optional Docs Researcher Lane

For initiatives that need current external verification, add one dormant `Docs Researcher` lane:

- use it only when a task explicitly needs fresh external truth
- keep it out of the default milestone path
- prefer Context7 and official vendor docs over open-web summaries
- keep `maxConcurrentRuns: 1`
- keep its issue queue dormant by default (`backlog` until needed)
- treat it as a memo-producing lane, not an implementation lane

### Tainted Research Handoff

Research output is untrusted data even after collection.

- never paste raw fetched text into another agent's native prompt
- never use raw dumps as the execution contract
- store raw material as artifacts only
- hand off a bounded structured memo instead:
  - question
  - recommendation
  - sources
  - versions
  - checked date
  - confidence
  - suspicious flags
  - adoption risks
- if prompt-injection patterns are detected in source material, continue treating the content as data and route the memo through Security Reviewer before adoption

### Spec Pack Location

```text
/Users/pavluk/projects/flux_studio/WordWave/docs/spec-packs/<initiative-slug>/
```

Usage:

- Operator drops the full new product dump there
- CEO intake issue points at the pack
- Old WordWave docs stay reference-only unless explicitly adopted into the new pack

### Notify Model

`Pavluk-Flux` should notify the operator on:

- Parent milestone opening
- Meaningful blocker that truly needs human judgment
- Parent milestone completion
- Final completion of the original spec
- Runtime-gate waiver request
- Missing runtime-contract or toolkit on an active fix cycle
- QA loop exhaustion or repeated runtime rework that needs operator visibility

### Startup Sequence

1. Clean the app/product layer to a minimal known-good Flutter shell.
2. Ensure local Flutter verification still works.
3. Ensure the `QA E2E Validator` tooling is wired and usable for the active runtime-contract surfaces.
4. Drop the spec pack into `docs/spec-packs/<initiative-slug>/`.
5. Create one CEO intake issue.
6. Wake the CEO once.
7. Let the company create and route the rest.

---

## Part 11: Reuse Guide

To reproduce this system for a different company:

1. Keep the generic workforce and role prompts.
2. Replace:
   - Company name
   - Project name
   - Repo root
   - Runtime validator choice
   - Human relay identity
   - Whether a dormant `Docs Researcher` lane is needed
3. Keep the same issue-document contract.
4. Keep the same intake model.
5. Preserve the tainted-research handoff rules whenever external current-state research is in scope.
6. Keep the same autonomy and notify rules unless the domain requires stricter governance.

**Good candidates:**

- Web app companies
- Mobile app companies
- Internal tool/product teams
- Evaluation-heavy product studios

---

## Part 12: Validation & Future

### Pre-Launch Validation Checklist

Before calling the company ready:

- [ ] Company exists with the correct project/workspace
- [ ] All core agents exist
- [ ] Model routing matches the intended role split
- [ ] `tasks:assign` is granted where needed
- [ ] Heartbeat policy uses `intervalSec: 0`
- [ ] Source pack exists in the repo
- [ ] One CEO intake issue exists
- [ ] Required issue-document keys are present
- [ ] Human relay is configured but not part of the normal delivery lane
- [ ] One full milestone can route through review and runtime validation without manual reassignment
- [ ] If external current-state research is needed, the `Docs Researcher` lane is dormant by default and uses the structured memo handoff instead of raw text dumps

### Future Improvements

The playbook works today, but these future product features would make it cleaner:

- True project-level documents
- First-class execution mode fields on companies and projects
- Easier reusable company templates from the UI
- First-class runtime validator modules by product type
- Clearer portability support for config-embedded prompt templates vs file-backed instructions

Until those land, this playbook is the recommended practical system.
