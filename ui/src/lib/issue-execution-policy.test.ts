import { describe, expect, it } from "vitest";
import { buildExecutionPolicy } from "./issue-execution-policy";

describe("buildExecutionPolicy", () => {
  it("preserves checkpoint mode when no review or approval participants remain", () => {
    expect(buildExecutionPolicy({
      existingPolicy: {
        mode: "checkpoint",
        commentRequired: true,
        stages: [],
      },
      reviewerValues: [],
      approverValues: [],
    })).toEqual({
      mode: "checkpoint",
      commentRequired: true,
      stages: [],
    });
  });

  it("still drops empty normal policies", () => {
    expect(buildExecutionPolicy({
      existingPolicy: {
        mode: "normal",
        commentRequired: true,
        stages: [],
      },
      reviewerValues: [],
      approverValues: [],
    })).toBeNull();
  });
});
