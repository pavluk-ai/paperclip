import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issues,
  type Db,
} from "@paperclipai/db";
import { runningProcesses } from "../adapters/index.js";
import { heartbeatService } from "../services/heartbeat.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

const tempPaths: string[] = [];
const runningInstances: EmbeddedPostgresInstance[] = [];
const openDbs: Db[] = [];
const DEFERRED_WAKE_CONTEXT_KEY = "_paperclipWakeContext";

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function createTempDatabase(): Promise<string> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-deferred-"));
  tempPaths.push(dataDir);
  const port = await getAvailablePort();
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await instance.initialise();
  await instance.start();
  runningInstances.push(instance);

  const adminUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminUrl, "paperclip");
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

function createTrackedDb(connectionString: string) {
  const db = createDb(connectionString);
  openDbs.push(db);
  return db;
}

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

function longRunningProcessConfig() {
  return {
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30000)"],
    cwd: process.cwd(),
    graceSec: 1,
  };
}

async function insertCompany(db: Db) {
  const prefix = `T${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  return db
    .insert(companies)
    .values({
      name: `Test Company ${prefix}`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function insertAgent(
  db: Db,
  companyId: string,
  name: string,
  overrides?: Partial<typeof agents.$inferInsert>,
) {
  return db
    .insert(agents)
    .values({
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: longRunningProcessConfig(),
      runtimeConfig: {},
      permissions: {},
      ...overrides,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function insertWakeRequest(
  db: Db,
  input: Partial<typeof agentWakeupRequests.$inferInsert> & {
    companyId: string;
    agentId: string;
    status: string;
  },
) {
  return db
    .insert(agentWakeupRequests)
    .values({
      companyId: input.companyId,
      agentId: input.agentId,
      source: input.source ?? "assignment",
      triggerDetail: input.triggerDetail ?? "system",
      reason: input.reason ?? "issue_assigned",
      payload: input.payload ?? null,
      status: input.status,
      requestedByActorType: input.requestedByActorType ?? "system",
      requestedByActorId: input.requestedByActorId ?? "test",
      runId: input.runId ?? null,
      finishedAt: input.finishedAt ?? null,
      error: input.error ?? null,
      claimedAt: input.claimedAt ?? null,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function insertRun(
  db: Db,
  input: Partial<typeof heartbeatRuns.$inferInsert> & {
    companyId: string;
    agentId: string;
    status: string;
  },
) {
  return db
    .insert(heartbeatRuns)
    .values({
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: input.invocationSource ?? "assignment",
      triggerDetail: input.triggerDetail ?? "system",
      status: input.status,
      wakeupRequestId: input.wakeupRequestId ?? null,
      contextSnapshot: input.contextSnapshot ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      error: input.error ?? null,
      errorCode: input.errorCode ?? null,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function insertIssue(
  db: Db,
  input: Partial<typeof issues.$inferInsert> & {
    companyId: string;
    title: string;
  },
) {
  return db
    .insert(issues)
    .values({
      companyId: input.companyId,
      title: input.title,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      identifier: input.identifier ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
      executionRunId: input.executionRunId ?? null,
      executionAgentNameKey: input.executionAgentNameKey ?? null,
      executionLockedAt: input.executionLockedAt ?? null,
      checkoutRunId: input.checkoutRunId ?? null,
      completedAt: input.completedAt ?? null,
      startedAt: input.startedAt ?? null,
      updatedAt: input.updatedAt ?? undefined,
    })
    .returning()
    .then((rows) => rows[0]!);
}

function deferredPayloadForIssue(issueId: string) {
  return {
    issueId,
    mutation: "update",
    [DEFERRED_WAKE_CONTEXT_KEY]: {
      source: "issue.update",
      taskId: issueId,
      issueId,
      taskKey: issueId,
      wakeReason: "issue_assigned",
      wakeSource: "assignment",
      wakeTriggerDetail: "system",
    },
  } satisfies Record<string, unknown>;
}

afterEach(async () => {
  const drainDeadline = Date.now() + 2_000;
  while (runningProcesses.size > 0 && Date.now() < drainDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const [runId, processHandle] of runningProcesses.entries()) {
    const pid = processHandle.child.pid;
    if (typeof pid === "number") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
    runningProcesses.delete(runId);
  }

  while (openDbs.length > 0) {
    const db = openDbs.pop();
    if (!db) continue;
    const client = (db as { $client?: { end?: (options?: { timeout?: number }) => Promise<void> } }).$client;
    if (!client?.end) continue;
    try {
      await client.end({ timeout: 1 });
    } catch {
      // Connection may already be closed during teardown.
    }
  }

  while (runningInstances.length > 0) {
    const instance = runningInstances.pop();
    if (!instance) continue;
    await instance.stop();
  }
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) continue;
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("deferred issue handoff recovery", () => {
  it("promotes the run-context issue first and clears stray issue locks from the same finishing run", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createTrackedDb(connectionString);
    const heartbeat = heartbeatService(db);

    const company = await insertCompany(db);
    const sourceAgent = await insertAgent(db, company.id, "Source Agent");
    const targetAgent = await insertAgent(db, company.id, "Target Agent");

    const sourceWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "queued",
    });
    const sourceRun = await insertRun(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "running",
      wakeupRequestId: sourceWake.id,
      startedAt: new Date(),
      contextSnapshot: {},
    });

    const intendedIssue = await insertIssue(db, {
      companyId: company.id,
      title: "Intended handoff issue",
      status: "in_review",
      assigneeAgentId: targetAgent.id,
      executionRunId: sourceRun.id,
      executionLockedAt: new Date(),
      identifier: `${company.issuePrefix}-19`,
    });
    const strayIssue = await insertIssue(db, {
      companyId: company.id,
      title: "Stray issue touched by same run",
      status: "done",
      assigneeAgentId: sourceAgent.id,
      executionRunId: sourceRun.id,
      executionLockedAt: new Date(),
      identifier: `${company.issuePrefix}-17`,
      completedAt: new Date(),
    });

    await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: {
          issueId: intendedIssue.id,
          taskId: intendedIssue.id,
          taskKey: intendedIssue.id,
        },
      })
      .where(eq(heartbeatRuns.id, sourceRun.id));

    const deferredWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: targetAgent.id,
      status: "deferred_issue_execution",
      reason: "issue_execution_deferred",
      payload: deferredPayloadForIssue(intendedIssue.id),
    });

    await heartbeat.cancelRun(sourceRun.id);

    const promotedWake = await waitFor(
      () =>
        db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, deferredWake.id))
          .then((rows) => rows[0]!),
      (row) => row.status !== "deferred_issue_execution" && row.runId !== null,
    );

    const promotedRun = await waitFor(
      () => heartbeat.getRun(promotedWake.runId!),
      (row) => Boolean(row) && ["queued", "running"].includes(row.status),
    );

    const refreshedIntendedIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, intendedIssue.id))
      .then((rows) => rows[0]!);
    const refreshedStrayIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, strayIssue.id))
      .then((rows) => rows[0]!);

    expect(promotedRun?.agentId).toBe(targetAgent.id);
    expect(refreshedIntendedIssue.executionRunId).toBe(promotedWake.runId);
    expect(refreshedStrayIssue.executionRunId).toBe(sourceRun.id);

    await heartbeat.cancelActiveForAgent(targetAgent.id);
  }, 20_000);

  it("self-heals a stranded deferred wake when the issue lock points at an older terminal run", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createTrackedDb(connectionString);
    const heartbeat = heartbeatService(db);

    const company = await insertCompany(db);
    const sourceAgent = await insertAgent(db, company.id, "Source Agent");
    const targetAgent = await insertAgent(db, company.id, "Target Agent");

    const oldRun = await insertRun(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "succeeded",
      startedAt: new Date(Date.now() - 10_000),
      finishedAt: new Date(Date.now() - 5_000),
      contextSnapshot: {},
    });

    const sourceWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "queued",
    });
    const sourceRun = await insertRun(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "running",
      wakeupRequestId: sourceWake.id,
      startedAt: new Date(),
      contextSnapshot: {},
    });

    const strandedIssue = await insertIssue(db, {
      companyId: company.id,
      title: "Issue with stranded deferred wake",
      status: "in_review",
      assigneeAgentId: targetAgent.id,
      executionRunId: oldRun.id,
      executionLockedAt: new Date(Date.now() - 5_000),
      identifier: `${company.issuePrefix}-42`,
    });

    await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: {
          issueId: strandedIssue.id,
          taskId: strandedIssue.id,
          taskKey: strandedIssue.id,
        },
      })
      .where(eq(heartbeatRuns.id, sourceRun.id));

    const deferredWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: targetAgent.id,
      status: "deferred_issue_execution",
      reason: "issue_execution_deferred",
      payload: deferredPayloadForIssue(strandedIssue.id),
    });

    await heartbeat.cancelRun(sourceRun.id);

    const promotedWake = await waitFor(
      () =>
        db
          .select()
          .from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, deferredWake.id))
          .then((rows) => rows[0]!),
      (row) => row.status !== "deferred_issue_execution" && row.runId !== null,
    );

    const refreshedIssue = await waitFor(
      () =>
        db
          .select()
          .from(issues)
          .where(eq(issues.id, strandedIssue.id))
          .then((rows) => rows[0]!),
      (row) => row.executionRunId !== null,
    );

    expect(refreshedIssue.executionRunId).toBe(oldRun.id);

    await heartbeat.cancelActiveForAgent(targetAgent.id);
  }, 20_000);

  it("coalesces into an existing queued run instead of creating a duplicate promoted run", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createTrackedDb(connectionString);
    const heartbeat = heartbeatService(db);

    const company = await insertCompany(db);
    const sourceAgent = await insertAgent(db, company.id, "Source Agent");
    const targetAgent = await insertAgent(db, company.id, "Target Agent");

    const oldRun = await insertRun(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "succeeded",
      startedAt: new Date(Date.now() - 10_000),
      finishedAt: new Date(Date.now() - 5_000),
      contextSnapshot: {},
    });

    const targetWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: targetAgent.id,
      status: "queued",
      payload: { issueId: "placeholder" },
    });

    const issue = await insertIssue(db, {
      companyId: company.id,
      title: "Issue with existing queued target run",
      status: "in_review",
      assigneeAgentId: targetAgent.id,
      executionRunId: oldRun.id,
      executionLockedAt: new Date(Date.now() - 5_000),
      identifier: `${company.issuePrefix}-43`,
    });

    const existingQueuedRun = await insertRun(db, {
      companyId: company.id,
      agentId: targetAgent.id,
      status: "queued",
      wakeupRequestId: targetWake.id,
      contextSnapshot: {
        issueId: issue.id,
        taskId: issue.id,
        taskKey: issue.id,
      },
    });

    await db
      .update(agentWakeupRequests)
      .set({ payload: { issueId: issue.id }, runId: existingQueuedRun.id })
      .where(eq(agentWakeupRequests.id, targetWake.id));

    const sourceWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "queued",
    });
    const sourceRun = await insertRun(db, {
      companyId: company.id,
      agentId: sourceAgent.id,
      status: "running",
      wakeupRequestId: sourceWake.id,
      startedAt: new Date(),
      contextSnapshot: {
        issueId: issue.id,
        taskId: issue.id,
        taskKey: issue.id,
      },
    });

    const deferredWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: targetAgent.id,
      status: "deferred_issue_execution",
      reason: "issue_execution_deferred",
      payload: deferredPayloadForIssue(issue.id),
    });

    await heartbeat.cancelRun(sourceRun.id);

    const refreshedDeferredWake = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, deferredWake.id))
      .then((rows) => rows[0]!);
    const refreshedIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issue.id))
      .then((rows) => rows[0]!);
    const matchingRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.agentId, targetAgent.id),
          inArray(heartbeatRuns.status, ["queued", "running"]),
        ),
      );

    if (refreshedDeferredWake.runId) {
      expect(refreshedDeferredWake.runId).toBe(existingQueuedRun.id);
    }
    expect(
      matchingRuns.filter((row) => (row.contextSnapshot as Record<string, unknown> | null)?.issueId === issue.id),
    ).toHaveLength(1);
  }, 20_000);

  it("preserves normal assignment wake behavior when no execution lock is active", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createTrackedDb(connectionString);
    const heartbeat = heartbeatService(db);

    const company = await insertCompany(db);
    const agent = await insertAgent(db, company.id, "Wake Target");
    const issue = await insertIssue(db, {
      companyId: company.id,
      title: "Normal assignment wake",
      status: "todo",
      assigneeAgentId: agent.id,
      identifier: `${company.issuePrefix}-50`,
    });

    const run = await heartbeat.wakeup(agent.id, {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: issue.id },
    });

    expect(run).not.toBeNull();

    const refreshedIssue = await waitFor(
      () =>
        db
          .select()
          .from(issues)
          .where(eq(issues.id, issue.id))
          .then((rows) => rows[0]!),
      (row) => row.executionRunId !== null,
    );

    expect(refreshedIssue.executionRunId).toBeTruthy();

    await heartbeat.cancelActiveForAgent(agent.id);
  }, 20_000);

  it("starts the next queued run for the agent after cancelling a stale running run", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const db = createTrackedDb(connectionString);
    const heartbeat = heartbeatService(db);

    const company = await insertCompany(db);
    const agent = await insertAgent(db, company.id, "Serial Agent");
    const queuedIssue = await insertIssue(db, {
      companyId: company.id,
      title: "Queued follow-up issue",
      status: "todo",
      assigneeAgentId: agent.id,
      identifier: `${company.issuePrefix}-51`,
    });

    const runningWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: agent.id,
      status: "claimed",
    });
    const runningRun = await insertRun(db, {
      companyId: company.id,
      agentId: agent.id,
      status: "running",
      wakeupRequestId: runningWake.id,
      startedAt: new Date(),
      contextSnapshot: { issueId: "11111111-1111-4111-8111-111111111111" },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId: runningRun.id })
      .where(eq(agentWakeupRequests.id, runningWake.id));

    const queuedWake = await insertWakeRequest(db, {
      companyId: company.id,
      agentId: agent.id,
      status: "queued",
      payload: { issueId: queuedIssue.id },
    });
    const queuedRun = await insertRun(db, {
      companyId: company.id,
      agentId: agent.id,
      status: "queued",
      wakeupRequestId: queuedWake.id,
      contextSnapshot: {
        issueId: queuedIssue.id,
        taskId: queuedIssue.id,
        taskKey: queuedIssue.id,
      },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId: queuedRun.id })
      .where(eq(agentWakeupRequests.id, queuedWake.id));

    await heartbeat.cancelRun(runningRun.id);

    const refreshedQueuedRun = await waitFor(
      () => heartbeat.getRun(queuedRun.id),
      (row) => Boolean(row) && row.status === "running",
    );

    expect(refreshedQueuedRun?.status).toBe("running");

    await heartbeat.cancelActiveForAgent(agent.id);
  }, 20_000);
});
