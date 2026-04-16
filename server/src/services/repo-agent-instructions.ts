import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { resolveHomeAwarePath } from "../home-paths.js";
import { resolveManagedInstructionsRoot } from "./agent-instructions.js";
import { documentService } from "./documents.js";

const SOURCE_KIND = "repo_paperclip_lane";
const SOURCE_VERSION = "repo_paperclip_lane/v2";
const RUNTIME_DIR_NAME = ".runtime/repo-paperclip-lane";
const MARKDOWN_LINK_RE = /\[[^\]]+]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".html", ".txt", ".yaml", ".yml", ".json"]);
const PAPERCLIP_RUNTIME_WORKFLOW = [
  "## Paperclip Control-Plane Workflow",
  "",
  "These operating rules stay in force for every repo-backed run.",
  "",
  "Before repo exploration or code changes:",
  "1. If a wake payload or wake comment is present, treat it as the highest-priority change for this run.",
  "2. Checkout the assigned issue before substantive work. For comment wakes, read the new comment first, then checkout.",
  "3. Do not switch to another issue unless Paperclip routing explicitly reassigns you.",
  "",
  "During the run:",
  "- Keep work scoped to the assigned issue and the linked docs in this packet.",
  "- Prefer the provided wake payload or `/api/issues/{id}/heartbeat-context` over replaying full threads unless broader context is required.",
  "- Route to the next owner only when the issue contract and routing docs say the handoff is ready.",
  "",
  "Before exiting:",
  "- Update the issue with status plus a comment that records what changed.",
  "- If blocked, set `blocked` with the concrete blocker and who must act next.",
  "- Do not leave the issue idle without an explicit status update.",
].join("\n");

type AgentLike = {
  id: string;
  companyId: string;
  name: string;
  adapterConfig: unknown;
  metadata: unknown;
};

type RepoPaperclipLaneSource = {
  kind: typeof SOURCE_KIND;
  repoRoot: string;
  packRoot: string;
  lanePromptPath: string | null;
  laneName: string | null;
};

type PreparedRepoAgentInstructions = {
  kind: typeof SOURCE_KIND;
  version: typeof SOURCE_VERSION;
  hash: string;
  instructionsFilePath: string;
  lanePromptPath: string | null;
  laneName: string | null;
  repoRoot: string;
  packRoot: string;
  linkedRepoPaths: string[];
  issueDocumentKeys: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAbsolutePath(candidatePath: string, fieldName: string) {
  const resolved = resolveHomeAwarePath(candidatePath);
  if (!path.isAbsolute(resolved)) {
    throw unprocessable(`${fieldName} must resolve to an absolute path`);
  }
  return path.resolve(resolved);
}

function ensurePathWithinRoot(rootPath: string, candidatePath: string, fieldName: string) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw unprocessable(`${fieldName} must stay within ${resolvedRoot}`);
  }
  return resolvedCandidate;
}

