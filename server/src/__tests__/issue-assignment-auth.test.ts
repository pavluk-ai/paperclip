import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  getPermissionStatus: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({}));
const mockGoalService = vi.hoisted(() => ({}));
const mockIssueApprovalService = vi.hoisted(() => ({
  listApprovalsForIssue: vi.fn(async () => []),
}));
const mockExecutionWorkspaceService = vi.hoisted(() => ({}));
const mockWorkProductService = vi.hoisted(() => ({}));
const mockDocumentService = vi.hoisted(() => ({}));
const mockRoutineService = vi.hoisted(() => ({
  syncRunStatusForIssue: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
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

function createEmptySelectChain() {
  const rows = Promise.resolve([]);
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        then: rows.then.bind(rows),
      })),
    })),
  };
}

const mockDb = {
  select: vi.fn(() => createEmptySelectChain()),
};

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  companyService: () => ({ getById: vi.fn(async () => null) }),
  heartbeatService: () => mockHeartbeatService,
  issueService: () => mockIssueService,
  projectService: () => mockProjectService,
  goalService: () => mockGoalService,
  instanceSettingsService: () => ({}),
  issueApprovalService: () => mockIssueApprovalService,
  issueRecoveryActionService: () => ({
    getActiveForIssue: vi.fn(async () => null),
    listActiveForIssues: vi.fn(async () => []),
    resolveActiveForIssue: vi.fn(async () => null),
  }),
  executionWorkspaceService: () => mockExecutionWorkspaceService,
  feedbackService: () => ({}),
  workProductService: () => mockWorkProductService,
  documentService: () => mockDocumentService,
  documentAnnotationService: () => ({}),
  issueReferenceService: () => mockIssueReferenceService,
  issueThreadInteractionService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
  routineService: () => mockRoutineService,
  logActivity: mockLogActivity,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      source: "agent_key",
    };
    next();
  });
  app.use(
    "/api",
    issueRoutes(
      mockDb as any,
      {} as any,
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("issue assignment auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockIssueService.create.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-1",
      title: "Review child task",
      status: "todo",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      assigneeUserId: null,
    });
    mockAgentService.resolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: {
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "company-1",
        status: "active",
        orgChainHealth: { status: "ok" },
      },
    });
    mockLogActivity.mockResolvedValue(undefined);
    mockRoutineService.syncRunStatusForIssue.mockResolvedValue(undefined);
  });

  it("returns a membership-specific error when the acting agent has no active membership", async () => {
    mockAccessService.decide.mockResolvedValue({
      allowed: false,
      explanation:
        "Agent company access is missing or inactive. Open Company Settings -> Access and make sure this agent has an active membership.",
    });

    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Review child task",
        status: "todo",
        assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("company access is missing or inactive");
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("returns a grant-specific error when the acting agent is a member without tasks:assign", async () => {
    mockAccessService.decide.mockResolvedValue({
      allowed: false,
      explanation:
        "Missing permission: tasks:assign. Open Company Settings -> Access and grant tasks:assign to this agent.",
    });

    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Review child task",
        status: "todo",
        assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Missing permission: tasks:assign");
    expect(mockAgentService.getById).not.toHaveBeenCalled();
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("creates the issue and wakes the assignee when the acting agent has membership and grant", async () => {
    mockAccessService.decide.mockResolvedValue({ allowed: true });

    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Review child task",
        status: "todo",
        assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      });

    expect(res.status).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        source: "assignment",
        reason: "issue_assigned",
      }),
    );
  });
});
