import { Plugin } from "@opencode/plugin/tui";
import {
  artifactCommands,
  createArtifactsController,
  makeClientArtifactStore,
} from "./artifacts/index.ts";
import { registerRouting } from "./routing/controller.tsx";
import { directoryOf } from "./routing/data.ts";
import { registerSubagents } from "./subagents/index.tsx";
import { registerTools } from "./tools/index.tsx";

/**
 * The TUI entrypoint. It owns no feature logic: every surface lives in its
 * feature folder (`routing/`, `tools/`, `subagents/`, `artifacts/`) and this
 * file only wires them to the host context, in registration order.
 */

export const opener = (
  open: () => void,
  openArtifacts: () => void = () => {},
  openGallery: () => void = () => {},
) => ({
  mode: "global" as const,
  commands: [
    {
      id: "spectre.routing.open",
      title: "Routing",
      description: "Open the page that configures model routing",
      group: "Spectre",
      palette: true as const,
      slash: { name: "routing" } as const,
      run: open,
    },
    ...artifactCommands(openArtifacts, openGallery),
  ],
});

export default Plugin.define({
  id: "spectre.ui",
  setup: async (context) => {
    const routeSession = (): string | undefined => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };

    const routing = registerRouting(context);

    const stopTools = registerTools(context);

    const stopSubagents = registerSubagents(context);

    const artifacts = createArtifactsController({
      store: makeClientArtifactStore({
        client: context.client,
        sessionTitle: (sessionID) => context.data.session.get(sessionID)?.title,
        projects: () =>
          context.data.project.list().map((project) => ({
            id: project.id,
            canonical: project.canonical,
            name: project.name,
            vcs: project.vcs,
            activeAt: project.time.active,
          })),
        sessions: () =>
          context.data.session.list().map((session) => ({
            id: session.id,
            directory: session.location.directory,
            projectID: session.projectID,
            title: session.title,
          })),
      }),
      dialog: context.ui.dialog,
      toast: context.ui.toast,
      formatPath: (value) => context.ui.format.path(value),
      resolveContext: () => {
        const sessionID = routeSession();
        return {
          directory: directoryOf({
            sessionID,
            session: (id) => context.data.session.get(id),
            route: context.ui.router.current(),
            location: context.location,
            fallback: context.data.location.default().directory,
          }),
          sessionID,
        };
      },
    });

    context.keymap.layer(() =>
      opener(
        routing.open,
        () => {
          void artifacts.openModal();
        },
        () => {
          void artifacts.openGallery();
        },
      ),
    );

    return () => {
      stopSubagents();
      stopTools();
      routing.stop();
      artifacts.dispose();
    };
  },
});
