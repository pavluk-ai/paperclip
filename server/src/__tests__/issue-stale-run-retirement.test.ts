import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockAgentService = vi.hoisted(() => ({
  resolveByReference: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockSyncRunStatusForIssue = vi.hoisted(() => vi.fn(async () => undefined));
const currentActor = vi.hoisted(() => ({
  actor: {
    type: "board" as const,
    userId: "local-board",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: false,
  } as any,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => true),
    getPermissionStatus: vi.fn(async () => ({
      membership: { status: "active" },
      hasGrant: true,
    })),
    hasPermission: vi.fn(async () => true),
  }),
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  instanceSettingsService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: mockSyncRunStatusForIssue,
  }),
  workProductService: () => ({}),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = currentActor.actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue(overrides?: Record<string, unknown>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    status: "in_progress",
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    executionRunId: "33333333-3333-4333-8333-333333333333",
    parentId: null,
    createdByUserId: "local-board",
    identifier: "PAP-101",
    title: "Tracked issue",
    ...overrides,
  };
}

function makeRun(overrides?: Record<string, unknown>) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    agentId: "22222222-2222-4222-8222-222222222222",
    status: "running",
    contextSnapshot: { issueId: "11111111-1111-4111-8111-111111111111" },
    ...overrides,
  };
}

describe("issue stale execution retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentActor.actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockAgentService.resolveByReference.mockImplementation(async (_companyId: string, raw: string) => ({
      ambiguous: false,
      agent: { id: raw },
    }));
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
  });

  it("cancels a stale foreign run when the issue is closed", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      status: "done",
    });
    mockHeartbeatService.getRun.mockResolvedValue(makeRun());
    mockHeartbeatService.cancelRun.mockResolvedValue({
      ...makeRun(),
      status: "cancelled",
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("cancels a stale foreign run when the issue is cancelled", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      status: "cancelled",
    });
    mockHeartbeatService.getRun.mockResolvedValue(makeRun());
    mockHeartbeatService.cancelRun.mockResolvedValue({
      ...makeRun(),
      status: "cancelled",
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("cancels a stale foreign run when the issue is parked in backlog", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      status: "backlog",
    });
    mockHeartbeatService.getRun.mockResolvedValue(makeRun());
    mockHeartbeatService.cancelRun.mockResolvedValue({
      ...makeRun(),
      status: "cancelled",
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "backlog" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("cancels a stale foreign run when the issue is reassigned away from that agent", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      assigneeAgentId: "44444444-4444-4444-8444-444444444444",
    });
    mockHeartbeatService.getRun.mockResolvedValue(makeRun());
    mockHeartbeatService.cancelRun.mockResolvedValue({
      ...makeRun(),
      status: "cancelled",
    });

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ assigneeAgentId: "44444444-4444-4444-8444-444444444444" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("does not inline-cancel the same run when an agent updates its own issue", async () => {
    currentActor.actor = {
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      runId: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      source: "agent_api_key",
    };
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      status: "done",
    });
    mockHeartbeatService.getRun.mockResolvedValue(makeRun());

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
  });

  it("does not cancel an unrelated active run for the same assignee", async () => {
    mockIssueService.getById.mockResolvedValue({
      ...makeIssue(),
      executionRunId: null,
    });
    mockIssueService.update.mockResolvedValue({
      ...makeIssue(),
      executionRunId: null,
      status: "done",
    });
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(
      makeRun({
        id: "55555555-5555-4555-8555-555555555555",
        contextSnapshot: { issueId: "66666666-6666-4666-8666-666666666666" },
      }),
    );

    const res = await request(createApp())
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
  });
});
