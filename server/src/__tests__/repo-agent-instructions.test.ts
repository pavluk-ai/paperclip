import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  documents,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  reconcileSourceBackedSessionContext,
  repoAgentInstructionsService,
} from "../services/repo-agent-instructions.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres repo-backed instructions tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("reconcileSourceBackedSessionContext", () => {
  it("forces a fresh session and clears explicit resume fields when the source hash changes", () => {
    const result = reconcileSourceBackedSessionContext(
      {
        instructionsSourceHash: "old-hash",
        resumeSessionDisplayId: "session-1",
        resumeSessionParams: { sessionId: "session-1" },
        resumeFromRunId: "run-1",
      },
      "new-hash",
    );

    expect(result.changed).toBe(true);
    expect(result.previousHash).toBe("old-hash");
    expect(result.contextSnapshot.forceFreshSession).toBe(true);
    expect(result.contextSnapshot.instructionsSourceForceFreshSession).toBe(true);
    expect(result.contextSnapshot.resumeSessionDisplayId).toBeUndefined();
    expect(result.contextSnapshot.resumeSessionParams).toBeUndefined();
    expect(result.contextSnapshot.resumeFromRunId).toBeUndefined();
  });

  it("clears the source-forced fresh-session flag once the hash matches again", () => {
    const result = reconcileSourceBackedSessionContext(
      {
        instructionsSourceHash: "same-hash",
        forceFreshSession: true,
        instructionsSourceForceFreshSession: true,
      },
      "same-hash",
    );

    expect(result.changed).toBe(false);
    expect(result.contextSnapshot.forceFreshSession).toBeUndefined();
    expect(result.contextSnapshot.instructionsSourceForceFreshSession).toBeUndefined();
  });
});

describeEmbeddedPostgres("repo-backed runtime instructions", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const cleanupDirs = new Set<string>();
  const originalPaperclipHome = process.env.PAPERCLIP_HOME;
  const originalPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-repo-agent-instructions-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = originalPaperclipHome;
    if (originalPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = originalPaperclipInstanceId;

    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);

    await Promise.all([...cleanupDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
      cleanupDirs.delete(dir);
    }));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedRepoBackedFixture(description: string) {
    const repoRoot = await makeTempDir("paperclip-repo-agent-instructions-repo-");
    const paperclipHome = await makeTempDir("paperclip-repo-agent-instructions-home-");
    cleanupDirs.add(repoRoot);
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    await fs.mkdir(path.join(repoRoot, "documentation", "paperclip", "agent-prompts"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "documentation", "phases"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "documentation", "paperclip"), { recursive: true });

    await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "# Repo Rules\n\nStay in scope.\n", "utf8");
    await fs.writeFile(
      path.join(repoRoot, "documentation", "paperclip", "agent-prompts", "senior-implementer.md"),
      "Implement only the linked contract.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(repoRoot, "documentation", "phases", "phase-0-foundation.md"),
      "# Phase 0\n\nFlutter shell is required.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(repoRoot, "documentation", "paperclip", "execution-contract.md"),
      "# Execution Contract\n\nUse exact linked docs only.\n",
      "utf8",
    );

    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const documentId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const now = new Date("2026-04-16T00:00:00.000Z");

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Senior Implementer",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      metadata: {
        instructionsSource: {
          kind: "repo_paperclip_lane",
          repoRoot,
          packRoot: "documentation/paperclip",
          lanePromptPath: "agent-prompts/senior-implementer.md",
          laneName: "Senior Implementer",
        },
      },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "LEAF-0.7: Frontend app shell",
      description,
      status: "todo",
      priority: "medium",
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Runtime contract",
      format: "markdown",
      latestBody: "## Runtime Contract\n\nUse marionette + integration_test.\n",
      latestRevisionId: null,
      latestRevisionNumber: 1,
      createdByUserId: "board",
      updatedByUserId: "board",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "runtime-contract",
      createdAt: now,
      updatedAt: now,
    });

    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0]!);
    return { repoRoot, paperclipHome, agent, issueId };
  }

  it("builds a runtime packet from repo AGENTS, lane addendum, issue docs, and linked repo docs", async () => {
    const { agent, issueId, paperclipHome } = await seedRepoBackedFixture(
      [
        "Milestone: [FLU-1](/FLU/issues/FLU-1)",
        "Use the exact source pack below:",
        "- `documentation/phases/phase-0-foundation.md`",
        '- [Execution contract](documentation/paperclip/execution-contract.md)',
      ].join("\n"),
    );
    const svc = repoAgentInstructionsService(db);

    const prepared = await svc.prepareRuntimePacket(agent, issueId);

    expect(prepared).toBeTruthy();
    expect(prepared?.issueDocumentKeys).toEqual(["runtime-contract"]);
    expect(prepared?.linkedRepoPaths).toEqual([
      "documentation/paperclip/execution-contract.md",
      "documentation/phases/phase-0-foundation.md",
    ]);
    expect(prepared?.instructionsFilePath.startsWith(path.join(
      paperclipHome,
      "instances",
      "test-instance",
      "companies",
      agent.companyId,
      "agents",
      agent.id,
      "instructions",
      ".runtime",
      "repo-paperclip-lane",
    ))).toBe(true);

    const generated = await fs.readFile(prepared!.instructionsFilePath, "utf8");
    expect(generated).toContain("## Paperclip Control-Plane Workflow");
    expect(generated).toContain("Checkout the assigned issue before substantive work.");
    expect(generated).toContain("# Repo Rules");
    expect(generated).toContain("Implement only the linked contract.");
    expect(generated).toContain("LEAF-0.7: Frontend app shell");
    expect(generated).toContain("Use marionette + integration_test.");
    expect(generated).toContain("Flutter shell is required.");
    expect(generated).toContain("Use exact linked docs only.");
  });

  it("fails closed when a referenced repo doc is missing", async () => {
    const { agent, issueId } = await seedRepoBackedFixture(
      "- `documentation/paperclip/missing.md`",
    );
    const svc = repoAgentInstructionsService(db);

    await expect(svc.prepareRuntimePacket(agent, issueId)).rejects.toThrow(
      "Linked repo doc is missing: documentation/paperclip/missing.md",
    );
  });
});
