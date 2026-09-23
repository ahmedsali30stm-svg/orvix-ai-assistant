import type {
  ToolDescriptor,
  ChatMessage,
} from "@jarvis/schemas";

// ── LLM adapter + model router (blueprint §72) ────────────────────────────
// Talks to any OpenAI-compatible /chat/completions endpoint. When no API key
// is configured, a deterministic MockBrain keeps the whole system functional
// for development and tests.

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
  finish: string;
  usage?: { prompt: number; completion: number };
}

export interface LlmRequest {
  messages: Array<{ role: string; content: string }>;
  tools?: ToolDescriptor[];
  signal?: AbortSignal;
  tier?: "fast" | "general" | "reasoning" | "coding";
}

export interface LlmAdapter {
  complete(req: LlmRequest): Promise<LlmTurn>;
  stream(req: LlmRequest): AsyncIterable<LlmTurn>;
  modelFor(tier?: LlmRequest["tier"]): string;
}

// ── OpenAI-compatible adapter ─────────────────────────────────────────────
export class OpenAiAdapter implements LlmAdapter {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private models: { general: string; fast: string; reasoning: string; coding: string },
  ) {}

  modelFor(tier?: LlmRequest["tier"]): string {
    switch (tier) {
      case "fast":
        return this.models.fast || this.models.general;
      case "reasoning":
        return this.models.reasoning || this.models.general;
      case "coding":
        return this.models.coding || this.models.general;
      default:
        return this.models.general;
    }
  }

  private body(req: LlmRequest, stream: boolean): Record<string, unknown> {
    return {
      model: this.modelFor(req.tier),
      messages: req.messages,
      stream,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: {
                name: t.id,
                description: t.description,
                parameters: {
                  type: "object",
                  properties: Object.fromEntries(
                    t.params.map((p) => [
                      p.name,
                      { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
                    ]),
                  ),
                  required: t.params.filter((p) => p.required).map((p) => p.name),
                },
              },
            })),
          }
        : {}),
    };
  }

  /** POST with automatic retry on 429/5xx (rate limits) using Retry-After or backoff. */
  private async post(body: string, signal?: AbortSignal, maxAttempts = 3): Promise<Response> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal,
      });
      if (res.ok) return res;
      const detail = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      const retryAfter = Number(res.headers.get("retry-after"));
      lastErr = new Error(`LLM ${res.status}: ${detail.slice(0, 300)}`);
      if (!retryable || attempt === maxAttempts || signal?.aborted) throw lastErr;
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2_000 * attempt, 8_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    throw lastErr ?? new Error("LLM request failed");
  }

  async complete(req: LlmRequest): Promise<LlmTurn> {
    const res = await this.post(JSON.stringify(this.body(req, false)), req.signal);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      toolCalls: (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      finish: choice?.finish_reason ?? "stop",
      usage: json.usage
        ? { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmTurn> {
    const res = await this.post(JSON.stringify(this.body(req, true)), req.signal);
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${detail.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let toolCalls: LlmToolCall[] = [];
    let finish = "stop";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
              finish_reason?: string | null;
            }>;
          };
          const c = evt.choices?.[0];
          if (!c) continue;
          if (c.delta?.content) {
            text += c.delta.content;
            yield { text: c.delta.content, toolCalls: [], finish: "" };
          }
          for (const tc of c.delta?.tool_calls ?? []) {
            const i = tc.index ?? 0;
            if (!toolCalls[i]) toolCalls[i] = { id: tc.id ?? `call_${i}`, name: "", arguments: "" };
            if (tc.id) toolCalls[i]!.id = tc.id;
            if (tc.function?.name) toolCalls[i]!.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[i]!.arguments += tc.function.arguments;
          }
          if (c.finish_reason) finish = c.finish_reason;
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }
    if (text || toolCalls.length > 0) {
      yield { text: "", toolCalls: toolCalls.filter(Boolean), finish };
    }
  }
}

// ── Mock brain ────────────────────────────────────────────────────────────
// Deterministic stand-in so the full pipeline (router → planner → tools →
// verification → memory) is exercisable without an API key. It reacts to a
// small set of cue phrases and emits tool calls like a real model would.

export class MockBrain implements LlmAdapter {
  private callSeq = 0;

  modelFor(): string {
    return "mock-brain";
  }

