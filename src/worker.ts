type HyperdriveBinding = {
  connectionString?: string;
};

export interface Env {
  HYPERDRIVE?: HyperdriveBinding;
  NODE_ENV?: string;
  PROCESS_EVENTS_INLINE?: string;
  CORS_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health/live") {
      return Response.json({
        ok: true,
        runtime: "cloudflare-worker",
        nodeEnv: env.NODE_ENV ?? "unknown",
      });
    }

    if (url.pathname === "/health/hyperdrive") {
      const hyperdriveBound = Boolean(env.HYPERDRIVE?.connectionString);
      return Response.json({
        ok: true,
        hyperdriveBound,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
