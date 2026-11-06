import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testVoices() {
  const possibleVoices = ['en-US-Journey-D', 'en-US-Journey-F', 'en-US-News-N', 'en-US-Neural2-A'];
  for (const voiceName of possibleVoices) {
    try {
      await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: 'Hello' }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      console.log(`Voice ${voiceName} SUCCESS`);
    } catch (err: any) {
      console.log(`Voice ${voiceName} FAILED: ${err.message}`);
    }
  }
}

testVoices().catch(console.error);
