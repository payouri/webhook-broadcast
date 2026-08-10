export interface StructuredLogFields {
  msg: string;
  requestId?: string;
  channelId?: string;
  broadcastId?: string;
  deliveryId?: string;
  endpointId?: string;
  result?: string;
  durationMs?: number;
  statusCode?: number | null;
  deliveryCount?: number;
}

/** Structured JSON logs to stdout (ADR 0009). Never pass bodies, tokens, or auth headers. */
export function logStructured(fields: StructuredLogFields): void {
  const payload = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  console.log(JSON.stringify(payload));
}
