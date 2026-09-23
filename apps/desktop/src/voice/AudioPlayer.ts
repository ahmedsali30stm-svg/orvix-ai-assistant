import type { AudioPlayer } from "./types";

export class WebAudioPlayer implements AudioPlayer {
  volume = 1;
  private audio: HTMLAudioElement | null = null;
  private onEndedCb: (()=>void)|null = null;
  async play(blob: Blob | string): Promise<void> {
    this.stop();
    const url = typeof blob === "string" ? blob : URL.createObjectURL(blob);
    const isBlob = typeof blob !== "string";
    return new Promise<void>((resolve, reject) => {
      const a = new Audio(url);
      this.audio = a;
      a.volume = this.volume;
      a.onended = () => { if(isBlob) URL.revokeObjectURL(url); this.audio=null; this.onEndedCb?.(); resolve(); };
      a.onerror = () => { if(isBlob) URL.revokeObjectURL(url); reject(new Error("playback failed")); };
      a.play().catch(reject);
    });
  }
  stop(): void { if(this.audio){ try{ this.audio.pause(); this.audio.src=""; }catch{} this.audio=null; } }
  isPlaying(): boolean { return !!this.audio && !this.audio.paused; }
  onEnded(cb:()=>void): void { this.onEndedCb = cb; }
}
