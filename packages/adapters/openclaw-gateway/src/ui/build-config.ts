import type { CreateConfigValues } from "@paperclipai/adapter-utils";

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildOpenClawGatewayConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.url) ac.url = v.url;
  ac.timeoutSec = 120;
  ac.waitTimeoutMs = 120000;
  ac.role = "operator";
  ac.scopes = ["operator.admin"];
  const payloadTemplate = parseJsonObject(v.payloadTemplateJson ?? "");
  if (payloadTemplate) ac.payloadTemplate = payloadTemplate;
  const payloadTemplateAgentId =
    typeof payloadTemplate?.agentId === "string" && payloadTemplate.agentId.trim().length > 0
      ? payloadTemplate.agentId.trim()
      : null;
  if (payloadTemplateAgentId) {
    ac.agentId = payloadTemplateAgentId;
    ac.sessionKeyStrategy = "fixed";
    ac.sessionKey = `agent:${payloadTemplateAgentId}:paperclip`;
  } else {
    ac.sessionKeyStrategy = "issue";
  }
  const runtimeServices = parseJsonObject(v.runtimeServicesJson ?? "");
  if (runtimeServices && Array.isArray(runtimeServices.services)) {
    ac.workspaceRuntime = runtimeServices;
  }
  return ac;
}
