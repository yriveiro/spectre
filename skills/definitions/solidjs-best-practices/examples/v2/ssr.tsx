/**
 * Solid 2.0 SSR. Compiled only; not executed.
 *
 * `@solidjs/web` owns the renderer, `onHead` serves a host-owned document,
 * and `clientOnly` keeps a browser-only component off the server.
 */
import {
  clientOnly,
  hydrate,
  HydrationScript,
  isServer,
  render,
  renderToString,
  renderToStream,
} from "@solidjs/web";

function App() {
  return (
    <main>
      <h1>Solid 2.0</h1>
    </main>
  );
}

const MapView = clientOnly(() => import("./Map"), { lazy: true });

export function renderDocument(): string {
  return renderToString(() => (
    <html lang="en">
      <head>
        <HydrationScript />
      </head>
      <body>
        <div id="app">
          <App />
          <MapView fallback={<div class="map-placeholder" />} />
        </div>
      </body>
    </html>
  ));
}

export function renderFragment(): { head: string; body: string } {
  let head = "";
  const body = renderToString(() => <App />, {
    onHead(value) {
      head = value;
    },
  });
  return { head, body };
}

export function streamingResponse(): Response {
  const stream = renderToStream(() => <App />);
  return new Response(stream.readable, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function mountClient(): (() => void) | undefined {
  if (isServer) return undefined;
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app");
  return render(() => <App />, root);
}

export function hydrateClient(): void {
  if (isServer) return;
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app");
  hydrate(() => <App />, root, { renderId: "app" });
}
