"use client";

import { useEffect, useRef, useState } from "react";
import { families, type Place } from "@/lib/atlas-types";
import { khatamImage } from "./khatam";

type NeshanMap = InstanceType<(typeof import("@neshan-maps-platform/mapbox-gl"))["Map"]>;
type GeoJsonSource = {
  setData(data: unknown): void;
  getClusterExpansionZoom(id: number, callback: (error: Error | null, zoom: number) => void): void;
};

const SOURCE = "atlas-places";
const TEHRAN: [number, number] = [51.389, 35.7];
const SAFFRON = "#E3A532";
const LAPIS = "#1B2A5C";

function collection(places: Place[]) {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      ...place,
      properties: { ...place.properties, icon: `khatam-${place.properties.family}` },
    })),
  };
}

export function MapCanvas({
  webKey,
  places,
  selectedPk,
  onSelect,
  focusRequest,
  padding,
}: {
  webKey: string;
  places: Place[];
  selectedPk: string | null;
  onSelect: (pk: string | null) => void;
  /** Bumped by the parent whenever the map should fly to the selected place. */
  focusRequest: number;
  padding: { left: number; bottom: number };
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<NeshanMap | null>(null);
  const placesRef = useRef(places);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    placesRef.current = places;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!webKey || !containerRef.current || mapRef.current) return;
    let cancelled = false;

    import("@neshan-maps-platform/mapbox-gl")
      .then((module) => {
        if (cancelled || !containerRef.current) return;
        const neshan = module.default;
        const map = new neshan.Map({
          mapType: neshan.Map.mapTypes.neshanVector,
          container: containerRef.current,
          zoom: 11,
          center: TEHRAN,
          mapKey: webKey,
          poi: false,
          traffic: false,
        });
        mapRef.current = map;

        map.on("load", () => {
          let iconsReady = true;
          try {
            for (const family of families) {
              const pin = khatamImage(family.color);
              const selected = khatamImage(family.color, { size: 44, ring: SAFFRON });
              if (!pin || !selected) throw new Error("canvas unavailable");
              map.addImage(`khatam-${family.id}`, pin, { pixelRatio: 2 });
              map.addImage(`khatam-${family.id}-selected`, selected, { pixelRatio: 2 });
            }
          } catch {
            iconsReady = false;
          }

          map.addSource(SOURCE, {
            type: "geojson",
            data: collection(placesRef.current),
            cluster: true,
            clusterMaxZoom: 13,
            clusterRadius: 44,
          } as never);

          map.addLayer({
            id: "atlas-clusters",
            type: "circle",
            source: SOURCE,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": LAPIS,
              "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 40, 26],
              "circle-stroke-width": 3,
              "circle-stroke-color": "rgba(255,255,255,0.9)",
            },
          });
          map.addLayer({
            id: "atlas-cluster-count",
            type: "symbol",
            source: SOURCE,
            filter: ["has", "point_count"],
            layout: { "text-field": "{point_count_abbreviated}", "text-size": 13 },
            paint: { "text-color": "#ffffff" },
          });

          if (iconsReady) {
            map.addLayer({
              id: "atlas-points",
              type: "symbol",
              source: SOURCE,
              filter: ["!", ["has", "point_count"]],
              layout: {
                "icon-image": ["get", "icon"],
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              },
            });
          } else {
            map.addLayer({
              id: "atlas-points",
              type: "circle",
              source: SOURCE,
              filter: ["!", ["has", "point_count"]],
              paint: {
                "circle-color": ["get", "color"],
                "circle-radius": 8,
                "circle-stroke-width": 2.5,
                "circle-stroke-color": "#ffffff",
              },
            });
          }
          map.addLayer({
            id: "atlas-labels",
            type: "symbol",
            source: SOURCE,
            filter: ["!", ["has", "point_count"]],
            minzoom: 13.5,
            layout: {
              "text-field": ["get", "fullName"],
              "text-size": 12,
              "text-offset": [0, 1.4],
              "text-anchor": "top",
              "text-max-width": 10,
            },
            paint: { "text-color": LAPIS, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
          });
          map.addLayer({
            id: "atlas-selected",
            type: iconsReady ? "symbol" : "circle",
            source: SOURCE,
            filter: ["==", ["get", "pk"], ""],
            ...(iconsReady
              ? {
                  layout: {
                    "icon-image": ["concat", ["get", "icon"], "-selected"],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                  },
                }
              : {
                  paint: {
                    "circle-color": ["get", "color"],
                    "circle-radius": 11,
                    "circle-stroke-width": 4,
                    "circle-stroke-color": SAFFRON,
                  },
                }),
          } as never);

          map.on("click", "atlas-clusters", (event) => {
            const feature = map.queryRenderedFeatures(event.point, { layers: ["atlas-clusters"] })[0];
            const clusterId = feature?.properties?.cluster_id;
            const source = map.getSource(SOURCE) as unknown as GeoJsonSource | undefined;
            const geometry = feature?.geometry;
            if (clusterId == null || !source || geometry?.type !== "Point") return;
            const center = geometry.coordinates as [number, number];
            source.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (!error) map.easeTo({ center, zoom: zoom + 0.5 });
            });
          });
          map.on("click", "atlas-points", (event) => {
            const pk = event.features?.[0]?.properties?.pk;
            if (pk != null) onSelectRef.current(String(pk));
          });
          for (const layer of ["atlas-clusters", "atlas-points"]) {
            map.on("mouseenter", layer, () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layer, () => {
              map.getCanvas().style.cursor = "";
            });
          }
          setReady(true);
        });
        map.on("error", (event: { error?: { status?: number } }) => {
          if (event?.error?.status === 401 || event?.error?.status === 403) setFailed(true);
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
  }, [webKey]);

  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource?.(SOURCE) as unknown as GeoJsonSource | undefined;
    source?.setData(collection(places));
  }, [places, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setFilter("atlas-selected", ["==", ["get", "pk"], selectedPk ?? ""]);
  }, [selectedPk, ready]);

  useEffect(() => {
    if (!ready || !selectedPk || !focusRequest) return;
    const place = placesRef.current.find((item) => item.properties.pk === selectedPk);
    if (!place) return;
    mapRef.current?.flyTo({
      center: place.geometry.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 15),
      padding: { left: padding.left, bottom: padding.bottom, top: 40, right: 40 },
      speed: 1.4,
    });
  }, [focusRequest, ready, selectedPk, padding.left, padding.bottom]);

  if (!webKey || failed) {
    return (
      <div className="map-offline" role="img" aria-label="Map unavailable">
        <div className="map-offline-note">
          <strong>{webKey ? "The map could not load" : "The map needs a Neshan key"}</strong>
          <span>
            {webKey
              ? "Check that this domain is allowed for the Neshan web key. The directory still works."
              : "Set NEXT_PUBLIC_NESHAN_WEB_KEY and redeploy. The directory still works."}
          </span>
        </div>
      </div>
    );
  }
  return <div className="map-canvas" ref={containerRef} />;
}
