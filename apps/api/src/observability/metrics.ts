import type { Queue } from "bullmq";
import type { DeliveryWorkItem } from "../deliveryQueue.js";

export const METRIC_NAMES = {
  ingestAccepted: "wb_ingest_accepted_total",
  attemptDuration: "wb_attempt_duration_seconds",
  attemptResults: "wb_attempt_results_total",
  queueDepth: "wb_queue_depth",
  workerConcurrency: "wb_worker_concurrency",
} as const;

export type AttemptResultClass = "succeeded" | "failed" | "dead_lettered" | "retry";

const ATTEMPT_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

class CounterMetric {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly labelNames: string[] = [],
    private readonly values = new Map<string, number>(),
  ) {}

  inc(labels?: Record<string, string>, by = 1): void {
    if (this.labelNames.length === 0) {
      this.value += by;
      return;
    }
    const key = labelKey(labels ?? {});
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.labelNames.length === 0) {
      lines.push(`${this.name} ${this.value}`);
      return `${lines.join("\n")}\n`;
    }
    for (const [key, value] of this.values) {
      lines.push(`${this.name}{${key}} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

class GaugeMetric {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly labelNames: string[] = [],
    private readonly values = new Map<string, number>(),
  ) {}

  set(labels: Record<string, string> | number, value?: number): void {
    if (typeof labels === "number") {
      this.value = labels;
      return;
    }
    const key = labelKey(labels);
    this.values.set(key, value ?? 0);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.labelNames.length === 0) {
      lines.push(`${this.name} ${this.value}`);
      return `${lines.join("\n")}\n`;
    }
    for (const [key, value] of this.values) {
      lines.push(`${this.name}{${key}} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

class HistogramMetric {
  private readonly sums = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  private readonly buckets = new Map<string, Map<number, number>>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly bucketUpperBounds: number[],
  ) {}

  observe(value: number): void {
    const key = "";
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const bucketCounts = this.buckets.get(key) ?? new Map<number, number>();
    for (const upper of this.bucketUpperBounds) {
      if (value <= upper) {
        bucketCounts.set(upper, (bucketCounts.get(upper) ?? 0) + 1);
      }
    }
    bucketCounts.set(
      Number.POSITIVE_INFINITY,
      (bucketCounts.get(Number.POSITIVE_INFINITY) ?? 0) + 1,
    );
    this.buckets.set(key, bucketCounts);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, count] of this.counts) {
      const labelPrefix = key ? `${key},` : "";
      const bucketCounts = this.buckets.get(key) ?? new Map<number, number>();
      for (const upper of this.bucketUpperBounds) {
        lines.push(
          `${this.name}_bucket{${labelPrefix}le="${upper}"} ${bucketCounts.get(upper) ?? 0}`,
        );
      }
      lines.push(
        `${this.name}_bucket{${labelPrefix}le="+Inf"} ${bucketCounts.get(Number.POSITIVE_INFINITY) ?? 0}`,
      );
      const metricLabels = key ? `{${key}}` : "";
      lines.push(`${this.name}_sum${metricLabels} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count${metricLabels} ${count}`);
    }
    if (this.counts.size === 0) {
      for (const upper of this.bucketUpperBounds) {
        lines.push(`${this.name}_bucket{le="${upper}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
    }
    return `${lines.join("\n")}\n`;
  }
}

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([name, value]) => `${name}="${value}"`)
    .join(",");
}

/**
 * App Prometheus series (ADR 0009) — one collector per process so API and
 * worker each expose their own `/metrics` scrape target.
 */
export class MetricsCollector {
  readonly ingestAcceptedTotal: CounterMetric;
  readonly attemptDurationSeconds: HistogramMetric;
  readonly attemptResultsTotal: CounterMetric;
  readonly queueDepth: GaugeMetric;
  readonly workerConcurrency: GaugeMetric;

  constructor() {
    this.ingestAcceptedTotal = new CounterMetric(
      METRIC_NAMES.ingestAccepted,
      "Ingest requests accepted (counted before the per-Channel success status is chosen, so 200/201/202/204 all land here)",
    );
    this.attemptDurationSeconds = new HistogramMetric(
      METRIC_NAMES.attemptDuration,
      "Attempt HTTP duration in seconds",
      ATTEMPT_DURATION_BUCKETS,
    );
    this.attemptResultsTotal = new CounterMetric(
      METRIC_NAMES.attemptResults,
      "Attempt outcomes by status class",
      ["result"],
    );
    this.queueDepth = new GaugeMetric(METRIC_NAMES.queueDepth, "Delivery queue depth by state", [
      "state",
    ]);
    this.workerConcurrency = new GaugeMetric(
      METRIC_NAMES.workerConcurrency,
      "Configured BullMQ worker concurrency",
    );
  }

  recordAttempt(result: AttemptResultClass, durationMs: number): void {
    this.attemptResultsTotal.inc({ result });
    this.attemptDurationSeconds.observe(durationMs / 1000);
  }

  renderAppMetrics(): string {
    return [
      this.ingestAcceptedTotal.render(),
      this.attemptDurationSeconds.render(),
      this.attemptResultsTotal.render(),
      this.queueDepth.render(),
      this.workerConcurrency.render(),
    ].join("");
  }

  /** BullMQ export plus app series; queue depth refreshed on each scrape. */
  async render(queue?: Queue<DeliveryWorkItem>): Promise<string> {
    if (queue) {
      const counts = await queue.getJobCounts("waiting", "active", "failed");
      this.queueDepth.set({ state: "waiting" }, counts.waiting ?? 0);
      this.queueDepth.set({ state: "active" }, counts.active ?? 0);
      this.queueDepth.set({ state: "failed" }, counts.failed ?? 0);
    }

    const appMetrics = this.renderAppMetrics();
    if (!queue) {
      return appMetrics;
    }
    const bullmqMetrics = await queue.exportPrometheusMetrics();
    return `${appMetrics}${bullmqMetrics}`;
  }
}
