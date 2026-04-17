import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const EXECUTION_CONTEXT_FINGERPRINT_KEY = "executionContextFingerprintHash";
const EXECUTION_CONTEXT_FORCE_FRESH_SESSION_KEY = "executionContextForceFreshSession";

const LEGACY_PACKET_CONTEXT_KEYS = [
  "instructionsSourceKind",
  "instructionsSourceVersion",
  "instructionsSourceHash",
  "instructionsSourceFilePath",
  "instructionsSourceRepoRoot",
  "instructionsSourceIssueDocumentKeys",
  "instructionsSourceRepoDocs",
  "instructionsSourcePacketMode",
  "instructionsSourcePacketMetrics",
  "instructionsSourceForceFreshSession",
] as const;

type IssueDocumentFingerprintInput = {
  key: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  body?: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fingerprintInstructionsFile(instructionsFilePath: string | null | undefined) {
  const rawPath = asNonEmptyString(instructionsFilePath);
  if (!rawPath) return null;
  try {
    const contents = await fs.readFile(rawPath, "utf8");
    return {
      path: rawPath,
      sha256: sha256Text(contents),
    };
  } catch (error) {
    const code =
      !!error
      && typeof error === "object"
      && "code" in error
      && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "READ_FAILED";
    return {
      path: rawPath,
      errorCode: code,
    };
  }
}

export async function computeExecutionContextFingerprint(input: {
  instructionsFilePath?: string | null;
  issueId?: string | null;
  issueDescription?: string | null;
  issueDocuments?: IssueDocumentFingerprintInput[] | null;
}) {
  const issueDocuments = [...(input.issueDocuments ?? [])]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((document) => ({
      key: document.key,
      latestRevisionId: document.latestRevisionId ?? null,
      latestRevisionNumber:
        typeof document.latestRevisionNumber === "number" ? document.latestRevisionNumber : null,
      bodySha256: document.latestRevisionId ? null : sha256Text(document.body ?? ""),
    }));

  return sha256Text(stableStringify({
    instructionsFile: await fingerprintInstructionsFile(input.instructionsFilePath),
    issue: input.issueId
      ? {
          id: input.issueId,
          descriptionSha256: sha256Text(input.issueDescription ?? ""),
        }
      : null,
    issueDocuments,
  }));
}

export function stripLegacyInstructionSourceContext(contextSnapshot: Record<string, unknown>) {
  const nextContext = { ...contextSnapshot };
  for (const key of LEGACY_PACKET_CONTEXT_KEYS) {
    delete nextContext[key];
  }
  return nextContext;
}

export function reconcileExecutionContextFingerprint(
  contextSnapshot: Record<string, unknown>,
  nextFingerprint: string,
) {
  const nextContext = stripLegacyInstructionSourceContext(contextSnapshot);
  const currentFingerprint =
    asNonEmptyString(contextSnapshot[EXECUTION_CONTEXT_FINGERPRINT_KEY])
    ?? asNonEmptyString(contextSnapshot.instructionsSourceHash);
  const fingerprintForcedFreshSession =
    contextSnapshot[EXECUTION_CONTEXT_FORCE_FRESH_SESSION_KEY] === true
    || contextSnapshot.instructionsSourceForceFreshSession === true;
  const changed = currentFingerprint !== nextFingerprint;

  nextContext[EXECUTION_CONTEXT_FINGERPRINT_KEY] = nextFingerprint;

  if (changed) {
    nextContext.forceFreshSession = true;
    nextContext[EXECUTION_CONTEXT_FORCE_FRESH_SESSION_KEY] = true;
    delete nextContext.resumeSessionParams;
    delete nextContext.resumeSessionDisplayId;
    delete nextContext.resumeFromRunId;
  } else if (fingerprintForcedFreshSession) {
    delete nextContext[EXECUTION_CONTEXT_FORCE_FRESH_SESSION_KEY];
    delete nextContext.forceFreshSession;
  }

  return {
    contextSnapshot: nextContext,
    previousFingerprint: currentFingerprint,
    changed,
  };
}
