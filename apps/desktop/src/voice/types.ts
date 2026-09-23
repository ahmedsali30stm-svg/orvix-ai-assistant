// Orvix Voice Stack — provider contracts (Phase 1)
// Updated per Phase 0 corrections: Web Speech = browser fallback, clearly labeled, not "local"
// All timings are hypotheses until measured on i7-8650U / 8GB.

export type VoiceEngineKind = "local" | "fallback" | "cloud";
export type STTEngineId = "whisper.cpp-base" | "whisper.cpp-tiny" | "web-speech-fallback";
export type TTSEngineId = "piper-en" | "kokoro-en" | "web-speech-fallback";
export type VADEngineId = "silero" | "webrtc" | "energy" | "none";

export type VoiceState =
  | "idle"
  | "listening"       // mic open, VAD active
  | "transcribing"    // STT running
  | "thinking"        // LLM/tool
  | "using_tool"
  | "speaking"        // TTS playback
  | "interrupted"
  | "error";

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
}

export interface AudioLevel { rms: number; peak: number; db: number; }

// ── AudioCapture ────────────────────────────────────────────────────────────
export interface AudioCapture {
  listMicrophones(): Promise<DeviceInfo[]>;
  listSpeakers(): Promise<DeviceInfo[]>;
  start(deviceId?: string): Promise<MediaStream>;
  stop(): void;
  onLevel?(cb: (lvl: AudioLevel) => void): void;
  onDeviceChange?(cb: () => void): void;
  getStream(): MediaStream | null;
  isStarted(): boolean;
}

// ── VAD ───────────────────────────────────────────────────────────────────
export interface VADProvider {
  id: VADEngineId;
  kind: VoiceEngineKind;
  start(stream: MediaStream, onSpeech: (segment: { startMs: number; endMs?: number }) => void): Promise<void>;
  stop(): void;
  // for UI: speech probability 0..1
  onSpeechProb?(cb: (p: number) => void): void;
}

// ── STT ───────────────────────────────────────────────────────────────────
export interface STTResult { text: string; isFinal: boolean; confidence?: number; lang?: string; }
export interface STTProvider {
  id: STTEngineId;
  kind: VoiceEngineKind;
  label: string; // display e.g. "whisper.cpp base (local)" vs "Web Speech (browser fallback)"
  start(opts: { langHint?: string; onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (e: string) => void }): Promise<void>;
  stop(): Promise<string>; // returns final text if any
  abort(): void;
}

// ── TTS ───────────────────────────────────────────────────────────────────
export interface TTSVoice { id: string; lang: string; name: string; engine: TTSEngineId }
export interface TTSProvider {
  id: TTSEngineId;
  kind: VoiceEngineKind;
  label: string;
  voices(): Promise<TTSVoice[]>;
  // synthesize to playable utterance; supports streaming by sentence
  speak(text: string, opts?: { voiceId?: string; rate?: number; volume?: number; onSentence?: (i: number) => void }): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
  // text normalization for English voice: strip markdown, verbalize numbers/currency/dates
  normalizeForSpeech?(raw: string): string;
}

// ── AudioPlayer ───────────────────────────────────────────────────────────
export interface AudioPlayer {
  play(buffer: AudioBuffer | Blob | string): Promise<void>; // Blob URL or TTS stream
  stop(): void;
  isPlaying(): boolean;
  volume: number;
  onEnded?(cb: () => void): void;
}

// ── WakeWord ──────────────────────────────────────────────────────────────
export interface WakeWordProvider {
  id: string; // e.g. "hey-orvix-web-speech-fallback" | "hey-orvix-porcupine-local"
  kind: VoiceEngineKind;
  start(onWake: (phrase: string, remainder?: string) => void, onError?: (e: string) => void): Promise<void>;
  stop(): void;
  isListening(): boolean;
}

// ── Session controller ────────────────────────────────────────────────────
export interface VoiceSessionEvents {
  onState?(s: VoiceState, detail?: string): void;
  onPartialTranscript?(t: string): void;
  onFinalTranscript?(t: string): void;
  onLevel?(lvl: AudioLevel): void;
  onError?(e: string): void;
}

export interface VoiceSessionConfig {
  stt: STTProvider;
  tts: TTSProvider;
  vad: VADProvider;
  capture: AudioCapture;
  player: AudioPlayer;
  wake?: WakeWordProvider | null;
  langMode: "en-en" | "ar-en-summary" | "ar-text-only"; // Phase 2
}
