import { useState, type FormEvent } from "react";

import type { ConditionEventSubmission, CurrentCondition, PersistedConditionEventResult } from "../current-conditions.js";
import { Badge } from "./ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

function inputClassName(): string {
  return "mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
}

function eventLabel(eventType: "obstacle" | "resolution" | "reopening"): string {
  return eventType === "obstacle" ? "Obstacle reported" : eventType === "resolution" ? "Resolution reported" : "Reopening reported";
}

export function ConditionLifecyclePanel({
  conditions,
  onSaved,
  submitConditionEvent,
}: {
  conditions: CurrentCondition[];
  onSaved: (result: PersistedConditionEventResult) => void;
  submitConditionEvent: (submission: ConditionEventSubmission) => Promise<PersistedConditionEventResult>;
}) {
  const [message, setMessage] = useState<string>();
  const [hasError, setHasError] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<ConditionEventSubmission>();
  const [failedSubmission, setFailedSubmission] = useState<ConditionEventSubmission>();
  const obstacles = conditions.flatMap((condition) => condition.observations
    .filter((observation) => observation.eventType === "obstacle")
    .map((observation) => ({ observation, segmentId: condition.projection.segmentId })));

  async function saveEvent(submission: ConditionEventSubmission, formElement?: HTMLFormElement) {
    setPendingSubmission(submission);
    setFailedSubmission(undefined);
    setHasError(false);
    setMessage(`Pending ${eventLabel(submission.eventType).toLowerCase()}. The server has not updated the provisional condition yet.`);
    try {
      const result = await submitConditionEvent(submission);
      onSaved(result);
      setPendingSubmission(undefined);
      setHasError(false);
      setMessage(`${eventLabel(result.observation.eventType)} was saved as provisional community evidence.`);
      formElement?.reset();
    } catch (error) {
      setPendingSubmission(undefined);
      setFailedSubmission(submission);
      setHasError(true);
      setMessage(error instanceof Error && error.message.startsWith("Invalid condition event:")
        ? error.message
        : "This event could not be saved. Check the selected obstacle and try again.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await saveEvent({
      clientRequestId: crypto.randomUUID(),
      eventType: form.get("eventType") === "reopening" ? "reopening" : "resolution",
      obstacleObservationId: String(form.get("obstacleObservationId")),
      description: String(form.get("description")).trim(),
      observedAt: String(form.get("observedAt")),
    }, formElement);
  }

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
      <Card>
        <CardHeader>
          <CardTitle><h2>Report a change</h2></CardTitle>
          <CardDescription>Append a provisional resolution or reopening observation. Published evidence remains unchanged.</CardDescription>
        </CardHeader>
        <CardContent>
          {obstacles.length === 0 ? <p className="text-sm text-muted-foreground">No assigned obstacle observations are available to reference.</p> : (
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <label className="text-sm font-medium" htmlFor="condition-event-type">
                Change type
                <select className={inputClassName()} defaultValue="resolution" id="condition-event-type" name="eventType">
                  <option value="resolution">Resolution reported</option>
                  <option value="reopening">Reopening reported</option>
                </select>
              </label>
              <label className="text-sm font-medium" htmlFor="condition-event-obstacle">
                Referenced obstacle
                <select className={inputClassName()} id="condition-event-obstacle" name="obstacleObservationId">
                  {obstacles.map(({ observation, segmentId }) => (
                    <option key={observation.id} value={observation.id}>{segmentId}: {observation.description}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium" htmlFor="condition-event-description">
                What did you observe?
                <textarea className={inputClassName()} id="condition-event-description" maxLength={500} name="description" required rows={3} />
              </label>
              <label className="text-sm font-medium" htmlFor="condition-event-observed-at">
                Observed on
                <input className={inputClassName()} id="condition-event-observed-at" name="observedAt" required type="date" />
              </label>
               <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={pendingSubmission !== undefined} type="submit">
                 {pendingSubmission ? "Saving change observation..." : "Save change observation"}
               </button>
             </form>
           )}
          {message ? <p className="mt-4 text-sm" role={hasError ? "alert" : "status"}>{message}</p> : null}
          {failedSubmission ? <button className="mt-3 min-h-11 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" onClick={() => { void saveEvent(failedSubmission); }} type="button">Try saving again</button> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><h2>Community evidence timeline</h2></CardTitle>
          <CardDescription>Ordered, immutable provisional evidence for each assigned segment.</CardDescription>
        </CardHeader>
        <CardContent>
          {conditions.length === 0 ? <p className="text-sm text-muted-foreground">No condition evidence is available.</p> : (
            <div className="grid gap-5">
              {conditions.map((condition) => (
                <section key={condition.projection.segmentId} aria-labelledby={`timeline-${condition.projection.segmentId}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium" id={`timeline-${condition.projection.segmentId}`}>{condition.projection.segmentId}</h3>
                    <Badge variant="outline">{condition.projection.active ? "Provisional active condition" : "No active provisional condition"}</Badge>
                  </div>
                  <ol className="mt-3 grid gap-3 border-l pl-4 text-sm">
                    {condition.observations.map((observation) => (
                      <li key={observation.id}>
                        <p className="font-medium">{eventLabel(observation.eventType)}</p>
                        <p>{observation.description}</p>
                        <p className="text-muted-foreground">Observed {observation.observedAt}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
