import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { ProviderRouterError } from "./lib/provider-router.js";

const app: Express = express();

// gzip compression — cuts RAG payload size 60-70% for mobile users
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    // Don't compress SSE streams — chunked encoding handles that
    if (req.headers.accept === "text/event-stream") return false;
    return compression.filter(req, res);
  },
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Permissive CORS for local development (BYOK headers come from same-origin proxy)
app.use(cors({
  credentials: true,
  origin: (_origin, cb) => cb(null, true),
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  req.log?.error?.({ err }, "Unhandled request error");

  const statusCode =
    err instanceof ProviderRouterError
      ? err.statusCode
      : typeof (err as { statusCode?: unknown })?.statusCode === "number"
        ? ((err as { statusCode: number }).statusCode)
        : typeof (err as { status?: unknown })?.status === "number"
          ? ((err as { status: number }).status)
          : 500;

  const errorCode =
    err instanceof ProviderRouterError
      ? err.code
      : typeof (err as { code?: unknown })?.code === "string"
        ? ((err as { code: string }).code)
        : statusCode >= 500
          ? "internal_error"
          : "request_error";

  const message =
    err instanceof Error && err.message
      ? err.message
      : "Internal server error";

  res.status(statusCode).json({
    error: message,
    code: errorCode,
  });
});

export default app;
