/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef } from 'react';
import { RouteDetails } from '../types';

// We need to declare google namespace as we are loading it via script tag for simplicity in this demo environment
declare global {
  interface Window {
    google: any;
  }
}

interface Props {
  route: RouteDetails | null;
}

const MapBackground: React.FC<Props> = ({ route }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);

  useEffect(() => {
    const initMap = () => {
      if (!window.google || !mapRef.current) return;

      if (!googleMapRef.current) {
        googleMapRef.current = new window.google.maps.Map(mapRef.current, {
          zoom: 13,
          center: { lat: 34.0522, lng: -118.2437 }, // Default LA
          disableDefaultUI: true,
          styles: [
            {
              "elementType": "geometry",
              "stylers": [{ "color": "#f5f5f5" }]
            },
            {
              "elementType": "labels.icon",
              "stylers": [{ "visibility": "off" }]
            },
            {
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#616161" }]
            },
            {
              "elementType": "labels.text.stroke",
              "stylers": [{ "color": "#f5f5f5" }]
            },
            {
              "featureType": "administrative.land_parcel",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#bdbdbd" }]
            },
            {
              "featureType": "poi",
              "elementType": "geometry",
              "stylers": [{ "color": "#eeeeee" }]
            },
            {
              "featureType": "poi",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#757575" }]
            },
            {
              "featureType": "poi.park",
              "elementType": "geometry",
              "stylers": [{ "color": "#e5e5e5" }]
            },
            {
              "featureType": "poi.park",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#9e9e9e" }]
            },
            {
              "featureType": "road",
              "elementType": "geometry",
              "stylers": [{ "color": "#ffffff" }]
            },
            {
              "featureType": "road.arterial",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#757575" }]
            },
            {
              "featureType": "road.highway",
              "elementType": "geometry",
              "stylers": [{ "color": "#dadada" }]
            },
            {
              "featureType": "road.highway",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#616161" }]
            },
            {
              "featureType": "road.local",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#9e9e9e" }]
            },
            {
              "featureType": "transit.line",
              "elementType": "geometry",
              "stylers": [{ "color": "#e5e5e5" }]
            },
            {
              "featureType": "transit.station",
              "elementType": "geometry",
              "stylers": [{ "color": "#eeeeee" }]
            },
            {
              "featureType": "water",
              "elementType": "geometry",
              "stylers": [{ "color": "#c9c9c9" }]
            },
            {
              "featureType": "water",
              "elementType": "labels.text.fill",
              "stylers": [{ "color": "#9e9e9e" }]
            }
          ]
        });

        directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
          map: googleMapRef.current,
          suppressMarkers: true, // We want a clean look
          polylineOptions: {
            strokeColor: "#1A1A1A",
            strokeWeight: 4,
            strokeOpacity: 0.8
          }
        });
      }
    };

    if (!window.google) {
        // Quick hack to wait for Google Maps if it loads late
        const interval = setInterval(() => {
            if (window.google) {
                clearInterval(interval);
                initMap();
            }
        }, 500);
        return () => clearInterval(interval);
    } else {
        initMap();
    }

  }, []);

  // Update route when it changes
  useEffect(() => {
    if (route && window.google && directionsRendererRef.current && googleMapRef.current) {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: route.startAddress,
          destination: route.endAddress,
          travelMode: window.google.maps.TravelMode.WALKING,
        },
        (result: any, status: any) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            directionsRendererRef.current.setDirections(result);
            // Fit bounds slightly padded
            const bounds = result.routes[0].bounds;
            googleMapRef.current.fitBounds(bounds);
          }
        }
      );
    }
  }, [route]);

  return (
    <div className="absolute inset-0 z-0 opacity-20 pointer-events-none mix-blend-multiply grayscale contrast-125">
      <div ref={mapRef} className="w-full h-full" />
      {/* Overlay gradient to fade edges */}
      <div className="absolute inset-0 bg-gradient-to-b from-editorial-100 via-transparent to-editorial-100"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-editorial-100 via-transparent to-editorial-100"></div>
    </div>
  );
};

export default MapBackground;
