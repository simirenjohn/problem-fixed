import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  LayersControl,
  ScaleControl,
  useMap,
  useMapEvents,
  Polyline,
  Polygon as LPolygon,
  CircleMarker,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  formatArea,
  formatDistance,
  lineDistanceMeters,
  polygonAreaSqMeters,
} from "@/lib/measure";

export type MeasureMode = "none" | "distance" | "area";

type Props = {
  parcels: FeatureCollection<Polygon>;
  showParcels: boolean;
  selectedId: string | null;
  onSelect: (parcelNumber: string) => void;
  flyTo: { lat: number; lng: number; zoom?: number } | null;
  measureMode: MeasureMode;
  measurePoints: Array<[number, number]>;
  onMeasurePoint: (pt: [number, number]) => void;
  onMeasureFinish: () => void;
  gpsPosition: { lat: number; lng: number; accuracy: number } | null;
  pinnedPoint: { lat: number; lng: number; label?: string } | null;
};

const SIANA_CENTER: [number, number] = [-1.552, 35.305];

function FlyHandler({ target }: { target: Props["flyTo"] }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 17, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function GpsHandler({ position }: { position: Props["gpsPosition"] }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.lat, position.lng], 16, { duration: 0.8 });
  }, [position, map]);
  return null;
}

function MeasureClickLayer({
  mode,
  onPoint,
  onFinish,
}: {
  mode: MeasureMode;
  onPoint: (pt: [number, number]) => void;
  onFinish: () => void;
}) {
  useMapEvents({
    click(e) {
      if (mode === "none") return;
      onPoint([e.latlng.lat, e.latlng.lng]);
    },
    dblclick() {
      if (mode !== "none") onFinish();
    },
  });
  return null;
}

export default function MapView({
  parcels,
  showParcels,
  selectedId,
  onSelect,
  flyTo,
  measureMode,
  measurePoints,
  onMeasurePoint,
  onMeasureFinish,
  gpsPosition,
  pinnedPoint,
}: Props) {
  const geoRef = useRef<L.GeoJSON | null>(null);

  // Re-render parcels layer when selection or visibility changes by re-keying
  const geoKey = useMemo(
    () => `${selectedId ?? ""}-${showParcels ? "1" : "0"}`,
    [selectedId, showParcels],
  );

  const measureLine = measureMode === "distance" ? measurePoints : [];
  const measurePoly = measureMode === "area" ? measurePoints : [];

  const distance =
    measureMode === "distance" && measurePoints.length >= 2
      ? lineDistanceMeters(measurePoints)
      : 0;
  const area =
    measureMode === "area" && measurePoints.length >= 3
      ? polygonAreaSqMeters(measurePoints)
      : 0;

  return (
    <MapContainer
      center={SIANA_CENTER}
      zoom={15}
      maxZoom={22}
      doubleClickZoom={measureMode === "none"}
      className="h-full w-full"
      style={{ background: "#0a0a0a" }}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Esri World Imagery">
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={22}
            maxNativeZoom={18}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="OpenStreetMap">
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={22}
            maxNativeZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.Overlay checked name="Reference labels">
          <TileLayer
            attribution="Esri Reference"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={22}
            maxNativeZoom={16}
          />
        </LayersControl.Overlay>
      </LayersControl>

      <ScaleControl position="bottomleft" />

      {showParcels && (
        <GeoJSON
          key={geoKey}
          ref={(r) => {
            geoRef.current = r;
          }}
          data={parcels as FeatureCollection}
          style={(feature) => {
            const pn = feature?.properties?.parcel_number as string | undefined;
            const isSelected = pn === selectedId;
            return {
              color: isSelected ? "#fbbf24" : "#22d3ee",
              weight: isSelected ? 3 : 1.5,
              fillColor: isSelected ? "#fbbf24" : "#22d3ee",
              fillOpacity: isSelected ? 0.25 : 0.1,
            };
          }}
          onEachFeature={(feature, layer) => {
            const pn = feature.properties?.parcel_number;
            if (pn) {
              layer.bindTooltip(String(pn), {
                permanent: false,
                direction: "center",
                className: "parcel-tooltip",
              });
            }
            layer.on({
              click: () => {
                if (measureMode !== "none") return;
                if (pn) onSelect(String(pn));
              },
            });
          }}
        />
      )}

      <MeasureClickLayer
        mode={measureMode}
        onPoint={onMeasurePoint}
        onFinish={onMeasureFinish}
      />

      {measureLine.length >= 1 && (
        <>
          <Polyline positions={measureLine} pathOptions={{ color: "#f97316", weight: 3 }} />
          {measureLine.map((pt, i) => (
            <CircleMarker
              key={i}
              center={pt}
              radius={4}
              pathOptions={{ color: "#f97316", fillColor: "#fff", fillOpacity: 1 }}
            />
          ))}
          {distance > 0 && (
            <CircleMarker
              center={measureLine[measureLine.length - 1]}
              radius={0.1}
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {formatDistance(distance)}
              </Tooltip>
            </CircleMarker>
          )}
        </>
      )}

      {measurePoly.length >= 2 && (
        <>
          <LPolygon
            positions={measurePoly}
            pathOptions={{
              color: "#f97316",
              weight: 2,
              fillColor: "#f97316",
              fillOpacity: 0.15,
            }}
          />
          {measurePoly.map((pt, i) => (
            <CircleMarker
              key={i}
              center={pt}
              radius={4}
              pathOptions={{ color: "#f97316", fillColor: "#fff", fillOpacity: 1 }}
            />
          ))}
          {area > 0 && (
            <CircleMarker
              center={measurePoly[0]}
              radius={0.1}
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]}>
                {formatArea(area)}
              </Tooltip>
            </CircleMarker>
          )}
        </>
      )}

      {gpsPosition && (
        <>
          <CircleMarker
            center={[gpsPosition.lat, gpsPosition.lng]}
            radius={7}
            pathOptions={{
              color: "#3b82f6",
              weight: 2,
              fillColor: "#3b82f6",
              fillOpacity: 0.9,
            }}
          >
            <Tooltip>Your location (±{gpsPosition.accuracy.toFixed(0)} m)</Tooltip>
          </CircleMarker>
        </>
      )}

      {pinnedPoint && (
        <CircleMarker
          center={[pinnedPoint.lat, pinnedPoint.lng]}
          radius={8}
          pathOptions={{
            color: "#a3e635",
            weight: 2,
            fillColor: "#a3e635",
            fillOpacity: 0.9,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>
            {pinnedPoint.label ??
              `${pinnedPoint.lat.toFixed(6)}, ${pinnedPoint.lng.toFixed(6)}`}
          </Tooltip>
        </CircleMarker>
      )}

      <FlyHandler target={flyTo} />
      <GpsHandler position={gpsPosition} />
    </MapContainer>
  );
}

// Helper to find feature by parcel_number
export function findParcel(
  data: FeatureCollection<Polygon>,
  parcelNumber: string,
): Feature<Polygon> | null {
  return (
    (data.features.find(
      (f) => f.properties?.parcel_number === parcelNumber,
    ) as Feature<Polygon> | undefined) ?? null
  );
}

export function featureCenter(f: Feature<Polygon>): { lat: number; lng: number } {
  const ring = f.geometry.coordinates[0];
  let x = 0,
    y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  const n = ring.length;
  return { lat: y / n, lng: x / n };
}