import { describe, expect, it } from "vitest";
import { isClaudeSkipPermissionsPersistedEnabled } from "./config-fields";

describe("Claude skip-permissions edit truth", () => {
  it("returns false when the saved config omits the field", () => {
    expect(isClaudeSkipPermissionsPersistedEnabled({})).toBe(false);
  });

  it("returns false when the saved config explicitly disables the field", () => {
    expect(
      isClaudeSkipPermissionsPersistedEnabled({
        dangerouslySkipPermissions: false,
      }),
    ).toBe(false);
  });

  it("returns true only when the saved config explicitly enables the field", () => {
    expect(
      isClaudeSkipPermissionsPersistedEnabled({
        dangerouslySkipPermissions: true,
      }),
    ).toBe(true);
  });
});
