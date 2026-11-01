# Citywide Local Accessibility Releases

The citywide Local Accessibility baseline is built outside the web application from a recorded OpenStreetMap snapshot and a versioned scoring configuration. A release is immutable and reproducible: Community Conditions are separate provisional observations and never change a release's scores or artifacts.

## Inputs and Build

The build requires:

- An OpenStreetMap Overpass JSON snapshot.
- `data/citywide/config.json`, the versioned baseline scoring configuration.
- A unique lowercase, hyphenated release ID and an ISO-8601 build time.
- An empty output directory for the generated release.

Fetch a new snapshot only when a baseline source refresh is intended. The fetcher makes controlled sequential requests to public Overpass endpoints:

```text
npm run fetch-citywide-osm -- --output data/citywide/osm-2026-10-30.json
```

Build and validate a release from that exact snapshot:

```text
npm run build-citywide-release -- --input data/citywide/osm-2026-10-30.json --config data/citywide/config.json --output releases/marseille-2026-10-30 --release-id marseille-2026-10-30 --built-at 2026-10-30T00:00:00.000Z
npm run build-release -- releases/marseille-2026-10-30
```

`build-release` checks manifest checksums, the scoring configuration, source records, segment geometry, metrics, and provenance. Do not publish a release if this command fails.

The Docker entrypoint runs the same build command. Mount the snapshot, configuration, and output directories into `/data` and `/releases`:

```text
docker build -t mjsl-release-builder .
docker run --rm -v "$PWD/data:/data" -v "$PWD/releases:/releases" mjsl-release-builder --input /data/citywide/osm-2026-10-30.json --config /data/citywide/config.json --output /releases/marseille-2026-10-30 --release-id marseille-2026-10-30 --built-at 2026-10-30T00:00:00.000Z
```

Scheduled and manually dispatched baseline builds use this workflow. They are deliberately distinct from lightweight Community Conditions writes, which record and project provisional observations without fetching OSM, rebuilding a release, or modifying a baseline score.

## Release Artifacts

Each release includes checksum-validated `config.json`, `sources.json`, and `segments.geojson`, plus citywide viewer artifacts:

- `tiles.json` and vector tiles under `tiles/{z}/{x}/{y}.pbf` for the map. Tiles contain segment identity and profile score/coverage state, not detailed provenance.
- `segment-index.json`, a compact score/evidence index for the accessible non-map result list.
- `segment-details.json`, which declares the deterministic detail-shard template.
- 256 `segment-details/{shard}.json` files containing the metrics, source relations, and geometry used by the calculation inspector.
- `map-segments.geojson`, retained as a legacy fallback for releases made before `segment-index.json`.

Neither baseline map/index artifact contains Community Conditions. The viewer fetches the pointer and manifest once, then loads only viewport vector tiles, the compact non-map index when needed, and the selected detail shard. It must not download the full detailed GeoJSON to render or filter the citywide map.

## Serve and Activate

Publish a complete release under an immutable `releases/<release-id>/` object prefix. Build the web application with `VITE_LOCAL_ACCESSIBILITY_RELEASE_URL` set to the stable public `current.json` URL, never a versioned release URL.

The pointer is a small mutable JSON document. Its `releaseId` must match the referenced release's `manifest.json`; `baseUrl` may be absolute or relative to `current.json`:

```json
{
  "schemaVersion": 1,
  "releaseId": "marseille-2026-10-31",
  "baseUrl": "./releases/marseille-2026-10-31/"
}
```

The application rejects malformed pointers and a pointer whose release ID differs from the manifest. Resolving the pointer occurs when the citywide explorer loads; an already open browser tab does not automatically switch releases.

The static host must:

- Serve the public release prefix and pointer over HTTPS.
- Allow the web application origin to make `GET` and `HEAD` CORS requests.
- Cache versioned release objects with `public, max-age=31536000, immutable`.
- Serve `current.json` with `no-store`.
- Keep the source snapshot archive private.

These are object-storage and CDN requirements, not domain requirements. Any provider with an S3-compatible publication endpoint and a public static origin can meet them.

## Publish and Roll Back

The publisher validates the local release and confirms that the source snapshot's SHA-256 checksum is recorded in `sources.json` before it contacts storage. It uploads the private source snapshot and all immutable release objects, reads the remote manifest back byte-for-byte, then writes `current.json` as the final operation. It refuses a reused release ID or source-snapshot key.

```text
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run publish-citywide-release -- --release releases/marseille-2026-10-31 --source data/citywide/osm-2026-10-31.json --bucket <public-release-bucket> --source-bucket <private-source-bucket> --endpoint https://<s3-compatible-endpoint>
```

Use `--dry-run` to validate the release and report the planned object count and bytes without contacting object storage:

```text
npm run publish-citywide-release -- --release releases/marseille-2026-10-31 --source data/citywide/osm-2026-10-31.json --bucket <public-release-bucket> --source-bucket <private-source-bucket> --endpoint https://<s3-compatible-endpoint> --dry-run
```

Roll back by activating an existing release. The command reads its remote manifest and only replaces `current.json` when the manifest names the requested release:

```text
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run rollback-citywide-release -- --release-id marseille-2026-10-31 --bucket <public-release-bucket> --source-bucket <private-source-bucket> --endpoint https://<s3-compatible-endpoint>
```

The scheduled and manually dispatched GitHub Actions workflow uses the `citywide-release` GitHub Environment. Configure `R2_ENDPOINT`, `R2_RELEASE_BUCKET`, and `R2_SOURCE_BUCKET` as environment variables, plus `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as environment secrets. Do not put credentials in repository files, command history, logs, or release artifacts.

The initial retention policy is no automatic deletion: preserve every published release and source snapshot until a replacement lifecycle policy is adopted. Rollback changes only the pointer; it never overwrites immutable release objects.

## Verification

Run the following before approving a release or a change to its viewer:

```text
npm run build-release -- releases/<release-id>
VITE_LOCAL_ACCESSIBILITY_RELEASE_URL= npm test
npm run typecheck
npm run generate-routes
npm run build
git diff --check
```

The automated suite verifies release checksums and schema, source-snapshot matching, immutable publication ordering, remote-manifest verification, pointer resolution, and cache behavior. It also verifies the citywide keyboard journey: choose a configured profile, filter score band and evidence status, select a result without using the map, and inspect both a valid baseline score and insufficient-evidence segment.

For a published release, additionally check in a production-like browser session that the map requests only viewport tiles, changing filters does not require the full GeoJSON artifact, and selecting a result loads only its relevant detail shard. Confirm that valid baseline scores and insufficient evidence have distinct map, filter, summary, and inspector presentation. Confirm that a provisional Community Condition is labelled as an overlay and does not change the displayed baseline score or release provenance.

The OSM snapshot and generated citywide release are operational artifacts, not checked-in sample data. Preserve each published snapshot with its release so the result can be recreated.
