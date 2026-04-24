/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



import React, { useState, useEffect, useRef } from 'react';
import { Headphones, Map as MapIcon, Sparkles, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import RoutePlanner from './components/RoutePlanner';
import StoryPlayer from './components/StoryPlayer';
import MapBackground from './components/MapBackground';
import { AppState, RouteDetails, AudioStory, Language } from './types';
import { generateSegment, generateSegmentAudio, calculateTotalSegments, generateStoryOutline } from './services/geminiService';
import { getTranslation } from './lib/translations';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// Helper to prevent infinite hangs on network requests
const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
    let timer: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([
        promise.then(val => { clearTimeout(timer); return val; }),
        timeoutPromise
    ]);
};

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.PLANNING);
  const [language, setLanguage] = useState<Language>('EN');
  const [route, setRoute] = useState<RouteDetails | null>(null);
  const t = getTranslation(language);
  const [story, setStory] = useState<AudioStory | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // --- Buffering Engine State ---
  const isGeneratingRef = useRef<boolean>(false);
  const [isBackgroundGenerating, setIsBackgroundGenerating] = useState(false);
  // Track which segment the user is currently listening to (fed back from StoryPlayer)
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(0);

  // --- Google Maps Bootstrap ---
  useEffect(() => {
    const SCRIPT_ID = 'google-maps-script';
    
    const getApiKey = () => {
        const key = process.env.API_KEY;
        if (!key) return null;
        // Clean up quotes just in case JSON.stringify added them in define, or env var has them
        return key.replace(/["']/g, "").trim();
    };

    const apiKey = getApiKey();

    console.log(process.env.API_KEY)

    if (!apiKey) {
        setScriptError("API Key is missing from environment variables.");
        console.error("Critical: process.env.API_KEY is missing or empty.");
        return;
    }
    
    if (document.getElementById(SCRIPT_ID) || window.google?.maps) return;



    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyBdf3qEHerho4yhseDl3vf-06ZHUcub-rI&loading=async&v=weekly&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onerror = () => setScriptError("Google Maps failed to load.");
    // @ts-ignore
    window.gm_authFailure = () => setScriptError("Google Maps authentication failed. Please check your API key.");
    document.head.appendChild(script);
  }, []);

  // --- Continuous Buffering Engine ---
  // Keeps 2 segments ahead of the current playback position
  useEffect(() => {
      if (!story || !route || appState < AppState.READY_TO_PLAY) return;

      const totalGenerated = story.segments.length;
      // We use index + 1 because playingIndex is 0-based, but segment count is 1-based total
      const neededBufferIndex = currentPlayingIndex + 3; 

      if (totalGenerated < neededBufferIndex && totalGenerated < story.totalSegmentsEstimate && !isGeneratingRef.current) {
          generateNextSegment(totalGenerated + 1);
      }
  }, [story, route, appState, currentPlayingIndex]);

  const generateNextSegment = async (index: number) => {
      if (!route || !story || isGeneratingRef.current) return;
      
      try {
          isGeneratingRef.current = true;
          setIsBackgroundGenerating(true);
          console.log(`[Buffering] Starting generation for Segment ${index}...`);

          // Gather all previous text for robust context, but limit length to avoid token overflow
          const allPreviousText = story.segments.map(s => s.text).join(" ").slice(-3000);
          
          // Get the specific outline beat for this segment. 
          // Fallback to generic if we somehow exceed the outline length.
          const segmentOutline = story.outline[index - 1] || "Continue the journey towards the final destination, wrapping up any loose narrative threads.";

          // 1. Generate Text (increased to 60s timeout for safety)
          const segmentData = await withTimeout(
              generateSegment(route, index, story.totalSegmentsEstimate, segmentOutline, allPreviousText),
              60000,
              `Text generation timed out for segment ${index}`
          );
          
          // 2. Generate Audio (increased to 100s timeout as TTS can be slow under load)
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const tempCtx = new AudioContextClass();
          const audioBuffer = await withTimeout(
              generateSegmentAudio(segmentData.text, tempCtx),
              100000,
              `Audio generation timed out for segment ${index}`
          );
          await tempCtx.close();

          // 3. Append to stream
          setStory(prev => {
              if (!prev) return null;
              // Ensure we don't add duplicates if race conditions occurred
              if (prev.segments.some(s => s.index === index)) return prev;
              return {
                  ...prev,
                  segments: [...prev.segments, { ...segmentData, audioBuffer }].sort((a, b) => a.index - b.index)
              };
          });
          console.log(`[Buffering] Segment ${index} ready.`);

      } catch (e) {
          console.error(`Failed to generate segment ${index}`, e);
          // We don't alert the user, we just hope the next attempt works.
          // The continuous loop in useEffect will retry if we are still behind buffer.
      } finally {
          isGeneratingRef.current = false;
          setIsBackgroundGenerating(false);
      }
  };

  // --- Handlers ---
  const handleGenerateStory = async (details: RouteDetails) => {
    setRoute(details);
    setGenerationError(null);
    
    try {
      setAppState(AppState.GENERATING_INITIAL_SEGMENT);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      const totalSegmentsEstimate = calculateTotalSegments(details.durationSeconds);
      setLoadingMessage(t.craftingOutline);

      // 1. Generate the Story Outline first
      const outline = await withTimeout(
          generateStoryOutline(details, totalSegmentsEstimate),
          60000, "Story outline generation timed out"
      );

      setLoadingMessage(t.writingChapter);

      // 2. Generate first segment using the first outline beat
      const firstOutlineBeat = outline[0] || "Begin the journey.";
      const seg1Data = await withTimeout(
          generateSegment(details, 1, totalSegmentsEstimate, firstOutlineBeat, ""),
          60000, "Initial text generation timed out"
      );
      
      setLoadingMessage(t.preparingAudio);
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const tempCtx = new AudioContextClass();
      const seg1Audio = await withTimeout(
          generateSegmentAudio(seg1Data.text, tempCtx),
          100000, "Initial audio generation timed out"
      );
      await tempCtx.close();

      setStory({
          totalSegmentsEstimate,
          outline,
          segments: [{ ...seg1Data, audioBuffer: seg1Audio }]
      });

      setAppState(AppState.READY_TO_PLAY);

    } catch (error: any) {
      console.error("Initial generation failed:", error);
      setAppState(AppState.PLANNING);
      
      let message = t.errorGeneric;
      if (error.message && (error.message.includes("timed out") || error.message.includes("timeout"))) {
          message = t.errorTimeout;
      }
      
      setGenerationError(message);
    }
  };

  const handleReset = () => {
      setAppState(AppState.PLANNING);
      setRoute(null);
      setStory(null);
      setCurrentPlayingIndex(0);
      setGenerationError(null);
      isGeneratingRef.current = false;
      setIsBackgroundGenerating(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Render Helpers ---
  const isHeroVisible = appState < AppState.READY_TO_PLAY;

  if (scriptError) {
      const errorMsg = scriptError === "Google Maps failed to load." ? t.errorMaps : 
                      scriptError.includes("authentication") ? t.errorAuth : 
                      scriptError.includes("API Key") ? t.errorKey : scriptError;
      return (
          <div className="min-h-screen bg-editorial-100 flex items-center justify-center p-6">
              <div className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md text-center space-y-4 border-2 border-red-100">
                  <AlertTriangle size={32} className="text-red-500 mx-auto" />
                  <p className="text-stone-600 font-medium">{errorMsg}</p>
              </div>
          </div>
      )
  }

  return (
    <div className="min-h-screen bg-editorial-100 text-editorial-900 relative selection:bg-stone-200">
      <MapBackground route={route} />

      <div className="absolute top-6 right-6 z-50 flex gap-2">
          {(['EN', 'IT'] as Language[]).map(lang => (
              <button 
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold transition-all shadow-sm ${language === lang ? 'bg-editorial-900 text-white border-editorial-900' : 'bg-white text-stone-400 border-stone-200 hover:border-stone-400'}`}
              >
                  {lang}
              </button>
          ))}
      </div>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-32">
        {/* Hero Section */}
        <div className={`transition-all duration-700 origin-top ease-in-out max-w-4xl mx-auto ${isHeroVisible ? 'opacity-100 translate-y-0 mb-16' : 'opacity-0 -translate-y-10 h-0 overflow-hidden mb-0'}`}>
            <h1 className="text-5xl md:text-7xl font-serif leading-[1.05] tracking-tight mb-8">
                {t.heroTitle} <br/> <span className="italic text-stone-500">{t.heroSubtitle}</span>
            </h1>
            <p className="text-xl text-stone-600 max-w-xl leading-relaxed font-light">
                {t.heroDescription}
            </p>
        </div>

        {/* Stage 1: Planning */}
        <div className={`max-w-4xl mx-auto transition-all duration-700 ${appState > AppState.GENERATING_INITIAL_SEGMENT ? 'hidden' : 'block'}`}>
            <RoutePlanner 
              onRouteFound={handleGenerateStory} 
              appState={appState} 
              externalError={generationError}
              language={language}
            />
        </div>

        {/* Stage 3: Loading Initial Segment (Formerly followed Stage 2 Confirmation) */}
        {appState === AppState.GENERATING_INITIAL_SEGMENT && (
            <div className="mt-16 flex flex-col items-center justify-center space-y-8 animate-fade-in text-center py-12 max-w-4xl mx-auto">
                <Loader2 size={48} className="animate-spin text-editorial-900" />
                <h3 className="text-3xl font-serif text-editorial-900">{loadingMessage}</h3>
            </div>
        )}

        {/* Stage 4: Final Player (Continuous Stream) */}
        {appState >= AppState.READY_TO_PLAY && story && route && (
            <div className="mt-8 animate-fade-in">
                <StoryPlayer 
                    story={story} 
                    route={route} 
                    onSegmentChange={(index) => setCurrentPlayingIndex(index)}
                    isBackgroundGenerating={isBackgroundGenerating}
                    language={language}
                />
                
                <div className="mt-24 text-center border-t border-stone-200 pt-12">
                    <button
                        onClick={handleReset}
                        className="group bg-white hover:bg-stone-50 text-editorial-900 px-8 py-4 rounded-full font-bold flex items-center gap-3 mx-auto transition-all border-2 border-stone-100 hover:border-stone-200 shadow-sm"
                    >
                        {t.endJourney}
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}

export default App;