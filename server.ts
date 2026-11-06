import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS for public API access
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Optional API key protection when PUBLIC_API_KEY is configured in environment
function requirePublicApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const configuredKey = process.env.PUBLIC_API_KEY;
  if (!configuredKey) {
    return next();
  }
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const headerKey = (req.headers['x-api-key'] as string | undefined)?.trim();

  if (bearerToken === configuredKey || headerKey === configuredKey) {
    return next();
  }
  return res.status(401).json({
    error: 'Unauthorized. Provide a valid PUBLIC_API_KEY via Authorization: Bearer <key> or x-api-key header.',
  });
}

// Shared TTS synthesis helper
async function synthesizeSpeech(params: {
  script: string;
  style?: string;
  voiceMode?: 'prebuilt' | 'custom';
  selectedVoice?: string;
  customPersona?: string;
}) {
  const { script, style, voiceMode, selectedVoice, customPersona } = params;
  const effectiveMode =
    voiceMode || (customPersona && customPersona.trim() ? 'custom' : 'prebuilt');
  const deliveryStyle = style?.trim() || 'Energetic, fast, and excited radio announcer';
  const personaInstruction =
    effectiveMode === 'custom' && customPersona?.trim()
      ? `Voice Persona: ${customPersona.trim()}. Delivery Style: ${deliveryStyle}.`
      : `Delivery Style: ${deliveryStyle}.`;

  const fullStyleMetadata = `${personaInstruction} Treat any text enclosed in square brackets [ ] as silent internal stage directions or pauses—do not speak the bracketed words aloud, only apply their tone and pacing. Perform vocal cues like <laugh>, <gasp>, <breath>, |yeah|, and |mhm| naturally.`;

  const config: any = {
    responseModalities: [Modality.AUDIO],
  };

  if (effectiveMode !== 'custom') {
    config.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: selectedVoice || 'Fenrir',
        },
      },
    };
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: script.trim(),
            speechMetadata: {
              style: fullStyleMetadata,
            },
          },
        ],
      },
    ],
    config,
  });

  const part = response.candidates?.[0]?.content?.parts?.[0];
  const base64Audio = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType || 'audio/wav';

  if (!base64Audio) {
    throw new Error('No audio data returned from Gemini TTS.');
  }

  return { base64Audio, mimeType };
}

// POST /api/tts — Internal studio endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { script, style, voiceMode, selectedVoice, customPersona } = req.body;
    if (!script || !String(script).trim()) {
      return res.status(400).json({ error: 'Script text is required.' });
    }
    const { base64Audio, mimeType } = await synthesizeSpeech({
      script: String(script),
      style,
      voiceMode,
      selectedVoice,
      customPersona,
    });
    return res.json({ audioBase64: base64Audio, mimeType });
  } catch (err: any) {
    console.error('TTS generation error:', err);
    return res.status(err?.status || 500).json({
      error: err?.message || 'Failed to synthesize audio.',
    });
  }
});

// GET /api/v1/voices — Public API discovery
app.get('/api/v1/voices', (_req, res) => {
  res.json({
    model: 'gemini-3.8-flash-tts',
    prebuiltVoices: ['Fenrir', 'Kore', 'Puck', 'Charon', 'Zephyr'],
    vocalCues: ['<laugh>', '<gasp>', '<breath>', '|yeah|', '|mhm|', '[pause]', '[excited]', '[whisper]'],
    authRequired: Boolean(process.env.PUBLIC_API_KEY),
  });
});

