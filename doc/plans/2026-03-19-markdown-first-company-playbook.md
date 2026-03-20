# Markdown-First Company Playbook Draft

Status: Draft for review
Date: 2026-03-19
Audience: Operators, template authors, and agent-integration authors

## 1. Why This Draft Exists

Paperclip already supports companies, org charts, goals, projects, issues, comments, heartbeats, approvals, budgets, and portable company exports. What it does not yet standardize well enough is how to build a company that is:

- repeatable across domains
- high-signal for operators
- generic at the role level
- deterministic when needed
- portable to future company templates without rewriting every agent prompt

This draft proposes a simple rule:

**Workflow belongs in artifacts, not in hardcoded task IDs or project-specific stage lists inside agent prompts.**

That means:

- agent prompts should define role, guardrails, and handoff behavior
- company and project artifacts should define workflow
- issue documents should carry the current working contract

This is a review artifact first. It is intended to become:

1. a stable repo playbook later
2. a portable company-markdown mirror for exported templates
3. the basis for generic agent templates that can be reused across many companies

## 2. What Makes a Strong Paperclip Company

A strong Paperclip company should feel like a real operating system for a team, not a bag of prompts.

It should have:

- a clear company mission and active company goal
- a small, comprehensible org with explicit reporting lines
- roles that are easy to reuse across companies
- projects that provide execution containers and workspace ownership
- issues that represent real units of work and handoff
- documents that preserve the working contract even when agent sessions are reset
- budget and approval rules that keep autonomy governable

An exceptional Paperclip company is not the one with the most specialized prompts. It is the one where:

- the board can understand the company at a glance
- agents can recover from a fresh session without losing the plan
- work can move through heartbeats with minimal hidden state
- the same operating pattern can be reused in another company with only domain changes

## 3. Core Design Principle

Use three layers of truth:

1. **Role prompts**
   These define the job, the guardrails, the handoff etiquette, and what good work looks like for that role.

2. **Company and project playbooks**
   These define how the company operates by default, which execution mode it uses, what the default roster is, and how projects should be kicked off.

3. **Issue documents**
   These define the live working contract for a specific initiative, stage, or milestone.

Do not put company-specific workflow sequencing directly in role prompts when it can live in:

- a company playbook
- a project kickoff plan
- a milestone or stage issue
- issue documents such as `plan`, `acceptance`, `design`, or `qa-contract`

### Anti-pattern

Avoid prompts that say things like:

- "When FLU-18 is done, assign FLU-19 to X"
- "Only work on ISSUE-123 and ISSUE-124"
- "This role is for WordWave only"

Those prompts can work for a one-off run, but they do not scale into reusable companies or portable templates.

## 4. Operating Modes

This playbook recommends three explicit operating modes. Companies should support all three, with one default.

### 4.1 Hybrid Gated (default)

This is the recommended default for most companies.

Characteristics:

- high-level stages are predefined
- the CEO or lead may decide the exact issue decomposition inside the current stage
- the next stage does not unlock until the current stage satisfies its acceptance criteria

Use this when:

- you want repeatability without freezing every task in advance
- the company should feel smart, not rigid
- you want a template that can be reused across domains

Strengths:

- adaptable inside a stage
- still reviewable and auditable
- easier to export into a reusable company template

Weaknesses:

- more structure than free-form execution
- requires stage acceptance to be written clearly

### 4.2 Stage-Driven

This is the strongest deterministic mode.

Characteristics:

- explicit ordered sequence of stages
- explicit unlock rules between stages
- limited agent discretion about routing

Use this when:

- you are running a demo, launch, or release-critical workflow
- repeatability matters more than flexibility
- you want consistent evaluation across multiple runs

Strengths:

- highly reproducible
- easiest to debug
- easiest to compare across companies or template versions

Weaknesses:

- less adaptive
- more setup overhead
- can become brittle if the stage map is over-specified

### 4.3 Goal-Directed

This is the most flexible mode.

Characteristics:

- the project goal is the main navigation anchor
- the CEO decides decomposition dynamically
- issue documents still matter, but the path is not pre-staged

Use this when:

- the destination is clear but the route is uncertain
- the work is exploratory or research-heavy
- the operator wants the CEO to decide the path in real time

Strengths:

