import { useEffect, useState, useRef } from "react";
import { WebAudioCapture } from "../voice/AudioCapture";
import type { DeviceInfo, AudioLevel, VoiceState } from "../voice/types";

export function VoiceSettings() {
  const [mics, setMics] = useState<DeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<DeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>(() => { try{ return localStorage.getItem("orvix.micId") ?? ""; }catch{ return ""; }});
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(() => { try{ return localStorage.getItem("orvix.speakerId") ?? ""; }catch{ return ""; }});
  const [level, setLevel] = useState<AudioLevel>({ rms:0, peak:0, db:-100 });
  const [voiceStatus, setVoiceStatus] = useState<Record<string,unknown> | null>(null);
  const [permission, setPermission] = useState<"unknown"|"granted"|"denied">("unknown");
  const [testingMic, setTestingMic] = useState(false);
  const [wakeOn, setWakeOn] = useState(()=> { try{ return localStorage.getItem("orvix.wake")==="1"; }catch{ return false; }});
  const captureRef = useRef<WebAudioCapture|null>(null);

  const refreshDevices = async () => {
    const cap = new WebAudioCapture();
    const m = await cap.listMicrophones();
    const s = await cap.listSpeakers();
    setMics(m); setSpeakers(s);
  };
  useEffect(()=> {
    refreshDevices();
    fetch("/api/voice/status").then(r=>r.json()).then(setVoiceStatus).catch(()=> setVoiceStatus({ error:"gateway offline"}));
    // permission query
    try{
      // @ts-ignore
      navigator.permissions?.query?.({ name:"microphone" as PermissionName }).then((res: PermissionStatus)=>{
        setPermission(res.state as never);
        res.onchange = () => setPermission(res.state as never);
      }).catch(()=>{});
    }catch{}
    const onDev = ()=> refreshDevices();
    try{ navigator.mediaDevices.addEventListener("devicechange", onDev); return ()=> navigator.mediaDevices.removeEventListener("devicechange", onDev); }catch{}
  }, []);

  const persistMic = (id:string)=> { setSelectedMic(id); try{ localStorage.setItem("orvix.micId", id); }catch{} };
  const persistSpeaker = (id:string)=> { setSelectedSpeaker(id); try{ localStorage.setItem("orvix.speakerId", id); }catch{} };
  const toggleWake = ()=> { const v=!wakeOn; setWakeOn(v); try{ localStorage.setItem("orvix.wake", v?"1":"0"); }catch{} };

  const testMic = async ()=>{
    if (testingMic) {
      captureRef.current?.stop(); setTestingMic(false); return;
    }
    try{
      const cap = new WebAudioCapture();
      captureRef.current = cap;
      cap.onLevel(setLevel);
      await cap.start(selectedMic || undefined);
      setPermission("granted");
      setTestingMic(true);
    } catch(e){
      setPermission("denied");
      console.warn(e);
    }
  };
  useEffect(()=> ()=>{ captureRef.current?.stop(); }, []);

  const testTTS = async ()=>{
    const text = "Hello Ahmed, this is Orvix. Your voice is working — local Piper will replace this browser voice after you download the model.";
    try{
      // try local first
      const res = await fetch("/api/voice/tts", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ text })});
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = new Audio(url); a.volume=1; await a.play(); a.onended=()=> URL.revokeObjectURL(url);
        return;
      }
    }catch{}
    // fallback
    const u = new SpeechSynthesisUtterance(text);
    u.lang="en-US"; u.rate=1.02; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  };

  return (
    <div className="glass rounded-2xl p-4 text-sm">
      <div className="font-medium text-slate-200">Voice — Local engine</div>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
        Web Speech = <b className="text-amber-300">browser fallback</b> (not local, rate-limited, needs internet). Local engine = <b className="text-emerald-300">Piper / Whisper</b> after you download models into <code className="text-cyan-300">models/piper</code> and <code className="text-cyan-300">models/whisper</code>. No cloud free tier in default path. No raw audio saved.
      </p>

      {/* engine status */}
      <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">STT</span><span className="text-slate-300">{(voiceStatus as {stt?:{whisperBase:boolean}})?.stt?.whisperBase ? "whisper.cpp base (local)" : "Web Speech (browser fallback)"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">TTS</span><span className="text-slate-300">{(voiceStatus as {tts?:{piperLessac:boolean}})?.tts?.piperLessac ? "Piper Lessac (local)" : "Web Speech (browser fallback)"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">VAD</span><span className="text-slate-300">{(voiceStatus as {vad?:{silero:boolean}})?.vad?.silero ? "Silero (local)" : "energy (fallback)"}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Mic permission</span><span className={permission==="granted"?"text-emerald-300":permission==="denied"?"text-red-400":"text-slate-400"}>{permission}</span></div>
      </div>

      {/* mic/speaker select */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div>
          <label className="text-xs text-slate-500">Microphone</label>
          <select value={selectedMic} onChange={e=> persistMic(e.target.value)} className="w-full mt-1 bg-white/5 rounded-xl px-3 py-2 text-sm outline-none">
            <option value="">Default</option>
            {mics.map(m=> <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Speaker</label>
          <select value={selectedSpeaker} onChange={e=> persistSpeaker(e.target.value)} className="w-full mt-1 bg-white/5 rounded-xl px-3 py-2 text-sm outline-none">
            <option value="">Default</option>
            {speakers.map(s=> <option key={s.deviceId} value={s.deviceId}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* level meter + test */}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={testMic} className={`px-3 py-2 rounded-xl text-xs font-semibold ${testingMic?"bg-red-500/90 text-white":"bg-white/8 hover:bg-white/15 text-slate-200"}`}>{testingMic?"Stop mic test":"Test mic (level)"}</button>
        <button onClick={testTTS} className="px-3 py-2 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-[#04060c] font-semibold text-xs">Test voice “Hello Ahmed”</button>
        <button onClick={toggleWake} className={`px-3 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-bold border ${wakeOn?"bg-cyan-400/15 text-cyan-300 border-cyan-400/30":"bg-white/5 text-slate-500 border-white/10"}`}>{wakeOn?"Hey Orvix on (experimental)":"Wake off"}</button>
      </div>
      {testingMic && (
        <div className="mt-3">
          <div className="h-2 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-75" style={{ width: `${Math.min(100, Math.max(0, (level.db+50)*2))}%` }} /></div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>r.m.s {level.rms.toFixed(3)}</span><span>peak {level.peak.toFixed(3)}</span><span>{level.db.toFixed(1)} dB</span></div>
          <p className="text-[10px] text-slate-600 mt-1">Speak normally — green 40-80% is ideal. If 0%: check mic permission / device.</p>
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-500 leading-relaxed">
        <b className="text-slate-300">States:</b> idle, listening, transcribing, thinking, using_tool, speaking, interrupted, error. Barge-in: while Orvix speaks, say “Hey Orvix” or press Ctrl+Space — audio stops and new request aborts previous LLM/tools.
        <br/><span className="text-amber-300">Wake word experimental — disabled by default until barge-in stable. Keep push-to-talk (mic/Ctrl+Space) as reliable fallback.</span>
      </div>
    </div>
  );
}
