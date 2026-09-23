import type { STTProvider } from "./types";
import { createRecognizer as createWebRec } from "./voice";
import { EnergyVAD } from "./VADProvider";

// Web Speech = browser fallback, NOT local. Labeled clearly per Phase 0 correction.
export class WebSpeechSTT implements STTProvider {
  id = "web-speech-fallback" as const;
  kind = "fallback" as const;
  label = "Web Speech (browser fallback — not local)";
  private rec: { start:()=>void; stop:()=>void } | null = null;
  private onPartial: ((t:string)=>void)|null = null;
  private onFinal: ((t:string)=>void)|null = null;
  private onError: ((e:string)=>void)|null = null;

  async start(opts:{ langHint?:string; onPartial:(t:string)=>void; onFinal:(t:string)=>void; onError:(e:string)=>void }): Promise<void> {
    this.onPartial = opts.onPartial;
    this.onFinal = opts.onFinal;
    this.onError = opts.onError;
    const lang = opts.langHint ?? "en-US";
    // continuous false for single utterance; VAD will handle segmentation
    this.rec = createWebRec({
      lang,
      onPartial: (p) => this.onPartial?.(p),
      onFinal: (t) => this.onFinal?.(t),
      onEnd: () => {},
      onError: (e) => this.onError?.(e),
    });
    this.rec.start();
  }
  async stop(): Promise<string> {
    this.rec?.stop();
    this.rec = null;
    return "";
  }
  abort(): void {
    this.rec?.stop();
    this.rec = null;
  }
}

// Real local Whisper via gateway /api/voice/stt — records via MediaRecorder then POSTs base64
// Shows true fallback if local not installed (does not claim "local" when using Web Speech)
// VAD-linked: EnergyVAD detects end-of-speech → auto stop & transcribe (per spec point 5)
export class WhisperLocalSTT implements STTProvider {
  id = "whisper.cpp-base" as const;
  kind = "local" as const;
  label = "whisper.cpp base (local)";
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private vad: EnergyVAD | null = null;
  private fallback = new WebSpeechSTT();
  private usingFallback = false;
  private onFinal: ((t:string)=>void)|null = null;
  private onPartial: ((t:string)=>void)|null = null;
  private onError: ((e:string)=>void)|null = null;
  private langHint: string | undefined;
  private autoStopTimer: number | null = null;

  // WAV encoder: capture 16k PCM via AudioContext, encode to WAV blob (no ffmpeg needed)
  private audioCtx: AudioContext | null = null;
  private pcmChunks: Float32Array[] = [];
  private processor: ScriptProcessorNode | null = null;

