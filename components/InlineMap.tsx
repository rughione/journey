/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useEffect, useRef } from 'react';
import { RouteDetails } from '../types';

interface Props {
  route: RouteDetails;
  currentSegmentIndex: number;
  totalSegments: number;
}

const InlineMap: React.FC<Props> = ({ route, currentSegmentIndex, totalSegments }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const progressMarkerRef = useRef<any>(null);
  const routePathRef = useRef<any[]>([]); // Store the array of LatLngs

  // 1. Init Map
  useEffect(() => {
    if (!window.google || !mapRef.current) return;

    if (!googleMapRef.current) {
      googleMapRef.current = new window.google.maps.Map(mapRef.current, {
        zoom: 13,
        center: { lat: 0, lng: 0 },
        disableDefaultUI: true,
        zoomControl: true,
        styles: [
            { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
            { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
            { "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
            { "elementType": "labels.text.stroke", "stylers": [{ "color": "#f5f5f5" }] },
            { "featureType": "administrative.land_parcel", "elementType": "labels.text.fill", "stylers": [{ "color": "#bdbdbd" }] },
            { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
            { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
            { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
            { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
            { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] },
            { "featureType": "road.arterial", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
            { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#dadada" }] },
            { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
            { "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
            { "featureType": "transit.line", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
            { "featureType": "transit.station", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
            { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#c9c9c9" }] },
            { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] }
        ]
      });

      directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
        map: googleMapRef.current,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: "#1A1A1A",
          strokeWeight: 5,
          strokeOpacity: 0.9
        }
      });

      const trafficLayer = new window.google.maps.TrafficLayer();
      trafficLayer.setMap(googleMapRef.current);
    }
  }, []);

  // 2. Calculate Route & Save Path
  useEffect(() => {
    if (route && directionsRendererRef.current && googleMapRef.current) {
        const directionsService = new window.google.maps.DirectionsService();
        directionsService.route(
          {
            origin: route.startAddress,
            destination: route.endAddress,
            travelMode: window.google.maps.TravelMode[route.travelMode],
          },
          (result: any, status: any) => {
            if (status === window.google.maps.DirectionsStatus.OK) {
              directionsRendererRef.current.setDirections(result);
              
              // Save the detailed path for placing the marker later
              routePathRef.current = result.routes[0].overview_path;

              const bounds = result.routes[0].bounds;
              googleMapRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });

              // Create progress marker if it doesn't exist
              if (!progressMarkerRef.current) {
                  progressMarkerRef.current = new window.google.maps.Marker({
                      map: googleMapRef.current,
                      position: routePathRef.current[0], // Start at beginning
                      zIndex: 999, // On top of everything
                      icon: {
                          path: window.google.maps.SymbolPath.CIRCLE,
                          scale: 8,
                          fillColor: "#1A1A1A", // Editorial black
                          fillOpacity: 1,
                          strokeColor: "#FFFFFF",
                          strokeWeight: 3,
                      },
                      title: "You are here"
                  });
              }
            }
          }
        );
      }
  }, [route]);

  // 3. Update Marker Position based on progress
  useEffect(() => {
      if (!progressMarkerRef.current || routePathRef.current.length === 0) return;

      const path = routePathRef.current;
      // Calculate approximate index along the path array based on segment progress
      // Ensure we don't go out of bounds (currentSegmentIndex is 0-based here effectively for progress)
      const safeIndex = Math.min(currentSegmentIndex, totalSegments);
      const progressRatio = safeIndex / Math.max(1, totalSegments);
      const pathIndex = Math.min(
          Math.floor(progressRatio * (path.length - 1)), 
          path.length - 1
      );

      const newPos = path[pathIndex];
      if (newPos) {
          progressMarkerRef.current.setPosition(newPos);
          // Optional: pan map to follow if desired, but fitting bounds usually enough for short routes
          // googleMapRef.current.panTo(newPos); 
      }

  }, [currentSegmentIndex, totalSegments]);

  return <div ref={mapRef} className="w-full h-full bg-stone-100" />;
};

export default InlineMap;