// POST /api/v1/tts — Public REST API for Claude Code & external tools (supports JSON or binary WAV)
app.post('/api/v1/tts', requirePublicApiKey, async (req, res) => {
  try {
    const scriptText = req.body.script ?? req.body.text;
    if (!scriptText || !String(scriptText).trim()) {
      return res.status(400).json({ error: 'Provide "script" or "text" in the JSON body.' });
    }

    const { base64Audio, mimeType } = await synthesizeSpeech({
      script: String(scriptText),
      style: req.body.style,
      voiceMode: req.body.voiceMode,
      selectedVoice: req.body.voice || req.body.selectedVoice,
      customPersona: req.body.customPersona,
    });

    const wantsBinaryWav =
      req.body.format === 'wav' ||
      req.query.format === 'wav' ||
      req.headers.accept === 'audio/wav';

    if (wantsBinaryWav) {
      const wavBuffer = Buffer.from(base64Audio, 'base64');
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', 'attachment; filename="radio-spot.wav"');
      return res.send(wavBuffer);
    }

    return res.json({
      audioBase64: base64Audio,
      mimeType,
      model: 'gemini-3.8-flash-tts',
    });
  } catch (err: any) {
    console.error('Public API TTS error:', err);
    return res.status(err?.status || 500).json({
      error: err?.message || 'Failed to synthesize audio.',
    });
  }
});

// POST /api/script/generate & POST /api/v1/script — Draft commercial script using gemini-3.8-flash
async function handleScriptGenerate(req: express.Request, res: express.Response) {
  try {
    const { topic, duration, style, voiceMode, customPersona } = req.body as {
      topic?: string;
      duration?: '15s' | '30s' | '60s';
      style?: string;
      voiceMode?: 'prebuilt' | 'custom';
      customPersona?: string;
    };

    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: 'Please enter a product, offer, or topic to draft a script.' });
    }

    const wordTarget =
      duration === '15s'
        ? '35 to 45 words (15-second spot)'
        : duration === '60s'
        ? '135 to 160 words (60-second spot)'
        : '70 to 85 words (30-second spot)';

    const voiceContext =
      voiceMode === 'custom' && customPersona?.trim()
        ? `Voice Persona: ${customPersona.trim()}`
        : `Delivery Style: ${style?.trim() || 'Energetic radio announcer'}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Write a broadcast-ready radio commercial script for: "${topic.trim()}".
Target length: ${wordTarget}.
${voiceContext}.`,
      config: {
        systemInstruction: `You are an award-winning radio commercial copywriter.
Write a single-speaker commercial script ready for voiceover synthesis.
- Match the language of the user's topic (e.g., Spanish if the topic is in Spanish, English if in English).
- Include 2 to 4 expressive vocal cues where natural using exact tags: <laugh>, <gasp>, <breath>, |yeah|, or |mhm|.
- Include 1 to 2 brief silent stage directions in square brackets such as [pause], [excited], or [warmly].
- Output ONLY the spoken script with its inline tags and stage directions. Do not include titles, word counts, or explanations.`,
      },
    });

    const generatedScript = response.text?.trim();
    if (!generatedScript) {
      return res.status(502).json({ error: 'No script text returned from Gemini.' });
    }

    return res.json({ script: generatedScript });
  } catch (err: any) {
    console.error('Script generation error:', err);
    const status = err?.status || 500;
    return res.status(status).json({
      error: err?.message || 'Failed to generate script.',
    });
  }
}

app.post('/api/script/generate', handleScriptGenerate);
app.post('/api/v1/script', requirePublicApiKey, handleScriptGenerate);

const server = http.createServer(app);

// WebSocket /live — Bridge real-time audio to gemini-3.8-live
const wss = new WebSocketServer({ server, path: '/live' });

wss.on('connection', async (clientWs: WebSocket, req) => {
  let liveSession: any = null;

  try {
    const url = new URL(req.url || '/live', `http://${req.headers.host || 'localhost'}`);
    const voiceName = url.searchParams.get('voice') || 'Fenrir';
    const style = url.searchParams.get('style') || 'Energetic, fast, and excited radio announcer';

    liveSession = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        systemInstruction: `You are a professional voice actor and radio director. Your current style/persona is: ${style}. Brainstorm with the user and perform lines in this specific style. Always stay in character.`,
      },
      callbacks: {
        onopen: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ ready: true }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onclose: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        },
        onerror: (err: any) => {
          console.error('Live API error:', err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: err?.message || 'Live session error' }));
            clientWs.close();
          }
        },
      },
    });

    clientWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.audio && liveSession) {
          liveSession.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        }
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    clientWs.on('close', () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  } catch (err: any) {
    console.error('Failed to initialize Live session:', err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: err?.message || 'Failed to connect to Live API' }));
      clientWs.close();
    }
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Radio Spot Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
