import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Play,
  Pause,
  Square,
  Loader2,
  Sparkles,
  AlertCircle,
  Download,
  MessageCircle,
  FileText,
  Sliders,
  Wand2,
  UserCheck,
  RotateCcw,
  Terminal,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { generateRadioSpot, generateCommercialScript } from './services/geminiService';
import { decode, encode, decodeAudioData } from './utils/audioUtils';
import Visualizer from './components/Visualizer';
import {
  VOICES,
  VOCAL_CUES,
  LoadingState,
  VoiceMode,
  SpotDuration,
} from './types';

const INITIAL_SCRIPT = `[excited] ¡Atención! ¡Llega el GRAN SORTEO!
[pause]
<gasp> ¡Ganate una MOTOMEL 150 cero kilómetro!
¿Segundo premio? <laugh> ¡Otra Motomel serie 2, 2025!
¡También sorteamos una bici Mountain Bike y cientos de miles de pesos en efectivo!
[pause]
Sortea el 28 de marzo. ¡Pedí tu número YA MISMO al WhatsApp en pantalla! ¡No te quedes afuera!`;

const DEFAULT_STYLE = 'Energetic, fast, and excited radio announcer';
const DEFAULT_CUSTOM_PERSONA =
  'Warm, gravelly late-night FM host with a confident, charismatic cadence';

const PERSONA_PRESETS = [
  {
    label: 'Late-Night FM Host',
    value: 'Warm, gravelly late-night FM host with a confident, charismatic cadence',
  },
  {
    label: '1950s Newsreel',
    value: 'Crisp, fast-talking mid-Atlantic 1950s radio announcer with vintage punch',
  },
  {
    label: 'Documentary Narrator',
    value: 'Deep, calm, authoritative documentary voice with measured pacing',
  },
];

