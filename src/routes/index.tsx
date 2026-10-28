import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";

export const Route = createFileRoute("/")({ component: LocalAccessibility });

function LocalAccessibility() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-16 outline-none sm:px-6 sm:py-28" id="main-content" tabIndex={-1}>
      <section className="max-w-3xl">
        <Badge variant="outline">Mode 01 / baseline release</Badge>
        <h1 className="mt-5 font-heading text-5xl font-medium tracking-tight sm:text-7xl">Local Accessibility</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Street-level baseline evidence for Marseille. Each future result will remain traceable to its release,
          configuration, source, and coverage.
        </p>
      </section>
      <Card className="mt-16 sm:mt-24">
        <CardHeader>
          <Badge className="mb-2" variant="secondary">Current release</Badge>
          <CardTitle id="local-status" className="text-2xl">Local segments are prepared for exploration</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="max-w-xl text-base leading-7">
            The sample baseline release is available. Map and segment inspection arrive in the next Local
            Accessibility ticket.
          </CardDescription>
        </CardContent>
      </Card>
    </main>
  );
}
