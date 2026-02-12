import { Hono, type Context } from "hono";

type HyperdriveBinding = {
  connectionString?: string;
};

type WorkerBindings = {
  HYPERDRIVE?: HyperdriveBinding;
  NODE_ENV?: string;
  PROCESS_EVENTS_INLINE?: string;
  CORS_ORIGINS?: string;
};

type WorkerVariables = {
  requestId: string;
};

type AppEnv = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};

const app = new Hono<AppEnv>();

function parseAllowedOrigins(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function applyCorsHeaders(c: Context<AppEnv>): void {
  const origin = c.req.header("origin");
  if (!origin) {
    return;
  }

  const normalizedOrigin = origin.replace(/\/+$/, "");
  const allowedOrigins = parseAllowedOrigins(c.env.CORS_ORIGINS);
  if (!allowedOrigins.includes(normalizedOrigin)) {
    return;
  }

  c.header("Access-Control-Allow-Origin", normalizedOrigin);
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,X-Request-Id,X-Observability-Token"
  );
  c.header("Access-Control-Expose-Headers", "X-Request-Id");
  c.header("Access-Control-Max-Age", "86400");
  c.header("Vary", "Origin");
}

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  c.set("requestId", requestId);

  if (c.req.method === "OPTIONS") {
    applyCorsHeaders(c);
    c.header("x-request-id", requestId);
    return c.body(null, 204);
  }

  await next();
  applyCorsHeaders(c);
  c.header("x-request-id", requestId);
});

function buildHealthPayload(c: Context<AppEnv>) {
  return {
    status: "ok",
    runtime: "cloudflare-worker",
    nodeEnv: c.env.NODE_ENV ?? "unknown",
    processEventsInline: c.env.PROCESS_EVENTS_INLINE === "true",
    requestId: c.get("requestId")
  };
}

app.get("/health/live", (c) => {
  return c.json(buildHealthPayload(c));
});

app.get("/health/hyperdrive", (c) => {
  const hyperdriveBound = Boolean(c.env.HYPERDRIVE?.connectionString);
  return c.json({
    ...buildHealthPayload(c),
    hyperdriveBound
  });
});

app.get("/health/ready", (c) => {
  const hyperdriveBound = Boolean(c.env.HYPERDRIVE?.connectionString);
  if (!hyperdriveBound) {
    return c.json(
      {
        status: "degraded",
        runtime: "cloudflare-worker",
        database: "down",
        requestId: c.get("requestId")
      },
      503
    );
  }

  return c.json({
    ...buildHealthPayload(c),
    database: "up"
  });
});

app.get("/health", (c) => {
  return c.json(buildHealthPayload(c));
});

app.get("/api/v1/health/live", (c) => c.json(buildHealthPayload(c)));
app.get("/api/v1/health/ready", (c) => {
  const hyperdriveBound = Boolean(c.env.HYPERDRIVE?.connectionString);
  if (!hyperdriveBound) {
    return c.json(
      {
        status: "degraded",
        runtime: "cloudflare-worker",
        database: "down",
        requestId: c.get("requestId")
      },
      503
    );
  }
  return c.json({
    ...buildHealthPayload(c),
    database: "up"
  });
});
app.get("/api/v1/health", (c) => c.json(buildHealthPayload(c)));

app.all("/api/v1/*", (c) => {
  return c.json(
    {
      error: "Cloudflare migration phase 1 active: route not migrated yet",
      code: "NOT_MIGRATED",
      path: c.req.path,
      requestId: c.get("requestId")
    },
    501
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      requestId: c.get("requestId")
    },
    404
  );
});

export default app;
