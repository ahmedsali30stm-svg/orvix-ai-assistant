import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolveProvider, OpenAiAdapter } from "../packages/core/src/llm.ts";
import type { ToolDescriptor } from "../packages/schemas/src/index.ts";

// ── Provider resolution priority ──────────────────────────────────────────
test("resolveProvider: GROQ_API_KEY wins with Groq base URL + AI_MODEL", () => {
  const { adapter, info } = resolveProvider({
    GROQ_API_KEY: "gsk_test",
    OPENAI_API_KEY: "sk_test",
    AI_MODEL: "openai/gpt-oss-20b",
  });
  assert.equal(info.kind, "groq");
  assert.equal(info.model, "openai/gpt-oss-20b");
  assert.equal(adapter.modelFor(), "openai/gpt-oss-20b");
});

test("resolveProvider: falls back to OPENAI_API_KEY, then mock", () => {
  const openai = resolveProvider({ OPENAI_API_KEY: "sk_test" });
  assert.equal(openai.info.kind, "openai-compatible");
  assert.equal(openai.info.model, "gpt-4o-mini");

  const mock = resolveProvider({});
  assert.equal(mock.info.kind, "mock");
  assert.equal(mock.info.model, "mock-brain");
});

// ── Streaming + tool calls against a real local SSE server ────────────────
test("OpenAiAdapter.stream parses SSE deltas: text then a complete tool call", async () => {
  const received: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      received.push({
        url: req.url ?? "",
        auth: req.headers.authorization ?? "",
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Chunked text followed by one streaming tool call, then done.
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"fs.list","arguments":"{\\"path\\":"}}]}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Desktop\\"}"}}]}}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const adapter = new OpenAiAdapter("gsk_test", `http://127.0.0.1:${port}`, {
      general: "test-model",
      fast: "",
      reasoning: "",
      coding: "",
    });

    const tools: ToolDescriptor[] = [
      {
        id: "fs.list",
        name: "List directory",
        description: "List files.",
        group: "FILES",
        riskLevel: "read",
        requiresConfirmation: false,
        timeoutMs: 5000,
        params: [{ name: "path", type: "string", description: "dir", required: true }],
      },
    ];

    const deltas: string[] = [];
    let finalToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let finish = "";
    for await (const turn of adapter.stream({ messages: [{ role: "user", content: "hi" }], tools })) {
      if (turn.text) deltas.push(turn.text);
      if (turn.toolCalls.length > 0) finalToolCalls = turn.toolCalls;
      if (turn.finish) finish = turn.finish;
    }

    assert.deepEqual(deltas, ["Hello", " world"]);
    assert.equal(finish, "tool_calls");
    assert.equal(finalToolCalls.length, 1);
    assert.deepEqual(finalToolCalls[0], { id: "call_1", name: "fs.list", arguments: '{"path":"Desktop"}' });

    // The wire format is real OpenAI function-calling shape.
    const sent = received[0]!;
    assert.equal(sent.url, "/chat/completions");
    assert.equal(sent.auth, "Bearer gsk_test");
    assert.equal(sent.body.model, "test-model");
    assert.equal(sent.body.stream, true);
    const toolsSent = sent.body.tools as Array<{ type: string; function: { name: string } }>;
    assert.equal(toolsSent[0]?.type, "function");
    assert.equal(toolsSent[0]?.function.name, "fs.list");
  } finally {
    server.close();
  }
});

test("OpenAiAdapter surfaces provider errors with status + detail", async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const adapter = new OpenAiAdapter("bad", `http://127.0.0.1:${port}`, { general: "m", fast: "", reasoning: "", coding: "" });
    await assert.rejects(
      () => adapter.complete({ messages: [{ role: "user", content: "hi" }] }),
      /LLM 401/,
    );
  } finally {
    server.close();
  }
});
