import { describe, expect, it, vi } from "vitest";
import { agents, companyMemberships } from "@paperclipai/db";
import {
  agentMembershipStatusForAgentStatus,
  reconcileAgentMembershipDrift,
} from "../services/agents.ts";

function createDbStub(input: {
  agentRows: Array<{ id: string; companyId: string; status: string }>;
  membershipRows: Array<{ companyId: string; principalId: string }>;
}) {
  const where = vi.fn(async () => input.membershipRows);
  const from = vi.fn((table: unknown) => {
    if (table === agents) {
      return Promise.resolve(input.agentRows);
    }
    if (table === companyMemberships) {
      return { where };
    }
    return Promise.resolve([]);
  });
  const select = vi.fn(() => ({ from }));
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return {
    db: { select, insert },
    values,
  };
}

describe("agent membership drift repair", () => {
  it("maps agent statuses onto membership statuses", () => {
    expect(agentMembershipStatusForAgentStatus("pending_approval")).toBe("pending");
    expect(agentMembershipStatusForAgentStatus("terminated")).toBe("suspended");
    expect(agentMembershipStatusForAgentStatus("idle")).toBe("active");
  });

  it("inserts missing memberships for agents without touching existing rows", async () => {
    const dbStub = createDbStub({
      agentRows: [
        { id: "agent-1", companyId: "company-1", status: "idle" },
        { id: "agent-2", companyId: "company-1", status: "pending_approval" },
        { id: "agent-3", companyId: "company-1", status: "terminated" },
      ],
      membershipRows: [
        { companyId: "company-1", principalId: "agent-1" },
      ],
    });

    const repaired = await reconcileAgentMembershipDrift(dbStub.db as any);

    expect(repaired).toBe(2);
    expect(dbStub.values).toHaveBeenCalledWith([
      {
        companyId: "company-1",
        principalType: "agent",
        principalId: "agent-2",
        status: "pending",
        membershipRole: "member",
      },
      {
        companyId: "company-1",
        principalType: "agent",
        principalId: "agent-3",
        status: "suspended",
        membershipRole: "member",
      },
    ]);
  });

  it("is a no-op when every agent already has a membership", async () => {
    const dbStub = createDbStub({
      agentRows: [{ id: "agent-1", companyId: "company-1", status: "idle" }],
      membershipRows: [{ companyId: "company-1", principalId: "agent-1" }],
    });

    const repaired = await reconcileAgentMembershipDrift(dbStub.db as any);

    expect(repaired).toBe(0);
    expect(dbStub.values).not.toHaveBeenCalled();
  });
});
