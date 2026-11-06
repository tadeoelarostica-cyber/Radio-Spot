export enum LoadingState {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  PLAYING = 'PLAYING',
  ERROR = 'ERROR',
}

export type VoiceMode = 'prebuilt' | 'custom';
export type SpotDuration = '15s' | '30s' | '60s';

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
}

export interface VocalCueOption {
  tag: string;
  label: string;
  category: 'burst' | 'backchannel' | 'direction';
}

export const VOICES: VoiceOption[] = [
  { id: 'Fenrir', name: 'Fenrir', description: 'Intense, deep & urgent' },
  { id: 'Kore', name: 'Kore', description: 'Clear, calm & reassuring' },
  { id: 'Puck', name: 'Puck', description: 'Playful, expressive & dynamic' },
  { id: 'Charon', name: 'Charon', description: 'Deep, resonant & authoritative' },
  { id: 'Zephyr', name: 'Zephyr', description: 'Balanced, warm & natural' },
];

export const VOCAL_CUES: VocalCueOption[] = [
  { tag: '<laugh>', label: 'Laugh', category: 'burst' },
  { tag: '<gasp>', label: 'Gasp', category: 'burst' },
  { tag: '<breath>', label: 'Breath', category: 'burst' },
  { tag: '|yeah|', label: 'Yeah', category: 'backchannel' },
  { tag: '|mhm|', label: 'Mhm', category: 'backchannel' },
  { tag: '[pause]', label: 'Pause', category: 'direction' },
  { tag: '[excited]', label: 'Excited', category: 'direction' },
  { tag: '[whisper]', label: 'Whisper', category: 'direction' },
];