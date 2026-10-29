import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRouter } from "../src/router.js";

async function renderRoute(pathname: string): Promise<string> {
  const router = getRouter();
  router.update({ history: createMemoryHistory({ initialEntries: [pathname] }) });
  await router.load();

  return renderToString(<RouterProvider router={router} />);
}

describe("analysis modes", () => {
  it("starts on Local Accessibility", async () => {
    const page = await renderRoute("/");

    expect(page).toContain("Local Accessibility");
    expect(page).toContain("Explore release-backed segments");
    expect(page).toContain("Score 78%");
  });

  it.each([
    ["/neighborhood-context", "Neighborhood Context", "No Neighborhood Context release is available yet"],
    ["/community-conditions", "Community Conditions", "Report an obstacle"],
  ])("keeps %s separate from the Local Accessibility baseline", async (pathname, heading, modeContent) => {
    const page = await renderRoute(pathname);

    expect(page).toContain(heading);
    expect(page).toContain(modeContent);
    expect(page).not.toContain("Explore release-backed segments");
  });
});
