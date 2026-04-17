import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeExecutionContextFingerprint,
  reconcileExecutionContextFingerprint,
} from "../services/execution-context-fingerprint.js";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createInstructionsFile(contents: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-execution-context-"));
  tempRoots.push(root);
  const instructionsFilePath = path.join(root, "AGENTS.md");
  await fs.writeFile(instructionsFilePath, contents, "utf8");
  return instructionsFilePath;
}

describe("computeExecutionContextFingerprint", () => {
  it("changes when the managed instructions bundle changes", async () => {
    const instructionsFilePath = await createInstructionsFile("# Agent\n\nUse the assigned issue.");
    const first = await computeExecutionContextFingerprint({
      instructionsFilePath,
      issueId: "issue-1",
      issueDescription: "Build the app shell.",
      issueDocuments: [],
    });

    await fs.writeFile(instructionsFilePath, "# Agent\n\nUse the assigned issue and issue docs.", "utf8");

    const second = await computeExecutionContextFingerprint({
      instructionsFilePath,
      issueId: "issue-1",
      issueDescription: "Build the app shell.",
      issueDocuments: [],
    });

    expect(second).not.toBe(first);
  });

  it("stays stable for reordered issue documents but changes when a revision changes", async () => {
    const instructionsFilePath = await createInstructionsFile("# Agent\n\nStay in scope.");
    const first = await computeExecutionContextFingerprint({
      instructionsFilePath,
      issueId: "issue-1",
      issueDescription: "Build the app shell.",
      issueDocuments: [
        { key: "plan", latestRevisionId: "rev-plan-1", latestRevisionNumber: 1, body: "plan body" },
        { key: "runtime-contract", latestRevisionId: "rev-runtime-1", latestRevisionNumber: 1, body: "runtime" },
      ],
    });
    const sameReordered = await computeExecutionContextFingerprint({
      instructionsFilePath,
      issueId: "issue-1",
      issueDescription: "Build the app shell.",
      issueDocuments: [
        { key: "runtime-contract", latestRevisionId: "rev-runtime-1", latestRevisionNumber: 1, body: "runtime" },
        { key: "plan", latestRevisionId: "rev-plan-1", latestRevisionNumber: 1, body: "plan body" },
      ],
    });
    const changedRevision = await computeExecutionContextFingerprint({
      instructionsFilePath,
      issueId: "issue-1",
      issueDescription: "Build the app shell.",
      issueDocuments: [
        { key: "plan", latestRevisionId: "rev-plan-2", latestRevisionNumber: 2, body: "plan body updated" },
        { key: "runtime-contract", latestRevisionId: "rev-runtime-1", latestRevisionNumber: 1, body: "runtime" },
      ],
    });

    expect(sameReordered).toBe(first);
    expect(changedRevision).not.toBe(first);
  });
});

describe("reconcileExecutionContextFingerprint", () => {
  it("forces a fresh session when the execution context changes and clears legacy packet metadata", () => {
    const reconciled = reconcileExecutionContextFingerprint(
      {
        instructionsSourceHash: "legacy-hash",
        instructionsSourceKind: "repo_paperclip_lane",
        instructionsSourcePacketMetrics: { packetChars: 1234 },
        resumeSessionParams: { sessionId: "session-1" },
        resumeSessionDisplayId: "session-1",
      },
      "next-hash",
    );

    expect(reconciled.changed).toBe(true);
    expect(reconciled.previousFingerprint).toBe("legacy-hash");
    expect(reconciled.contextSnapshot.executionContextFingerprintHash).toBe("next-hash");
    expect(reconciled.contextSnapshot.executionContextForceFreshSession).toBe(true);
    expect(reconciled.contextSnapshot.forceFreshSession).toBe(true);
    expect(reconciled.contextSnapshot.instructionsSourceKind).toBeUndefined();
    expect(reconciled.contextSnapshot.instructionsSourcePacketMetrics).toBeUndefined();
    expect(reconciled.contextSnapshot.resumeSessionParams).toBeUndefined();
    expect(reconciled.contextSnapshot.resumeSessionDisplayId).toBeUndefined();
  });

  it("clears one-shot fresh-session flags once the fingerprint matches again", () => {
    const reconciled = reconcileExecutionContextFingerprint(
      {
        executionContextFingerprintHash: "same-hash",
        executionContextForceFreshSession: true,
        forceFreshSession: true,
      },
      "same-hash",
    );

    expect(reconciled.changed).toBe(false);
    expect(reconciled.contextSnapshot.executionContextForceFreshSession).toBeUndefined();
    expect(reconciled.contextSnapshot.forceFreshSession).toBeUndefined();
  });
});
