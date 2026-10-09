/**
 * server.json is published to the MCP Registry by the release workflow, which
 * rejects it with 422 when the top-level description is over 100 characters.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverJson = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8")) as {
  description: string;
};

describe("server.json", () => {
  it("keeps the description within the MCP Registry's 100-character limit", () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });
});
