import { createServer } from "node:http";
import { createDb } from "@webhook-broadcast/db";
import { bootEnv } from "./config.js";
import { createApp } from "./app.js";

const env = bootEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = createApp({
  db,
  operatorApiKey: env.OPERATOR_API_KEY,
  cookieName: env.COOKIE_NAME,
});
const server = createServer(app.callback());

server.listen(env.PORT, () => {
  console.log(JSON.stringify({ msg: "api listening", port: env.PORT }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ msg: "api shutting down", signal }));
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
