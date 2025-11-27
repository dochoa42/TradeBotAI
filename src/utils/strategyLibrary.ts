export type StrategyIndicatorDescriptor = {
  label: string;
  params?: Record<string, unknown>;
  raw: unknown;
};

export function parseIndicatorsJson(raw: string | null | undefined): StrategyIndicatorDescriptor[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item, idx) => {
      if (typeof item === "string") {
        return { label: item, raw: item };
      }

      if (item && typeof item === "object") {
        const named =
          (typeof (item as any).name === "string" && (item as any).name.trim()) ||
          (typeof (item as any).type === "string" && (item as any).type.trim()) ||
          `Indicator ${idx + 1}`;
        const params =
          (item as any).params && typeof (item as any).params === "object"
            ? ((item as any).params as Record<string, unknown>)
            : undefined;
        return { label: named, params, raw: item };
      }

      return { label: `Indicator ${idx + 1}`, raw: item };
    });
  } catch (_err) {
    return [];
  }
}

export function summarizeIndicators(raw: string | null | undefined, fallback = "-"): string {
  const parsed = parseIndicatorsJson(raw);
  if (!parsed.length) {
    return fallback;
  }

  return parsed
    .map((indicator) => {
      if (!indicator.params || Object.keys(indicator.params).length === 0) {
        return indicator.label;
      }
      const paramSnippet = Object.entries(indicator.params)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      return `${indicator.label} (${paramSnippet})`;
    })
    .join(", ");
}
