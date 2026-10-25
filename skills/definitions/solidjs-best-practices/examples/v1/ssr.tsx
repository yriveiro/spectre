/**
 * Solid 1.9 SSR. Compiled only; not executed.
 *
 * `HydrationScript` belongs once in the document head. The client entry calls
 * `hydrate`, not `render`, when the root already holds server HTML.
 */
import {
  HydrationScript,
  hydrate,
  isServer,
  render,
  renderToStream,
  renderToString,
} from "solid-js/web";

function App() {
  return (
    <main>
      <h1>Solid 1.9</h1>
    </main>
  );
}

export function renderDocument(): string {
  return renderToString(
    () => (
      <html lang="en">
        <head>
          <HydrationScript />
        </head>
        <body>
          <div id="app">
            <App />
          </div>
        </body>
      </html>
    ),
    { nonce: "nonce-value", renderId: "app" },
  );
}

export function streamDocument(): string {
  const chunks: string[] = [];
  renderToStream(() => <App />).pipe({
    write: (chunk) => {
      chunks.push(chunk);
    },
  });
  return chunks.join("");
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
