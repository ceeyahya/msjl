import { createFileRoute } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
export const Route = createFileRoute("/community-conditions")({ component: CommunityConditions });

function CommunityConditions() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-16 outline-none sm:px-6 sm:py-28" id="main-content" tabIndex={-1}>
      <section className="max-w-3xl">
        <Badge variant="outline">Mode 03 / public observations</Badge>
        <h1 className="mt-5 font-heading text-5xl font-medium tracking-tight sm:text-7xl">Community Conditions</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Community observations are a separate public condition layer. They never alter the baseline score in this
          demonstrator.
        </p>
      </section>
      <Card className="mt-16 sm:mt-24">
        <CardHeader>
          <CircleAlert aria-hidden="true" className="mb-2 size-5 text-muted-foreground" />
          <CardTitle id="community-status" className="text-2xl">No Community Conditions release is available yet</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="max-w-xl text-base leading-7">
            No reports, resolutions, or inferred status are shown here. Community evidence will be introduced as
            immutable observations in a dedicated release.
          </CardDescription>
        </CardContent>
      </Card>
    </main>
  );
}
