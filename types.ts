/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/



export type StoryStyle = 'NOIR' | 'CHILDREN' | 'HISTORICAL' | 'FANTASY';
export type Language = 'EN' | 'IT';
export type ExperienceType = 'STORY' | 'NEWS';

export interface RouteDetails {
  startAddress: string;
  endAddress: string;
  distance: string;
  duration: string;
  durationSeconds: number;
  travelMode: string; // 'WALKING' | 'DRIVING'
  voiceName?: string; // Optional for now to maintain backward compatibility if needed
  storyStyle: StoryStyle;
  language: Language;
  experienceType: ExperienceType;
  pathSteps?: string[];
}

export interface StorySegment {
    index: number; // 1-based index
    text: string;
    audioBuffer: AudioBuffer | null;
}

export interface AudioStory {
  totalSegmentsEstimate: number;
  outline: string[];
  segments: StorySegment[];
}

export enum AppState {
  PLANNING,
  CALCULATING_ROUTE,
  ROUTE_CONFIRMED,
  GENERATING_INITIAL_SEGMENT,
  READY_TO_PLAY,
  PLAYING
}