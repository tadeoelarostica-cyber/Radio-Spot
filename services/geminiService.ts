import { SpotDuration, VoiceMode } from '../types';

export interface GenerateSpotParams {
  script: string;
  style: string;
  voiceMode: VoiceMode;
  selectedVoice: string;
  customPersona: string;
}

export interface GenerateSpotResponse {
  audioBase64: string;
  mimeType: string;
}

export async function generateRadioSpot(
  params: GenerateSpotParams
): Promise<GenerateSpotResponse> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to synthesize audio.');
  }

  return data as GenerateSpotResponse;
}

export interface GenerateScriptParams {
  topic: string;
  duration: SpotDuration;
  style: string;
  voiceMode: VoiceMode;
  customPersona: string;
}

export async function generateCommercialScript(
  params: GenerateScriptParams
): Promise<string> {
  const response = await fetch('/api/script/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to generate script.');
  }

  return data.script;
}