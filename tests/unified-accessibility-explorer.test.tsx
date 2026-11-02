// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/citywide-local-accessibility-explorer.js", () => ({
  PublishedCitywideAccessibilityExplorer: ({ primaryScoreLayer }: { primaryScoreLayer?: string }) => <p>Local explorer: {primaryScoreLayer ?? "baseline"}</p>,
}));

vi.mock("../src/components/neighborhood-context-explorer.js", () => ({
  PublishedNeighborhoodContextExplorer: () => <p>Context explorer</p>,
}));

import { UnifiedAccessibilityExplorer } from "../src/components/unified-accessibility-explorer.js";

afterEach(cleanup);

describe("UnifiedAccessibilityExplorer", () => {
  it("switches explicit primary evidence layers through native radio controls without presenting an aggregate", async () => {
    const user = userEvent.setup();
    render(<UnifiedAccessibilityExplorer contextPointerUrl="https://data.example/context-current.json" localAccessibilityPointerUrl="https://data.example/local-current.json" refreshConditions={async () => ({ conditions: [], unmatchedObservations: [] })} />);

    expect((screen.getByRole("radio", { name: /baseline local accessibility/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Local explorer: baseline")).toBeTruthy();
    expect(screen.getByText(/does not calculate a combined/i)).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /effective current local accessibility/i }));
    expect((screen.getByRole("radio", { name: /effective current local accessibility/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Local explorer: effective-current")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /neighborhood context/i }));
    expect((screen.getByRole("radio", { name: /neighborhood context/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Context explorer")).toBeTruthy();
    expect(screen.getByText("Local explorer: baseline")).toBeTruthy();
  });
});
