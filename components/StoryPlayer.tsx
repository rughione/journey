/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, MapPin, Clock, Footprints, Car, Loader2, ArrowDownCircle, Mic, MicOff } from 'lucide-react';
import { AudioStory, RouteDetails, StorySegment, Language } from '../types';
import InlineMap from './InlineMap';
import { getTranslation } from '../lib/translations';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface Props {
  story: AudioStory;
  route: RouteDetails;
  onSegmentChange: (index: number) => void;
  isBackgroundGenerating: boolean;
  language: Language;
}

const StoryPlayer: React.FC<Props> = ({ story, route, onSegmentChange, isBackgroundGenerating, language }) => {
  const t = getTranslation(language);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Audio Engine Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0); // When the current segment started playing in audioCtx time
  const segmentOffsetRef = useRef<number>(0); // How far into the current segment we are if paused
  
  // CRITICAL FIX: Ref to track current index inside async audio callbacks
  const indexRef = useRef(currentSegmentIndex);

  const textContainerRef = useRef<HTMLDivElement>(null);

  const currentSegment = story.segments[currentSegmentIndex];

  // Keep ref in sync with state
  useEffect(() => {
      indexRef.current = currentSegmentIndex;
  }, [currentSegmentIndex]);

  // --- Audio Lifecycle ---
  useEffect(() => {
    return () => {
      stopAudio();
      audioContextRef.current?.close();
    };
  }, []);

  // Notify parent App of current index for buffering purposes
  useEffect(() => {
      onSegmentChange(currentSegmentIndex);
  }, [currentSegmentIndex, onSegmentChange]);

  // Auto-play NEXT segment if we were buffering and it just arrived
  useEffect(() => {
      // Check if the *current* segment (which might have just arrived) is now ready
      const segmentNowReady = story.segments[currentSegmentIndex];

      if (isBuffering && isPlaying && segmentNowReady?.audioBuffer) {
          console.log(`[StoryPlayer] Segment ${currentSegmentIndex} arrived while buffering. Resuming...`);
          setIsBuffering(false);
          playSegment(segmentNowReady, 0);
      }
  }, [story.segments, currentSegmentIndex, isBuffering, isPlaying]);

  // Auto-scroll handling
  useEffect(() => {
      if (autoScroll && textContainerRef.current) {
          const lastParagraph = textContainerRef.current.lastElementChild;
          lastParagraph?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
  }, [story.segments.length, currentSegmentIndex, autoScroll]);


  // --- Voice Commands ---
  useEffect(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    if (isVoiceEnabled) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = language === 'IT' ? 'it-IT' : 'en-US';

      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript.toLowerCase().trim();
        console.log(`[Voice Command] Detected: "${command}"`);

        const playCommands = language === 'IT' 
          ? ['riproduci', 'continua', 'vai', 'play'] 
          : ['play', 'resume', 'continue', 'go'];
          
        const pauseCommands = language === 'IT'
          ? ['pausa', 'ferma', 'stop', 'fermati']
          : ['pause', 'stop', 'hold', 'freeze'];
          
        const nextCommands = language === 'IT'
          ? ['prossimo', 'avanti', 'successivo']
          : ['next', 'skip', 'forward'];

        if (playCommands.some(cmd => command.includes(cmd))) {
          if (!isPlaying) togglePlayback();
        } else if (pauseCommands.some(cmd => command.includes(cmd))) {
          if (isPlaying) togglePlayback();
        } else if (nextCommands.some(cmd => command.includes(cmd))) {
          handleSegmentEnd();
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
          setIsVoiceEnabled(false);
        }
      };

      recognition.onend = () => {
        if (isVoiceEnabled) {
          try { recognition.start(); } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
      try { recognition.start(); } catch (e) {}
    } else {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isVoiceEnabled, language, isPlaying]);

  // --- Audio Engine ---
  const stopAudio = () => {
      if (sourceRef.current) {
          sourceRef.current.onended = null;
          try { sourceRef.current.stop(); } catch (e) {}
          sourceRef.current = null;
      }
  };

  const playSegment = async (segment: StorySegment, offset: number = 0) => {
      if (!segment?.audioBuffer) {
           console.warn("Attempted to play segment without audio buffer");
           setIsBuffering(true);
           return;
      }

      if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          audioContextRef.current = new AudioContextClass();
      }
      if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
      }

      stopAudio();

      const source = audioContextRef.current.createBufferSource();
      source.buffer = segment.audioBuffer;
      source.connect(audioContextRef.current.destination);
      sourceRef.current = source;

      source.onended = () => {
          // Check if it reached natural end (vs manual stop)
          const duration = segment.audioBuffer!.duration;
          // Safety check if audioContext was closed
          if (!audioContextRef.current) return;

          const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
          
          // Use a generous tolerance because tracking audioCtx time vs duration can be slightly off
          if (elapsed >= duration - 0.5) { 
              handleSegmentEnd();
          }
      };

      startTimeRef.current = audioContextRef.current.currentTime - offset;
      source.start(0, offset);
      console.log(`[StoryPlayer] Playing segment ${segment.index} at offset ${offset}`);
  };

  const handleSegmentEnd = () => {
      // USE REF TO GET LATEST INDEX, NOT STALE CLOSURE
      const currentIndex = indexRef.current;
      const nextIndex = currentIndex + 1;
      
      console.log(`[StoryPlayer] Segment ${currentIndex} ended. Advancing to ${nextIndex}.`);
      
      setCurrentSegmentIndex(nextIndex);
      segmentOffsetRef.current = 0;

      // Check if next segment is already available in the story prop
      // Note: story.segments is 0-indexed array, our segments have 1-based .index property.
      // If nextIndex is 5, we want the segment at array index 5 (which is the 6th segment).
      // Wait, actually currentSegmentIndex IS 0-based array index in this component state.
      // So nextIndex is the next array index.
      
      if (story.segments[nextIndex]?.audioBuffer) {
          playSegment(story.segments[nextIndex], 0);
      } else {
          // Check if we reached the absolute end of the estimated journey
          if (nextIndex >= story.totalSegmentsEstimate && !isBackgroundGenerating) {
              console.log("[StoryPlayer] Reached end of journey.");
              setIsPlaying(false);
          } else {
              console.log(`[StoryPlayer] Segment index ${nextIndex} not ready. Buffering...`);
              setIsBuffering(true);
          }
      }
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      // PAUSE
      if (audioContextRef.current && !isBuffering) {
          segmentOffsetRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      }
      stopAudio();
      setIsPlaying(false);
      setAutoScroll(false); // User likely wants to read if they paused
    } else {
      // RESUME / PLAY
      setIsPlaying(true);
      if (currentSegment?.audioBuffer) {
         setIsBuffering(false);
         playSegment(currentSegment, segmentOffsetRef.current);
         setAutoScroll(true);
      } else {
          setIsBuffering(true);
      }
    }
  };

  const ModeIcon = route.travelMode === 'DRIVING' ? Car : Footprints;

  return (
    <div className="w-full max-w-5xl mx-auto animate-fade-in pb-24 px-4 md:px-6">
      
      {/* Hero Map (16:9) */}
      <div className="w-full aspect-video bg-stone-100 rounded-[2rem] shadow-2xl overflow-hidden relative mb-8 border-4 border-white">
           <InlineMap 
              route={route} 
              currentSegmentIndex={currentSegmentIndex}
              totalSegments={story.totalSegmentsEstimate}
           />
           {/* Destination Overlay */}
           <div className="absolute bottom-4 left-4 right-4 md:bottom-6 md:left-6 md:right-auto bg-white/95 backdrop-blur-md p-4 rounded-[1.5rem] shadow-lg border border-white/50 flex items-center gap-4 md:max-w-md z-10">
                <div className="bg-editorial-900 text-white p-3 rounded-full shrink-0">
                    <ModeIcon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-xs text-stone-500 font-bold uppercase tracking-wider mb-0.5">{t.destination}</div>
                    <div className="text-editorial-900 font-serif text-lg leading-tight truncate">{route.endAddress}</div>
                </div>
            </div>
      </div>

      {/* Sticky Player Header */}
      <div className="sticky top-6 z-30 bg-editorial-900 text-white rounded-full p-4 md:p-5 shadow-2xl mb-16 flex items-center justify-between transition-transform ring-4 ring-editorial-100">
         <div className="flex items-center gap-4 pl-4">
             {isBuffering ? (
                 <div className="flex items-center gap-2 text-amber-300 text-sm font-medium animate-pulse">
                     <Loader2 size={18} className="animate-spin" />
                     <span>{t.buffering}</span>
                 </div>
             ) : (
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isPlaying ? 'bg-green-400 animate-pulse' : 'bg-stone-500'}`}></div>
                    <span className="text-sm font-medium text-stone-300 hidden md:block">
                        {isPlaying ? t.liveStream : t.streamPaused}
                    </span>
                </div>
             )}
         </div>

         <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
             <span className="font-serif text-lg md:text-xl">
                 {route.duration} Journey
             </span>
         </div>

         <div className="flex items-center gap-4 pr-1">
             <button 
                onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} 
                className={`p-2 rounded-full transition-all ${isVoiceEnabled ? 'text-amber-300 bg-amber-300/10 scale-110' : 'text-stone-500 hover:text-white'}`} 
                title={isVoiceEnabled ? "Voice Control ON" : "Voice Control OFF"}
             >
                 {isVoiceEnabled ? <Mic size={20} /> : <MicOff size={20} />}
             </button>
             <button onClick={() => setAutoScroll(!autoScroll)} className={`p-2 rounded-full transition-colors ${autoScroll ? 'text-white bg-white/10' : 'text-stone-500 hover:text-white'}`} title="Toggle Auto-scroll">
                 <ArrowDownCircle size={20} />
             </button>
             <button
                onClick={togglePlayback}
                // Don't disable if buffering, allow them to "pause" the buffering state if they want to stop altogether
                className="bg-white text-editorial-900 p-3 md:p-4 rounded-full hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
                {isPlaying && !isBuffering ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current ml-1" />}
            </button>
         </div>
      </div>

      {/* Continuous Story Stream */}
      <div ref={textContainerRef} className="max-w-3xl mx-auto space-y-12 min-h-[50vh]">
          {story.segments.map((segment, idx) => (
              <div 
                key={segment.index} 
                className={`transition-all duration-1000 ${segment.index === currentSegmentIndex + 1 ? 'opacity-100 scale-100' : segment.index <= currentSegmentIndex ? 'opacity-60' : 'opacity-0 translate-y-10'}`}
              >
                  <p className="prose prose-xl md:prose-2xl max-w-none font-serif leading-relaxed text-editorial-900">
                    {segment.text}
                  </p>
                  {idx < story.segments.length - 1 && (
                      <div className="w-24 h-[2px] bg-stone-200 my-12 mx-auto"></div>
                  )}
              </div>
          ))}

          {/* 'Typing' indicator when buffering next segment */}
          {(isBuffering || isBackgroundGenerating) && (
              <div className="flex flex-col items-center justify-center gap-3 pt-12 pb-4 opacity-70 animate-pulse">
                  <div className="relative">
                    <Loader2 size={24} className="animate-spin text-editorial-900" />
                  </div>
                  <span className="text-sm font-medium text-stone-500 uppercase tracking-widest">{t.loadingNext}</span>
              </div>
          )}
      </div>
    </div>
  );
};

export default StoryPlayer;