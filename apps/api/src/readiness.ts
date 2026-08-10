import type { Pool } from "pg";
import type { DeliveryQueue } from "./deliveryQueue.js";

export type ReadinessCheckStatus = "ok" | "fail";

export type ReadinessChecks = {
  postgres: ReadinessCheckStatus;
  redis: ReadinessCheckStatus;
};

export async function checkReadiness(deps: {
  pool: Pool;
  deliveryQueue: DeliveryQueue;
}): Promise<ReadinessChecks> {
  const [postgres, redis] = await Promise.all([
    checkPostgres(deps.pool),
    checkRedis(deps.deliveryQueue),
  ]);
  return { postgres, redis };
}

async function checkPostgres(pool: Pool): Promise<ReadinessCheckStatus> {
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "fail";
  }
}

async function checkRedis(deliveryQueue: DeliveryQueue): Promise<ReadinessCheckStatus> {
  try {
    await deliveryQueue.ping();
    return "ok";
  } catch {
    return "fail";
  }
}
