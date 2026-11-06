# Radio Spot Studio — Gemini 3.8 Voice Engine & Expressive Script Upgrade

Upgrade the underlying voice synthesis engine to **Gemini 3.8 Flash TTS** (`gemini-3.8-flash-tts`) with server-side API execution, adding **Custom Voice Persona Design** from text descriptions, **Expressive Vocal Cues** (`<laugh>`, `<gasp>`, `<breath>`, backchanneling, and stage directions), and an **AI Commercial Script Generator** (`gemini-3.8-flash`).

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All Phase 1 clarifications have been incorporated into this plan. Please review the confirmed choices and architectural decisions below before proceeding.

- **Confirmed — New Voice Generation Features**:
  1. **Custom Voice Persona Design**: Users can switch between prebuilt studio voices and a **Custom Persona** mode where they describe any voice character from scratch (e.g., *"Gravelly late-night jazz host with a warm, unhurried cadence"*), passed via `speechMetadata.style` to `gemini-3.8-flash-tts`.
  2. **Expressive Vocal Cues**: Native support for scripted vocal bursts (`<laugh>`, `<gasp>`, `<breath>`), conversational backchanneling (`|yeah|`, `|mhm|`), and bracketed stage directions (`[pause]`, `[whisper]`), paired with a one-click **Expressive Tag Helper** toolbar in the script editor.
- **Confirmed — Voice Engine ("Motor") Upgrade**:
  - Upgrade from `gemini-3.1-flash-tts-preview` to **`gemini-3.8-flash-tts`** for Script-to-Audio and **`gemini-3.8-live`** for Live Conversation, upgrading `@google/genai` to `>= 2.25.0`.
  - Migrate all `@google/genai` SDK calls to a dedicated **server-side Express backend** (`/api/tts`, `/api/script/generate`, and `/live` WebSocket bridge) so `GEMINI_API_KEY` is managed securely on the server.
- **Confirmed — AI-Assisted Script Writing Tools**:
  - Add an **AI Script Generator** (`gemini-3.8-flash`) that drafts commercial scripts from a brief topic/product and target duration, automatically weaving in expressive vocal cues and stage directions.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the Radio Spot Generator into a full-featured broadcast voice studio. Users can brainstorm and generate commercial scripts with AI, insert expressive vocal cues at the cursor with one click, design custom voice personas from natural-language descriptions (or pick a prebuilt studio voice), and synthesize high-fidelity 24kHz WAV audio using `gemini-3.8-flash-tts`.
- **Target Audience / Persona**: Radio producers, podcasters, indie creators, and marketers who need expressive, character-driven commercial voiceovers without recording equipment.
- **Key Value**: Replaces flat, robotic TTS output with expressive, director-guided vocal performances—combining custom voice persona design, natural vocal bursts, and AI scriptwriting in a single studio workflow.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **AI Script Drafting & Tagging**:
   - In **Script to Audio** mode, the user can optionally expand the **AI Script Writer** bar, enter a product/offer (e.g., *"Weekend flash sale at Luna Coffee Roasters"*) and select a spot length (`15s Punchy`, `30s Standard`, `60s Story`), then click **Draft Script**.
   - `gemini-3.8-flash` generates a formatted commercial script containing `[stage directions]` and expressive vocal cues (`<laugh>`, `<gasp>`, `<breath>`), populating the editor.
   - Above the script textarea, the **Expressive Tag Helper** toolbar lets the user click any cue (`<laugh>`, `<gasp>`, `<breath>`, `|yeah|`, `|mhm|`, `[pause]`) to insert it directly at the current cursor position.
2. **Voice Persona & Style Configuration**:
   - In the **Voice Engine** panel, users toggle between **Prebuilt Voices** (selecting from studio voices like `Fenrir`, `Kore`, `Puck`, `Charon`, `Zephyr`) and **Custom Persona** (entering a rich text description of the desired voice timbre, age, accent, and delivery).
   - The **Voice Style / Direction** input remains available for fine-tuning emotional delivery and pacing.