- flexible
- useful for ambiguous or founder-mode work
- closest to a "real autonomous company" feel

Weaknesses:

- harder to evaluate consistently
- more prompt-sensitive
- easier for the company to drift without strong review habits

### 4.4 Selection Rule

Use a simple convention:

- each company has a default execution mode
- each project kickoff may override it
- if a project does not override it, agents follow the company default

For now, this is a documented convention, not a new schema field.

Recommended storage until product support exists:

- company default mode lives in the company playbook markdown
- project override lives in the kickoff `plan` document for the project or kickoff issue

## 5. Base Team Pattern

Start with a small reusable core team. Add specialists only when needed.

### 5.1 Default core roster

#### CEO / Decider

Mission:

- decide what should happen now
- unlock downstream work
- keep work aligned to goals and operator intent
- perform final stage review and acceptance

Must do:

- maintain project-level direction
- approve or revise stage completion
- unlock only runnable downstream work
- escalate ambiguity instead of burying it

Must not do:

- absorb implementation work by default
- hide workflow in prompt-only memory
- unlock downstream stages without acceptance

Reads:

- company playbook
- project kickoff `plan`
- stage issue and required issue documents

Writes:

- review comments
- approval or unlock decisions
- optional updated `plan` when project direction changes

#### Lead

Mission:

- turn direction into a crisp, testable working contract
- own design/spec/acceptance quality
- hand work back for review cleanly

Must do:

- define scope and non-goals
- define required outputs and acceptance
- reconcile ambiguous direction into concrete docs

Must not do:

- invent new company strategy after kickoff
- implement code when acting in the lead lane
- unlock downstream work unless the company explicitly uses that pattern

Reads:

- company playbook
- kickoff `plan`
- relevant project/goal context

Writes:

- `acceptance`
- `design`
- `milestone-map`
- other strategy/spec docs as needed

#### Implementer

Mission:

- execute the approved contract
- report exact verification
- hand work back with minimal ambiguity

Must do:

- implement only the approved scope
- run required checks
- report exact commands and outcomes

Must not do:

- rewrite product strategy
- silently expand scope
- mark work complete without verification evidence

Reads:

- company playbook
- current issue
- implementation-facing issue documents such as `acceptance`, `design`, `qa-contract`

Writes:

- `build-notes`
- `qa-report`
- concise completion comments

### 5.2 Optional specialist modules

Add specialists only when the company or project truly needs them.

Recommended optional modules:

- `Web E2E Validator`
- `Flutter E2E Validator`
- `Relay / Human Contact`
- `Researcher`
- domain-specific specialists

Rule of thumb:

- the base company should work without optional specialists
- optional specialists should strengthen the company, not be required for basic operation

## 6. Workflow Artifact Contract

Paperclip already has the right primitives. This playbook standardizes how to use them.

### 6.1 Required artifact layers

#### Company playbook

Defines:

- company default execution mode
- default roster pattern
- specialist modules
- default handoff norms
- template authoring conventions

#### Project kickoff `plan`

Defines:

- project objective
- selected execution mode if overriding the company default
- stage map or goal-driving rule
- deliverables
- success criteria
- review gates

#### Stage or milestone issues

Define:

- the current unit of coordinated work
- owner
- scope
- non-goals
- unlock condition for the next stage

#### Issue documents

Issue documents are the working contract.

Recommended stable keys:

- `plan`
- `acceptance`
- `design`
- `milestone-map`
- `qa-contract`
- `build-notes`
- `qa-report`

### 6.2 Role of existing Paperclip primitives

#### Goals

Use goals as:

- the business objective
- the long-lived reason the project exists
- a scope anchor

Do not use goals alone as the workflow engine.

#### Projects

Use projects as:

- execution containers
- workspace owners
- cost and visibility boundaries
- the home for mode overrides and kickoff context

Do not use projects alone as the sequencing engine.

#### Issues

Use issues as:

- units of work
- handoff points
- the place where status changes become visible and auditable

#### Issue documents

Use issue documents as:

- the durable working contract
- the source of truth that survives session resets and heartbeat boundaries

### 6.3 Explicit rule

Goals and projects organize intent.

Issues and issue documents carry the live contract.

Prompts should not embed:

- company-specific issue IDs
- product-specific stage lists
- one-project-only choreography that belongs in documents

## 7. Generic Handoff Rules

