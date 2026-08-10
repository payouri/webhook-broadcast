import { createServer } from "node:http";
import { bootEnv } from "./config.js";
import { createApp } from "./app.js";

const env = bootEnv();
const app = createApp();
const server = createServer(app.callback());

server.listen(env.PORT, () => {
  console.log(JSON.stringify({ msg: "api listening", port: env.PORT }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ msg: "api shutting down", signal }));
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
