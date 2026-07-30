"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AtlasPlace = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    username: string;
    fullName: string;
    biography?: string;
    address?: string;
    categories: string[];
    primaryCategory: string;
    color?: string;
    instagramUrl?: string;
    evidenceStrength?: string;
  };
};

type AtlasCollection = {
  type: "FeatureCollection";
  features: AtlasPlace[];
  metadata?: { status?: string; generatedAt?: string };
};

type NeshanMapInstance = InstanceType<
  (typeof import("@neshan-maps-platform/mapbox-gl"))["Map"]
>;

type AtlasGeoJsonSource = {
  setData(data: AtlasCollection): void;
  getClusterExpansionZoom(
    clusterId: number,
    callback: (error: Error | null, zoom: number) => void,
  ): void;
};

type Category = {
  id: string;
  label: string;
  shortLabel: string;
  classified: number;
  color: string;
};

const categories: Category[] = [
  { id: "Restaurants", label: "Restaurants", shortLabel: "Restaurants", classified: 113, color: "#9f3d2f" },
  { id: "Cafes_and_Coffee_Shops", label: "Cafés & coffee shops", shortLabel: "Cafés", classified: 40, color: "#a96f3a" },
  { id: "Bakeries_Desserts_and_Sweets", label: "Bakeries, desserts & sweets", shortLabel: "Bakeries", classified: 10, color: "#c48d55" },
  { id: "Food_Products_Catering_and_Grocery", label: "Food, catering & grocery", shortLabel: "Food & grocery", classified: 59, color: "#b75a3f" },
  { id: "Fashion_Beauty_Jewelry_and_Accessories", label: "Fashion, beauty & jewelry", shortLabel: "Fashion & beauty", classified: 50, color: "#9a5f73" },
  { id: "Electronics_Automotive_and_Gadgets", label: "Electronics, automotive & gadgets", shortLabel: "Electronics", classified: 35, color: "#596d78" },
  { id: "Home_Books_Gifts_and_Other_Retail", label: "Home, books, gifts & retail", shortLabel: "Retail", classified: 86, color: "#7c6a51" },
  { id: "Education_and_Language", label: "Education & language", shortLabel: "Education", classified: 122, color: "#49756d" },
  { id: "Immigration_Legal_and_Finance", label: "Immigration, legal & finance", shortLabel: "Legal & finance", classified: 53, color: "#536a8b" },
  { id: "Technology_and_Software", label: "Technology & software", shortLabel: "Technology", classified: 104, color: "#3c7781" },
  { id: "Marketing_Design_and_Business_Services", label: "Marketing, design & business", shortLabel: "Business services", classified: 100, color: "#7f5e8a" },
  { id: "Health_Medical_and_Wellness", label: "Health, medical & wellness", shortLabel: "Health", classified: 43, color: "#4f8264" },
  { id: "Travel_Hotels_and_Events", label: "Travel, hotels & events", shortLabel: "Travel & events", classified: 75, color: "#3d7890" },
  { id: "Media_News_and_Publishing", label: "Media, news & publishing", shortLabel: "Media", classified: 83, color: "#7b6250" },
  { id: "Arts_Music_and_Entertainment", label: "Arts, music & entertainment", shortLabel: "Arts & music", classified: 192, color: "#8d4f55" },
  { id: "Creators_Public_Figures_and_Personal_Brands", label: "Creators & public figures", shortLabel: "Creators", classified: 174, color: "#a6654c" },
  { id: "Sports_and_Fitness", label: "Sports & fitness", shortLabel: "Sports", classified: 34, color: "#547348" },
  { id: "Community_Nonprofit_and_Government", label: "Community & nonprofit", shortLabel: "Community", classified: 21, color: "#657548" },
  { id: "Personal_and_Noncommercial", label: "Personal & noncommercial", shortLabel: "Personal", classified: 29, color: "#827b70" },
  { id: "Other_Businesses_and_Services", label: "Other businesses & services", shortLabel: "Other services", classified: 35, color: "#6f695f" },
  { id: "Unclear", label: "Unclear", shortLabel: "Unclear", classified: 1, color: "#aaa091" },
];