function normalizeRepoRelativePath(repoRoot: string, absolutePath: string) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function normalizeMarkdownDestination(rawDestination: string) {
  const trimmed = rawDestination.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function stripLineSuffixIfPresent(candidatePath: string) {
  return candidatePath.replace(/:(\d+)(?::\d+)?$/, "");
}

function shouldIgnoreMarkdownDestination(destination: string) {
  if (!destination || destination.startsWith("#")) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(destination);
}

function looksLikeLinkedRepoDocDestination(repoRoot: string, destination: string) {
  const normalized = stripLineSuffixIfPresent(destination.trim());
  if (!normalized) return false;
  if (path.isAbsolute(normalized)) {
    const relativeToRepo = normalizeRepoRelativePath(repoRoot, normalized);
    if (relativeToRepo.startsWith("../")) return false;
    if (relativeToRepo === "AGENTS.md" || relativeToRepo.endsWith("/AGENTS.md")) {
      return true;
    }
    return (
      (relativeToRepo.startsWith("documentation/") || relativeToRepo.startsWith("doc/"))
      && DOC_EXTENSIONS.has(path.extname(relativeToRepo).toLowerCase())
    );
  }
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  if (withoutLeadingSlash === "AGENTS.md" || withoutLeadingSlash.endsWith("/AGENTS.md")) {
    return true;
  }
  const extension = path.extname(withoutLeadingSlash).toLowerCase();
  if (!DOC_EXTENSIONS.has(extension)) return false;
  return withoutLeadingSlash.startsWith("documentation/") || withoutLeadingSlash.startsWith("doc/");
}

async function statIfFile(targetPath: string) {
  return fs.stat(targetPath).then((stats) => (stats.isFile() ? stats : null)).catch(() => null);
}

async function resolveLinkedRepoDocPath(repoRoot: string, rawDestination: string) {
  const destination = normalizeMarkdownDestination(rawDestination);
  if (shouldIgnoreMarkdownDestination(destination)) return null;
  if (!looksLikeLinkedRepoDocDestination(repoRoot, destination)) return null;

  const stripped = stripLineSuffixIfPresent(destination);
  const candidateAbsolute = path.isAbsolute(stripped)
    && !stripped.startsWith(`${path.resolve(repoRoot)}${path.sep}`)
    && (stripped.startsWith("/documentation/") || stripped.startsWith("/doc/") || stripped === "/AGENTS.md")
    ? path.resolve(repoRoot, stripped.replace(/^\/+/, ""))
    : path.isAbsolute(stripped)
      ? stripped
      : path.resolve(repoRoot, stripped.replace(/^\/+/, ""));
  const normalizedAbsolute = ensurePathWithinRoot(repoRoot, candidateAbsolute, "Linked repo doc path");
  const stat = await statIfFile(normalizedAbsolute);
  return stat ? normalizedAbsolute : null;
}

function extractMarkdownLinkDestinations(markdown: string) {
  const destinations: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_LINK_RE)) {
    const destination = match[1];
    if (!destination) continue;
    destinations.push(destination);
  }
  return destinations;
}

