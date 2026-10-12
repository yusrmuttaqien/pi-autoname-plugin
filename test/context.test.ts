import { describe, it, expect, vi } from "vitest";
import { buildContext } from "../src/context.js";
import type { Config } from "../src/config.js";

function msg(role: "user" | "assistant", content: unknown) {
  return { type: "message", message: { role, content } };
}

function mkCtx(entries: unknown[]) {
  const buildContextEntries = vi.fn(() => entries);
  return { sessionManager: { buildContextEntries } } as any;
}

function cfg(start: number, end: number): Config {
  return { contextStart: start, contextEnd: end } as Config;
}

describe("extractText behavior through buildContext", () => {
  it("reads string user content", async () => {
    const ctx = mkCtx([msg("user", "Hello there")]);
    const out = await buildContext(ctx, cfg(1, 0));
    expect(out?.firstUserMessage).toBe("Hello there");
  });

  it("joins text blocks from array content and skips non-text blocks", async () => {
    const ctx = mkCtx([
      msg("user", [
        { type: "text", text: "First part" },
        { type: "image", source: { type: "url" } },
        { type: "text", text: "second part" },
      ]),
    ]);
    const out = await buildContext(ctx, cfg(1, 0));
    expect(out?.firstUserMessage).toBe("First part\nsecond part");
  });

  it("skips empty and whitespace-only user messages", async () => {
    const ctx = mkCtx([msg("user", "   "), msg("user", ""), msg("user", "Real")]);
    const out = await buildContext(ctx, cfg(1, 0));
    expect(out?.firstUserMessage).toBe("Real");
  });

  it("returns undefined when there is no user message", async () => {
    const ctx = mkCtx([msg("assistant", "Hi, how can I help?")]);
    expect(await buildContext(ctx, cfg(1, 0))).toBeUndefined();
  });

  it("seeds the context from the in-progress input when the transcript is empty", async () => {
    // The `input` event fires before pi appends the message, so the first
    // turn has no user message yet without the threaded input.
    const ctx = mkCtx([]);
    const out = await buildContext(ctx, cfg(1, 3), "fix oauth please");
    expect(out?.firstUserMessage).toBe("fix oauth please");
    expect(out?.recentUserMessages).toEqual([]);
  });

  it("appends the in-progress input after existing messages", async () => {
    const ctx = mkCtx([msg("user", "first"), msg("assistant", "ok")]);
    const out = await buildContext(ctx, cfg(1, 3), "second");
    expect(out?.firstUserMessage).toBe("first");
    expect(out?.recentUserMessages).toEqual(["second"]);
  });

  it("truncates oversized messages head+tail with a marker", async () => {
    const big = `head-${"a".repeat(3000)}-tail`;
    const ctx = mkCtx([msg("user", big)]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.firstUserMessage).toContain("[message truncated]");
    expect(out?.firstUserMessage?.startsWith("head-")).toBe(true);
    expect(out?.firstUserMessage?.endsWith("-tail")).toBe(true);
    expect(out!.firstUserMessage.length).toBeLessThan(big.length);
  });

  it("leaves messages at the cap untouched", async () => {
    const exact = "b".repeat(2000);
    const ctx = mkCtx([msg("user", exact)]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.firstUserMessage).toBe(exact);
  });

  it("truncates the in-progress input too", async () => {
    const ctx = mkCtx([]);
    const out = await buildContext(ctx, cfg(1, 3), `x${"y".repeat(3000)}z`);
    expect(out?.firstUserMessage).toContain("[message truncated]");
  });
});

describe("recent-user-messages depth", () => {
  it("collects the first message and up to 3 recent (excluding first)", async () => {
    const ctx = mkCtx([
      msg("user", "first"),
      msg("assistant", "ok"),
      msg("user", "two"),
      msg("user", "three"),
      msg("user", "four"),
      msg("user", "five"),
    ]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.firstUserMessage).toBe("first");
    expect(out?.recentUserMessages).toEqual(["three", "four", "five"]);
  });

  it("excludes the first message from recent even when it is among the last 3", async () => {
    const ctx = mkCtx([msg("user", "first"), msg("user", "second"), msg("user", "third")]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.firstUserMessage).toBe("first");
    expect(out?.recentUserMessages).toEqual(["second", "third"]);
  });

  it("returns an empty recent list when only one user message exists", async () => {
    const ctx = mkCtx([msg("user", "only")]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.recentUserMessages).toEqual([]);
  });

  it("captures the first assistant message for topic-project context", async () => {
    const ctx = mkCtx([
      msg("user", "hello"),
      msg("assistant", "I will help you"),
      msg("user", "do it"),
    ]);
    const out = await buildContext(ctx, cfg(1, 3));
    expect(out?.firstAssistantMessage).toBe("I will help you");
  });

  it("uses the compaction-aware buildContextEntries view", async () => {
    const ctx = mkCtx([msg("user", "x")]);
    await buildContext(ctx, cfg(1, 3));
    expect(ctx.sessionManager.buildContextEntries).toHaveBeenCalledTimes(1);
  });
});