const categoryById = new Map(categories.map((category) => [category.id, category]));
const allCategoryIds = categories.map((category) => category.id);

function createAllCategorySet() {
  return new Set(allCategoryIds);
}

const fallbackPins = [
  { left: "61%", top: "35%", count: "48", color: "#9f3d2f" },
  { left: "51%", top: "50%", count: "21", color: "#a96f3a" },
  { left: "72%", top: "55%", count: "12", color: "#49756d" },
  { left: "40%", top: "38%", count: "9", color: "#7f5e8a" },
  { left: "64%", top: "69%", count: "6", color: "#3d7890" },
];

function emptyCollection(): AtlasCollection {
  return { type: "FeatureCollection", features: [] };
}

function categoryColor(id: string) {
  return categoryById.get(id)?.color ?? "#6f695f";
}

export function AtlasMap({ webKey }: { webKey: string }) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<NeshanMapInstance | null>(null);
  const collectionRef = useRef<AtlasCollection>(emptyCollection());
  const [collection, setCollection] = useState<AtlasCollection>(emptyCollection);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    createAllCategorySet,
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AtlasPlace | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    fetch("/locations.geojson")
      .then((response) => {
        if (!response.ok) throw new Error("Location data could not be loaded.");
        return response.json();
      })
      .then((data: AtlasCollection) => {
        setCollection(data);
        setActiveCategories(createAllCategorySet());
      })
      .catch((error) => setMapError(error.message));
  }, []);

  useEffect(() => {
    collectionRef.current = collection;
  }, [collection]);

  const filteredFeatures = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en");
    return collection.features.filter((feature) => {
      const props = feature.properties;
      const matchesLayer = props.categories.some((id) => activeCategories.has(id));
      if (!matchesLayer) return false;
      if (!needle) return true;
      return [props.fullName, props.username, props.address, props.biography]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("en").includes(needle));
    });
  }, [activeCategories, collection.features, search]);

  const displayCollection = useMemo<AtlasCollection>(
    () => ({
      type: "FeatureCollection",
      features: filteredFeatures.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          color:
            feature.properties.color ??
            categoryColor(feature.properties.primaryCategory),
          categoriesText: feature.properties.categories
            .map((id) => categoryById.get(id)?.shortLabel ?? id)
            .join(" · "),
        },
      })) as AtlasPlace[],
    }),
    [filteredFeatures],
  );

  const mappedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feature of collection.features) {
      for (const category of feature.properties.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return counts;
  }, [collection.features]);

  useEffect(() => {
    if (!webKey || !mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    import("@neshan-maps-platform/mapbox-gl")
      .then((module) => {
        if (cancelled || !mapContainerRef.current) return;
        const neshan = module.default;
        const map = new neshan.Map({
          mapType: neshan.Map.mapTypes.neshanVector,
          container: mapContainerRef.current,
          zoom: 10.4,
          center: [51.389, 35.6892],
          mapKey: webKey,
          poi: true,
          traffic: false,
        });
        mapRef.current = map;

        map.on("load", () => {
          map.addSource("atlas-places", {
            type: "geojson",
            data: displayCollection,
            cluster: true,
            clusterMaxZoom: 13,
            clusterRadius: 48,
          });
          map.addLayer({
            id: "atlas-clusters",
            type: "circle",
            source: "atlas-places",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#9f3d2f",
              "circle-radius": ["step", ["get", "point_count"], 18, 20, 23, 70, 29],
              "circle-stroke-width": 3,
              "circle-stroke-color": "#f1e8d8",
            },
          });
          map.addLayer({
            id: "atlas-cluster-count",
            type: "symbol",
            source: "atlas-places",
            filter: ["has", "point_count"],
            layout: {
              "text-field": "{point_count_abbreviated}",
              "text-size": 12,
            },
            paint: { "text-color": "#fffaf0" },
          });
          map.addLayer({
            id: "atlas-points",
            type: "circle",
            source: "atlas-places",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": ["coalesce", ["get", "color"], "#9f3d2f"],
              "circle-radius": 8,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#f7efdf",
            },
          });
          map.addLayer({
            id: "atlas-labels",
            type: "symbol",
            source: "atlas-places",
            filter: ["!", ["has", "point_count"]],
            minzoom: 12.5,
            layout: {
              "text-field": ["get", "fullName"],
              "text-size": 11,
              "text-offset": [0, 1.35],
              "text-anchor": "top",
            },
            paint: {
              "text-color": "#332d24",
              "text-halo-color": "#f7efdf",
              "text-halo-width": 1.5,
            },
          });

          map.on("click", "atlas-clusters", (event) => {
            const feature = map.queryRenderedFeatures(event.point, {
              layers: ["atlas-clusters"],
            })[0];
            const clusterId = feature?.properties?.cluster_id;
            const source = map.getSource("atlas-places") as unknown as
              | AtlasGeoJsonSource
              | undefined;
            const position =
              feature?.geometry?.type === "Point"
                ? feature.geometry.coordinates
                : null;
            const coordinates: [number, number] | null =
              position && position.length >= 2
                ? [Number(position[0]), Number(position[1])]
                : null;
            if (
              clusterId == null ||
              !source ||
              !coordinates ||
              !coordinates.every(Number.isFinite)
            ) return;
            source.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (error) return;
              map.easeTo({ center: coordinates, zoom });
            });
          });
          map.on("click", "atlas-points", (event) => {
            const feature = event.features?.[0];
            if (!feature?.properties) return;
            const username = String(feature.properties.username ?? "");
            const original = collectionRef.current.features.find(
              (item) => item.properties.username === username,
            );
            if (original) setSelected(original);
          });
          for (const layer of ["atlas-clusters", "atlas-points"]) {
            map.on("mouseenter", layer, () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", layer, () => {
              map.getCanvas().style.cursor = "";
            });
          }
          setMapReady(true);
        });
        map.on("error", () => setMapError("The Neshan map could not be initialized."));
      })
      .catch(() => setMapError("The Neshan map library could not be initialized."));

    return () => {
      cancelled = true;
      mapRef.current?.remove?.();
      mapRef.current = null;
    };
    // Map is intentionally created once, after the key becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webKey]);

  useEffect(() => {
    const source = mapRef.current?.getSource?.(
      "atlas-places",
    ) as unknown as AtlasGeoJsonSource | undefined;
    source?.setData?.(displayCollection);
  }, [displayCollection]);

  function toggleCategory(id: string) {
    setActiveCategories((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCoords = selected?.geometry.coordinates;
  const selectedCategoryLabels =
    selected?.properties.categories
      .map((id) => categoryById.get(id)?.shortLabel ?? id)
      .join(" · ") ?? "";

  return (
    <main className="atlas-shell">
      <button
        className="mobile-menu"
        type="button"
        aria-label="Open map layers"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((value) => !value)}
      >
        <span /><span /><span />
      </button>

      <aside className={`atlas-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <header className="brand-block">
          <div className="brand-seal" aria-hidden="true"><span>FA</span></div>
          <div>
            <p className="eyebrow">A CURATED MAP</p>
            <h1>Following Atlas</h1>
            <p className="brand-fa" lang="fa" dir="rtl">اطلس مکان‌های دنبال‌شده</p>
          </div>
        </header>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people or places"
            aria-label="Search people or places"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">×</button>
          )}
        </label>

        <div className="stat-grid" aria-label="Map statistics">
          <div><strong>903</strong><span>profiles read</span></div>
          <div><strong>{collection.features.length}</strong><span>matched places</span></div>
          <div><strong>21</strong><span>map layers</span></div>
        </div>

        <div className="layer-heading">
          <div>
            <p className="eyebrow">MAP LAYERS</p>
            <p>{activeCategories.size} of 21 visible</p>
          </div>
          <div className="layer-actions">
            <button type="button" onClick={() => setActiveCategories(createAllCategorySet())}>All</button>
            <button type="button" onClick={() => setActiveCategories(new Set())}>None</button>
          </div>
        </div>

        <div className="layer-list">
          {categories.map((category) => {
            const active = activeCategories.has(category.id);
            return (
              <button
                type="button"
                className={`layer-row ${active ? "is-active" : ""}`}
                onClick={() => toggleCategory(category.id)}
                key={category.id}
                aria-pressed={active}
              >
                <span className="category-dot" style={{ background: category.color }} />
                <span className="layer-name">
                  {category.label}
                  <small>
                    {mappedCounts.get(category.id) ?? 0} mapped · {category.classified} classified
                  </small>
                </span>
                <span className="switch"><i /></span>
              </button>
            );
          })}
        </div>

        <footer className="sidebar-footer">
          Only public business and venue locations are included.
        </footer>
      </aside>

      {sidebarOpen && (
        <button className="sidebar-scrim" type="button" aria-label="Close map layers" onClick={() => setSidebarOpen(false)} />
      )}

      <section className="map-stage" aria-label="Interactive map of public Instagram places">
        {webKey ? (
          <div className="neshan-map" ref={mapContainerRef} />
        ) : (
          <div className="atlas-fallback" aria-label="Map preview awaiting Neshan web key">
            <span className="atlas-land land-one" />
            <span className="atlas-land land-two" />
            <span className="atlas-road road-one" />
            <span className="atlas-road road-two" />
            <span className="atlas-road road-three" />
            <span className="atlas-road road-four" />
            <span className="atlas-district district-one">YOSEF ABAD</span>
            <span className="atlas-district district-two">TEHRAN</span>
            <span className="atlas-district district-three">VANAK</span>
            {fallbackPins.map((pin) => (
              <span
                key={`${pin.left}-${pin.top}`}
                className="preview-cluster"
                style={{ left: pin.left, top: pin.top, background: pin.color }}
              >
                {pin.count}
              </span>
            ))}
            <span className="preview-pin pin-one" />
            <span className="preview-pin pin-two" />
          </div>
        )}

        <div className="map-status">
          <span className={mapReady ? "status-ready" : ""} />
          {mapError || (webKey
            ? mapReady
              ? `${filteredFeatures.length} places visible`
              : "Loading Neshan map…"
            : "Atlas preview · add your Neshan web key")}
        </div>

        {!webKey && (
          <div className="map-setup-note">
            <p className="eyebrow">READY FOR MATCHED LOCATIONS</p>
            <strong>The atlas is built. Connect Neshan to bring it to life.</strong>
            <span>Add your web key locally, then run the anonymous Neshan enrichment script.</span>
          </div>
        )}

        {selected ? (
          <article className="place-card">
            <button type="button" className="place-close" onClick={() => setSelected(null)} aria-label="Close place details">×</button>
            <p className="eyebrow">{selectedCategoryLabels}</p>
            <h2>{selected.properties.fullName || `@${selected.properties.username}`}</h2>
            <a
              className="username"
              href={selected.properties.instagramUrl ?? `https://instagram.com/${selected.properties.username}`}
              target="_blank"
              rel="noreferrer"
            >
              @{selected.properties.username} ↗
            </a>
            {selected.properties.address && <p className="place-address">{selected.properties.address}</p>}
            <div className="place-actions">
              <a
                href={`https://neshan.org/maps/@${selectedCoords?.[1]},${selectedCoords?.[0]},16z`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Neshan
              </a>
            </div>
          </article>
        ) : collection.features.length > 0 ? (
          <div className="empty-card">
            <span>+</span>
            <p>Select a pin to open its profile and matched public address.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