function looksLikeInlineDocPath(token: string) {
  const normalized = token.trim().replace(/^\/+/, "");
  if (!normalized) return false;
  if (normalized === "AGENTS.md" || normalized.endsWith("/AGENTS.md")) return true;
  if (!(normalized.startsWith("documentation/") || normalized.startsWith("doc/"))) return false;
  return DOC_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function extractInlineDocCandidates(markdown: string) {
  const candidates: string[] = [];
  for (const match of markdown.matchAll(INLINE_CODE_RE)) {
    const candidate = match[1]?.trim();
    if (!candidate || !looksLikeInlineDocPath(candidate)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

export function parseRepoPaperclipLaneSource(metadata: unknown): RepoPaperclipLaneSource | null {
  const metadataRecord = asRecord(metadata);
  const rawSource = asRecord(metadataRecord?.instructionsSource);
  if (!rawSource) return null;

  const kind = asString(rawSource.kind);
  if (!kind) {
    throw unprocessable("metadata.instructionsSource.kind is required");
  }
  if (kind !== SOURCE_KIND) {
    throw unprocessable(`Unsupported metadata.instructionsSource.kind "${kind}"`);
  }

  const repoRootRaw = asString(rawSource.repoRoot);
  if (!repoRootRaw) {
    throw unprocessable("metadata.instructionsSource.repoRoot is required");
  }

  const packRootRaw = asString(rawSource.packRoot);
  if (!packRootRaw) {
    throw unprocessable("metadata.instructionsSource.packRoot is required");
  }

  const repoRoot = normalizeAbsolutePath(repoRootRaw, "metadata.instructionsSource.repoRoot");
  const packRootCandidate = path.isAbsolute(packRootRaw)
    ? packRootRaw
    : path.resolve(repoRoot, packRootRaw);
  const packRoot = ensurePathWithinRoot(
    repoRoot,
    normalizeAbsolutePath(packRootCandidate, "metadata.instructionsSource.packRoot"),
    "metadata.instructionsSource.packRoot",
  );

  const lanePromptRaw = asString(rawSource.lanePromptPath);
  const lanePromptPath = lanePromptRaw
    ? normalizeRepoRelativePath(
        repoRoot,
        ensurePathWithinRoot(
          repoRoot,
          path.isAbsolute(lanePromptRaw) ? lanePromptRaw : path.resolve(packRoot, lanePromptRaw),
          "metadata.instructionsSource.lanePromptPath",
        ),
      )
    : null;

  return {
    kind: SOURCE_KIND,
    repoRoot,
    packRoot,
    lanePromptPath,
    laneName: asString(rawSource.laneName),
  };
}

export function reconcileSourceBackedSessionContext(
  contextSnapshot: Record<string, unknown>,
  nextHash: string,
) {
  const currentHash = asString(contextSnapshot.instructionsSourceHash);
  const sourceForcedFreshSession = contextSnapshot.instructionsSourceForceFreshSession === true;
  const shouldForceFreshSession = currentHash !== nextHash;
  const nextContext = { ...contextSnapshot };

  if (shouldForceFreshSession) {
    nextContext.forceFreshSession = true;
    nextContext.instructionsSourceForceFreshSession = true;
    delete nextContext.resumeSessionParams;
    delete nextContext.resumeSessionDisplayId;
    delete nextContext.resumeFromRunId;
  } else if (sourceForcedFreshSession) {
    delete nextContext.instructionsSourceForceFreshSession;
    delete nextContext.forceFreshSession;
  }

  return {
    contextSnapshot: nextContext,
    previousHash: currentHash,
    changed: currentHash !== nextHash,
  };
}

async function collectIssueLinkedRepoDocs(input: {
  repoRoot: string;
  issueDescription: string | null;
  issueDocuments: Array<{ body: string }>;
}) {
  const resolvedPaths = new Map<string, string>();
  const sourceBodies = [
    input.issueDescription ?? "",
    ...input.issueDocuments.map((doc) => doc.body),
  ];

  for (const sourceBody of sourceBodies) {
    for (const destination of extractMarkdownLinkDestinations(sourceBody)) {
      const normalizedDestination = normalizeMarkdownDestination(destination);
      if (shouldIgnoreMarkdownDestination(normalizedDestination)) continue;
      if (!looksLikeLinkedRepoDocDestination(input.repoRoot, normalizedDestination)) continue;
      const resolvedPath = await resolveLinkedRepoDocPath(input.repoRoot, destination);
      if (!resolvedPath) {
        throw unprocessable(`Linked repo doc is missing: ${normalizedDestination}`);
      }
      resolvedPaths.set(normalizeRepoRelativePath(input.repoRoot, resolvedPath), resolvedPath);
    }
    for (const candidate of extractInlineDocCandidates(sourceBody)) {
      const resolvedPath = await resolveLinkedRepoDocPath(input.repoRoot, candidate);
      if (!resolvedPath) {
        throw unprocessable(`Linked repo doc is missing: ${candidate}`);
      }
      resolvedPaths.set(normalizeRepoRelativePath(input.repoRoot, resolvedPath), resolvedPath);
    }
  }

  return [...resolvedPaths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, absolutePath]) => ({ relativePath, absolutePath }));
}

function renderGeneratedInstructionsMarkdown(input: {
  repoAgentsPath: string;
  repoAgentsBody: string;
  lanePromptPath: string | null;
  lanePromptBody: string | null;
  laneName: string | null;
  issue:
    | {
        identifier: string | null;
        title: string;
        status: string;
        priority: string;
        description: string | null;
      }
    | null;
  issueDocuments: Array<{ key: string; title: string | null; body: string }>;
  linkedRepoDocs: Array<{ relativePath: string; body: string }>;
}) {
  const lines: string[] = [
    "<!-- Generated by Paperclip from live repo + issue sources. -->",
    `# Paperclip Runtime Packet (${SOURCE_VERSION})`,
    "",
    "Use only the repository instructions, lane addendum, assigned issue, attached issue documents, and linked repo docs below.",
    "Do not widen scope beyond this packet.",
    "",
    PAPERCLIP_RUNTIME_WORKFLOW.trim(),
    "",
    "## Repository Instructions",
    `Source: ${input.repoAgentsPath}`,
    "",
    input.repoAgentsBody.trim(),
  ];

  if (input.lanePromptBody) {
    lines.push(
      "",
      `## Lane Addendum${input.laneName ? ` — ${input.laneName}` : ""}`,
      input.lanePromptPath ? `Source: ${input.lanePromptPath}` : "",
      "",
      input.lanePromptBody.trim(),
    );
  }

  if (input.issue) {
    lines.push(
      "",
      "## Assigned Issue",
      "",
      `- Identifier: ${input.issue.identifier ?? "(unassigned)"}`,
      `- Title: ${input.issue.title}`,
      `- Status: ${input.issue.status}`,
      `- Priority: ${input.issue.priority}`,
      "",
      input.issue.description?.trim() ? input.issue.description.trim() : "_No issue description._",
    );
  } else {
    lines.push(
      "",
      "## Assigned Issue",
      "",
      "_No issue is currently attached to this run._",
    );
  }

  if (input.issueDocuments.length > 0) {
    lines.push("", "## Issue Documents");
    for (const doc of input.issueDocuments) {
      lines.push(
        "",
        `### ${doc.key}${doc.title ? ` — ${doc.title}` : ""}`,
        "",
        doc.body.trim(),
      );
    }
  }

  if (input.linkedRepoDocs.length > 0) {
    lines.push("", "## Linked Repo Docs");
    for (const doc of input.linkedRepoDocs) {
      lines.push(
        "",
        `### ${doc.relativePath}`,
        "",
        doc.body.trim(),
      );
    }
  }

  lines.push("");
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}

export function repoAgentInstructionsService(db: Db) {
  const documentsSvc = documentService(db);

  return {
    async prepareRuntimePacket(
      agent: AgentLike,
      issueId: string | null,
    ): Promise<PreparedRepoAgentInstructions | null> {
      const source = parseRepoPaperclipLaneSource(agent.metadata);
      if (!source) return null;

      const repoAgentsPath = path.join(source.repoRoot, "AGENTS.md");
      const repoAgentsBody = await fs.readFile(repoAgentsPath, "utf8").catch(() => {
        throw unprocessable(`Repo-backed instructions require ${repoAgentsPath}`);
      });

      const lanePromptBody = source.lanePromptPath
        ? await fs.readFile(path.join(source.repoRoot, source.lanePromptPath), "utf8").catch(() => {
            throw unprocessable(
              `Repo-backed instructions missing lane prompt ${path.join(source.repoRoot, source.lanePromptPath!)}`,
            );
          })
        : null;

      const issue = issueId
        ? await db
            .select({
              identifier: issues.identifier,
              title: issues.title,
              status: issues.status,
              priority: issues.priority,
              description: issues.description,
            })
            .from(issues)
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .then((rows) => rows[0] ?? null)
        : null;
      const issueDocuments = issueId ? await documentsSvc.listIssueDocuments(issueId) : [];

      const linkedRepoDocs = await collectIssueLinkedRepoDocs({
        repoRoot: source.repoRoot,
        issueDescription: issue?.description ?? null,
        issueDocuments: issueDocuments.map((doc) => ({ body: doc.body ?? "" })),
      });
      const linkedRepoDocsWithBody = await Promise.all(
        linkedRepoDocs.map(async ({ relativePath, absolutePath }) => ({
          relativePath,
          body: await fs.readFile(absolutePath, "utf8"),
        })),
      );

      const markdown = renderGeneratedInstructionsMarkdown({
        repoAgentsPath: normalizeRepoRelativePath(source.repoRoot, repoAgentsPath),
        repoAgentsBody,
        lanePromptPath: source.lanePromptPath,
        lanePromptBody,
        laneName: source.laneName,
        issue,
        issueDocuments: issueDocuments.map((doc) => ({
          key: doc.key,
          title: doc.title ?? null,
          body: doc.body ?? "",
        })),
        linkedRepoDocs: linkedRepoDocsWithBody,
      });
      const hash = createHash("sha256").update(markdown).digest("hex");

      const runtimeRoot = path.join(resolveManagedInstructionsRoot(agent), RUNTIME_DIR_NAME);
      await fs.mkdir(runtimeRoot, { recursive: true });
      const instructionsFilePath = path.join(runtimeRoot, `${hash}.md`);
      await fs.writeFile(instructionsFilePath, markdown, "utf8");

      return {
        kind: SOURCE_KIND,
        version: SOURCE_VERSION,
        hash,
        instructionsFilePath,
        lanePromptPath: source.lanePromptPath,
        laneName: source.laneName,
        repoRoot: source.repoRoot,
        packRoot: source.packRoot,
        linkedRepoPaths: linkedRepoDocs.map((doc) => doc.relativePath),
        issueDocumentKeys: issueDocuments.map((doc) => doc.key),
      };
    },
  };
}
