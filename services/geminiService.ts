/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



import { GoogleGenAI, Modality } from "@google/genai";
import { RouteDetails, StorySegment, StoryStyle } from "../types";
import { base64ToArrayBuffer, pcmToWav } from "./audioUtils";

// Sanitize the key to ensure no extra quotes or whitespace
const RAW_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const API_KEY = RAW_API_KEY ? RAW_API_KEY.replace(/["']/g, "").trim() : "";

if (!API_KEY) {
    console.warn("ECHO_PATHS WARNING: API_KEY is missing from environment.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            const errorMsg = error.message || "";
            const errorCode = error.status || error.code || (error.details && error.details[0]?.code);
            const isRateLimit = errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED") || errorCode === 429;
            
            if (isRateLimit && i < maxRetries - 1) {
                const delay = initialDelay * Math.pow(3, i); // Exponential backoff with base 3
                console.warn(`Rate limit hit (Code: ${errorCode}). Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
};

// CONSTANTS FOR CONTINUOUS STREAMING
const TARGET_SEGMENT_DURATION_SEC = 60; 
const WORDS_PER_MINUTE = 145;
const WORDS_PER_SEGMENT = Math.round((TARGET_SEGMENT_DURATION_SEC / 60) * WORDS_PER_MINUTE);

export const calculateTotalSegments = (durationSeconds: number): number => {
    return Math.max(1, Math.ceil(durationSeconds / TARGET_SEGMENT_DURATION_SEC));
};

const getStyleInstruction = (style: StoryStyle, language: Language): string => {
    if (language === 'IT') {
        switch (style) {
            case 'NOIR':
                return "Stile: Noir Thriller. Crudo, cinico, atmosferico. Usa il monologo interiore. Il viaggiatore è un detective o qualcuno con un passato travagliato. La città è un personaggio a sé stante: oscura, piovosa, che nasconde segreti. Usa metafore di ombre, fumo e neon freddo.";
            case 'CHILDREN':
                return "Stile: Storia per bambini. Stravagante, magico, pieno di meraviglia e umorismo gentile. Il mondo è luminoso e vivo; forse gli oggetti inanimati (come semafori o alberi) hanno lievi personalità. Linguaggio semplice ma evocativo. Un senso di deliziosa scoperta.";
            case 'HISTORICAL':
                return "Stile: Epopea storica. Grandioso, drammatico e senza tempo. Tratta il viaggio come un pellegrinaggio significativo o una ricerca in un'epoca passata (anche se è ai giorni nostri, sovrapponilo a una grandezza storica). Usa un linguaggio leggermente arcaico ma comprensibile. Concentrati sulla resistenza, il destino e il peso della storia.";
            case 'FANTASY':
                return "Stile: Avventura fantasy. Eroico, mistico ed epico. Il mondo reale è solo un velo su un regno magico. Le strade sono sentieri antichi, gli edifici sono torri o rovine. Il viaggiatore è impegnato in una missione vitale. Usa metafore di magia, creature mitiche (le ombre potrebbero essere bestie in agguato) e destino.";
            default:
                return "Stile: Narrazione immersiva, 'nel momento'. Concentrati sulla sensazione di movimento e sull'ambiente immediato.";
        }
    }
    switch (style) {
        case 'NOIR':
            return "Style: Noir Thriller. Gritty, cynical, atmospheric. Use inner monologue. The traveler is a detective or someone with a troubled past. The city is a character itself—dark, rainy, hiding secrets. Use metaphors of shadows, smoke, and cold neon.";
        case 'CHILDREN':
            return "Style: Children's Story. Whimsical, magical, full of wonder and gentle humor. The world is bright and alive; maybe inanimate objects (like traffic lights or trees) have slight personalities. Simple but evocative language. A sense of delightful discovery.";
        case 'HISTORICAL':
            return "Style: Historical Epic. Grandiose, dramatic, and timeless. Treat the journey as a significant pilgrimage or quest in a bygone era (even though it's modern day, overlay it with historical grandeur). Use slightly archaic but understandable language. Focus on endurance, destiny, and the weight of history.";
        case 'FANTASY':
            return "Style: Fantasy Adventure. Heroic, mystical, and epic. The real world is just a veil over a magical realm. Streets are ancient paths, buildings are towers or ruins. The traveler is on a vital quest. Use metaphors of magic, mythical creatures (shadows might be lurking beasts), and destiny.";
        default:
            return "Style: Immersive, 'in the moment' narration. Focus on the sensation of movement and the immediate environment.";
    }
};

export const generateStoryOutline = async (
    route: RouteDetails,
    totalSegments: number
): Promise<string[]> => {
    const isNews = route.experienceType === 'NEWS';
    const languageName = route.language === 'IT' ? 'Italian' : 'English';
    const now = new Date();
    const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const styleInstruction = isNews 
        ? (route.language === 'IT' ? "Stile: Notiziario radiofonico professionale. Fornisci aggiornamenti chiari, informativi e coinvolgenti. Cerca SEMPRE le notizie dell'ultima ora." : "Style: Professional radio news broadcast. Provide clear, informative, and engaging updates. ALWAYS search for breaking news from the last 24 hours.")
        : getStyleInstruction(route.storyStyle, route.language);

    const etymologyInstruction = route.language === 'IT'
        ? "INFORMAZIONI STRADALI: Durante il percorso nominerai diverse strade. Usa Google Search per identificare a chi sono intestate le vie (es. Via Diaz, Via Garibaldi) e spiega brevemente chi erano o cosa rappresentano, integrandolo nel racconto."
        : "STREET ETYMOLOGY: During the journey, you will encounter various streets. Use Google Search to identify the namesakes of these streets (e.g., Via Diaz, Garibaldi St) and briefly explain who they were or what they represent, integrating this into the narrative.";
    
    const fallbackMessage = route.language === 'IT' ? "Continua il viaggio verso la destinazione." : "Continue the journey towards the destination.";
    const fallbackOutline = route.language === 'IT' ? "Continua l'immersione narrativa del viaggio." : "Continue the immersive narrative of the journey.";
    
    let prompt = "";
    const pathContext = route.pathSteps ? `\nPlanned Path Elements: ${route.pathSteps.join(', ')}` : "";

    if (isNews) {
        prompt = `
        Today's Date: ${currentDate}.
        Current Local Time: ${currentTime} (${timezone}).
        You are a news producer for a radio station. Plan a news broadcast that is exactly ${totalSegments} segments long.
        The broadcast should cover the latest global news, technology, sports, and entertainment specifically from the LAST 24 HOURS.
        
        ${etymologyInstruction}
        ${pathContext}

        CRITICAL GROUNDING: For EVERY segment, you MUST use the search tool to verify:
        1. The absolute LATEST news (last 24 hours).
        2. Real-time LIVE traffic and accidents for the journey from ${route.startAddress} to ${route.endAddress}.
        3. Real-time weather and the exact current time (${currentTime}).
        
        Do not rely on your internal knowledge for current events. If no significant news is found for a specific category, focus on local events or points of interest along the route.

        The entire output (JSON and text) must be in ${languageName}.

        Output strictly valid JSON: An array of ${totalSegments} strings, each describing the topic of that news segment. 
        Example: ["Titoli principali e traffico locale", "Notizie internazionali dell'ultima ora", "Sport locale: Risultati di ieri", ...]
        `;
    } else {
        prompt = `
        You are an expert storyteller. Write an outline for a story that is exactly ${totalSegments} chapters long and has a complete cohesive story arc with a clear set up, inciting incident, rising action, climax, success, falling action, and resolution. 

        ${etymologyInstruction}
        ${pathContext}

        The entire output (JSON and text) must be in ${languageName}.

        Your outline should be tailored to match this journey:

        Journey: ${route.startAddress} to ${route.endAddress} by ${route.travelMode.toLowerCase()}.
        Total Duration: Approx ${route.duration}.
        Total Narrative Segments needed: ${totalSegments}.
        
        ${styleInstruction}

        Output strictly valid JSON: An array of ${totalSegments} strings. Example: ["Capitolo 1 riassunto...", "Capitolo 2 riassunto...", ...]
        `;
    }

    try {
        const modelToUse = isNews || route.storyStyle === 'HISTORICAL' ? 'gemini-1.5-flash' : 'gemini-3-flash-preview';
        const tools = isNews || route.storyStyle === 'HISTORICAL' ? [{ googleSearch: {} }] : [];
        
        const text = await withRetry(async () => {
            const response = await ai.models.generateContent({
                model: modelToUse,
                contents: prompt,
                config: { 
                    responseMimeType: 'application/json',
                    tools: tools as any
                }
            });
            return response.text?.trim() || "";
        });

        if (!text) throw new Error("No outline generated.");
        
        const outline = JSON.parse(text);
        if (!Array.isArray(outline) || outline.length === 0) {
             throw new Error("Invalid outline format received.");
        }

        while (outline.length < totalSegments) {
            outline.push(fallbackMessage);
        }

        const finalOutline = outline.slice(0, totalSegments);
        console.log(">> OUTLINE:", finalOutline);
        return finalOutline;

    } catch (error) {
        console.error("Outline Generation Error:", error);
        return Array(totalSegments).fill(fallbackOutline);
    }
};

export const generateSegment = async (
    route: RouteDetails,
    segmentIndex: number,
    totalSegmentsEstimate: number,
    segmentOutline: string,
    previousContext: string = ""
): Promise<StorySegment> => {

  const isNews = route.experienceType === 'NEWS';
  const isFirst = segmentIndex === 1;

  let contextPrompt = "";
  if (!isFirst) {
      contextPrompt = `
      PREVIOUS ${isNews ? 'BROADCAST' : 'NARRATIVE'} CONTEXT:
      ...${previousContext.slice(-1500)} 
      (CONTINUE SEAMLESSLY from the above. Do not repeat it.)
      `;
  }

  const languageName = route.language === 'IT' ? 'Italian' : 'English';
  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const styleInstruction = isNews 
      ? (route.language === 'IT' ? "Stile: Radio News Anchor. Usa un tono professionale, veloce e informativo. Cita sempre fatti accaduti nelle ultime 24-48 ore." : "Style: Radio News Anchor. Use a professional, fast-paced, and informative tone. Always cite facts from the last 24-48 hours.")
      : getStyleInstruction(route.storyStyle, route.language);

  const etymologyInstruction = route.language === 'IT'
      ? "INFORMAZIONI STRADALI: Durante questo segmento, potresti attraversare queste strade: " + (route.pathSteps?.join(', ') || 'non specificate') + ". Se possibile, spiega brevemente a chi sono dedicate queste vie usando Google Search per dettagli precisi."
      : "STREET ETYMOLOGY: During this segment, you might pass through these streets: " + (route.pathSteps?.join(', ') || 'not specified') + ". If possible, briefly explain the history behind these street names using Google Search for accuracy.";

  const prompt = `
    Today's Date: ${currentDate}.
    Current Local Time: ${currentTime} (${timezone}).
    You are an AI ${isNews ? 'Radio News Anchor' : 'storytelling engine'} generating a continuous, audio stream for a traveler.
    Journey: ${route.startAddress} to ${route.endAddress}.
    Current Status: Segment ${segmentIndex} of approx ${totalSegmentsEstimate}.
    Target Language: ${languageName} (Write in ${languageName} only).
    
    ${styleInstruction}
    ${etymologyInstruction}

    CURRENT ${isNews ? 'NEWS TOPIC' : 'CHAPTER GOAL'}: ${segmentOutline}

    ${contextPrompt}

    Task: Write the next ~${TARGET_SEGMENT_DURATION_SEC} seconds of ${isNews ? 'news reporting' : 'narration'} (approx ${WORDS_PER_SEGMENT} words).
    ${isNews || route.storyStyle === 'HISTORICAL' ? 'GROUNDING REQUIREMENT: You MUST use the search tool to verify all factual details. For News, only report events from the last 24 hours. For History, ensure architectural and biographical facts are 100% accurate. If reporting traffic/weather, use the CURRENT conditions for: ' + currentTime + '.' : 'Keep the narrative moving forward.'}

    IMPORTANT: Output ONLY the raw text for this segment in ${languageName}. Do not include titles or headings.
  `;

  try {
    const modelToUse = isNews || route.storyStyle === 'HISTORICAL' ? 'gemini-1.5-flash' : 'gemini-3-flash-preview';
    const tools = isNews || route.storyStyle === 'HISTORICAL' ? [{ googleSearch: {} }] : [];
    
    const text = await withRetry(async () => {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: prompt,
            config: {
              tools: tools as any
            }
          });
        const currentText = response.text?.trim() || "";
        if (!currentText) throw new Error("Empty text returned from segment generation.");
        return currentText;
    });

    if (!text) {
      if (isNews) {
        text = route.language === 'IT' 
          ? `Spiacenti, abbiamo riscontrato un problema nel recuperare le ultime notizie per questo segmento. Continuiamo con il viaggio verso ${route.endAddress}.`
          : `Sorry, we encountered a problem retrieving the latest news for this segment. Continuing our journey towards ${route.endAddress}.`;
      } else {
        text = segmentOutline; // Fallback to outline if story generation fails
      }
    }

    return {
      index: segmentIndex,
      text: text,
      audioBuffer: null 
    };

  } catch (error) {
    console.error(`Segment ${segmentIndex} Generation Error:`, error);
    // Even on catch, return a fallback instead of crashing the stream
    const fallbackText = route.language === 'IT' 
      ? `Continuiamo il percorso. Prossima tappa: ${segmentOutline}.`
      : `Continuing the path. Next up: ${segmentOutline}.`;
      
    return {
      index: segmentIndex,
      text: fallbackText,
      audioBuffer: null
    };
  }
};

export const generateSegmentAudio = async (text: string, audioContext: AudioContext, voiceName: string = 'Kore'): Promise<AudioBuffer> => {
  try {
    const audioResult = await withRetry(async () => {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-001', // Changed to a stable model supporting native audio/TTS
            contents: [{ parts: [{ text: text }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
              }
            }
          });
      
          const part = response.candidates?.[0]?.content?.parts?.[0];
          const data = part?.inlineData?.data;
          if (!data) throw new Error("No audio data received from Gemini TTS.");
          return { data, mimeType: part?.inlineData?.mimeType };
    }, 4, 3000); // Higher retry count and longer delay for TTS

    const audioData = audioResult.data;
    const mimeType = audioResult.mimeType || "audio/pcm;rate=24000";
    const match = mimeType.match(/rate=(\d+)/);
    const sampleRate = match ? parseInt(match[1], 10) : 24000;

    const wavArrayBuffer = await pcmToWav(base64ToArrayBuffer(audioData), sampleRate).arrayBuffer();
    return await audioContext.decodeAudioData(wavArrayBuffer);

  } catch (error) {
    console.error("Audio Generation Error:", error);
    throw error; // Re-throw to be caught by buffering engine
  }
};