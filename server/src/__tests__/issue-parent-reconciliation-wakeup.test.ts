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
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
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

function makeChildIssue(status: "todo" | "in_progress" | "done") {
  return {
    id: "child-1",
    companyId: "company-1",
    status,
    assigneeAgentId: "worker-1",
    assigneeUserId: null,
    parentId: "parent-1",
    createdByUserId: "local-board",
    identifier: "PAP-101",
    title: "Child issue",
  };
}

function makeParentIssue(status: "backlog" | "todo" | "in_progress" | "in_review" | "done") {
  return {
    id: "parent-1",
    companyId: "company-1",
    status,
    assigneeAgentId: "manager-1",
    assigneeUserId: null,
    parentId: null,
    createdByUserId: "local-board",
    identifier: "PAP-100",
    title: "Parent issue",
  };
}

describe("issue parent reconciliation wakeup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-1",
      issueId: "child-1",
      companyId: "company-1",
      body: "hello",
      createdAt: new Date(),
      updatedAt: new Date(),
      authorAgentId: null,
      authorUserId: "local-board",
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
  });

  it("wakes the parent assignee when a child enters a terminal state", async () => {
    mockIssueService.getById
      .mockResolvedValueOnce(makeChildIssue("in_progress"))
      .mockResolvedValueOnce(makeParentIssue("in_progress"));
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("in_progress"),
      status: "done",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "manager-1",
      expect.objectContaining({
        source: "automation",
        reason: "child_issue_terminal",
        payload: expect.objectContaining({
          issueId: "parent-1",
          parentIssueId: "parent-1",
          childIssueId: "child-1",
          childIssueStatus: "done",
        }),
      }),
    );
  });

  it("does not wake the parent assignee for non-terminal child status changes", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeChildIssue("todo"));
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("todo"),
      status: "in_progress",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("does not wake a dormant parent when a child closes", async () => {
    mockIssueService.getById
      .mockResolvedValueOnce(makeChildIssue("in_progress"))
      .mockResolvedValueOnce(makeParentIssue("backlog"));
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("in_progress"),
      status: "done",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("wakes the parent assignee when a child is blocked", async () => {
    mockIssueService.getById
      .mockResolvedValueOnce(makeChildIssue("in_progress"))
      .mockResolvedValueOnce(makeParentIssue("in_review"));
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("in_progress"),
      status: "blocked",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "blocked" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "manager-1",
      expect.objectContaining({
        reason: "child_issue_terminal",
        payload: expect.objectContaining({
          childIssueStatus: "blocked",
        }),
      }),
    );
  });

  it("wakes the parent assignee when a child is cancelled", async () => {
    mockIssueService.getById
      .mockResolvedValueOnce(makeChildIssue("in_progress"))
      .mockResolvedValueOnce(makeParentIssue("todo"));
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("in_progress"),
      status: "cancelled",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "manager-1",
      expect.objectContaining({
        reason: "child_issue_terminal",
        payload: expect.objectContaining({
          childIssueStatus: "cancelled",
        }),
      }),
    );
  });

  it("queues only one parent reconciliation wake when parent and child share the same assignee", async () => {
    mockIssueService.getById
      .mockResolvedValueOnce({
        ...makeChildIssue("in_progress"),
        assigneeAgentId: "manager-1",
      })
      .mockResolvedValueOnce({
        ...makeParentIssue("in_progress"),
        assigneeAgentId: "manager-1",
      });
    mockIssueService.update.mockResolvedValue({
      ...makeChildIssue("in_progress"),
      assigneeAgentId: "manager-1",
      status: "done",
    });

    const res = await request(createApp())
      .patch("/api/issues/child-1")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "manager-1",
      expect.objectContaining({
        reason: "child_issue_terminal",
      }),
    );
  });
});
