export type IndicatorParamSchema = {
  name: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number }[];
};

export type IndicatorConfig = {
  id: string;
  label: string;
  kind: "trend" | "oscillator" | "volatility" | "volume";
  defaultParams: Record<string, number>;
  paramsSchema: IndicatorParamSchema[];
  overlay: "price" | "separatePanel";
};

export const INDICATOR_CATALOG: IndicatorConfig[] = [
  {
    id: "sma",
    label: "SMA",
    kind: "trend",
    defaultParams: { length: 20 },
    paramsSchema: [
      {
        name: "length",
        label: "Length",
        type: "number",
        min: 2,
        max: 500,
        step: 1,
      },
    ],
    overlay: "price",
  },
  {
    id: "ema",
    label: "EMA",
    kind: "trend",
    defaultParams: { length: 20 },
    paramsSchema: [
      {
        name: "length",
        label: "Length",
        type: "number",
        min: 2,
        max: 500,
        step: 1,
      },
    ],
    overlay: "price",
  },
  {
    id: "rsi",
    label: "RSI",
    kind: "oscillator",
    defaultParams: { length: 14 },
    paramsSchema: [
      {
        name: "length",
        label: "Length",
        type: "number",
        min: 2,
        max: 200,
        step: 1,
      },
    ],
    overlay: "separatePanel",
  },
  {
    id: "macd",
    label: "MACD",
    kind: "trend",
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramsSchema: [
      {
        name: "fast",
        label: "Fast",
        type: "number",
        min: 2,
        max: 100,
        step: 1,
      },
      {
        name: "slow",
        label: "Slow",
        type: "number",
        min: 2,
        max: 100,
        step: 1,
      },
      {
        name: "signal",
        label: "Signal",
        type: "number",
        min: 2,
        max: 100,
        step: 1,
      },
    ],
    overlay: "separatePanel",
  },
  {
    id: "bbands",
    label: "Bollinger Bands",
    kind: "volatility",
    defaultParams: { length: 20, std: 2 },
    paramsSchema: [
      {
        name: "length",
        label: "Length",
        type: "number",
        min: 5,
        max: 200,
        step: 1,
      },
      {
        name: "std",
        label: "Std Dev",
        type: "number",
        min: 1,
        max: 4,
        step: 0.5,
      },
    ],
    overlay: "price",
  },
];
