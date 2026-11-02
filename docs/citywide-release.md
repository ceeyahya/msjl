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

Before accepting Community Conditions for a published baseline release, prepare its validated artifact in PostGIS. Preparation validates every manifest-declared artifact checksum, records the `segments.geojson` identity and expected eligible-segment count, then bulk-loads only eligible segment geometry. It is idempotent only when both the release identity and count match; it never runs from a browser or request handler.

```text
npm run migrate-current-conditions
npm run prepare-current-conditions-release -- --release-url https://data.example.org/local-accessibility/releases/marseille-2026-10-31/ --expected-eligible-segment-count 97300
```

Use the exact count reported by the validated build. For a local development artifact, replace `--release-url <url>` with `--release <directory>`. An unknown or unprepared release cannot read or write Community Conditions; there is no sample-release fallback. Prepare the release before moving `current.json` to it, and retain its immutable artifacts for rollback.

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

The scheduled and manually dispatched GitHub Actions workflow uses the `citywide-release` GitHub Environment. Configure `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL`, `R2_RELEASE_BUCKET`, and `R2_SOURCE_BUCKET` as environment variables, plus `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and the least-privileged PostGIS `DATABASE_URL` as environment secrets. The workflow uploads immutable artifacts, prepares the published release in PostGIS, and only then switches `current.json`. Do not put credentials in repository files, command history, logs, or release artifacts.

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

## Neighborhood Context Releases

Neighborhood Context is a separate IRIS-scale evidence product. It never consumes a Local Accessibility score, changes a baseline release, or publishes through `current.json`.

`context-policy-v1` fixes the 2022-01-01 INSEE IRIS geography, Filosofi 2021 material-pressure thresholds, Tuesday-Thursday 07:00-20:00 RTM departure window, qualifying civic/free-service categories, 95% pedestrian-network population coverage gate, and equal-weight geometric mean. A policy change requires a new immutable policy ID and comparability record.

Before a quarterly build, collect and retain the six required source snapshots: INSEE IRIS boundaries, Filosofi, RTM GTFS, authoritative civic-service register, INSEE population grid, and the OSM pedestrian-network extract. `sources.json` must record each source URL, retrieval time, version, licence, and SHA-256 checksum. The builder accepts only already population-weighted IRIS aggregates; each available material-pressure value must carry `qualifyingNote: 0` for `DISP_NOTE21`. It does not infer Context values from Local Accessibility data.

```text
npm run build-neighborhood-context-release -- --areas data/context/iris-2026-q4.geojson --config data/context/context-policy-v1.json --sources data/context/sources-2026-q4.json --source-directory data/context/snapshots-2026-q4 --output releases/marseille-context-2026-q4 --release-id marseille-context-2026-q4 --built-at 2026-11-02T00:00:00.000Z
npm run validate-neighborhood-context-release -- releases/marseille-context-2026-q4
```

The generated release contains checksum-validated configuration, provenance, complete IRIS GeoJSON, polygon vector tiles, a compact `area-index.json`, and deterministic detail shards. The browser loads the pointer, manifest, configuration, source records, TileJSON, and compact index, then fetches only the selected IRIS detail shard.

Publish the checksum-verified source files from `sources.json`, then publish and activate the independent `context-current.json` pointer.

```text
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run publish-neighborhood-context-release -- --release releases/marseille-context-2026-q4 --source-directory data/context/snapshots-2026-q4 --bucket <public-release-bucket> --source-bucket <private-source-bucket> --endpoint https://<s3-compatible-endpoint>
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run rollback-neighborhood-context-release -- --release-id marseille-context-2026-q4 --bucket <public-release-bucket> --source-bucket <private-source-bucket> --endpoint https://<s3-compatible-endpoint>
```

The Context publisher uses `context-releases/<release-id>/`, `context-sources/<release-id>/`, and `context-current.json`, so it cannot activate or roll back a Local Accessibility release. Set `VITE_NEIGHBORHOOD_CONTEXT_RELEASE_URL` to the public `context-current.json` URL to expose the validated release in the application.
