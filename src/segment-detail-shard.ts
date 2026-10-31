export const segmentDetailShardCount = 256;

export function segmentDetailShard(segmentId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < segmentId.length; index += 1) {
    hash ^= segmentId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 2);
}
