import { describe, expect, it } from "vitest";
import { buildAgentSnippet } from "./company-settings-snippet";

describe("buildAgentSnippet", () => {
  it("documents persona-bound routing and workspace-local claim storage", () => {
    const snippet = buildAgentSnippet({
      onboardingTextUrl: "http://localhost:3100/api/invites/token-123/onboarding.txt",
      connectionCandidates: ["http://localhost:3100"],
      testResolutionUrl: "http://localhost:3100/api/openclaw/test-resolution",
    });

    expect(snippet).toContain('agentDefaultsPayload.agentId');
    expect(snippet).toContain('sessionKeyStrategy: "fixed"');
    expect(snippet).toContain("~/.openclaw/openclaw.json");
    expect(snippet).toContain("agents.list[].workspace");
    expect(snippet).toContain("channels.telegram.groups[*].topics");
    expect(snippet).toContain("stop and ask the operator instead of guessing");
    expect(snippet).toContain("./paperclip-claimed-api-key.json");
    expect(snippet).toContain("GET /api/agents/me");
    expect(snippet).not.toContain("another session called \"paperclip-onboarding\"");
    expect(snippet).not.toContain("~/.openclaw/workspace/paperclip-claimed-api-key.json");
  });
});
