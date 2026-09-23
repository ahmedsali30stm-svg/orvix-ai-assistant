import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Local voice endpoints — Phase 1 vertical slice stub
// No cloud free tier in default path. Piper/Whisper run locally after model download.
// Until models installed, endpoint returns 503 with clear install instructions.
export function registerVoiceRoutes(app: FastifyInstance) {
  // List installed local voices/models
  app.get("/api/voice/status", async () => {
    const piperModel = resolve("models/piper/en_US-lessac-medium.onnx");
    const piperConfig = piperModel + ".json";
    const whisperBase = resolve("models/whisper/ggml-base.bin");
    const whisperTiny = resolve("models/whisper/ggml-tiny.bin");
    return {
      stt: {
        whisperBase: existsSync(whisperBase),
        whisperTiny: existsSync(whisperTiny),
        fallback: "web-speech (browser — fallback)",
      },
      tts: {
        piperLessac: existsSync(piperModel) && existsSync(piperConfig),
        // Kokoro not installed until benchmark + license verified
        kokoro: existsSync(resolve("models/kokoro/kokoro-v1.0.onnx")),
        fallback: "web-speech (browser — fallback)",
      },
      vad: { silero: existsSync(resolve("models/silero/silero_vad.onnx")), fallback: "energy (fallback)" },
      devices: { note: "enumerate via navigator.mediaDevices in desktop" },
    };
  });

  // Piper TTS — sentence streaming
  // Client sends {text, voice:"en_US-lessac-medium"}; server spawns piper binary if present.
  app.post("/api/voice/tts", async (req, reply) => {
    const { text, voice = "en_US-lessac-medium" } = (req.body as { text?: string; voice?: string; rate?: number }) ?? {};
    if (!text || !text.trim()) return reply.code(400).send({ error: "text required", fallback: "web-speech" });

    const modelPath = resolve(`models/piper/${voice}.onnx`);
    const configPath = modelPath + ".json";
    const piperBin = resolve("tools/piper/piper.exe"); // Windows; linux: piper

    if (!existsSync(modelPath) || !existsSync(configPath)) {
      return reply.code(503).send({
        error: "Piper model not installed",
        fallback: "web-speech",
        expected: modelPath,
        install: "Download https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx + .onnx.json into models/piper/",
        verify: "Check LICENSE at https://github.com/rhasspy/piper — MIT; voice model CC0-ish — verify before use",
      });
    }
    if (!existsSync(piperBin)) {
      return reply.code(503).send({
        error: "Piper binary not installed",
        fallback: "web-speech",
        expected: piperBin,
        install: "Download https://github.com/rhasspy/piper/releases — tools/piper/piper.exe",
      });
    }
    // If both exist, spawn piper and stream wav back (not yet — return 501 to keep contract)
    return reply.code(501).send({ error: "Piper installed but TTS streaming not yet wired in vertical slice — using fallback", fallback: "web-speech" });
  });

  // Whisper STT — upload audio blob
  app.post("/api/voice/stt", async (req, reply) => {
    const whisperBin = resolve("tools/whisper/whisper.exe");
    const modelPath = resolve("models/whisper/ggml-base.bin");
    if (!existsSync(whisperBin) || !existsSync(modelPath)) {
      return reply.code(503).send({
        error: "Whisper local not installed",
        fallback: "web-speech",
        expected: { whisperBin, modelPath },
        install: "Download whisper.cpp release + ggml-base.bin into models/whisper/",
      });
    }
    return reply.code(501).send({ error: "Whisper installed but endpoint not yet wired — using fallback", fallback: "web-speech" });
  });
}