type AppMode = 'tts' | 'live';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('tts');
  const [script, setScript] = useState<string>(INITIAL_SCRIPT);
  const [style, setStyle] = useState<string>(DEFAULT_STYLE);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('prebuilt');
  const [selectedVoice, setSelectedVoice] = useState<string>('Fenrir');
  const [customPersona, setCustomPersona] = useState<string>(DEFAULT_CUSTOM_PERSONA);

  // AI Script Generator State
  const [aiTopic, setAiTopic] = useState<string>('');
  const [spotDuration, setSpotDuration] = useState<SpotDuration>('30s');
  const [isDraftingScript, setIsDraftingScript] = useState<boolean>(false);

  // Playback & Synthesis State
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [scriptHistory, setScriptHistory] = useState<string[]>([]);
  const [isApiModalOpen, setIsApiModalOpen] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Custom Player State
  const customAudioRef = useRef<HTMLAudioElement | null>(null);
  const scriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isPlayingCustom, setIsPlayingCustom] = useState<boolean>(false);
  const [customProgress, setCustomProgress] = useState<number>(0);
  const [customDuration, setCustomDuration] = useState<number>(0);

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  // Live API WebSocket Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveNextStartTimeRef = useRef<number>(0);
  const liveSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem('radioSpotHistory');
    if (saved) {
      try {
        setScriptHistory(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      disconnectLiveSession();
    };
  }, []);

  const disconnectLiveSession = () => {
    if (liveWsRef.current) {
      liveWsRef.current.close();
      liveWsRef.current = null;
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((track) => track.stop());
      liveStreamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    liveSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        // ignore
      }
    });
    liveSourcesRef.current.clear();
    liveNextStartTimeRef.current = 0;
    setIsLiveConnected(false);
    setLoadingState(LoadingState.IDLE);
  };

  const handleStop = () => {
    if (mode === 'tts') {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch {
          // ignore
        }
        sourceNodeRef.current = null;
      }
      if (customAudioRef.current) {
        customAudioRef.current.pause();
        customAudioRef.current.currentTime = 0;
      }
      setLoadingState(LoadingState.IDLE);
    } else {
      disconnectLiveSession();
    }
  };

  // --- Insert Expressive Vocal Cue at Cursor ---
  const handleInsertCue = (tag: string) => {
    const textarea = scriptTextareaRef.current;
    if (!textarea) {
      setScript((prev) => `${prev} ${tag}`);
      return;
    }

    const start = textarea.selectionStart ?? script.length;
    const end = textarea.selectionEnd ?? script.length;
    const before = script.slice(0, start);
    const after = script.slice(end);

    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const insertion = `${needsLeadingSpace ? ' ' : ''}${tag}${needsTrailingSpace ? ' ' : ''}`;

    const updated = `${before}${insertion}${after}`;
    setScript(updated);

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + insertion.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
  };

  // --- AI Script Generator ---
  const handleDraftScript = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim() || isDraftingScript) return;

    setIsDraftingScript(true);
    setError(null);
    try {
      const drafted = await generateCommercialScript({
        topic: aiTopic.trim(),
        duration: spotDuration,
        style,
        voiceMode,
        customPersona,
      });
      setScript(drafted);
    } catch (err: any) {
      setError(err.message || 'Failed to draft script.');
    } finally {
      setIsDraftingScript(false);
    }
  };

  // --- Custom Player Handlers ---
  const toggleCustomPlay = () => {
    if (!customAudioRef.current) return;
    if (isPlayingCustom) {
      customAudioRef.current.pause();
    } else {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch {
          // ignore
        }
        sourceNodeRef.current = null;
        setLoadingState(LoadingState.IDLE);
      }
      customAudioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (customAudioRef.current) {
      setCustomProgress(customAudioRef.current.currentTime);
      setCustomDuration(customAudioRef.current.duration || 0);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (customAudioRef.current && customDuration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      customAudioRef.current.currentTime = percentage * customDuration;
    }
  };

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00';
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // --- TTS LOGIC (Gemini 3.8 Flash TTS) ---
  const handleGenerateAndPlay = async () => {
    if (!script.trim()) return;
    if (voiceMode === 'custom' && !customPersona.trim()) {
      setError('Please enter a custom voice persona description.');
      return;
    }

    const trimmedScript = script.trim();
    setScriptHistory((prev) => {
      const newHistory = [trimmedScript, ...prev.filter((s) => s !== trimmedScript)].slice(0, 5);
      localStorage.setItem('radioSpotHistory', JSON.stringify(newHistory));
      return newHistory;
    });

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    setLoadingState(LoadingState.GENERATING);
    setError(null);

    try {
      const { audioBase64, mimeType } = await generateRadioSpot({
        script: trimmedScript,
        style,
        voiceMode,
        selectedVoice,
        customPersona,
      });

      const audioBytes = decode(audioBase64);
      const wavBlob = new Blob([audioBytes], { type: mimeType || 'audio/wav' });
      const url = URL.createObjectURL(wavBlob);
      setDownloadUrl(url);

      // Decode WAV (with 44-byte RIFF header) or fallback to raw 24kHz PCM
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContextRef.current.decodeAudioData(audioBytes.buffer.slice(0));
      } catch {
        audioBuffer = await decodeAudioData(audioBytes, audioContextRef.current, 24000, 1);
      }

      playAudioBuffer(audioBuffer);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate audio.');
      setLoadingState(LoadingState.ERROR);
    }
  };

  const playAudioBuffer = (buffer: AudioBuffer) => {
    if (!audioContextRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;

    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioContextRef.current.destination);

    analyserRef.current = analyser;
    setAnalyserNode(analyser);
    sourceNodeRef.current = source;

    source.onended = () => {
      setLoadingState(LoadingState.IDLE);
    };

    source.start();
    setLoadingState(LoadingState.PLAYING);
  };

  // --- LIVE API LOGIC (Server WebSocket Bridge to gemini-3.8-live) ---
  function createPcmBase64(data: Float32Array): string {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
    }
    return encode(new Uint8Array(int16.buffer));
  }

  const startLiveSession = async () => {
    setError(null);
    try {
      setLoadingState(LoadingState.GENERATING);

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      const outputNode = outputCtx.createGain();
      outputNode.connect(analyser);
      analyser.connect(outputCtx.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      liveStreamRef.current = stream;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const effectiveStyle =
        voiceMode === 'custom' && customPersona.trim()
          ? `${customPersona.trim()}. ${style}`
          : style;
      const wsUrl = `${wsProtocol}//${window.location.host}/live?voice=${encodeURIComponent(
        selectedVoice
      )}&style=${encodeURIComponent(effectiveStyle)}`;

      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      ws.onopen = () => {
        setIsLiveConnected(true);
        setLoadingState(LoadingState.PLAYING);

        const source = inputCtx.createMediaStreamSource(stream);
        const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const base64 = createPcmBase64(inputData);
            ws.send(JSON.stringify({ audio: base64 }));
          }
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(inputCtx.destination);
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          setError(msg.error);
          disconnectLiveSession();
          return;
        }
        if (msg.audio && outputAudioContextRef.current) {
          liveNextStartTimeRef.current = Math.max(
            liveNextStartTimeRef.current,
            outputAudioContextRef.current.currentTime
          );

          const audioBuffer = await decodeAudioData(
            decode(msg.audio),
            outputAudioContextRef.current,
            24000,
            1
          );

          const source = outputAudioContextRef.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(outputNode);

          source.addEventListener('ended', () => {
            liveSourcesRef.current.delete(source);
          });

          source.start(liveNextStartTimeRef.current);
          liveNextStartTimeRef.current += audioBuffer.duration;
          liveSourcesRef.current.add(source);
        }
        if (msg.interrupted) {
          liveSourcesRef.current.forEach((s) => {
            try {
              s.stop();
            } catch {
              // ignore
            }
          });
          liveSourcesRef.current.clear();
          liveNextStartTimeRef.current = 0;
        }
      };

      ws.onclose = () => {
        disconnectLiveSession();
      };

      ws.onerror = () => {
        setError('Live connection error. Please try again.');
        disconnectLiveSession();
      };
    } catch (e: any) {
      console.error(e);
      setError('Failed to start live session: ' + e.message);
      disconnectLiveSession();
    }
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col items-center">
      {/* Three-Zone Top Bar */}
      <header className="w-full border-b border-white/10 bg-[#090D16]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            Radio Spot Studio
          </span>

          <nav className="flex items-center gap-2 bg-[#111827] p-1 rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => {
                setMode('tts');
                handleStop();
              }}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                mode === 'tts'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Script to Audio
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('live');
                handleStop();
              }}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                mode === 'live'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Live Conversation
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsApiModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg bg-[#111827] hover:bg-slate-800 border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Terminal className="w-3.5 h-3.5 text-[#E11D48]" />
              API & Claude Code
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="w-full max-w-6xl px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Script, Tags & Voice Configuration */}
        <div className="lg:col-span-7 space-y-6">
          {mode === 'tts' ? (
            <>
              {/* AI Commercial Script Writer */}
              <section className="bg-[#111827] border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-[#E11D48]" />
                    AI Commercial Script Writer
                  </h2>
                  <div className="flex items-center gap-1 bg-[#090D16] p-0.5 rounded-lg border border-white/10">
                    {(['15s', '30s', '60s'] as SpotDuration[]).map((dur) => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => setSpotDuration(dur)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono tabular-nums transition-colors ${
                          spotDuration === dur
                            ? 'bg-slate-800 text-white font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {dur}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleDraftScript} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="Product, offer, or event (e.g., 48-hour flash sale at Luna Coffee)..."
                    className="flex-1 bg-[#090D16] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#E11D48]"
                  />
                  <button
                    type="submit"
                    disabled={!aiTopic.trim() || isDraftingScript}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg border border-white/10 flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDraftingScript ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Drafting...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[#E11D48]" />
                        Draft Script
                      </>
                    )}
                  </button>
                </form>
              </section>

              {/* Commercial Script Editor + Expressive Tag Helper */}
              <section className="bg-[#111827] border border-white/10 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <label
                    htmlFor="commercial-script"
                    className="text-sm font-semibold text-slate-200 flex items-center gap-2"
                  >
                    <Mic className="w-4 h-4 text-[#E11D48]" />
                    Commercial Script
                  </label>
                  <button
                    type="button"
                    onClick={() => setScript(INITIAL_SCRIPT)}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                </div>

                {/* Expressive Vocal Cue Tag Helper */}
                <div className="mb-3 flex flex-wrap items-center gap-1.5 pb-3 border-b border-white/10">
                  <span className="text-xs text-slate-400 mr-1">Insert Cue:</span>
                  {VOCAL_CUES.map((cue) => (
                    <button
                      key={cue.tag}
                      type="button"
                      onClick={() => handleInsertCue(cue.tag)}
                      title={`Insert ${cue.tag}`}
                      className="px-2.5 py-1 rounded-md bg-[#090D16] hover:bg-slate-800 border border-white/10 text-xs font-mono text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                    >
                      {cue.tag}
                    </button>
                  ))}
                </div>

                <textarea
                  id="commercial-script"
                  ref={scriptTextareaRef}
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  className="w-full h-48 bg-[#090D16] border border-white/10 rounded-lg p-4 text-slate-100 focus:outline-none focus:border-[#E11D48] font-mono text-sm leading-relaxed resize-y"
                  placeholder="Enter your radio spot script here. Use <laugh>, <gasp>, <breath>, |yeah|, |mhm|, or [stage directions]..."
                />

                {/* Recent Drafts History */}
                {scriptHistory.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-white/10">
                    <div className="text-xs font-medium text-slate-400 mb-2">
                      Recent Drafts
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {scriptHistory.map((historyItem, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setScript(historyItem)}
                          className="bg-[#090D16] hover:bg-slate-800 border border-white/10 text-slate-300 text-xs py-1.5 px-3 rounded-md truncate max-w-[220px] transition-colors text-left"
                          title={historyItem}
                        >
                          {historyItem.replace(/\s+/g, ' ').slice(0, 34)}...
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : (
            /* LIVE CONVERSATION PANEL */
            <section className="bg-[#111827] border border-white/10 rounded-xl p-8 text-center">
              <div className="w-14 h-14 bg-[#E11D48]/15 border border-[#E11D48]/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-7 h-7 text-[#E11D48]" />
              </div>
              <h2 className="text-lg font-bold text-white mb-2">
                Live Voice Director Session
              </h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                Speak directly with Gemini 3.8 Live to brainstorm ad copy, test pacing, and rehearse
                commercial lines in real time using your selected voice and delivery style.
              </p>
            </section>
          )}

          {/* Voice Engine: Prebuilt Voices vs Custom Persona Design */}
          <section className="bg-[#111827] border border-white/10 rounded-xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#E11D48]" />
                Voice Engine
              </h2>

              {mode === 'tts' && (
                <div className="flex items-center gap-1 bg-[#090D16] p-1 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => setVoiceMode('prebuilt')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      voiceMode === 'prebuilt'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Prebuilt Voices
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceMode('custom')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      voiceMode === 'custom'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Custom Persona
                  </button>
                </div>
              )}
            </div>

            {voiceMode === 'prebuilt' || mode === 'live' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {VOICES.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    onClick={() => setSelectedVoice(voice.id)}
                    disabled={isLiveConnected || loadingState === LoadingState.GENERATING}
                    className={`p-3 rounded-lg border text-left transition-colors flex flex-col justify-between ${
                      selectedVoice === voice.id
                        ? 'bg-[#E11D48]/15 border-[#E11D48] text-white'
                        : 'bg-[#090D16] border-white/10 hover:border-white/25 text-slate-200 disabled:opacity-50'
                    }`}
                  >
                    <div className="font-semibold text-sm">{voice.name}</div>
                    <div className="text-xs text-slate-400 leading-snug mt-1">
                      {voice.description}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="custom-persona"
                    className="block text-xs font-medium text-slate-400 mb-1.5"
                  >
                    Describe the voice persona (timbre, age, accent, character)
                  </label>
                  <textarea
                    id="custom-persona"
                    rows={2}
                    value={customPersona}
                    onChange={(e) => setCustomPersona(e.target.value)}
                    placeholder="e.g., Warm, gravelly late-night FM host with a confident, charismatic cadence..."
                    className="w-full bg-[#090D16] border border-white/10 rounded-lg p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#E11D48] resize-none"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Presets:</span>
                  {PERSONA_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setCustomPersona(preset.value)}
                      className="px-2.5 py-1 rounded-md bg-[#090D16] hover:bg-slate-800 border border-white/10 text-xs text-slate-300 hover:text-white transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Delivery Style / Direction */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex justify-between items-center mb-1.5">
                <label
                  htmlFor="delivery-style"
                  className="text-xs font-medium text-slate-400 flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5 text-[#E11D48]" />
                  Delivery Style & Pacing
                </label>
                <button
                  type="button"
                  onClick={() => setStyle(DEFAULT_STYLE)}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Reset
                </button>
              </div>
              <input
                id="delivery-style"
                type="text"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full bg-[#090D16] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#E11D48]"
                placeholder="e.g., Energetic, fast, and excited radio announcer"
              />
            </div>
          </section>
        </div>

        {/* Right Column: Studio Monitor, Visualizer & Playback */}
        <div className="lg:col-span-5">
          <section className="bg-[#111827] border border-white/10 rounded-xl p-6 flex flex-col gap-5 sticky top-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Studio Monitor</h2>
              <span className="text-xs font-mono text-slate-400">
                {mode === 'tts'
                  ? voiceMode === 'custom'
                    ? 'Custom Voice Design'
                    : `Voice: ${selectedVoice}`
                  : isLiveConnected
                  ? 'Live Connected'
                  : 'Standby'}
              </span>
            </div>

            <Visualizer
              analyser={analyserNode}
              isPlaying={mode === 'tts' ? loadingState === LoadingState.PLAYING : isLiveConnected}
            />

            {error && (
              <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-lg text-red-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'tts' ? (
              <div className="flex flex-col gap-3">
                {loadingState === LoadingState.GENERATING ? (
                  <button
                    type="button"
                    disabled
                    className="w-full bg-slate-800 text-slate-300 font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 cursor-not-allowed border border-white/10"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Synthesizing Spot...
                  </button>
                ) : loadingState === LoadingState.PLAYING ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="w-full bg-slate-800 hover:bg-slate-700 border border-white/15 text-white font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop Playback
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateAndPlay}
                    disabled={!script.trim()}
                    className="w-full bg-[#E11D48] hover:bg-[#F43F5E] text-white font-semibold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Spot
                  </button>
                )}

                {downloadUrl && (
                  <div className="w-full bg-[#090D16] border border-white/10 rounded-lg p-4 flex flex-col gap-3 mt-1">
                    <audio
                      ref={customAudioRef}
                      src={downloadUrl}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleTimeUpdate}
                      onPlay={() => setIsPlayingCustom(true)}
                      onPause={() => setIsPlayingCustom(false)}
                      onEnded={() => setIsPlayingCustom(false)}
                      className="hidden"
                    />

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={toggleCustomPlay}
                        aria-label={isPlayingCustom ? 'Pause' : 'Play'}
                        className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-[#E11D48] hover:bg-[#F43F5E] text-white rounded-full transition-colors"
                      >
                        {isPlayingCustom ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                      </button>

                      <div
                        className="flex-1 bg-slate-800 h-2 rounded-full overflow-hidden cursor-pointer relative"
                        onClick={handleTimelineClick}
                      >
                        <div
                          className="bg-[#E11D48] h-full absolute top-0 left-0"
                          style={{
                            width: `${
                              customDuration > 0 ? (customProgress / customDuration) * 100 : 0
                            }%`,
                          }}
                        />
                      </div>

                      <span className="text-xs text-slate-400 font-mono tabular-nums flex-shrink-0">
                        {formatTime(customProgress)} / {formatTime(customDuration)}
                      </span>
                    </div>

                    <a
                      href={downloadUrl}
                      download="radio-spot.wav"
                      className="w-full bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download WAV (24kHz)
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {!isLiveConnected ? (
                  <button
                    type="button"
                    onClick={startLiveSession}
                    disabled={loadingState === LoadingState.GENERATING}
                    className="w-full bg-[#E11D48] hover:bg-[#F43F5E] text-white font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {loadingState === LoadingState.GENERATING ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        Start Live Session
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={disconnectLiveSession}
                    className="w-full bg-slate-800 hover:bg-slate-700 border border-red-500/40 text-red-300 font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    End Session
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Public API & Claude Code Modal */}
      {isApiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-white/10 rounded-xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#E11D48]" />
                  Public REST API & Claude Code Integration
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Call this app from Claude Code, terminal scripts, or external tools.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsApiModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <div className="font-semibold text-slate-200 mb-1.5">
                  1. Generate WAV Audio via cURL (POST /api/v1/tts)
                </div>
                <div className="relative bg-[#090D16] border border-white/10 rounded-lg p-3.5 font-mono text-slate-300 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const cmd = `curl -X POST "${window.location.origin}/api/v1/tts" \\\n  -H "Content-Type: application/json" \\\n  -d '{"script":"[excited] ¡Gran oferta hoy! <gasp> Solo por 24 horas.","voice":"Fenrir","format":"wav"}' \\\n  --output radio-spot.wav`;
                      navigator.clipboard.writeText(cmd);
                      setCopiedKey('curl');
                      setTimeout(() => setCopiedKey(null), 2000);
                    }}
                    className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                  >
                    {copiedKey === 'curl' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </button>
                  <pre className="pr-16 whitespace-pre-wrap">{`curl -X POST "${window.location.origin}/api/v1/tts" \\
  -H "Content-Type: application/json" \\
  -d '{"script":"[excited] ¡Gran oferta hoy! <gasp> Solo por 24 horas.","voice":"Fenrir","format":"wav"}' \\
  --output radio-spot.wav`}</pre>
                </div>
              </div>

              <div>
                <div className="font-semibold text-slate-200 mb-1.5">
                  2. Claude Code Custom Slash Command (.claude/commands/radio-spot.md)
                </div>
                <div className="relative bg-[#090D16] border border-white/10 rounded-lg p-3.5 font-mono text-slate-300 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const md = `Generate a radio commercial WAV file for: $ARGUMENTS\n\n1. Call POST ${window.location.origin}/api/v1/script with {"topic": "$ARGUMENTS", "duration": "30s"} to draft the script.\n2. Call POST ${window.location.origin}/api/v1/tts with {"script": "<generated_script>", "voice": "Fenrir", "format": "wav"} and save the output to radio-spot.wav.`;
                      navigator.clipboard.writeText(md);
                      setCopiedKey('claude');
                      setTimeout(() => setCopiedKey(null), 2000);
                    }}
                    className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                  >
                    {copiedKey === 'claude' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </button>
                  <pre className="pr-16 whitespace-pre-wrap">{`Generate a radio commercial WAV file for: $ARGUMENTS

1. Call POST ${window.location.origin}/api/v1/script with {"topic": "$ARGUMENTS", "duration": "30s"} to draft the script.
2. Call POST ${window.location.origin}/api/v1/tts with {"script": "<generated_script>", "voice": "Fenrir", "format": "wav"} and save the output to radio-spot.wav.`}</pre>
                </div>
              </div>

              <div className="p-3 bg-[#090D16] border border-white/10 rounded-lg text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Optional Security:</strong> To protect your
                public endpoint when deployed, set <code className="text-slate-200">PUBLIC_API_KEY</code>{' '}
                in <strong>Settings &gt; Secrets</strong> and pass{' '}
                <code className="text-slate-200">Authorization: Bearer &lt;your-key&gt;</code>.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;