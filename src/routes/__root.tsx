import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { cn } from "../lib/utils.js";
import appCss from "../styles.css?url";

const modes = [
  { to: "/", label: "Local Accessibility", description: "Street segments" },
  { to: "/neighborhood-context", label: "Neighborhood Context", description: "Area-scale evidence" },
  { to: "/community-conditions", label: "Community Conditions", description: "Public observations" },
] as const;

const modeLinkClasses =
  "group flex min-h-18 flex-col justify-center gap-1 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring sm:border-r sm:border-b-0 sm:last:border-r-0";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MJSL | Marseille accessibility evidence" },
      {
        name: "description",
        content: "A reproducible accessibility evidence demonstrator for Marseille.",
      },
    ],
    links: appCss ? [{ rel: "stylesheet", href: appCss }] : [],
  }),
  shellComponent: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          className="fixed top-4 left-4 z-50 -translate-y-24 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          href="#main-content"
        >
          Skip to content
        </a>
        <header className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6">
          <div className="flex items-center justify-between gap-4 py-3">
            <Link className="inline-flex items-center gap-3 rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" to="/">
              <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-primary font-heading text-lg text-primary-foreground">M</span>
              <span>
                <strong className="block font-heading text-base font-medium tracking-tight">MJSL</strong>
                <small className="block text-xs text-muted-foreground">Marseille evidence atlas</small>
              </span>
            </Link>
            <p className="max-w-36 text-right text-xs text-muted-foreground">Free-tier research demonstrator</p>
          </div>
          <nav aria-label="Analysis modes" className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card sm:grid-cols-3">
            {modes.map((mode) => (
              <Link
                activeProps={{ className: cn(modeLinkClasses, "bg-primary text-primary-foreground hover:bg-primary") }}
                className={modeLinkClasses}
                key={mode.to}
                to={mode.to}
              >
                <span>{mode.label}</span>
                <small className="text-xs text-muted-foreground group-[.bg-primary]:text-primary-foreground/70">{mode.description}</small>
              </Link>
            ))}
          </nav>
        </header>
        <Outlet />
        <footer className="mx-auto w-full max-w-6xl border-t px-4 py-6 text-xs text-muted-foreground sm:px-6">
          Baseline evidence, neighborhood context, and community conditions are intentionally separate.
        </footer>
        <Scripts />
      </body>
    </html>
  );
}