3. **Synthesis, Playback & History**:
   - Clicking **Generate Spot** sends the script, voice configuration, and style direction to `/api/tts`.
   - The server invokes `gemini-3.8-flash-tts` and returns the 24kHz WAV audio. The client decodes it for the real-time frequency visualizer, loads it into the custom scrubbable audio player, enables one-click `.wav` download, and saves the script to the 5-item `localStorage` draft history.
4. **Live Conversation Mode**:
   - Switching to **Live Conversation** connects via WebSocket (`/live`) to `gemini-3.8-live` on the server, streaming 16kHz microphone PCM up and 24kHz audio responses back in real time.

### Visual Identity & Theme

- **Aesthetic Direction**: Dark broadcast studio console—clean, high-contrast, tactile, and free of decorative clutter.
- **Color Palette & Mood**:
  - **60% Dominant Neutral Canvas**: Deep studio obsidian (`#090D16`) and matte console slate (`#111827`).
  - **30% Structural Surfaces**: Single-elevation panels (`#161F30`) with crisp `1px` hairline borders (`rgba(255, 255, 255, 0.08)`), avoiding nested cards-within-cards or thick left accent bars.
  - **10% Accent Budget**: Broadcast crimson (`#E11D48` / `#F43F5E`) reserved strictly for primary actions (**Generate Spot**, **Draft Script**), active mode/voice states, and live audio progress.
- **Typography & Hierarchy**:
  - **Display & UI**: `Plus Jakarta Sans` for crisp, legible studio headings and controls.
  - **Script Editor & Telemetry**: `JetBrains Mono` with `tabular-nums` for script editing, vocal cue tags, and audio timecodes (`0:00 / 0:30`).
- **Interactive Feedback & Motion**:
  - Snappy `150ms` transitions on segmented controls, tag insertion buttons, and voice cards.
  - Clear loading states (**Drafting Script...**, **Synthesizing Audio...**), inline error banners with actionable messages, and zero-latency access to all studio controls.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Upgrading to `gemini-3.8-flash-tts` with `speechMetadata` & Vocal Bursts**
  - *Chosen Approach*: Route all Script-to-Audio requests through `gemini-3.8-flash-tts` using structured `contents` parts with `speechMetadata.style` for both prebuilt voices and custom voice persona descriptions, while preserving native `<laugh>`, `<gasp>`, `<breath>`, and `|yeah|`/`|mhm|` cues in the script text.
  - *Why*: `gemini-3.8-flash-tts` is specifically engineered for Voice Design (prompting custom voice personas from scratch) and expressive vocal bursts, and returns a complete 24kHz WAV file directly.
  - *Alternatives Considered*: Keeping `gemini-3.1-flash-tts-preview` or `gemini-3.8-flash-lite-tts`—passed over because neither supports custom Voice Design or rich vocal burst/backchanneling synthesis.

- **Decision 2: Server-Side Express + Vite Middleware Architecture**
  - *Chosen Approach*: Introduce a Node/Express server entry point (`server.ts`) that mounts Vite in development and serves static assets in production, exposing `/api/tts`, `/api/script/generate`, and a `/live` WebSocket proxy for `gemini-3.8-live`.
  - *Why*: Centralizes `@google/genai` (`>= 2.25.0`) on the server with `process.env.GEMINI_API_KEY` and `'User-Agent': 'aistudio-build'`, eliminates client-side API key exposure, and provides clean error propagation.
  - *Alternatives Considered*: Keeping client-side SDK calls—passed over because server-side execution is required for `@google/genai` best practices and clean key management.

- **Decision 3: Cursor-Aware Tag Insertion & `localStorage` Draft Persistence**
  - *Chosen Approach*: Track the script `<textarea>` selection range (`selectionStart` / `selectionEnd`) so clicking any vocal cue button inserts the tag at the exact cursor position and restores focus, while continuing to persist the last 5 generated scripts in `localStorage`.
  - *Why*: Makes adding expressive cues effortless without manual typing or losing cursor context, and requires zero database overhead for personal draft history.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (React)                           │
