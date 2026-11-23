import handler from "@tanstack/react-start/server-entry";
import { runEdgeLiveSync } from "./lib/server/live-sync";

export default {
  fetch: handler.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      runEdgeLiveSync(env)
        .then((summary) => {
          console.log(
            JSON.stringify({
              level: "info",
              event: "abstract_live_sync",
              ...summary,
            }),
          );
        })
        .catch((err: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              event: "abstract_live_sync_failed",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }),
    );
  },
};
