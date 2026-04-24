import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const agentId = "22222222-2222-4222-8222-222222222222";

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

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockIssueReferenceService = vi.hoisted(() => ({
  syncIssue: vi.fn(async () => undefined),
  syncComment: vi.fn(async () => undefined),
  syncDocument: vi.fn(async () => undefined),
  deleteDocumentSource: vi.fn(async () => undefined),
  listIssueReferenceSummary: vi.fn(async () => ({
    outbound: [],
    inbound: [],
  })),
  emptySummary: vi.fn(() => ({
    outbound: [],
    inbound: [],
  })),
  diffIssueReferenceSummary: vi.fn(() => ({
    addedReferencedIssues: [],
    removedReferencedIssues: [],
    currentReferencedIssues: [],
  })),
}));
const mockIssueThreadInteractionService = vi.hoisted(() => ({
  expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({}),
  agentService: () => ({}),
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  feedbackService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  instanceSettingsService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  issueReferenceService: () => mockIssueReferenceService,
  issueThreadInteractionService: () => mockIssueThreadInteractionService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function createApp(actor?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor ?? {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue(status: "backlog" | "todo" | "in_progress" | "done" | "cancelled") {
  return {
    id: "issue-1",
    companyId: "company-1",
    status,
    assigneeAgentId: agentId,
    assigneeUserId: null,
    parentId: "parent-1",
    createdByUserId: "local-board",
    identifier: "PAP-600",
    title: "Leaf issue",
  };
}

async function flushWakeups() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("issue same-assignee handoff wakeup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-1",
      issueId: "issue-1",
      companyId: "company-1",
      body: "handoff",
      createdAt: new Date(),
      updatedAt: new Date(),
      authorAgentId: null,
      authorUserId: "local-board",
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
  });

  it("wakes the same assignee when a manager posts a handoff comment and activates the issue", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("todo"));
    mockIssueService.update.mockResolvedValue({
      ...makeIssue("todo"),
      status: "in_progress",
    });

    const res = await request(createApp())
      .patch("/api/issues/issue-1")
      .send({ status: "in_progress", comment: "continue implementation" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        source: "automation",
        reason: "issue_handoff_same_assignee",
        payload: expect.objectContaining({
          issueId: "issue-1",
          commentId: "comment-1",
          mutation: "update",
        }),
        contextSnapshot: expect.objectContaining({
          issueId: "issue-1",
          taskId: "issue-1",
          commentId: "comment-1",
          wakeCommentId: "comment-1",
          wakeReason: "issue_handoff_same_assignee",
        }),
      }),
    );
  });

  it("does not wake on same-assignee status changes without a handoff comment", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("todo"));
    mockIssueService.update.mockResolvedValue({
      ...makeIssue("todo"),
      status: "in_progress",
    });

    const res = await request(createApp())
      .patch("/api/issues/issue-1")
      .send({ status: "in_progress" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("does not wake on same-assignee comments when status does not change", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("todo"));
    mockIssueService.update.mockResolvedValue(makeIssue("todo"));

    const res = await request(createApp())
      .patch("/api/issues/issue-1")
      .send({ comment: "just a note" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("does not trigger when the assignee is updating its own issue", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("todo"));
    mockIssueService.update.mockResolvedValue({
      ...makeIssue("todo"),
      status: "in_progress",
    });

    const res = await request(createApp({
      type: "agent",
      agentId,
      companyId: "company-1",
      source: "agent_jwt",
    }))
      .patch("/api/issues/issue-1")
      .send({ status: "in_progress", comment: "self update" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("keeps backlog-exit wake behavior unchanged", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("backlog"));
    mockIssueService.update.mockResolvedValue({
      ...makeIssue("backlog"),
      status: "todo",
    });

    const res = await request(createApp())
      .patch("/api/issues/issue-1")
      .send({ status: "todo", comment: "activate now" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        reason: "issue_status_changed",
      }),
    );
  });

  it("does not trigger for terminal same-assignee transitions", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue("in_progress"));
    mockIssueService.update.mockResolvedValue({
      ...makeIssue("in_progress"),
      status: "done",
    });

    const res = await request(createApp())
      .patch("/api/issues/issue-1")
      .send({ status: "done", comment: "wrapped" });
    await flushWakeups();

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });
});
