import type { AudioCapture, DeviceInfo, AudioLevel } from "./types";

export class WebAudioCapture implements AudioCapture {
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private levelCb: ((lvl: AudioLevel) => void) | null = null;
  private deviceCb: (() => void) | null = null;
  private ctx: AudioContext | null = null;

  async listMicrophones(): Promise<DeviceInfo[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === "audioinput").map(d => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0,6)}`, kind: "audioinput" }));
    } catch { return []; }
  }
  async listSpeakers(): Promise<DeviceInfo[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === "audiooutput").map(d => ({ deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0,6)}`, kind: "audiooutput" }));
    } catch { return []; }
  }
  async start(deviceId?: string): Promise<MediaStream> {
    this.stop();
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    // analyser for level meter
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.loop();
    } catch {}
    // devicechange
    try { navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChangeInner); } catch {}
    return this.stream;
  }
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    try { navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChangeInner); } catch {}
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.ctx) { try { this.ctx.close(); } catch {} }
    this.ctx = null;
    this.analyser = null;
  }
  onLevel(cb: (lvl: AudioLevel) => void): void { this.levelCb = cb; }
  onDeviceChange(cb: () => void): void { this.deviceCb = cb; }
  private onDeviceChangeInner = () => { this.deviceCb?.(); };
  getStream(): MediaStream | null { return this.stream; }
  isStarted(): boolean { return !!this.stream; }

  private loop = () => {
    if (!this.analyser || !this.levelCb) { this.raf = requestAnimationFrame(this.loop); return; }
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0, peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      const a = Math.abs(v);
      sum += v * v;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / data.length);
    const db = 20 * Math.log10(Math.max(0.0001, rms));
    this.levelCb({ rms, peak, db });
    this.raf = requestAnimationFrame(this.loop);
  };
}
