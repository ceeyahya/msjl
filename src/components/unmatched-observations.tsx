import type { UnmatchedConditionObservation } from "../current-conditions.js";

export function UnmatchedObservations({ observations }: { observations: UnmatchedConditionObservation[] }) {
  if (observations.length === 0) return null;

  return (
    <section aria-labelledby="unmatched-observations-heading" className="mt-6 rounded-xl border p-6">
      <h2 className="text-lg font-medium" id="unmatched-observations-heading">Unmatched community evidence</h2>
      <p className="mt-2 text-sm text-muted-foreground">These reports remain visible but do not create a segment overlay.</p>
      <ol className="mt-4 grid gap-3 text-sm">
        {observations.map((observation) => (
          <li key={observation.id}>
            <p className="font-medium">{observation.description}</p>
            <p className="text-muted-foreground">Observed {observation.observedAt}. {observation.assignment.reason}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
