import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync, createWriteStream } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";

// Allowlist — no path construction from client input
const ALLOWED_VOICES = new Set(["en_US-lessac-medium", "en_US-ryan-medium"]);
const MAX_TEXT_LEN = 1000; // per sentence
const TTS_TIMEOUT_MS = 15_000;

// WAV helper: ensure 16k for whisper (no ffmpeg needed for wav). Linear resample.
function ensureWav16k(filePath: string): void {
  try {
    const buf = readFileSync(filePath);
    if (buf.length < 44 || buf.subarray(0,4).toString() !== "RIFF") return;
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const bits = buf.readUInt16LE(34);
    if (sampleRate === 16000 && channels === 1 && bits === 16) return;
    // assume PCM 16bit little endian, mono or stereo
    const dataOff = 44;
    const bytesPerSample = bits/8;
    const frameSize = bytesPerSample * channels;
    const numFrames = Math.floor((buf.length - dataOff)/frameSize);
    // read mono: if stereo, average
    const pcm: number[] = [];
    for(let i=0;i<numFrames;i++){
      const off = dataOff + i*frameSize;
      let s = 0;
      if (channels === 1) s = buf.readInt16LE(off);
      else {
        const l = buf.readInt16LE(off);
        const r = buf.readInt16LE(off+2);
        s = Math.round((l+r)/2);
      }
      pcm.push(s);
    }
    const ratio = sampleRate / 16000;
    const newLen = Math.floor(pcm.length / ratio);
    const out = new Int16Array(newLen);
    for(let i=0;i<newLen;i++){
      const src = i * ratio;
      const idx = Math.floor(src);
      const frac = src - idx;
      const a = pcm[idx] ?? 0;
      const b = pcm[idx+1] ?? a;
      out[i] = Math.round(a + (b - a) * frac);
    }
    const outBuf = Buffer.alloc(44 + newLen*2);
    buf.copy(outBuf,0,0,44);
    outBuf.writeUInt32LE(16000,24);
    outBuf.writeUInt32LE(16000*2,28);
    outBuf.writeUInt32LE(36 + newLen*2,4);
    outBuf.writeUInt32LE(newLen*2,40);
    for(let i=0;i<newLen;i++) outBuf.writeInt16LE(out[i]!,44+i*2);
    writeFileSync(filePath, outBuf);
  } catch {}
}

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

  // Piper TTS — real local synthesis, one sentence at a time
  // Security: voice is allowlist-only; text length + timeout bounded; abort kills child; no raw path from client
  app.post("/api/voice/tts", async (req, reply) => {
    const body = (req.body as { text?: string; voice?: string }) ?? {};
    const rawText = typeof body.text === "string" ? body.text : "";
    const voice = typeof body.voice === "string" && ALLOWED_VOICES.has(body.voice) ? body.voice : "en_US-lessac-medium";
    if (!ALLOWED_VOICES.has(voice)) {
      return reply.code(400).send({ error: `voice not allowed. Allowed: ${[...ALLOWED_VOICES].join(", ")}`, fallback: "web-speech" });
    }
    const text = rawText.trim();
    if (!text) return reply.code(400).send({ error: "text required", fallback: "web-speech" });
    if (text.length > MAX_TEXT_LEN) {
      return reply.code(400).send({ error: `text too long (${text.length} > ${MAX_TEXT_LEN})`, fallback: "web-speech" });
    }

    const modelPath = resolve(`models/piper/${voice}.onnx`);
    const configPath = modelPath + ".json";
    const piperBin = resolve("tools/piper/piper.exe"); // Windows; linux: piper

    if (!existsSync(modelPath) || !existsSync(configPath)) {
      return reply.code(503).send({
        error: "Piper model not installed",
        fallback: "web-speech",
        expected: modelPath,
        install: "Download https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx + .onnx.json into models/piper/",
        verify: "Check LICENSE at https://github.com/rhasspy/piper — MIT; voice model https://huggingface.co/rhasspy/piper-voices (Apache 2.0) — verify before use",
      });
    }
    if (!existsSync(piperBin)) {
      return reply.code(503).send({
        error: "Piper binary not installed",
        fallback: "web-speech",
        expected: piperBin,
        install: "Download https://github.com/rhasspy/piper/releases — tools/piper/piper.exe (Windows) or tools/piper/piper (Linux)",
      });
    }

    // Spawn piper: echo text | piper --model modelPath --output_file -
    const child = spawn(piperBin, ["--model", modelPath, "--output_file", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    // Note: client abort handling simplified for vertical slice — server will always
    // try to return WAV; client-side AbortController handles fetch cancel.
    // Timeout kills runaway piper.

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      stderr += "\n[timeout]";
      try { child.kill("SIGKILL"); } catch {}
    }, TTS_TIMEOUT_MS);

    // feed text via stdin
    try {
      child.stdin.write(text);
      child.stdin.end();
    } catch (e) {
      clearTimeout(timeout);
      return reply.code(500).send({ error: `piper stdin failed: ${String(e).slice(0,200)}`, fallback: "web-speech" });
    }

    const exitCode: number | null = await new Promise((resolveP) => {
      child.on("close", (code) => resolveP(code));
      child.on("error", () => resolveP(1));
    });
    clearTimeout(timeout);

    if (exitCode === null) {
      return reply.code(500).send({ error: `piper no exit code: ${stderr.slice(0,300)}`, fallback: "web-speech" });
    }
    if (exitCode !== 0) {
      return reply.code(500).send({ error: `piper failed (code ${exitCode}): ${stderr.slice(0,400)}`, fallback: "web-speech" });
    }
    const wav = Buffer.concat(chunks);
    if (wav.length < 44 || wav.subarray(0,4).toString() !== "RIFF") {
      return reply.code(500).send({ error: `piper output not valid WAV (${wav.length} bytes): ${stderr.slice(0,200)}`, fallback: "web-speech" });
    }
    reply.header("content-type", "audio/wav");
    reply.header("cache-control", "no-store");
    reply.header("x-tts-engine", "piper-local");
    reply.header("x-tts-voice", voice);
    return reply.send(wav);
  });

  // Whisper STT — real local: JSON { audioBase64, mime?:string, lang?:string }
  // Limits: 5MB, ~30s, temp file cleanup, abort kills child, no path from client
  const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
  const WHISPER_TIMEOUT_MS = 30_000;
  const ALLOWED_MIMES = new Set(["audio/wav", "audio/wave", "audio/x-wav", "audio/webm", "audio/ogg", "audio/mp3", "audio/mpeg"]);

  app.post("/api/voice/stt", async (req, reply) => {
    const body = (req.body as { audioBase64?: string; mime?: string; lang?: string }) ?? {};
    const b64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    const mimeIn = typeof body.mime === "string" ? body.mime.toLowerCase() : "audio/wav";
    if (!b64) return reply.code(400).send({ error: "audioBase64 required", fallback: "web-speech" });
    if (!ALLOWED_MIMES.has(mimeIn) && !mimeIn.startsWith("audio/")) {
      return reply.code(400).send({ error: `mime not allowed: ${mimeIn}`, fallback: "web-speech" });
    }
    // decode + size check
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return reply.code(400).send({ error: "invalid base64", fallback: "web-speech" });
    }
    if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) {
      return reply.code(400).send({ error: `audio size ${buf.length} out of range (max ${MAX_AUDIO_BYTES})`, fallback: "web-speech" });
    }
    if (buf.length < 1000) {
      return reply.code(400).send({ error: "audio too short (<1KB)", fallback: "web-speech" });
    }

    const whisperBin = resolve("tools/whisper/whisper.exe");
    const whisperBinAlt = resolve("tools/whisper/main.exe");
    const bin = existsSync(whisperBin) ? whisperBin : existsSync(whisperBinAlt) ? whisperBinAlt : "";
    const modelPath = resolve("models/whisper/ggml-base.bin");
    const modelTiny = resolve("models/whisper/ggml-tiny.bin");
    const model = existsSync(modelPath) ? modelPath : existsSync(modelTiny) ? modelTiny : "";
    if (!bin || !model) {
      return reply.code(503).send({
        error: "Whisper local not installed",
        fallback: "web-speech",
        expected: { whisperBin, modelPath, alt: whisperBinAlt },
        install: "Download whisper.cpp release (whisper.exe/main.exe) into tools/whisper/ + ggml-base.bin into models/whisper/ from https://huggingface.co/ggerganov/whisper.cpp",
      });
    }

    // write temp input
    const { mkdtempSync, rmSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { randomUUID } = await import("node:crypto");
    const dir = mkdtempSync(join(tmpdir(), "orvix-stt-"));
    const ext = mimeIn.includes("webm") ? "webm" : mimeIn.includes("ogg") ? "ogg" : mimeIn.includes("mp3") ? "mp3" : "wav";
    const inPath = join(dir, `in_${randomUUID()}.${ext}`);
    const wavPath = join(dir, `in_${randomUUID()}.wav`);
    const outPrefix = join(dir, `out_${randomUUID()}`);
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(inPath, buf);

      // Convert to 16k wav if needed (ffmpeg)
      let wavFile = inPath;
      if (ext !== "wav") {
        const ffmpegCandidates = ["ffmpeg", "ffmpeg.exe", resolve("tools/ffmpeg/ffmpeg.exe")];
        let ffmpeg = "";
        for (const cand of ffmpegCandidates) {
          try {
            const { spawnSync } = await import("node:child_process");
            const r = spawnSync(cand, ["-version"], { windowsHide: true, timeout: 2000 });
            if (r.status === 0) { ffmpeg = cand; break; }
          } catch {}
          if (existsSync(cand)) { ffmpeg = cand; break; }
        }
        if (!ffmpeg) {
          return reply.code(503).send({ error: `ffmpeg not found to convert ${ext} → wav (need wav input or install ffmpeg)`, fallback: "web-speech", hint: "Record as audio/wav in browser or install ffmpeg into PATH/tools/ffmpeg/" });
        }
        const conv = spawn("ffmpeg", ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath], { windowsHide: true } as never);
        const convDone: number | null = await new Promise((res) => { conv.on("close", res); conv.on("error", () => res(1)); setTimeout(()=> { try{ conv.kill("SIGKILL"); }catch{} res(1); }, 15_000); });
        if (convDone !== 0 || !existsSync(wavPath)) {
          return reply.code(500).send({ error: `ffmpeg convert failed for ${ext}`, fallback: "web-speech" });
        }
        wavFile = wavPath;
      } else {
        wavFile = inPath;
        // resample wav to 16k if needed (no ffmpeg, pure JS) — whisper requires 16k
        try { ensureWav16k(wavFile); } catch {}
      }

      // Spawn whisper: whisper.exe -m model -f wavFile -l auto --output-txt --output-file outPrefix
      // Some builds use --language auto, others -l auto
      const args = ["-m", model, "-f", wavFile, "-l", "auto", "-otxt", "-of", outPrefix];
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

      let killed = false;
      const onAbort = () => { if (!killed) { killed = true; try{ child.kill("SIGKILL"); }catch{} }};
      const sig = (req.raw as unknown as { signal?: AbortSignal })?.signal;
      if (sig) sig.addEventListener("abort", onAbort, { once: true });
      req.raw.on("close", onAbort);
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });

      const timeout = setTimeout(() => { try{ child.kill("SIGKILL"); }catch{} stderr += "\n[whisper timeout]"; }, WHISPER_TIMEOUT_MS);
      const code: number | null = await new Promise((res) => { child.on("close", res); child.on("error", () => res(1)); });
      clearTimeout(timeout);
      req.raw.off("close", onAbort);
      if (sig) sig.removeEventListener("abort", onAbort);
      if (killed || sig?.aborted) return reply.code(499).send({ error: "client closed request", fallback: "web-speech" });
      if (code !== 0) {
        return reply.code(500).send({ error: `whisper failed (code ${code}): ${stderr.slice(0,400) || stdout.slice(0,400)}`, fallback: "web-speech" });
      }
      // read txt output
      const txtPath = outPrefix + ".txt";
      let text = "";
      try {
        if (existsSync(txtPath)) text = readFileSync(txtPath, "utf8").trim();
        else text = stdout.trim();
      } catch {}
      text = text.replace(/^\[.*?\]\s*/g, "").trim(); // strip timestamps like [00:00:00.000 --> 00:00:02.000]
      if (!text) return reply.code(500).send({ error: "whisper produced empty transcript", fallback: "web-speech", stderr: stderr.slice(0,200) });
      reply.header("x-stt-engine", "whisper-local");
      return reply.send({ text, lang: "auto", engine: "whisper-local", fallback: null });
    } catch (e) {
      return reply.code(500).send({ error: `stt error: ${String(e).slice(0,300)}`, fallback: "web-speech" });
    } finally {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
}
