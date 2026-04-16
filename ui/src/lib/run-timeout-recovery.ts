import type { RunForIssue } from "../api/activity";

export type RunTimeoutRecovery = {
  classification: "clean_timeout" | "dirty_timeout_recovery_required";
  executionWorkspaceId: string | null;
  branchName: string | null;
  workspacePath: string | null;
  baseRef: string | null;
  dirtyTrackedFiles: number;
  untrackedFiles: number;
  aheadCount: number | null;
  behindCount: number | null;
  routedToAgentId: string | null;
  routedToAgentName: string | null;
  routedStatus: string | null;
  wakeReason: string | null;
  lastFailureSummary: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export function readRunTimeoutRecovery(resultJson: unknown): RunTimeoutRecovery | null {
  const summary = asRecord(asRecord(resultJson)?.timeoutRecovery);
  if (!summary) return null;
  const classification = summary.classification === "dirty_timeout_recovery_required"
    ? "dirty_timeout_recovery_required"
    : summary.classification === "clean_timeout"
      ? "clean_timeout"
      : null;
  if (!classification) return null;

  return {
    classification,
    executionWorkspaceId: asNonEmptyString(summary.executionWorkspaceId),
    branchName: asNonEmptyString(summary.branchName),
    workspacePath: asNonEmptyString(summary.workspacePath),
    baseRef: asNonEmptyString(summary.baseRef),
    dirtyTrackedFiles: asCount(summary.dirtyTrackedFiles) ?? 0,
    untrackedFiles: asCount(summary.untrackedFiles) ?? 0,
    aheadCount: asCount(summary.aheadCount),
    behindCount: asCount(summary.behindCount),
    routedToAgentId: asNonEmptyString(summary.routedToAgentId),
    routedToAgentName: asNonEmptyString(summary.routedToAgentName),
    routedStatus: asNonEmptyString(summary.routedStatus),
    wakeReason: asNonEmptyString(summary.wakeReason),
    lastFailureSummary: asNonEmptyString(summary.lastFailureSummary),
  };
}

export function isDirtyRunTimeoutRecovery(summary: RunTimeoutRecovery | null | undefined): boolean {
  return summary?.classification === "dirty_timeout_recovery_required";
}

export function findLatestDirtyTimeoutRecoveryRun(runs: readonly RunForIssue[]): {
  runId: string;
  status: string;
  createdAt: string;
  recovery: RunTimeoutRecovery;
} | null {
  for (const run of runs) {
    const recovery = readRunTimeoutRecovery(run.resultJson);
    if (recovery?.classification !== "dirty_timeout_recovery_required") continue;
    return {
      runId: run.runId,
      status: run.status,
      createdAt: run.createdAt,
      recovery,
    };
  }
  return null;
}
