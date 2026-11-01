# Reactive Current Conditions

## Decision

Keep the versioned baseline release as the authoritative open/official-data result. Add a separate reactive current-conditions plane for community observations.

An obstacle report updates the submitting browser optimistically, is persisted, matched to eligible segments, and derives a provisional effective-current local result for only the affected segments. It never overwrites the baseline release or its score.

See `docs/architecture/reactive-current-conditions.html` for the architecture delta diagram.

## Initial Deployment

| Responsibility | Initial location | Reason |
| --- | --- | --- |
| Web application and lightweight report API | Cloudflare | Serves the TanStack Start application and handles lightweight request/response work. |
| Reactive database | Supabase Free | Hosted standard PostgreSQL with PostGIS and Realtime. |
| Cross-browser updates | Supabase Realtime | Broadcasts persisted observation changes to other open clients over WebSockets. |
| Baseline artifacts | Object storage/CDN | Stores versioned segment data, tiles, manifests, and source artifacts. |
| Heavy baseline build | Docker CLI on local machine or GitHub Actions | Performs ingestion, segment construction, full-city scoring, tiles, and routing artifacts outside request handlers. |

The Docker CLI is one portable command. Developers can run it locally against local Docker Compose services. The scheduled/manual production build runs the same command in GitHub Actions. It must not run in Cloudflare Workers or in a browser.

## Supabase Free Constraints

Supabase Free is appropriate for the current two-user prototype because it provides:

- A dedicated PostgreSQL database with PostGIS available.
- 500 MB database storage per project.
- 1 GB file storage and 5 GB monthly egress.
- Realtime database-change subscriptions.
- Two active free projects.

It is not a production uptime commitment. Free projects can be paused after approximately seven days of low activity. A paused project requires manual resumption from the Supabase dashboard. No automatic keep-alive should be used to evade this limit.

If reliable public availability becomes a requirement, migrate the standard PostgreSQL/PostGIS schema and application configuration to a paid managed database or a VPS. This is an operational migration, not a rewrite of scoring, report, or map domain logic.

## Reactive Write Path

1. The browser creates an immutable obstacle observation and immediately shows it locally.
2. The API validates and persists it in Supabase Postgres.
3. PostGIS assigns the point to the nearest eligible segment within the configured threshold; unmatched reports remain stored with their reason.
4. The current-condition scorer derives the assigned segment's provisional community barrier from active category-and-severity observations, then recalculates the effective-current local result from the immutable baseline dimensions. It stores the policy version and impact breakdown.
5. The API persists the derived current-condition projection.
6. Supabase Realtime broadcasts the persisted report/projection change.
7. All open clients update their existing MapLibre sources. They do not rebuild the map or download a new baseline release.

The browser's optimistic result is reconciled with the persisted server result. The server calculation is authoritative.

## Boundaries

- Baseline rebuilds are full GIS/data-pipeline jobs, scheduled or manually invoked.
- Report writes are small, bounded database operations.
- A report affects an explicitly labelled, versioned effective-current local score only. The immutable baseline score remains visible and unchanged.
- Dynamic conditions must retain observation provenance and must be reversible by later resolution or reopening observations.
- Domain code relies on standard PostgreSQL/PostGIS contracts rather than Supabase-specific business logic. Supabase Realtime is an infrastructure adapter, replaceable by another change-feed implementation.
