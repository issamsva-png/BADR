import app from "./app";
import { logger } from "./lib/logger";

const localDemoMode = process.env.DEMO_MODE_LOCAL === "true";
if (localDemoMode && process.env.NODE_ENV === "production") {
  throw new Error("Local demo mode must not be used in production");
}

const rawPort = process.env["API_PORT"] || process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = localDemoMode
  ? app.listen(port, "127.0.0.1")
  : app.listen(port);
server.once("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
server.once("listening", () => {
  logger.info({ port }, "Server listening");
});
