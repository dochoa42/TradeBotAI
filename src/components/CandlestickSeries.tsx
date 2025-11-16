import React from "react";
import { Customized, Layer } from "recharts";

export type CandlestickSeriesProps = {
  data: any[];
  xAxisId?: string;
  yAxisId?: string;
  xKey: string;
  openKey?: string;
  highKey?: string;
  lowKey?: string;
  closeKey: string;
  bullColor?: string;
  bearColor?: string;
  candleWidth?: number;
};

const toNumber = (value: any): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const candidates = (primary?: string, fallback: string[] = []) => {
  const set = new Set<string>();
  if (primary) set.add(primary);
  fallback.forEach((k) => set.add(k));
  return Array.from(set);
};

const pickValue = (entry: any, keys: string[]): number | null => {
  if (!entry) return null;
  for (const key of keys) {
    if (key in entry) {
      const num = toNumber(entry[key]);
      if (num != null) {
        return num;
      }
    }
  }
  return null;
};

export function CandlestickSeries({
  data,
  xAxisId = "main-x",
  yAxisId = "main-y",
  xKey = "time",
  openKey = "open",
  highKey = "high",
  lowKey = "low",
  closeKey = "close",
  bullColor = "rgba(34,197,94,0.9)",
  bearColor = "rgba(249,115,129,0.9)",
  candleWidth,
}: CandlestickSeriesProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return (
    <Customized
      component={(chartProps: any) => {
        const xAxis = chartProps?.xAxisMap?.[xAxisId];
        const yAxis = chartProps?.yAxisMap?.[yAxisId];
        if (
          !xAxis ||
          !yAxis ||
          typeof xAxis.scale !== "function" ||
          typeof yAxis.scale !== "function"
        ) {
          return null;
        }

        const xScale = xAxis.scale;
        const yScale = yAxis.scale;
        const autoWidth =
          typeof xScale.bandwidth === "function"
            ? Number(xScale.bandwidth()) * 0.7
            : undefined;
        const resolvedWidth = Math.max(
          1,
          candleWidth ?? (autoWidth && Number.isFinite(autoWidth) ? autoWidth : 5)
        );

        const openKeys = candidates(openKey, ["open", "o"]);
        const closeKeys = candidates(closeKey, ["close", "c", "price", "last"]);
        const highKeys = candidates(highKey, ["high", "h"]);
        const lowKeys = candidates(lowKey, ["low", "l"]);

        let previousClose: number | null = null;

        return (
          <Layer className="candlestick-series">
            {data.map((entry: any, idx: number) => {
              if (!entry) return null;

              const rawX = entry[xKey];
              if (rawX == null) {
                return null;
              }

              const close = pickValue(entry, closeKeys);
              if (close == null) {
                return null;
              }

              let open = pickValue(entry, openKeys);
              if (open == null) {
                open = previousClose ?? close;
              }

              let high = pickValue(entry, highKeys);
              let low = pickValue(entry, lowKeys);

              if (high == null) {
                high = Math.max(open, close);
              }
              if (low == null) {
                low = Math.min(open, close);
              }

              // ensure wick envelopes body even if data was noisy
              const wickHigh = Math.max(high, open, close);
              const wickLow = Math.min(low, open, close);

              const scaledX = Number(xScale(rawX));
              const scaledOpen = Number(yScale(open));
              const scaledClose = Number(yScale(close));
              const scaledHigh = Number(yScale(wickHigh));
              const scaledLow = Number(yScale(wickLow));

              if (
                [scaledX, scaledOpen, scaledClose, scaledHigh, scaledLow].some(
                  (val) => !Number.isFinite(val)
                )
              ) {
                previousClose = close;
                return null;
              }

              const isBull = close >= open;
              const color = isBull ? bullColor : bearColor;
              const bodyTop = Math.min(scaledOpen, scaledClose);
              const bodyHeight = Math.max(
                1,
                Math.abs(scaledClose - scaledOpen)
              );
              const rectX = scaledX - resolvedWidth / 2;

              previousClose = close;

              return (
                <g key={`candle-${idx}`}>
                  <line
                    x1={scaledX}
                    x2={scaledX}
                    y1={scaledHigh}
                    y2={scaledLow}
                    stroke={color}
                    strokeWidth={1.2}
                    opacity={0.9}
                    strokeLinecap="round"
                  />
                  <rect
                    x={rectX}
                    y={bodyTop}
                    width={resolvedWidth}
                    height={bodyHeight}
                    fill={color}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.9}
                    rx={1.2}
                    ry={1.2}
                  />
                </g>
              );
            })}
          </Layer>
        );
      }}
    />
  );
}

export default CandlestickSeries;
