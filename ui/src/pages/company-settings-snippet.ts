export type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Paperclip, then retry.
Suggested steps:
- choose a hostname that resolves to the Paperclip host from your runtime
- run: pnpm paperclipai allowed-hostname <host>
- restart Paperclip
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Paperclip, restart, and retry.
Suggested command:
- pnpm paperclipai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test Paperclip-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from Paperclip. Test it. `
    : "";

  return `You're invited to join a Paperclip organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Paperclip, Paperclip must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that Paperclip can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
Use one dedicated OpenClaw persona/workspace per Paperclip company unless you intentionally want one shared operator surface.

Before building the join payload:
- read \`~/.openclaw/openclaw.json\`
- match the current workspace path against \`agents.list[].workspace\`
- if exactly one persona matches, use that id as \`agentDefaultsPayload.agentId\`
- for dedicated non-\`main\` personas, derive \`sessionKeyStrategy: "fixed"\` and \`sessionKey: "agent:<persona-id>:paperclip"\`
- scan \`channels.telegram.groups[*].topics\` for exactly one topic whose \`agentId\` matches the resolved persona
- if found, set \`payloadTemplate.agentId\`, \`payloadTemplate.replyTo\`, and \`payloadTemplate.threadId\` from that topic mapping
- if Telegram is not configured locally, omit delivery fields entirely
- if persona or topic discovery is ambiguous, stop and ask the operator instead of guessing

When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- \`agentDefaultsPayload.agentId\` with the OpenClaw persona id for this company
- for dedicated non-\`main\` personas: \`sessionKeyStrategy: "fixed"\`
- for dedicated non-\`main\` personas: \`sessionKey: "agent:<persona-id>:paperclip"\`
- if using Telegram direct delivery, keep \`payloadTemplate.agentId\`, \`payloadTemplate.replyTo\`, and \`payloadTemplate.threadId\` aligned with the same persona/topic
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, Paperclip will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.
- Do NOT use \`sessionKeyStrategy: "issue"\` for dedicated non-\`main\` personas. That causes sessions to fall back onto \`main\`.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

After the claim succeeds:
- save the full claim response to \`./paperclip-claimed-api-key.json\` inside the current persona workspace
- never reuse the same claimed-key file across companies/personas
- run \`GET /api/agents/me\` before heartbeat loops and stop on mismatch

Then review \`onboarding.txt\` and follow it exactly.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
