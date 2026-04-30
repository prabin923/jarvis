"use client";

import type { ComponentType } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, Cpu, Wifi, HardDrive, Battery, MemoryStick, Monitor,
  Smartphone, Router, CircuitBoard, Activity, Volume2, Loader2,
  Server, Globe, Zap, Signal, ChevronRight, Ear, EarOff
} from "lucide-react";

interface SystemData {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: { model: string; cores: number; usage: number };
  memory: { total: string; used: string; free: string; percent: number };
  disk: { total: string; used: string; free: string; percent: number };
  battery: { percent: number; charging: boolean; timeRemaining: string } | null;
  processes: { name: string; cpu: string; mem: string }[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

type DeviceType = "router" | "computer" | "phone" | "iot" | "unknown";
type ActivePanel = "system" | "network" | "chat";
type SpeechRecognitionConstructor = new () => SpeechRecognition;

interface NetworkData {
  localDevice: { ip: string; hostname: string };
  wifi: { ssid: string; signal: string } | null;
  devices: { ip: string; mac: string; hostname: string; vendor: string; type: DeviceType }[];
  totalDevices: number;
}

interface SpeechRecognitionResultEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const ACTIVE_PANELS = ["chat", "system", "network"] as const;

const DEVICE_ICONS: Record<DeviceType, ComponentType<{ className?: string }>> = {
  router: Router,
  computer: Monitor,
  phone: Smartphone,
  iot: CircuitBoard,
  unknown: Server,
};

// ─── Clap Detection Constants ───
const CLAP_THRESHOLD = 0.25;        // Volume spike threshold (0–1) — lowered for real claps
const CLAP_MIN_GAP = 100;           // Min ms between two claps
const CLAP_MAX_GAP = 900;           // Max ms between two claps for double-clap
const CLAP_COOLDOWN = 1500;         // Cooldown after wake to avoid re-triggering
const CLAP_IMPULSE_DURATION = 200;  // A clap must be short (ms) — widened for real hardware
const CLAP_FREQUENCY_SPREAD = 0.4;  // Min spectral flatness (claps = broadband noise)

export default function JarvisPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [systemData, setSystemData] = useState<SystemData | null>(null);
  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>("chat");
  const [clapDetectionOn, setClapDetectionOn] = useState(false);
  const [clapFlash, setClapFlash] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clap detection refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const clapAnimFrameRef = useRef<number>(0);
  const lastClapTimeRef = useRef<number>(0);
  const clapCooldownRef = useRef<boolean>(false);
  const wasLoudRef = useRef<boolean>(false);
  const loudStartRef = useRef<number>(0);

  const stopClapDetection = useCallback(() => {
    if (clapAnimFrameRef.current) {
      cancelAnimationFrame(clapAnimFrameRef.current);
      clapAnimFrameRef.current = 0;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    analyserRef.current = null;
    setClapDetectionOn(false);
  }, []);

  // Fetch system data
  const fetchSystem = useCallback(async () => {
    try {
      const res = await fetch("/api/system");
      const data = await res.json();
      if (!data.error) setSystemData(data);
    } catch {}
  }, []);

  // Fetch network data
  const fetchNetwork = useCallback(async () => {
    try {
      const res = await fetch("/api/network");
      const data = await res.json();
      if (!data.error) setNetworkData(data);
    } catch {}
  }, []);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void fetchSystem();
      void fetchNetwork();
    }, 0);
    const sysInterval = setInterval(fetchSystem, 5000);
    const netInterval = setInterval(fetchNetwork, 15000);
    if (typeof window !== "undefined") synthRef.current = window.speechSynthesis;
    return () => {
      clearTimeout(initialFetch);
      clearInterval(sysInterval);
      clearInterval(netInterval);
      stopClapDetection();
    };
  }, [fetchSystem, fetchNetwork, stopClapDetection]);

  // ─── Clap Detection Engine (improved) ───
  const startClapDetection = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.1; // Low smoothing to preserve sharp transients
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      micStreamRef.current = stream;
      lastClapTimeRef.current = 0;
      clapCooldownRef.current = false;
      wasLoudRef.current = false;

      const timeDomainData = new Uint8Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      // Check if sound is broadband (clap-like) vs tonal (voice/music)
      const isSpectrallyFlat = (): boolean => {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        let max = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
          if (freqData[i] > max) max = freqData[i];
        }
        if (max === 0) return false;
        const mean = sum / freqData.length;
        // Spectral flatness: ratio of mean to max (1 = perfectly flat = noise/clap)
        return (mean / max) > CLAP_FREQUENCY_SPREAD;
      };

      const detectClap = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(timeDomainData);

        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          const val = (timeDomainData[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / timeDomainData.length);
        const now = Date.now();

        // Detect impulse start
        if (rms > CLAP_THRESHOLD && !wasLoudRef.current) {
          wasLoudRef.current = true;
          loudStartRef.current = now;
        }

        // Detect impulse end — check if it was short enough to be a clap
        if (rms < CLAP_THRESHOLD * 0.4 && wasLoudRef.current) {
          const loudDuration = now - loudStartRef.current;
          wasLoudRef.current = false;

          // Must be short (impulse) AND broadband (not voice)
          if (loudDuration < CLAP_IMPULSE_DURATION && !clapCooldownRef.current && isSpectrallyFlat()) {
            const timeSinceLastClap = now - lastClapTimeRef.current;

            if (timeSinceLastClap > CLAP_MIN_GAP && timeSinceLastClap < CLAP_MAX_GAP) {
              // ✅ Double clap detected!
              clapCooldownRef.current = true;
              lastClapTimeRef.current = 0;

              // Flash indicator
              setClapFlash(true);
              setTimeout(() => setClapFlash(false), 600);

              // Wake JARVIS — trigger voice input
              setTimeout(() => {
                clapCooldownRef.current = false;
              }, CLAP_COOLDOWN);

              // Trigger the voice wake
              document.dispatchEvent(new CustomEvent("jarvis-clap-wake"));
            } else {
              // First clap — record time
              lastClapTimeRef.current = now;
            }
          }
        }

        clapAnimFrameRef.current = requestAnimationFrame(detectClap);
      };

      clapAnimFrameRef.current = requestAnimationFrame(detectClap);
      setClapDetectionOn(true);
    } catch (err) {
      console.error("Clap detection: mic access denied", err);
    }
  }, []);

  const toggleClapDetection = useCallback(() => {
    if (clapDetectionOn) {
      stopClapDetection();
    } else {
      startClapDetection();
    }
  }, [clapDetectionOn, startClapDetection, stopClapDetection]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // TTS
  const speak = useCallback((text: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
    const voices = synthRef.current.getVoices();
    const premium = voices.find(v => v.name.toLowerCase().includes("daniel")) ||
      voices.find(v => v.name.toLowerCase().includes("google") && v.lang.startsWith("en")) ||
      voices.find(v => v.lang.startsWith("en") && !v.localService) ||
      voices.find(v => v.lang.startsWith("en"));
    if (premium) utterance.voice = premium;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current.speak(utterance);
  }, []);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsProcessing(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          systemData,
          networkData,
          history: messages.slice(-10),
        }),
      });
      const data = await res.json();
      const reply = data.reply || "I'm having trouble processing that, Boss.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      speak(reply);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Connection issue. Systems may be offline." }]);
    } finally {
      setIsProcessing(false);
    }
  }, [systemData, networkData, messages, speak]);

  const startVoiceInput = useCallback(() => {
    if (isListening || isProcessing) return;
    if (isSpeaking) {
      synthRef.current?.cancel();
      setIsSpeaking(false);
    }

    const speechWindow = window as SpeechWindow;
    const SR = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (text) sendMessage(text);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.start();
    recognitionRef.current = recognition;
  }, [isListening, isProcessing, isSpeaking, sendMessage]);

  // Listen for wake events from the in-page clap detector and Electron background listener.
  useEffect(() => {
    const handleClapWake = () => {
      setActivePanel("chat");
      window.setTimeout(startVoiceInput, 300);
    };

    document.addEventListener("jarvis-clap-wake", handleClapWake);
    return () => document.removeEventListener("jarvis-clap-wake", handleClapWake);
  }, [startVoiceInput]);

  // Voice input
  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    startVoiceInput();
  };

  const cpuColor = (systemData?.cpu.usage || 0) > 80 ? "text-red-400" : (systemData?.cpu.usage || 0) > 50 ? "text-amber-400" : "text-cyan-400";
  const memColor = (systemData?.memory.percent || 0) > 80 ? "text-red-400" : (systemData?.memory.percent || 0) > 50 ? "text-amber-400" : "text-cyan-400";
  const diskColor = (systemData?.disk.percent || 0) > 80 ? "text-red-400" : "text-cyan-400";

  return (
    <div className="h-screen flex flex-col overflow-hidden grid-bg">
      {/* Scan overlay */}
      <div className="scan-overlay" />

      {/* Draggable title bar for Electron */}
      <div className="electron-drag-region" />

      {/* Header */}
      <header className="px-4 sm:px-6 py-3 flex items-center justify-between border-b border-[rgba(0,212,255,0.06)] z-10 relative" style={{ paddingLeft: '5rem' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border border-cyan-500/30 flex items-center justify-center relative">
            <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(0,212,255,0.6)]" />
            <div className="arc-ring w-8 h-8" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-[0.3em] text-jarvis font-mono">J.A.R.V.I.S.</h1>
            <p className="text-[9px] tracking-[0.2em] text-neutral-600 uppercase">Desktop AI System v3.0</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ACTIVE_PANELS.map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all font-mono ${
                activePanel === p
                  ? "text-cyan-300 bg-cyan-500/10 border border-cyan-500/20"
                  : "text-neutral-600 hover:text-neutral-400"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono text-neutral-600">
          {/* Clap Detection Toggle */}
          <button
            onClick={toggleClapDetection}
            title={clapDetectionOn ? "Clap detection ON — double-clap to wake" : "Enable clap detection"}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all ${
              clapDetectionOn
                ? clapFlash
                  ? "text-cyan-200 bg-cyan-400/30 border border-cyan-400/50 shadow-[0_0_15px_rgba(0,212,255,0.5)] scale-110"
                  : "text-cyan-400 bg-cyan-500/10 border border-cyan-500/20"
                : "text-neutral-600 hover:text-neutral-400 border border-transparent"
            }`}
          >
            {clapDetectionOn ? <Ear className="w-3.5 h-3.5" /> : <EarOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{clapDetectionOn ? "👏 ON" : "👏"}</span>
          </button>

          {systemData && (
            <>
              <span className={cpuColor}>CPU {systemData.cpu.usage}%</span>
              <span className={memColor}>RAM {systemData.memory.percent}%</span>
              {systemData.battery && (
                <span className={systemData.battery.percent < 20 ? "text-red-400" : "text-emerald-400"}>
                  {systemData.battery.charging ? "⚡" : "🔋"} {systemData.battery.percent}%
                </span>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left sidebar — System */}
        {activePanel === "system" && systemData && (
          <div className="w-full p-4 sm:p-6 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Device Info */}
              <div className="hud-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Monitor className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Device</span>
                </div>
                <div className="space-y-2 text-sm">
                  <InfoRow label="Host" value={systemData.hostname} />
                  <InfoRow label="OS" value={`${systemData.platform} ${systemData.arch}`} />
                  <InfoRow label="Uptime" value={systemData.uptime} />
                </div>
              </div>

              {/* CPU */}
              <div className="hud-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Processor</span>
                </div>
                <p className="text-[11px] text-neutral-500 mb-2 font-mono">{systemData.cpu.model}</p>
                <div className="flex items-end justify-between mb-2">
                  <span className={`text-2xl font-bold font-mono ${cpuColor}`}>{systemData.cpu.usage}%</span>
                  <span className="text-[10px] text-neutral-600">{systemData.cpu.cores} cores</span>
                </div>
                <div className={`jarvis-progress ${systemData.cpu.usage > 80 ? "jarvis-progress-warn" : ""}`}>
                  <div className="jarvis-progress-bar" style={{ width: `${systemData.cpu.usage}%` }} />
                </div>
              </div>

              {/* Memory */}
              <div className="hud-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MemoryStick className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Memory</span>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <span className={`text-2xl font-bold font-mono ${memColor}`}>{systemData.memory.percent}%</span>
                  <span className="text-[10px] text-neutral-600">{systemData.memory.used} / {systemData.memory.total}</span>
                </div>
                <div className={`jarvis-progress ${systemData.memory.percent > 80 ? "jarvis-progress-warn" : ""}`}>
                  <div className="jarvis-progress-bar" style={{ width: `${systemData.memory.percent}%` }} />
                </div>
              </div>

              {/* Disk */}
              <div className="hud-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Storage</span>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <span className={`text-2xl font-bold font-mono ${diskColor}`}>{systemData.disk.percent}%</span>
                  <span className="text-[10px] text-neutral-600">{systemData.disk.used} / {systemData.disk.total}</span>
                </div>
                <div className={`jarvis-progress ${systemData.disk.percent > 80 ? "jarvis-progress-warn" : ""}`}>
                  <div className="jarvis-progress-bar" style={{ width: `${systemData.disk.percent}%` }} />
                </div>
              </div>

              {/* Battery */}
              {systemData.battery && (
                <div className="hud-panel p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Battery className="w-4 h-4 text-cyan-400" />
                    <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Battery</span>
                  </div>
                  <div className="flex items-end justify-between mb-2">
                    <span className={`text-2xl font-bold font-mono ${systemData.battery.percent < 20 ? "text-red-400" : systemData.battery.percent < 50 ? "text-amber-400" : "text-emerald-400"}`}>
                      {systemData.battery.percent}%
                    </span>
                    <span className="text-[10px] text-neutral-600">
                      {systemData.battery.charging ? "⚡ Charging" : systemData.battery.timeRemaining}
                    </span>
                  </div>
                  <div className="jarvis-progress">
                    <div className="jarvis-progress-bar" style={{ width: `${systemData.battery.percent}%` }} />
                  </div>
                </div>
              )}

              {/* Processes */}
              <div className="hud-panel p-4 sm:col-span-2 lg:col-span-1">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Top Processes</span>
                </div>
                <div className="space-y-1.5">
                  {systemData.processes.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-neutral-400 truncate max-w-[140px]">{p.name}</span>
                      <div className="flex gap-3">
                        <span className="text-cyan-500">{p.cpu}</span>
                        <span className="text-neutral-600">{p.mem}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Network Panel */}
        {activePanel === "network" && (
          <div className="w-full p-4 sm:p-6 overflow-y-auto space-y-4">
            {/* Network Header */}
            {networkData && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="hud-panel p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-4 h-4 text-cyan-400" />
                      <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Local IP</span>
                    </div>
                    <p className="text-lg font-bold font-mono text-white">{networkData.localDevice.ip}</p>
                    <p className="text-[10px] text-neutral-600 font-mono">{networkData.localDevice.hostname}</p>
                  </div>
                  <div className="hud-panel p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Signal className="w-4 h-4 text-cyan-400" />
                      <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">WiFi</span>
                    </div>
                    <p className="text-lg font-bold font-mono text-white">{networkData.wifi?.ssid || "N/A"}</p>
                    <p className="text-[10px] text-neutral-600 font-mono">{networkData.wifi?.signal || "No signal"}</p>
                  </div>
                  <div className="hud-panel p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Wifi className="w-4 h-4 text-cyan-400" />
                      <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Devices</span>
                    </div>
                    <p className="text-lg font-bold font-mono text-cyan-400">{networkData.totalDevices}</p>
                    <p className="text-[10px] text-neutral-600 font-mono">Connected to network</p>
                  </div>
                </div>

                {/* Device List */}
                <div className="hud-panel p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Server className="w-4 h-4 text-cyan-400" />
                    <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase font-mono">Network Devices</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {networkData.devices.map((device, i) => {
                      const Icon = DEVICE_ICONS[device.type] || Server;
                      return (
                        <div key={i} className="device-card flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-4 h-4 text-cyan-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white font-mono">{device.ip}</p>
                            <p className="text-[10px] text-neutral-500 font-mono truncate">{device.mac}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-mono uppercase">{device.vendor}</span>
                              <span className="text-[9px] text-neutral-600 font-mono">{device.type}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {networkData.devices.length === 0 && (
                      <p className="text-neutral-600 text-sm font-mono col-span-full text-center py-8">Scanning network...</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Chat Panel */}
        {activePanel === "chat" && (
          <div className="flex-1 flex flex-col w-full">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-6">
                  {/* Arc Reactor Orb */}
                  <div className="relative cursor-pointer" onClick={toggleVoice}>
                    <div className={`w-32 h-32 sm:w-40 sm:h-40 rounded-full border flex items-center justify-center transition-all duration-500 ${
                      isListening ? "jarvis-orb-active border-cyan-400/40" : "jarvis-orb border-cyan-500/20"
                    }`}>
                      <div className="arc-ring w-36 h-36 sm:w-44 sm:h-44" />
                      <div className="arc-ring arc-ring-inner w-28 h-28 sm:w-36 sm:h-36" />
                      {isListening ? (
                        <Mic className="w-10 h-10 text-cyan-300 animate-pulse" />
                      ) : isSpeaking ? (
                        <Volume2 className="w-10 h-10 text-cyan-300 animate-pulse" />
                      ) : isProcessing ? (
                        <Loader2 className="w-10 h-10 text-cyan-300 animate-spin" />
                      ) : (
                        <Zap className="w-10 h-10 text-cyan-500/60" />
                      )}
                    </div>
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-jarvis font-mono">
                      Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, Boss.
                    </h2>
                    <p className="text-neutral-600 text-sm max-w-md">
                      All systems operational. I have access to your device and network. What would you like to know?
                    </p>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                    {[
                      "System status report",
                      "Who's on my network?",
                      "How's my battery?",
                      "What's eating my CPU?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="px-3 py-2 rounded-lg text-[11px] font-mono text-cyan-400/70 border border-cyan-500/10 hover:border-cyan-500/30 hover:text-cyan-300 hover:bg-cyan-500/5 transition-all"
                      >
                        <ChevronRight className="w-3 h-3 inline mr-1 opacity-40" />{q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "chat-user text-neutral-200"
                      : "chat-jarvis text-neutral-300"
                  }`}>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,212,255,0.6)]" />
                        <span className="text-[9px] font-bold tracking-widest text-cyan-500 uppercase font-mono">J.A.R.V.I.S.</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}

              {isProcessing && (
                <div className="flex justify-start">
                  <div className="chat-jarvis px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-[9px] font-bold tracking-widest text-cyan-500 uppercase font-mono">Processing</span>
                    </div>
                    <span className="text-sm text-neutral-500 cursor-blink font-mono">Analyzing</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 sm:p-4 border-t border-[rgba(0,212,255,0.06)]">
              <div className="flex items-center gap-2 max-w-4xl mx-auto">
                <button
                  onClick={toggleVoice}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    isListening
                      ? "bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 shadow-[0_0_15px_rgba(0,212,255,0.3)]"
                      : "bg-white/[0.03] border border-white/5 text-neutral-500 hover:text-cyan-400 hover:border-cyan-500/20"
                  }`}
                >
                  <Mic className="w-4 h-4" />
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isProcessing && sendMessage(input)}
                  placeholder="Talk to JARVIS..."
                  className="flex-1 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
                  disabled={isProcessing}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={isProcessing || !input.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all disabled:opacity-30 shrink-0"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-neutral-600 font-mono">{label}</span>
      <span className="text-[11px] text-neutral-300 font-mono">{value}</span>
    </div>
  );
}
