import { describe, expect, it } from "vitest";
import { handleRpc } from "./mcp";

const call = (args: unknown) =>
  handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_week", arguments: args } }) as {
    result: { isError: boolean; content: { text: string }[]; structuredContent?: { placements: unknown[]; score: number } };
  };

describe("MCP plan_week", () => {
  it("initializes and lists the tool", () => {
    const init = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(init?.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} } });
    expect(handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["plan_week"]);
  });

  it("plans posts with service defaults", () => {
    const res = call({
      start: "2030-01-07T00:00:00Z",
      channels: [{ id: "x", service: "twitter", timezone: "America/New_York" }, { id: "li", service: "linkedin", timezone: "Europe/London" }],
      drafts: [{ id: "a", text: "Hello", channelIds: ["x", "li"], topic: "launch" }, { id: "b", text: "Again", channelIds: ["x"] }],
    });
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent?.placements).toHaveLength(3);
    expect(res.result.content[0].text).toMatch(/Cadence score/);
  });

  it("returns a tool error for bad input", () => {
    const res = call({ channels: [{ id: "x", timezone: "Mars/Base" }], drafts: [{ id: "a", text: "", channelIds: ["x"] }] });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/IANA/);
  });

  it("rejects unknown methods", () => {
    expect(handleRpc({ jsonrpc: "2.0", id: 9, method: "resources/list" })?.error?.code).toBe(-32601);
  });
});
