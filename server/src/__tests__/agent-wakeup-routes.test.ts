import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

const baseAgent = {
  id: agentId,
  companyId,
  name: "Builder",
  urlKey: "builder",
  role: "engineer",
  title: "Builder",
  icon: null,
  status: "idle",
  reportsTo: null,
  capabilities: null,
  adapterType: "codex_local",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-03-19T00:00:00.000Z"),
  updatedAt: new Date("2026-03-19T00:00:00.000Z"),
};

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(),
  wakeup: vi.fn(),
  listTaskSessions: vi.fn(),
  resetRuntimeSession: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  resolveAdapterConfigForRuntime: vi.fn(),
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => ({
    getBundle: vi.fn(),
    readFile: vi.fn(),
    updateBundle: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    exportFiles: vi.fn(),
    ensureManagedBundle: vi.fn(),
    materializeManagedBundle: vi.fn(),
  }),
  accessService: () => mockAccessService,
  approvalService: () => ({}),
  companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
  budgetService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("agent wakeup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue(baseAgent);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: baseAgent });
    mockHeartbeatService.getRun.mockResolvedValue({
      id: runId,
      companyId,
      agentId,
      contextSnapshot: {
        issueId: "issue-inherited",
        taskId: "issue-inherited",
        taskKey: "issue:issue-inherited",
        commentId: "comment-inherited",
        wakeCommentId: "comment-inherited",
      },
    });
    mockHeartbeatService.wakeup.mockResolvedValue({
      id: "run-next",
      companyId,
      agentId,
      status: "queued",
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("inherits task scope from the current run for same-agent self-requeue", async () => {
    const app = createApp({
      type: "agent",
      agentId,
      companyId,
      runId,
      source: "agent_jwt",
    });

    const res = await request(app)
      .post(`/api/agents/${agentId}/wakeup`)
      .send({ reason: "continue" });

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(runId);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        reason: "continue",
        payload: {
          issueId: "issue-inherited",
          taskId: "issue-inherited",
          taskKey: "issue:issue-inherited",
          commentId: "comment-inherited",
          wakeCommentId: "comment-inherited",
        },
      }),
    );
  });

  it("lets explicit payload scope win while inheriting missing task fields", async () => {
    const app = createApp({
      type: "agent",
      agentId,
      companyId,
      runId,
      source: "agent_jwt",
    });

    const res = await request(app)
      .post(`/api/agents/${agentId}/wakeup`)
      .send({
        reason: "continue",
        payload: {
          issueId: "issue-explicit",
          taskKey: "issue:issue-explicit",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        payload: {
          issueId: "issue-explicit",
          taskId: "issue-inherited",
          taskKey: "issue:issue-explicit",
          commentId: "comment-inherited",
          wakeCommentId: "comment-inherited",
        },
      }),
    );
  });

  it("does not inherit task scope for board-triggered wakes", async () => {
    const app = createApp({
      type: "board",
      userId: "board-user",
      companyIds: [companyId],
      source: "local_implicit",
      isInstanceAdmin: true,
      runId,
    });

    const res = await request(app)
      .post(`/api/agents/${agentId}/wakeup`)
      .send({ reason: "continue" });

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        payload: null,
      }),
    );
  });
});
