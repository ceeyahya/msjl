import { createFileRoute } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { PublishedNeighborhoodContextExplorer } from "../components/neighborhood-context-explorer.js";
export const Route = createFileRoute("/neighborhood-context")({ component: NeighborhoodContext });

function NeighborhoodContext() {
  const pointerUrl = import.meta.env.VITE_NEIGHBORHOOD_CONTEXT_RELEASE_URL;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-16 outline-none sm:px-6 sm:py-28" id="main-content" tabIndex={-1}>
      <section className="max-w-3xl">
        <Badge variant="outline">Mode 02 / area-scale evidence</Badge>
        <h1 className="mt-5 font-heading text-5xl font-medium tracking-tight sm:text-7xl">Neighborhood Context</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Contextual evidence belongs to IRIS and neighborhood-scale areas, not to individual street segments.
        </p>
      </section>
      {pointerUrl ? <PublishedNeighborhoodContextExplorer pointerUrl={pointerUrl} /> : <Card className="mt-16 sm:mt-24">
        <CardHeader>
          <CircleAlert aria-hidden="true" className="mb-2 size-5 text-muted-foreground" />
          <CardTitle id="context-status" className="text-2xl">No Neighborhood Context release is available yet</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="max-w-xl text-base leading-7">
            This mode does not reuse or infer a score from Local Accessibility. It will appear only with its own
            versioned area-scale evidence.
          </CardDescription>
        </CardContent>
      </Card>}
    </main>
  );
}
