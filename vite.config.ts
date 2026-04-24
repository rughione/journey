/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // helper to clean keys
    const cleanKey = (key: string | undefined) => {
      if (!key) return undefined;
      const k = key.trim();
      // Filter out common placeholders or invalid values
      if (k === '' || k === 'GEMINI_API_KEY' || k === 'API_KEY' || k.includes('YOUR_API_KEY')) return undefined;
      return k;
    };

    // Try to find a valid key in various locations
    const apiKey = cleanKey(process.env.API_KEY) || 
                   cleanKey(process.env.GEMINI_API_KEY) || 
                   cleanKey(env.API_KEY) || 
                   cleanKey(env.GEMINI_API_KEY);

    if (!apiKey) {
       console.warn("⚠️  WARNING: API_KEY is undefined. The app may not function correctly.");
    } else {
       console.log("✅ API_KEY loaded for build.");
    }

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Correctly inject the string value. 
        // If apiKey is undefined, it sets it to undefined (or empty string if preferred, but undefined is safer to detect)
        'process.env.API_KEY': apiKey ? JSON.stringify(apiKey) : 'undefined',
      },
      resolve: {
        alias: {
          '@': path.resolve('.'),
        }
      }
    };
});