│                                                                         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │  AI Script Writer    │  │  Script Editor &    │  │ Voice Engine   │  │
│  │  (Topic + Duration)  │  │  Tag Helper Toolbar │  │ Prebuilt /     │  │
│  └──────────┬───────────┘  └──────────┬──────────┘  │ Custom Persona │  │
│             │                         │             └───────┬────────┘  │
│             ▼                         ▼                     ▼           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              Studio Controller & Audio Playback Engine            │  │
│  │   • POST /api/script/generate   • POST /api/tts                   │  │
│  │   • WebSocket /live (16kHz mic) • Web Audio Analyser + WAV Player │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │ HTTP / WS
┌──────────────────────────────────▼──────────────────────────────────────┐
│                     Express Server + Vite Middleware                    │
│                                                                         │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────┐  │
│  │ POST /api/script/    │  │ POST /api/tts       │  │ WS /live       │  │
│  │      generate        │  │                     │  │                │  │
│  │ • gemini-3.8-flash   │  │ • gemini-3.8-flash- │  │ • gemini-3.8-  │  │
│  │   (JSON/Text script) │  │   tts (WAV output)  │  │   live         │  │
│  └──────────────────────┘  └─────────────────────┘  └────────────────┘  │
│                                                                         │
│              Shared @google/genai Client (GEMINI_API_KEY)               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Voice Configuration State**:
  - `voiceMode`: `'prebuilt' | 'custom'`
  - `selectedVoice`: Prebuilt voice ID (`'Fenrir' | 'Kore' | 'Puck' | 'Charon' | 'Zephyr'`)
  - `customPersona`: Free-text voice character description (e.g., *"Warm, authoritative documentary narrator, mid-40s"*)
  - `style`: Delivery direction string (e.g., *"Energetic, fast, and excited radio announcer"*)
- **Script & AI Writer State**:
  - `script`: Current commercial script text (supports `<laugh>`, `<gasp>`, `<breath>`, `|yeah|`, `|mhm|`, and `[stage directions]`)
  - `scriptHistory`: Array of up to 5 recent scripts persisted in `localStorage` (`radioSpotHistory`)
  - `aiPrompt` & `spotDuration`: Inputs for `/api/script/generate` (`'15s' | '30s' | '60s'`)
- **Audio & Playback State**:
  - `loadingState`: `'IDLE' | 'GENERATING' | 'PLAYING' | 'ERROR'`
  - `downloadUrl`: Object URL for the 24kHz WAV `Blob` returned by `gemini-3.8-flash-tts`
  - `analyserNode`: Web Audio `AnalyserNode` driving the real-time frequency visualizer

### Interactive Component & State Mapping

- **AI Script Writer (`POST /api/script/generate`)**: Validates non-empty topic input, sets drafting loading state, calls `gemini-3.8-flash` on the server with instructions to include `[stage directions]` and vocal cues (`<laugh>`, `<gasp>`, `<breath>`), and updates `script` on response.
- **Expressive Tag Helper**: Reads `textareaRef.current.selectionStart` / `selectionEnd`, splices the selected cue token into `script`, and schedules cursor placement right after the inserted token.
- **Voice Mode Switcher (`Prebuilt` vs. `Custom Persona`)**: Toggles between the prebuilt voice grid and the custom persona description input; when `custom` is active, `/api/tts` passes `customPersona` + `style` into `speechMetadata.style` on `gemini-3.8-flash-tts`.
- **Generate Spot (`POST /api/tts`)**: Saves trimmed script to `scriptHistory`, sends `{ script, style, voiceMode, selectedVoice, customPersona }` to `/api/tts`, receives base64 WAV audio, creates a `Blob` (`type: 'audio/wav'`) for the player/download, and decodes into `AudioContext` for immediate playback with live visualization.
- **Live Conversation (`WS /live`)**: Opens a WebSocket to `/live` with voice/style query params, streams 16kHz PCM from `navigator.mediaDevices.getUserMedia`, and plays back 24kHz PCM chunks from `gemini-3.8-live` with interruption handling.
