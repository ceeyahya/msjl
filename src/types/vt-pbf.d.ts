declare module "vt-pbf" {
  const vtpbf: {
    fromGeojsonVt(layers: Record<string, unknown>): Uint8Array;
  };

  export default vtpbf;
}
