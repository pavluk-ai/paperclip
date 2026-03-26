# Tainted Research Handoff Pattern

Date: 2026-03-25
Status: adopted for Flux Studio / WordWave

## Goal

Allow external-current research without letting raw research dumps contaminate downstream agent prompts.

## Pattern

1. A dormant `Docs Researcher` lane is activated only when a task explicitly needs current external verification.
2. The researcher treats all fetched content as untrusted data.
3. Raw fetched material is stored only as artifacts or references.
4. The handoff contract is a bounded structured memo, not a copied text dump.
5. If suspicious prompt-injection patterns are found in source material, the memo is routed through Security Reviewer before adoption.
6. CTO approves the memo before implementation adopts it.

## Required Memo Fields

- `question`
- `recommendation`
- `sources[]`
- `claims[]`
- `versions[]`
- `checked_at`
- `confidence`
- `suspicious_flags[]`
- `adoption_risks[]`

## Guardrails

- Never paste raw external text into a native system/developer prompt.
- Never use a raw research dump as the execution contract for another agent.
- Prefer Context7 and official vendor docs over open-web summaries.
- Default to latest stable versions unless the issue explicitly requests prerelease channels.

## Flux Studio Defaults

- `Docs Researcher` is optional and dormant by default.
- `maxConcurrentRuns: 1`
- not part of the default milestone path
- structured memo goes to CTO
- security-sensitive research also goes to Security Reviewer