Every stage issue should declare the following:

- owner
- scope
- non-goals
- required outputs
- acceptance criteria
- unlock criteria for the next stage

### 7.1 Generic handoff contract

When an agent completes a stage:

- it hands work back through the same issue
- it updates the issue status and required documents
- it leaves a concise comment describing what changed and what the reviewer should inspect

The CEO or designated reviewer should unlock the next stage from:

- issue state
- issue documents
- acceptance status

Not from:

- memory of a prompt-only choreography
- hidden assumptions about which ticket comes next

### 7.2 Hybrid gated rule

In `hybrid gated` mode:

- the CEO may create or refine sub-issues inside the current stage
- the CEO must not unlock the next stage until the current stage acceptance criteria are satisfied
- leads and implementers may recommend the next work, but the gate stays explicit

## 8. Flux / WordWave Worked Example

Flux is the first migration example because it already proved a full end-to-end heartbeat-driven task flow, but it currently encodes too much workflow directly in prompts.

### 8.1 Flux default mode

- company default mode: `hybrid gated`

### 8.2 Base team

- `Flux CEO`
- `WordWave Lead`
- `WordWave Engineer`
- optional `Pavluk Flux` relay

### 8.3 Workflow home

The workflow should live in:

- the company playbook
- the WordWave kickoff `plan`
- stage issue documents

Not in:

- `FLU-*` references embedded in the role prompts

### 8.4 Old model vs new model

#### Old model

- prompts encoded the workflow
- prompts named specific Flux issue numbers
- role prompts were tightly coupled to one run

#### New model

- prompts encode role, mission, guardrails, and handoff etiquette
- kickoff and stage docs encode workflow
- the company remains able to run the same effective process, but the prompts become reusable

### 8.5 Flux migration target

After migration:

- `Flux CEO` prompt should describe CEO behavior generically
- `WordWave Lead` prompt should describe lead behavior generically
- `WordWave Engineer` prompt should describe implementer behavior generically
- WordWave sequencing should live in kickoff and stage docs

The optional relay should remain optional, not foundational to the company pattern.

## 9. Template Authoring Rules

When creating a reusable Paperclip company template:

1. choose the company default execution mode
2. choose the base roster
3. decide which specialist modules are optional
4. write the company playbook
5. write the project kickoff plan template
6. define the required issue-document keys
7. ensure each role prompt is generic and reusable
8. export the company with company markdown plus agent markdown

### 9.1 Template anti-patterns

Avoid:

- hardcoded issue IDs in prompts
- product-specific stage sequences inside role prompts
- validator agents required by default when they should be optional
- goals/projects used as the only sequencing mechanism
- one-off prompt behavior that cannot survive export/import cleanly

## 10. Migration Checklist for Existing Companies

Use this checklist when converting a company from prompt-hardcoded workflow to playbook-driven workflow.

1. inventory the current agent prompts
2. mark all workflow-specific content that belongs in documents instead
3. preserve role guardrails and mission
4. strip company-specific choreography from prompts
5. move workflow into company playbook and kickoff docs
6. set the company default mode
7. define the project override rule
8. define the required issue-document keys
9. run one real project end to end
10. export and preview-import the company to verify portability

Flux / WordWave should be the first migration target.

## 11. Portable Mirror Strategy

The canonical source should live in the repo as documentation.

Later, create a portable company-markdown mirror that:

- carries the same operating model into company portability export/import
- stays aligned with the canonical repo playbook
- gives template consumers a company-local guide without forcing them to read the repo docs first

Recommended model:

- repo playbook = canonical source
- portable company markdown = exported mirror adapted for company use

## 12. Review Standard

This draft is ready to promote only when it clearly answers:

- how to design a reusable Paperclip company without hardcoding workflow into prompts
- when to use `hybrid gated`, `stage-driven`, and `goal-directed`
- what the minimum reusable team is
- where workflow truth lives
- how Flux should be migrated
- how the same pattern can be reused for future companies

## 13. Current Recommendation

If you are starting a new company today:

- use a small core roster
- make `hybrid gated` the default
- keep prompts role-generic
- keep workflow in company/project/issue artifacts
- add specialists only when the company actually needs them

That gives Paperclip the best balance of:

- repeatability
- operator clarity
- portability
- and real agent autonomy
