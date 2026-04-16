import { describe, expect, it } from "vitest";
import { findLatestDirtyTimeoutRecoveryRun, readRunTimeoutRecovery } from "./run-timeout-recovery";

describe("readRunTimeoutRecovery", () => {
  it("parses a dirty timeout recovery summary", () => {
    expect(readRunTimeoutRecovery({
      timeoutRecovery: {
        classification: "dirty_timeout_recovery_required",
        dirtyTrackedFiles: 2,
        untrackedFiles: 1,
        aheadCount: 3,
        routedToAgentId: "agent-cto",
        routedToAgentName: "CTO / Architecture Lead",
      },
    })).toEqual({
      classification: "dirty_timeout_recovery_required",
      executionWorkspaceId: null,
      branchName: null,
      workspacePath: null,
      baseRef: null,
      dirtyTrackedFiles: 2,
      untrackedFiles: 1,
      aheadCount: 3,
      behindCount: null,
      routedToAgentId: "agent-cto",
      routedToAgentName: "CTO / Architecture Lead",
      routedStatus: null,
      wakeReason: null,
      lastFailureSummary: null,
    });
  });

  it("returns null for unrelated result json", () => {
    expect(readRunTimeoutRecovery({ summary: "done" })).toBeNull();
  });
});

describe("findLatestDirtyTimeoutRecoveryRun", () => {
  it("returns the first dirty timeout recovery from descending runs", () => {
    const dirty = findLatestDirtyTimeoutRecoveryRun([
      {
        runId: "run-2",
        status: "timed_out",
        agentId: "agent-1",
        adapterType: "codex_local",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        invocationSource: "assignment",
        usageJson: null,
        resultJson: {
          timeoutRecovery: {
            classification: "dirty_timeout_recovery_required",
            dirtyTrackedFiles: 1,
            untrackedFiles: 0,
          },
        },
        logBytes: null,
      },
      {
        runId: "run-1",
        status: "timed_out",
        agentId: "agent-1",
        adapterType: "codex_local",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-04-15T00:00:00.000Z",
        invocationSource: "assignment",
        usageJson: null,
        resultJson: {
          timeoutRecovery: {
            classification: "clean_timeout",
          },
        },
        logBytes: null,
      },
    ]);

    expect(dirty).toMatchObject({
      runId: "run-2",
      recovery: {
        classification: "dirty_timeout_recovery_required",
        dirtyTrackedFiles: 1,
      },
    });
  });
});
