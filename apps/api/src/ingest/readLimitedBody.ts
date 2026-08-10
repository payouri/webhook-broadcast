import type { IncomingMessage } from "node:http";

export class PayloadTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`body exceeds ${limitBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Reads the raw request body straight off the socket, capped at
 * `limitBytes`. Ingest must persist the exact inbound bytes for any content
 * type (ADR 0002), so it deliberately bypasses the JSON/form `@koa/bodyparser`
 * used by admin routes (see `app.ts` mount order) and enforces the byte cap
 * itself rather than trusting a possibly-absent or spoofed `Content-Length`.
 */
export function readLimitedBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > limitBytes) {
        fail(new PayloadTooLargeError(limitBytes));
        req.pause();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (error: Error): void => fail(error);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