  async complete(req: LlmRequest): Promise<LlmTurn> {
    let text = "";
    for await (const t of this.stream(req)) text += t.text;
    return { text, toolCalls: [], finish: "stop" };
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmTurn> {
    const lastMsg = req.messages[req.messages.length - 1];
    // After a tool result comes back, produce a final answer instead of
    // re-issuing the same tool call forever (the mock brain is stateless).
    if (lastMsg?.role === "user" && lastMsg.content.startsWith("[tool result]")) {
      // Mirror the language of the user's actual question, not the tool notes.
      const question = [...req.messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("[tool result]"));
      const arabic = Boolean(question && /[\u0600-\u06FF]/.test(question.content));
      yield {
        text: friendlyToolAnswer(lastMsg.content.replace("[tool result] ", ""), arabic),
        toolCalls: [],
        finish: "stop",
      };
      return;
    }
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const q = (lastUser?.content ?? "").toLowerCase();

    const words = q.split(/\s+/).filter(Boolean);
    const emit = (chunks: string[]): AsyncIterable<LlmTurn> =>
      (async function* () {
        for (const c of chunks) {
          yield { text: c, toolCalls: [], finish: "" };
          await new Promise((r) => setTimeout(r, 15));
        }
      })();

    // Heuristic tool selection against the live registry.
    const wantsFiles = /\b(file|files|folder|list|directory|desktop|documents)\b/.test(q);
    const wantsWeb = /\b(search|web|news|weather|latest|google)\b/.test(q);
    const wantsShell = /\b(command|shell|terminal|run)\b/.test(q);
    const wantsTime = /\b(time|date|today|now)\b/.test(q);

    // "open X" / "launch X" → the dedicated opener tool (never raw shell).
    const openMatch = /\b(?:open|launch|start|افتح)\s+(.+)/.exec(q);
    if (openMatch && req.tools?.some((t) => t.id === "computer.open")) {
      const raw = openMatch[1]!.trim().replace(/[.?!]+$/, "");
      const knownSites = /youtube|google|gmail|github|twitter|x\.com|facebook|instagram|linkedin|reddit|wikipedia/;
      let target: string;
      if (/^https?:\/\//.test(raw)) target = raw;
      else if (raw.includes(".com") || raw.includes(".org") || raw.includes(".net")) target = `https://${raw}`;
      else if (knownSites.test(raw)) target = `https://${raw.replace(/^the\s+/, "").replace(/\s+/g, "")}.com`;
      else target = raw.replace(/^(the\s+)?(app\s+)?/, "");
      yield {
        text: "",
        toolCalls: [{ id: `mock_${this.callSeq++}`, name: "computer.open", arguments: JSON.stringify({ target }) }],
        finish: "tool_calls",
      };
      return;
    }

    if (wantsFiles && req.tools?.some((t) => t.id === "fs.list")) {
      const dir = /desktop/.test(q) ? "Desktop" : /documents/.test(q) ? "Documents" : ".";
      yield {
        text: "",
        toolCalls: [{ id: `mock_${this.callSeq++}`, name: "fs.list", arguments: JSON.stringify({ path: dir }) }],
        finish: "tool_calls",
      };
      return;
    }
    if (wantsWeb && req.tools?.some((t) => t.id === "web.search")) {
      const query = words.filter((w) => !/^(search|web|for|the|latest|news|about|google)$/.test(w)).join(" ") || "jarvis ai";
      yield {
        text: "",
        toolCalls: [{ id: `mock_${this.callSeq++}`, name: "web.search", arguments: JSON.stringify({ query }) }],
        finish: "tool_calls",
      };
      return;
    }
    if (wantsShell && req.tools?.some((t) => t.id === "computer.run_command")) {
      yield {
        text: "",
        toolCalls: [{ id: `mock_${this.callSeq++}`, name: "computer.run_command", arguments: JSON.stringify({ command: "echo hello from Orvix" }) }],
        finish: "tool_calls",
      };
      return;
    }
    // Documents: "read the payroll xlsx" / "what does report.pdf say"
    const docMatch = /[\w./\\~-]+\.(pdf|xlsx|xls|csv)\b/i.exec(q);
    if (docMatch && req.tools?.some((t) => t.id === "docs.read_xlsx" || t.id === "docs.read_pdf")) {
      const file = docMatch[0]!;
      const id = /\.pdf$/i.test(file) ? "docs.read_pdf" : "docs.read_xlsx";
      if (req.tools.some((t) => t.id === id)) {
        yield {
          text: "",
          toolCalls: [{ id: `mock_${this.callSeq++}`, name: id, arguments: JSON.stringify({ path: file }) }],
          finish: "tool_calls",
        };
        return;
      }
    }
    if (wantsTime && req.tools?.some((t) => t.id === "system.now")) {
      yield {
        text: "",
        toolCalls: [{ id: `mock_${this.callSeq++}`, name: "system.now", arguments: "{}" }],
        finish: "tool_calls",
      };
      return;
    }

    // Plain conversational responses.
    if (/^(hi|hello|hey|yo)\b/.test(q) || /معاك|صباح الخير/.test(q)) {
      yield* emit(["Hey — Orvix here. What are we working on?"]);
      return;
    }
    if (/remind|يوم|بكرة|tomorrow/.test(q) && req.tools?.some((t) => t.id === "tasks.create")) {
      yield {
        text: "",
        toolCalls: [
          {
            id: `mock_${this.callSeq++}`,
            name: "tasks.create",
            arguments: JSON.stringify({
              title: q.slice(0, 60),
              goal: q,
              successCriteria: "user confirms completion",
            }),
          },
        ],
        finish: "tool_calls",
      };
      return;
    }
    yield* emit([
      "I'm running on the local mock brain (no API key configured), so my answers are scripted. ",
      "The full pipeline behind me is real: routing, planning, tools, verification, memory. ",
      "Add OPENAI_API_KEY to .env and I'll think for real.",
    ]);
  }
}

export function createAdapter(opts: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fast?: string;
  reasoning?: string;
  coding?: string;
}): LlmAdapter {
  if (opts.apiKey) {
    return new OpenAiAdapter(
      opts.apiKey,
      opts.baseUrl || "https://api.openai.com/v1",
      {
        general: opts.model || "gpt-4o-mini",
        fast: opts.fast || "",
        reasoning: opts.reasoning || "",
        coding: opts.coding || "",
      },
    );
  }
  return new MockBrain();
}

// ── Provider resolution (Groq / OpenAI / OpenRouter / Ollama / mock) ──────
// Priority: GROQ_API_KEY → OPENAI_API_KEY (OpenAI-compatible) → MockBrain.
export interface ProviderInfo {
  kind: "groq" | "openai-compatible" | "mock";
  model: string;
}

export function resolveProvider(env: {
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  AI_MODEL?: string;
  JARVIS_MODEL?: string;
  JARVIS_MODEL_FAST?: string;
  JARVIS_MODEL_REASONING?: string;
  JARVIS_MODEL_CODING?: string;
}): { adapter: LlmAdapter; info: ProviderInfo } {
  if (env.GROQ_API_KEY) {
    const model = env.AI_MODEL || env.JARVIS_MODEL || "openai/gpt-oss-20b";
    return {
      adapter: createAdapter({
        apiKey: env.GROQ_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1",
        model,
        fast: env.JARVIS_MODEL_FAST,
        reasoning: env.JARVIS_MODEL_REASONING,
        coding: env.JARVIS_MODEL_CODING,
      }),
      info: { kind: "groq", model },
    };
  }
  if (env.OPENAI_API_KEY) {
    const model = env.AI_MODEL || env.JARVIS_MODEL || "gpt-4o-mini";
    return {
      adapter: createAdapter({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        model,
        fast: env.JARVIS_MODEL_FAST,
        reasoning: env.JARVIS_MODEL_REASONING,
        coding: env.JARVIS_MODEL_CODING,
      }),
      info: { kind: "openai-compatible", model },
    };
  }
  return { adapter: new MockBrain(), info: { kind: "mock", model: "mock-brain" } };
}

// ── Human-friendly answer formatting for the mock brain ──────────────────
// Turns raw tool-result notes into short readable answers (EN/AR) instead of
// dumping JSON at the user.

function friendlyToolAnswer(note: string, arabic: boolean): string {
  const ok = note.includes("ok=true");
  const tool = /Tool ([\w.]+) →/.exec(note)?.[1] ?? "";

  if (!ok) {
    const reason = note.split("→").pop()?.trim().slice(0, 160) ?? note;
    return arabic ? `معتزر، مكتملتش: ${reason}` : `I couldn't complete that. ${reason}`;
  }

  // fs.list: render the items as a neat list.
  const listMatch = /Listed (\d+) entries in (.+?) (\{.*\})$/s.exec(note);
  if (tool === "fs.list" && listMatch) {
    const count = listMatch[1]!;
    const dir = listMatch[2]!;
    try {
      const items = JSON.parse(listMatch[3]!) as { items: Array<{ name: string; kind: string }> };
      const dirs = items.items.filter((i) => i.kind === "dir").map((i) => `📁 ${i.name}`);
      const files = items.items.filter((i) => i.kind !== "dir").map((i) => `📄 ${i.name}`);
      const head = arabic
        ? `اتفضل — ${count} عنصر في «${dir}»:`
        : `Here's what's in ${dir} (${count} items):`;
      return [head, ...dirs, ...files].join("\n");
    } catch {
      // fall through to generic summary
    }
  }

  // web.search: show titles if the tool returned them.
  try {
    const dataStart = note.indexOf("{");
    if (dataStart >= 0) {
      const data = JSON.parse(note.slice(dataStart)) as { results?: Array<{ title: string; url?: string }> };
      if (Array.isArray(data.results) && data.results.length > 0) {
        const lines = data.results.slice(0, 5).map((r) => `• ${r.title}${r.url ? ` — ${r.url}` : ""}`);
        return arabic ? `دي أهم النتايج:\n${lines.join("\n")}` : `Top results:\n${lines.join("\n")}`;
      }
    }
  } catch {
    // not JSON — generic path below
  }

  const cleaned = note.replace(/^Tool [\w.]+ → ok=true \([^)]*\)\. /, "").replace(/\s*\{.*\}$/s, "").trim();
  return arabic ? `تم ✓ ${cleaned}` : `Done ✓ ${cleaned}`;
}
