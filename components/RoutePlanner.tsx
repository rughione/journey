/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Navigation, Loader2, Footprints, Car, CloudRain, Sparkles, ScrollText, Sword, Newspaper, BookOpen } from 'lucide-react';
import { RouteDetails, AppState, StoryStyle, Language, ExperienceType } from '../types';
import { getTranslation } from '../lib/translations';

declare global {
  interface Window {
    google: any;
  }
}

interface Props {
  onRouteFound: (details: RouteDetails) => void;
  appState: AppState;
  externalError?: string | null;
  language: Language;
}

type TravelMode = 'WALKING' | 'DRIVING';

const RoutePlanner: React.FC<Props> = ({ onRouteFound, appState, externalError, language }) => {
  const t = getTranslation(language);

  const STYLES: { id: StoryStyle; label: string; icon: React.ElementType; desc: string }[] = [
    { id: 'NOIR', label: t.styles.NOIR.label, icon: CloudRain, desc: t.styles.NOIR.desc },
    { id: 'CHILDREN', label: t.styles.CHILDREN.label, icon: Sparkles, desc: t.styles.CHILDREN.desc },
    { id: 'HISTORICAL', label: t.styles.HISTORICAL.label, icon: ScrollText, desc: t.styles.HISTORICAL.desc },
    { id: 'FANTASY', label: t.styles.FANTASY.label, icon: Sword, desc: t.styles.FANTASY.desc },
  ];
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');
  const [experienceType, setExperienceType] = useState<ExperienceType>('STORY');
  const [selectedStyle, setSelectedStyle] = useState<StoryStyle>('NOIR');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  // Sync external errors (like timeouts from App.tsx) into local UI
  useEffect(() => {
    if (externalError) {
        setError(externalError);
    }
  }, [externalError]);

  // Initialize Classic Autocomplete
  useEffect(() => {
    let isMounted = true;

    const initAutocomplete = async () => {
        if (!window.google?.maps?.places) return;
        
        try {
             const setupAutocomplete = (
                 inputElement: HTMLInputElement | null,
                 setAddress: (addr: string) => void
             ) => {
                 if (!inputElement) return;

                 const autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
                     fields: ['formatted_address', 'geometry', 'name'],
                     types: ['geocode', 'establishment']
                 });

                 autocomplete.addListener('place_changed', () => {
                     if (!isMounted) return;
                     const place = autocomplete.getPlace();
                     
                     if (!place.geometry || !place.geometry.location) {
                         if (inputElement.value && window.google.maps.Geocoder) {
                             const geocoder = new window.google.maps.Geocoder();
                             geocoder.geocode({ address: inputElement.value }, (results: any, status: any) => {
                                 if (status === 'OK' && results[0]) {
                                     setAddress(results[0].formatted_address);
                                     inputElement.value = results[0].formatted_address;
                                 }
                             });
                         }
                         return;
                     }

                     const address = place.formatted_address || place.name;
                     setAddress(address);
                     inputElement.value = address;
                 });
             };

             setupAutocomplete(startInputRef.current, setStartAddress);
             setupAutocomplete(endInputRef.current, setEndAddress);

        } catch (e) {
            console.error("Failed to initialize Places Autocomplete:", e);
            if (isMounted) setError("Location search failed to initialize. Please refresh.");
        }
    };

    if (window.google?.maps?.places) {
        initAutocomplete();
    } else {
        const interval = setInterval(() => {
            if (window.google?.maps?.places) {
                clearInterval(interval);
                initAutocomplete();
            }
        }, 300);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }
    
    return () => { isMounted = false; };
  }, []);

  const handleCalculate = () => {
    const finalStart = startInputRef.current?.value || startAddress;
    const finalEnd = endInputRef.current?.value || endAddress;

    if (!finalStart || !finalEnd) {
      setError(t.selectBoth);
      return;
    }

    if (!window.google?.maps) {
         setError(t.errorDirections); // Or a specific maps not loaded error
         return;
    }

    setError(null);
    setIsLoading(true);

    const directionsService = new window.google.maps.DirectionsService();
    const routeRequest: any = {
      origin: finalStart,
      destination: finalEnd,
      travelMode: window.google.maps.TravelMode[travelMode],
    };

    if (travelMode === 'DRIVING') {
      routeRequest.drivingOptions = {
        departureTime: new Date(),
        trafficModel: 'bestguess'
      };
    }

    directionsService.route(
      routeRequest,
      (result: any, status: any) => {
        setIsLoading(false);
        if (status === window.google.maps.DirectionsStatus.OK) {
          const leg = result.routes[0].legs[0];
          
          // duration_in_traffic is available when drivingOptions are used
          const durationText = leg.duration_in_traffic?.text || leg.duration.text;
          const durationValue = leg.duration_in_traffic?.value || leg.duration.value;

          // 4 hours limit (14400 seconds) to prevent generation timeouts
          if (leg.duration.value > 14400) {
            setError(t.errorTooLong);
            return;
          }

          onRouteFound({
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            distance: leg.distance.text,
            duration: durationText,
            durationSeconds: durationValue,
            travelMode: travelMode,
            voiceName: 'Kore', // Updated to a valid Gemini TTS voice
            storyStyle: selectedStyle,
            language: language,
            experienceType: experienceType,
            pathSteps: (leg.steps || []).map((s: any) => (s.html_instructions || '').replace(/<[^>]*>?/gm, ''))
          });
        } else {
          console.error("Directions error:", status, result);
          if (status === 'ZERO_RESULTS') {
              const mode = travelMode === 'WALKING' ? t.walk.toLowerCase() : t.drive.toLowerCase();
              setError(t.errorNoRoute(mode, finalStart, finalEnd));
          } else {
              setError(t.errorDirections);
          }
        }
      }
    );
  };

  const isLocked = appState > AppState.ROUTE_CONFIRMED;

  return (
    <div className={`transition-all duration-700 ${isLocked ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
      <div className="space-y-8 bg-white/80 backdrop-blur-lg p-8 md:p-10 rounded-[2rem] shadow-2xl shadow-stone-200/50 border border-white/50">
        <div className="space-y-1">
            <h2 className="text-2xl font-serif text-editorial-900">{t.planJourney}</h2>
            <p className="text-stone-500">{t.searchLocations}</p>
        </div>

        <div className="space-y-4">
          <div className="relative group z-20 h-14 bg-stone-50/50 border-2 border-stone-100 focus-within:border-editorial-900 focus-within:bg-white rounded-xl transition-all shadow-sm focus-within:shadow-md overflow-hidden">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-editorial-900 transition-colors pointer-events-none z-10" size={20} />
            <input
                ref={startInputRef}
                type="text"
                placeholder={t.startingPoint}
                className="w-full h-full bg-transparent p-0 pl-12 pr-4 text-editorial-900 placeholder-stone-400 outline-none font-medium text-base"
                onChange={(e) => setStartAddress(e.target.value)}
                disabled={isLocked}
            />
          </div>

          <div className="relative group z-10 h-14 bg-stone-50/50 border-2 border-stone-100 focus-within:border-editorial-900 focus-within:bg-white rounded-xl transition-all shadow-sm focus-within:shadow-md overflow-hidden">
            <Navigation className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-editorial-900 transition-colors pointer-events-none z-10" size={20} />
            <input
                ref={endInputRef}
                type="text"
                placeholder={t.destination}
                className="w-full h-full bg-transparent p-0 pl-12 pr-4 text-editorial-900 placeholder-stone-400 outline-none font-medium text-base"
                onChange={(e) => setEndAddress(e.target.value)}
                disabled={isLocked}
            />
          </div>
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Experience Type */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-stone-500 uppercase tracking-wider">{t.experienceType}</label>
                <div className="flex gap-2 bg-stone-100/50 p-1.5 rounded-xl border border-stone-100">
                    {(['STORY', 'NEWS'] as ExperienceType[]).map((type) => (
                        <button
                            key={type}
                            onClick={() => setExperienceType(type)}
                            disabled={isLocked}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all ${
                                experienceType === type 
                                    ? 'bg-white text-editorial-900 shadow-md' 
                                    : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-700'
                            }`}
                        >
                            {type === 'STORY' && <BookOpen size={18} />}
                            {type === 'NEWS' && <Newspaper size={18} />}
                            <span className="hidden lg:inline text-xs truncate">
                                {type === 'STORY' ? t.experienceStory : t.experienceNews}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Travel Mode */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-stone-500 uppercase tracking-wider">{t.travelMode}</label>
                <div className="flex gap-2 bg-stone-100/50 p-1.5 rounded-xl border border-stone-100">
                    {(['WALKING', 'DRIVING'] as TravelMode[]).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setTravelMode(mode)}
                            disabled={isLocked}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-all ${
                                travelMode === mode 
                                    ? 'bg-white text-editorial-900 shadow-md' 
                                    : 'text-stone-500 hover:bg-stone-200/50 hover:text-stone-700'
                            }`}
                        >
                            {mode === 'WALKING' && <Footprints size={18} />}
                            {mode === 'DRIVING' && <Car size={18} />}
                            <span className="hidden lg:inline">
                                {mode === 'WALKING' ? t.walk : t.drive}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* Story Style Selector (Only if Story experience is selected) */}
        {experienceType === 'STORY' && (
            <div className="space-y-3 animate-fade-in">
                <label className="text-sm font-medium text-stone-500 uppercase tracking-wider">{t.storyStyle}</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {STYLES.map((style) => {
                        const Icon = style.icon;
                        const isSelected = selectedStyle === style.id;
                        return (
                            <button
                                key={style.id}
                                onClick={() => setSelectedStyle(style.id)}
                                disabled={isLocked}
                                className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                                    isSelected
                                        ? 'border-editorial-900 bg-editorial-900 text-white shadow-md'
                                        : 'border-stone-100 bg-stone-50/50 text-stone-600 hover:border-stone-300 hover:bg-stone-100'
                                }`}
                            >
                                <Icon size={24} className={`shrink-0 ${isSelected ? 'text-white' : 'text-stone-400'}`} />
                                <div>
                                    <div className={`font-bold ${isSelected ? 'text-white' : 'text-editorial-900'}`}>
                                        {style.label}
                                    </div>
                                    <div className={`text-xs mt-1 leading-tight ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                                        {style.desc}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        )}

        {experienceType === 'NEWS' && (
            <div className="p-6 bg-stone-100/50 rounded-2xl border-2 border-stone-200 border-dashed animate-fade-in flex flex-col items-center justify-center text-center space-y-2">
                <Newspaper size={32} className="text-stone-400" />
                <p className="text-stone-600 font-medium">{t.experienceNews}</p>
                <p className="text-xs text-stone-500 max-w-xs">{t.newsQuery}</p>
            </div>
        )}

        {error && (
          <p className="text-red-600 text-sm bg-red-50 p-3 rounded-lg font-medium animate-fade-in">{error}</p>
        )}

        <button
          onClick={handleCalculate}
          disabled={isLoading || isLocked || !startAddress || !endAddress}
          className="w-full bg-editorial-900 text-white py-4 rounded-full font-bold text-lg hover:bg-stone-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-editorial-900/20 active:scale-[0.99]"
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" /> {t.planningJourney}
            </>
          ) : (
            <>
               <Sparkles size={20} className="animate-subtle-pulse" />
               {t.generateStory}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default RoutePlanner;