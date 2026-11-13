import { describe, expect, it } from "vitest";
import { charLimit, splitPosts, toDrafts } from "./inbox";

describe("inbox", () => {
  it("splits on blank lines and --- separators", () => {
    expect(splitPosts("one\n\ntwo\n---\nthree\n\n\n")).toEqual(["one", "two", "three"]);
  });

  it("keeps single newlines inside a post", () => {
    expect(splitPosts("line a\nline b\n\nnext")).toEqual(["line a\nline b", "next"]);
  });

  it("makes unique ids that don't clash with existing drafts", () => {
    const drafts = toDrafts("Hello big world\n\nHello big world again", ["x"], [
      { id: "hello-big-world", text: "", channelIds: [] },
    ]);
    expect(drafts.map((d) => d.id)).toEqual(["hello-big-world-2", "hello-big-world-3"]);
    expect(drafts[0].channelIds).toEqual(["x"]);
  });

  it("knows network limits", () => {
    expect(charLimit("twitter")).toBe(280);
    expect(charLimit("unknown")).toBeUndefined();
  });
});
