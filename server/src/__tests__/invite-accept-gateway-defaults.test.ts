import { describe, expect, it } from "vitest";
import {
  buildJoinDefaultsPayloadForAccept,
  normalizeAgentDefaultsForJoin,
} from "../routes/access.js";

describe("buildJoinDefaultsPayloadForAccept (openclaw_gateway)", () => {
  it("leaves non-gateway payloads unchanged", () => {
    const defaultsPayload = { command: "echo hello" };
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "process",
      defaultsPayload,
      inboundOpenClawAuthHeader: "ignored-token",
    });

    expect(result).toEqual(defaultsPayload);
  });

  it("normalizes wrapped x-openclaw-token header", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": {
            value: "gateway-token-1234567890",
          },
        },
      },
    }) as Record<string, unknown>;

    expect(result).toMatchObject({
      url: "ws://127.0.0.1:18789",
      headers: {
        "x-openclaw-token": "gateway-token-1234567890",
      },
    });
  });

  it("accepts inbound x-openclaw-token for gateway joins", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
      },
      inboundOpenClawTokenHeader: "gateway-token-1234567890",
    }) as Record<string, unknown>;

    expect(result).toMatchObject({
      headers: {
        "x-openclaw-token": "gateway-token-1234567890",
      },
    });
  });

  it("derives x-openclaw-token from authorization header", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          authorization: "Bearer gateway-token-1234567890",
        },
      },
    }) as Record<string, unknown>;

    expect(result).toMatchObject({
      headers: {
        authorization: "Bearer gateway-token-1234567890",
        "x-openclaw-token": "gateway-token-1234567890",
      },
    });
  });
});

describe("normalizeAgentDefaultsForJoin (openclaw_gateway)", () => {
  it("generates persistent device key when device auth is enabled", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        disableDeviceAuth: false,
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toEqual([]);
    expect(normalized.normalized?.disableDeviceAuth).toBe(false);
    expect(typeof normalized.normalized?.devicePrivateKeyPem).toBe("string");
    expect((normalized.normalized?.devicePrivateKeyPem as string).length).toBeGreaterThan(64);
  });

  it("does not generate device key when disableDeviceAuth=true", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        disableDeviceAuth: true,
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toEqual([]);
    expect(normalized.normalized?.disableDeviceAuth).toBe(true);
    expect(normalized.normalized?.devicePrivateKeyPem).toBeUndefined();
  });

  it("defaults dedicated persona routing to a fixed session", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        agentId: "pavluk-cbp",
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({
      agentId: "pavluk-cbp",
      sessionKeyStrategy: "fixed",
      sessionKey: "agent:pavluk-cbp:paperclip",
    });
  });

  it("derives top-level agentId from payloadTemplate and normalizes telegram delivery fields", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        payloadTemplate: {
          agentId: "pavluk-dev",
          replyTo: "-1001234567890",
          threadId: "9",
        },
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({
      agentId: "pavluk-dev",
      sessionKeyStrategy: "fixed",
      sessionKey: "agent:pavluk-dev:paperclip",
      payloadTemplate: {
        agentId: "pavluk-dev",
        deliver: true,
        replyChannel: "telegram",
        replyTo: "-1001234567890",
        threadId: "9",
      },
    });
  });

  it("rejects issue-scoped sessions for dedicated non-main personas", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        agentId: "pavluk-flux",
        sessionKeyStrategy: "issue",
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toContain(
      'agentDefaultsPayload.sessionKeyStrategy="issue" is only supported for intentional main/shared-persona setups',
    );
  });

  it("rejects mismatched top-level and payloadTemplate agent ids", () => {
    const normalized = normalizeAgentDefaultsForJoin({
      adapterType: "openclaw_gateway",
      defaultsPayload: {
        url: "ws://127.0.0.1:18789",
        headers: {
          "x-openclaw-token": "gateway-token-1234567890",
        },
        agentId: "pavluk-sherpa",
        payloadTemplate: {
          agentId: "pavluk-cbp",
        },
      },
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    });

    expect(normalized.fatalErrors).toContain(
      "agentDefaultsPayload.agentId and payloadTemplate.agentId must match",
    );
  });
});
