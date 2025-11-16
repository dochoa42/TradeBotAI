import React from "react";
import { Customized, Layer } from "recharts";

export type CandlestickSeriesProps = {
  data: any[];
  xAxisId?: string;
  yAxisId?: string;
  xKey?: string;
  openKey?: string;
  highKey?: string;
  lowKey?: string;
  closeKey?: string;
  bullColor?: string;
  bearColor?: string;
  candleWidth?: number;
};

function pickNumber(entry: any, keys: string[]): number | null {
  for (const k of keys) {
    if (k in entry && entry[k] != null) {
      const n = Number(entry[k]);
      if (!Number.isNaN(n) && Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function CandlestickSeries({
  data,
  xAxisId = "main-x",
  yAxisId = "main-y",
  xKey = "time",
  openKey = "open",
  highKey = "high",
  lowKey = "low",
  closeKey = "close",
  bullColor = "#3BFF85",
  bearColor = "#FF4B81",
  candleWidth = 4,
}: CandlestickSeriesProps) {
  if (!data || data.length === 0) return null;

  return (
    <Customized
      component={(chartProps: any) => {
        const xAxis = chartProps?.xAxisMap?.[xAxisId];
        const yAxis = chartProps?.yAxisMap?.[yAxisId];

        if (!xAxis || !yAxis || typeof xAxis.scale !== "function" || typeof yAxis.scale !== "function") {
          return null;
        }

        const xScale = xAxis.scale;
        const yScale = yAxis.scale;

        return (
          <Layer className="candlestick-series">
            {data.map((entry: any, idx: number) => {
              const xRaw = entry?.[xKey];

              const close =
                pickNumber(entry, [closeKey, "close", "price", "c"]) ?? null;
              if (close == null) {
                return null;
              }

              let open =
                pickNumber(entry, [openKey, "open", "o", "Open"]) ?? close;
              let high =
                pickNumber(entry, [highKey, "high", "h", "High"]) ?? close;
              let low =
                pickNumber(entry, [lowKey, "low", "l", "Low"]) ?? close;

              const maxOC = Math.max(open, close);
              const minOC = Math.min(open, close);
              if (high < maxOC) high = maxOC;
              if (low > minOC) low = minOC;

              if (xRaw == null) return null;

              const x = Number(xScale(xRaw));
              const yOpen = Number(yScale(open));
              const yClose = Number(yScale(close));
              const yHigh = Number(yScale(high));
              const yLow = Number(yScale(low));

              if (
                [x, yOpen, yClose, yHigh, yLow].some(
                  (v) => !Number.isFinite(v)
                )
              ) {
                return null;
              }

              const bullish = close >= open;
              const color = bullish ? bullColor : bearColor;
              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
              const bodyX = x - candleWidth / 2;

              return (
                <g key={`candle-${idx}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth={1.2}
                    opacity={0.9}
                  />
                  <rect
                    x={bodyX}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={color}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.95}
                    rx={1}
                    ry={1}
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
