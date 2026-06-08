import "dotenv/config";
import { normalizeApiKeys } from "./lib/normalize-keys.js";
normalizeApiKeys();

import app from "./app.js";
import { logger } from "./lib/logger.js";

const rawPort = process.env["PORT"] || "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening on 0.0.0.0");
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
