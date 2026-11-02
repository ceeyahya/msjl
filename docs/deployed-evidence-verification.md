# Deployed Evidence Verification

Run this acceptance check against an approved production-like environment. It writes immutable Community Conditions evidence, so do not use the public production release or a shared production database unless the resulting observations are intentional and retained. Use a prepared test Local Accessibility release, an independently published test Context release, and a disposable or explicitly approved PostGIS database.

## Preconditions

- The deployed application has both `VITE_LOCAL_ACCESSIBILITY_RELEASE_URL` and `VITE_NEIGHBORHOOD_CONTEXT_RELEASE_URL` configured.
- The Local Accessibility pointer selects a release prepared with `npm run prepare-current-conditions-release` against the target database.
- The prepared release ID in the target database is exactly the Local Accessibility pointer release ID. Verify this through an approved operator connection before testing; do not expose the connection string or credentials.
- The Context pointer selects a separately published, validated Context release. It must not be a Local Accessibility release or pointer.
- Supabase Realtime is configured for the target database, and two independent browser profiles can open the application. Use separate profiles or browsers so they do not share a session, cache, or in-memory state.
- Choose and record one point within 15 m of an eligible test segment and one point farther than 15 m from every eligible segment. Use distinct descriptive text and the current date so the immutable test observations are identifiable.

## Deterministic Checks

Run these before the deployed-browser check:

```text
VITE_LOCAL_ACCESSIBILITY_RELEASE_URL= VITE_NEIGHBORHOOD_CONTEXT_RELEASE_URL= npm test
npm run typecheck
npm run generate-routes
npm run build
git diff --check
```

Run the persistence suite only with the approved disposable or local database:

```text
npm run test:current-conditions:integration
```

The automated suite covers pointer/manifest identity, release validation, assignment and unmatched preservation, idempotent retry, immutable resolution/reopening history, effective-current derivation, Realtime snapshot reconciliation, and the Local and Context non-map selection paths. It does not prove the deployed environment's credentials, release preparation, WebSocket delivery, or browser accessibility tree.

## Release Identity

In browser A, open the deployed application with the network inspector enabled.

1. Confirm the Local Accessibility `current.json` response identifies a release ID that matches its fetched `manifest.json`.
2. Confirm the Context `context-current.json` response identifies a different Context release ID that matches its fetched `manifest.json`.
3. With an approved database operator connection, query the prepared-release record for the Local pointer release ID. It must return that exact ID and no substitute release ID. For example, substitute the resolved pointer ID into `SELECT release_id FROM prepared_baseline_releases WHERE release_id = '<pointer release ID>';`.
4. Select a Local Accessibility segment through the non-map results and confirm its inspector names the baseline release and its provenance.
5. Select an IRIS area through the Context non-map results and confirm its inspector names `context-policy-v1`, its source records, and population coverage.

Fail the check if either pointer and manifest disagree, the prepared release differs from the Local pointer release, either release is unavailable, or Context appears as a Local Accessibility release.

## Two-Browser Collaboration

Keep browser B open on the same deployed application and Local Accessibility release while browser A performs these steps. In browser B, select Effective Current Local Accessibility and keep the Community Conditions result list visible. After browser A creates the assigned report, select that same segment from browser B's non-map Community Conditions list to inspect its timeline and effective-current result.

1. Before submitting, introduce a response delay of at least three seconds for browser A's report POST using an approved test-environment proxy or browser network rule. Confirm the request is pending before continuing.
2. In browser A, submit the assigned test obstacle. While the delayed request is pending, the submission status announces a pending observation and does not claim a segment assignment. Remove the delay after observing that state.
3. After reconciliation, browser A shows the assigned segment, nearest-assignment distance, provisional community label, and effective-current result. Its immutable baseline score and release remain unchanged.
4. In browser B, without reloading, select the propagated Community Condition from the non-map list. Confirm its active provisional condition, effective-current result, and obstacle timeline entry match browser A. Its live-update status reaches connected, or it recovers via the documented reconnect snapshot path.
5. In browser A, submit a resolution for the reported obstacle. In both browsers, inspect the selected condition and confirm the appended timeline event, inactive/resolved projection, and baseline effective result.
6. In browser A, submit a reopening for that obstacle. In both browsers, confirm all three immutable timeline entries are ordered obstacle, resolution, reopening and the active effective-current result returns.
7. In browser A, submit the deliberately unmatched point. The saved confirmation and Community Conditions view retain its assignment reason. Neither browser attaches it to a segment or changes an effective-current result.

For the report submission, reconciliation response, snapshot refresh, and Realtime subscription, inspect the browser network/debug information and record the `baselineReleaseId`. Each value must equal the Local pointer/manifest/prepared-release ID. The Realtime subscription channel is `current-conditions:<release ID>`; reject the run if it uses a different release ID.

Record the two release IDs, both browser versions, the observation IDs, and any Realtime reconnect delay with the release acceptance evidence. A temporary Realtime outage is not a data-loss pass: confirm the persisted snapshot recovers after reconnection before accepting it.

## Keyboard And Screen Reader

Perform this in one browser using only `Tab`, native select controls, and `Enter` or `Space`; do not use the map.

1. Select each primary layer in turn: Baseline Local Accessibility, Effective Current Local Accessibility, and Neighborhood Context. Confirm the status text names the selected layer and never presents a combined score.
2. In the Local Accessibility results, choose a profile, score band, and evidence status; activate one scored segment and one insufficient-evidence segment; inspect their result, coverage, provenance, and any separate Community Condition evidence.
3. In the Neighborhood Context results, filter by score band and evidence status; activate a scored IRIS area; inspect its policy, three indicators, source records, and population coverage.
4. In Community Conditions, navigate the filters, assigned-condition result, unmatched evidence, report form, and lifecycle timeline. Submit the assigned obstacle, resolution, and reopening without using the map.

With a screen reader, verify every control has its visible label, role, and current value; dynamic result counts and pending/saved messages are announced; errors are announced as alerts; and every selected segment or area inspector has a descriptive heading. Record the browser and screen reader used plus any failed announcement or focus order.

## Acceptance Record

The release acceptance record must include:

- Application URL, Local Accessibility release ID, and Context release ID.
- The prepared Local Accessibility release ID and database environment identifier, without credentials.
- The two browser versions, screen reader where used, observation IDs, and test date.
- Pass/fail outcomes for every step above, including any reconnect delay or unresolved issue.
