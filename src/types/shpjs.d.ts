declare module "shpjs" {
  import type { FeatureCollection } from "geojson";
  const shp: (
    input: ArrayBuffer | string | Uint8Array,
  ) => Promise<FeatureCollection | FeatureCollection[]>;
  export default shp;
}