  async start(opts:{ langHint?:string; onPartial:(t:string)=>void; onFinal:(t:string)=>void; onError:(e:string)=>void }): Promise<void> {
    this.onPartial = opts.onPartial;
    this.onFinal = opts.onFinal;
    this.onError = opts.onError;
    this.langHint = opts.langHint;
    this.usingFallback = false;
    this.chunks = [];
    this.pcmChunks = [];

    try {
      const capStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }});
      this.stream = capStream;
      // Try to capture 16k PCM directly via AudioContext (avoids ffmpeg conversion on server)
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 16000 } as never);
        // resume if suspended (needs user gesture — we are in gesture)
        if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
        const src = this.audioCtx.createMediaStreamSource(capStream);
        // ScriptProcessor 4096, 1 channel
        this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0);
          // copy
          this.pcmChunks.push(new Float32Array(data));
        };
        src.connect(this.processor);
        this.processor.connect(this.audioCtx.destination);
        this.onPartial?.("…recording (local 16k WAV)");
      } catch {
        // fallback to MediaRecorder webm if AudioContext fails
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/wav";
        this.rec = new MediaRecorder(capStream, mime ? { mimeType: mime } as never : undefined);
        this.rec.ondataavailable = (e) => { if (e.data.size>0) this.chunks.push(e.data); };
        this.rec.onerror = () => { this.fallbackToWebSpeech("MediaRecorder error — fallback to Web Speech"); };
        this.rec.start(100);
        this.onPartial?.("…recording (local webm)");
      }
      // VAD-linked auto stop: energy VAD detects silence → auto stop & transcribe
      try {
        this.vad = new EnergyVAD();
        await this.vad.start(capStream, (seg) => {
          if (seg.endMs !== undefined) {
            if (this.autoStopTimer) clearTimeout(this.autoStopTimer as unknown as number);
            this.autoStopTimer = window.setTimeout(() => {
              const isRec = (this.rec && this.rec.state === "recording") || (this.pcmChunks.length>0 && this.audioCtx);
              if (isRec) {
                this.onPartial?.("…transcribing");
                this.stop().catch(()=>{});
              }
            }, 400);
          } else {
            if (this.autoStopTimer) { clearTimeout(this.autoStopTimer as unknown as number); this.autoStopTimer=null; }
          }
        });
      } catch {}
    } catch (e) {
      this.fallbackToWebSpeech(`mic error: ${String(e).slice(0,80)}`);
    }
  }

  private fallbackToWebSpeech(reason:string){
    this.usingFallback = true;
    console.warn(`[WhisperLocal] ${reason} — using Web Speech fallback (browser, NOT local)`);
    // stop local rec
    try{ this.rec?.stop(); }catch{}
    try{ this.stream?.getTracks().forEach(t=>t.stop()); }catch{}
    this.rec=null; this.stream=null;
    this.fallback.start({ langHint: this.langHint, onPartial: this.onPartial!, onFinal: this.onFinal!, onError: this.onError! });
  }

  private encodeWav(pcms: Float32Array[], sampleRate: number): Blob {
    const total = pcms.reduce((a,c)=>a+c.length,0);
    const buffer = new ArrayBuffer(44 + total*2);
    const view = new DataView(buffer);
    const writeString = (off:number, s:string)=> { for(let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i)); };
    writeString(0,"RIFF"); view.setUint32(4,36+total*2,true); writeString(8,"WAVE");
    writeString(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    writeString(36,"data"); view.setUint32(40,total*2,true);
    let off=44;
    for(const chunk of pcms){ for(let i=0;i<chunk.length;i++){ let s=Math.max(-1,Math.min(1,chunk[i]!)); view.setInt16(off, s<0?s*0x8000:s*0x7FFF,true); off+=2; } }
    return new Blob([buffer],{type:"audio/wav"});
  }

  async stop(): Promise<string> {
    if (this.usingFallback) {
      return this.fallback.stop();
    }
    // cleanup VAD
    if (this.autoStopTimer) { clearTimeout(this.autoStopTimer as unknown as number); this.autoStopTimer=null; }
    try{ this.vad?.stop(); }catch{}
    this.vad=null;

    // WAV path (16k PCM) — no ffmpeg needed, direct whisper 16k
    if (this.pcmChunks.length > 0) {
      const pcm = this.pcmChunks.slice();
      const ctx = this.audioCtx;
      this.pcmChunks = [];
      try{ this.processor?.disconnect(); }catch{}
      this.processor=null;
      if (ctx) { try{ ctx.close(); }catch{} this.audioCtx=null; }
      // keep stream for cleanup after, but pcm already captured
      const wavBlob = this.encodeWav(pcm, 16000);
      // cleanup stream
      this.stream?.getTracks().forEach(t=>t.stop());
      this.stream=null; this.rec=null;
      if (wavBlob.size < 1000) { this.onError?.("audio too short"); return ""; }
      // send to local whisper
      return new Promise<string>((resolve)=>{
        const reader = new FileReader();
        reader.onload = async ()=>{
          const b64 = (reader.result as string).split(",")[1] ?? "";
          try{
            const res = await fetch("/api/voice/stt",{ method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ audioBase64:b64, mime:"audio/wav", lang:this.langHint })});
            const ct=res.headers.get("content-type")??"";
            if(res.status===503 || res.status===501){
              const j= ct.includes("json")? await res.json().catch(()=>({})): {error: await res.text().catch(()=> "")};
              const msg=(j as {error?:string})?.error ?? `local STT not installed (${res.status})`;
              console.warn(`[WhisperLocal] ${msg} — fallback to Web Speech (browser, NOT local)`);
              this.usingFallback=true;
              this.onError?.(`${msg} — using Web Speech fallback for next utterance`);
              resolve(""); return;
            }
            if(!res.ok){ this.onError?.(`STT failed: ${(await res.text().catch(()=> "")).slice(0,120)}`); resolve(""); return; }
            const j= await res.json() as {text?:string};
            const text= typeof j.text==="string"? j.text.trim(): "";
            if(text){ this.onFinal?.(text); resolve(text); } else { this.onError?.("empty transcript"); resolve(""); }
          }catch(e){ this.onError?.(`STT network: ${String(e).slice(0,100)}`); resolve(""); }
        };
        reader.onerror=()=>{ this.onError?.("base64 read failed"); resolve(""); };
        reader.readAsDataURL(wavBlob);
      });
    }

    const rec = this.rec;
    if (!rec) return "";
    return new Promise<string>((resolve) => {
      const mime = rec.mimeType || "audio/webm";
      rec.onstop = async () => {
        try {
          // cleanup stream
          this.stream?.getTracks().forEach(t=>t.stop());
          const blob = new Blob(this.chunks, { type: mime });
          if (blob.size < 800) { this.onError?.("audio too short"); resolve(""); return; }
          // convert to base64
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;
            const b64 = dataUrl.split(",")[1] ?? "";
            try {
              const res = await fetch("/api/voice/stt", {
                method: "POST",
                headers: { "content-type":"application/json" },
                body: JSON.stringify({ audioBase64: b64, mime, lang: this.langHint }),
              });
              const ct = res.headers.get("content-type") ?? "";
              if (res.status === 503 || res.status === 501) {
                const j = ct.includes("json") ? await res.json().catch(()=> ({})) : { error: await res.text().catch(()=> "") };
                const msg = (j as {error?:string})?.error ?? `local STT not installed (${res.status})`;
                console.warn(`[WhisperLocal] ${msg} — fallback to Web Speech (browser, NOT local)`);
                // show fallback in UI via error then delegate
                this.usingFallback = true;
                // start fallback and transfer final via it? For this utterance, we lost it — fallback will need re-record, so just report
                this.onError?.(`${msg} — using Web Speech fallback for next utterance`);
                // Try to fallback for this same utterance by starting Web Speech with no audio — can't, so return empty
                resolve("");
                return;
              }
              if (!res.ok) {
                const txt = await res.text().catch(()=> "");
                this.onError?.(`STT failed: ${txt.slice(0,120)}`);
                resolve("");
                return;
              }
              const j = await res.json() as { text?: string; fallback?: string };
              const text = typeof j.text === "string" ? j.text.trim() : "";
              if (j.fallback) console.warn(`[WhisperLocal] server fallback: ${j.fallback}`);
              if (text) { this.onFinal?.(text); resolve(text); }
              else { this.onError?.("empty transcript"); resolve(""); }
            } catch (e) {
              this.onError?.(`STT network: ${String(e).slice(0,100)}`);
              resolve("");
            }
          };
          reader.onerror = () => { this.onError?.("base64 read failed"); resolve(""); };
          reader.readAsDataURL(blob);
        } catch (e) {
          this.onError?.(String(e));
          resolve("");
        } finally {
          this.rec=null; this.stream=null; this.chunks=[];
        }
      };
      try{ rec.stop(); } catch{ resolve(""); }
    });
  }

  abort(): void {
    if (this.autoStopTimer) { clearTimeout(this.autoStopTimer as unknown as number); this.autoStopTimer=null; }
    try{ this.vad?.stop(); }catch{} this.vad=null;
    if (this.usingFallback) { this.fallback.abort(); this.usingFallback=false; return; }
    // wav path cleanup
    try{ this.processor?.disconnect(); }catch{} this.processor=null;
    if (this.audioCtx) { try{ this.audioCtx.close(); }catch{} this.audioCtx=null; }
    this.pcmChunks=[];
    try{ this.rec?.stop(); }catch{}
    try{ this.stream?.getTracks().forEach(t=>t.stop()); }catch{}
    this.rec=null; this.stream=null; this.chunks=[];
  }
}

export class WhisperTinySTT implements STTProvider {
  id = "whisper.cpp-tiny" as const;
  kind = "local" as const;
  label = "whisper.cpp tiny (local — lighter, not yet installed)";
  async start(_opts:unknown): Promise<void>{ throw new Error("Whisper tiny not installed"); }
  async stop(): Promise<string>{ return ""; }
  abort(): void{}
}
