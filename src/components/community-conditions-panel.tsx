import { useState, type FormEvent } from "react";

import {
  obstacleCategories,
  validateObstacleSubmission,
  type ObstacleSubmission,
  type PersistedObstacleResult,
} from "../current-conditions.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

type SubmissionState =
  | { status: "idle" }
  | { status: "pending"; submission: ObstacleSubmission }
  | { status: "saved"; result: PersistedObstacleResult }
  | { status: "failed"; message: string };

function inputClassName(error = false): string {
  return `mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${error ? "border-destructive" : "border-input"}`;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("Invalid obstacle observation:")) return error.message;
  return "Your observation could not be saved. Check your connection and try again.";
}

export function CommunityConditionsPanel({
  submitObstacle,
}: {
  submitObstacle: (submission: ObstacleSubmission) => Promise<PersistedObstacleResult>;
}) {
  const [state, setState] = useState<SubmissionState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const submission = validateObstacleSubmission({
        category: form.get("category"),
        description: form.get("description"),
        latitude: Number(form.get("latitude")),
        longitude: Number(form.get("longitude")),
        observedAt: form.get("observedAt"),
      });
      setState({ status: "pending", submission });
      const result = await submitObstacle(submission);
      setState({ status: "saved", result });
      formElement.reset();
    } catch (error) {
      setState({ status: "failed", message: failureMessage(error) });
    }
  }

  return (
    <div className="mt-16 grid gap-6 lg:mt-24 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
      <Card>
        <CardHeader>
          <CardTitle><h2>Report an obstacle</h2></CardTitle>
          <CardDescription>
            This creates an immutable community observation. It cannot change the baseline release or score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="text-sm font-medium" htmlFor="obstacle-category">
              Obstacle type
              <select className={inputClassName()} defaultValue="blocked-path" id="obstacle-category" name="category">
                {obstacleCategories.map((category) => <option key={category} value={category}>{category.replace("-", " ")}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium" htmlFor="obstacle-description">
              What did you observe?
              <textarea className={inputClassName()} id="obstacle-description" maxLength={500} name="description" required rows={4} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium" htmlFor="obstacle-latitude">
                Latitude
                <input className={inputClassName()} defaultValue="43.2951" id="obstacle-latitude" inputMode="decimal" name="latitude" required type="number" step="any" />
              </label>
              <label className="text-sm font-medium" htmlFor="obstacle-longitude">
                Longitude
                <input className={inputClassName()} defaultValue="5.3698" id="obstacle-longitude" inputMode="decimal" name="longitude" required type="number" step="any" />
              </label>
            </div>
            <label className="text-sm font-medium" htmlFor="obstacle-observed-at">
              Observed on
              <input className={inputClassName()} id="obstacle-observed-at" name="observedAt" required type="date" />
            </label>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={state.status === "pending"}
              type="submit"
            >
              {state.status === "pending" ? "Saving observation..." : "Submit obstacle observation"}
            </button>
          </form>
        </CardContent>
      </Card>

      <Card aria-live="polite">
        <CardHeader>
          <CardTitle><h2>Submission status</h2></CardTitle>
        </CardHeader>
        <CardContent>
          {state.status === "idle" && <CardDescription>New observations are provisional community evidence until the server assigns them.</CardDescription>}
          {state.status === "pending" && <p role="status">Saving obstacle observation near {state.submission.latitude}, {state.submission.longitude}.</p>}
          {state.status === "failed" && <p className="text-destructive" role="alert">{state.message}</p>}
          {state.status === "saved" && (
            <div className="grid gap-3">
              {"projection" in state.result ? (
                <>
                  <p className="font-medium">Saved and assigned to {state.result.assignment.segmentId}</p>
                  <p className="text-sm text-muted-foreground">Nearest eligible segment, {state.result.assignment.distanceMetres.toFixed(1)} m away.</p>
                  <Badge variant="outline">{state.result.projection.label}</Badge>
                  <p className="text-sm text-muted-foreground">The baseline score is unchanged. This report affects only the separate current condition.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">Saved without a segment assignment</p>
                  <p className="text-sm text-muted-foreground">{state.result.assignment.reason}</p>
                  <p className="text-sm text-muted-foreground">The observation remains available as unmatched evidence and affects no segment.</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
