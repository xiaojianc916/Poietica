export interface MetricRecorder {
  increment(name: string, value?: number, tags?: Record<string, string>): void
  gauge(name: string, value: number, tags?: Record<string, string>): void
  timing(name: string, ms: number, tags?: Record<string, string>): void
}

export const noopMetrics: MetricRecorder = {
  increment: () => {},
  gauge: () => {},
  timing: () => {},
}

let metrics: MetricRecorder = noopMetrics

export function setMetricsRecorder(recorder: MetricRecorder): void {
  metrics = recorder
}

export function getMetricsRecorder(): MetricRecorder {
  return metrics
}
