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
  candleWidth?: number; // optional override
};

export function CandlestickSeries({
  data,
  xAxisId,
  yAxisId,
  xKey = "time",
  openKey = "open",
  highKey = "high",
  lowKey = "low",
  closeKey = "close",
  bullColor = "#22c55e", // neon green
  bearColor = "#fb7185", // neon pink
  candleWidth,
}: CandlestickSeriesProps) {
  if (!data || data.length === 0) return null;
  console.log("Candles debug sample:", data.slice(0, 3));

  return (
    <Customized
      component={(chartProps: any) => {
        const { xAxisMap, yAxisMap } = chartProps || {};

        const allX = xAxisMap ? (Object.values(xAxisMap) as any[]) : [];
        const allY = yAxisMap ? (Object.values(yAxisMap) as any[]) : [];

        const xAxis =
          (xAxisId && xAxisMap && xAxisMap[xAxisId]) || allX[0] || null;
        const yAxis =
          (yAxisId && yAxisMap && yAxisMap[yAxisId]) || allY[0] || null;

        if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) {
          // If we can't resolve axes, bail out quietly.
          return null;
        }

        const xScale = xAxis.scale;
        const yScale = yAxis.scale;

        const isBand =
          typeof (xScale as any).bandwidth === "function" &&
          (xScale as any).bandwidth() > 0;
        const bandWidth = isBand ? (xScale as any).bandwidth() : 0;

        // Fallback width if we don't have a band scale
        let defaultStep = 8;
        if (!isBand && data.length > 1) {
          const first = data[0]?.[xKey];
          const second = data[1]?.[xKey];
          const x1 = Number(xScale(first));
          const x2 = Number(xScale(second));
          if (Number.isFinite(x1) && Number.isFinite(x2) && x1 !== x2) {
            defaultStep = Math.abs(x2 - x1);
          }
        }

        const bodyWidth =
          candleWidth ??
          Math.max(3, (isBand ? bandWidth : defaultStep) * 0.6);

        return (
          <Layer className="candlestick-series">
            {data.map((entry: any, idx: number) => {
              const xValue = entry?.[xKey];

              const open = Number(entry?.[openKey]);
              const high = Number(entry?.[highKey]);
              const low = Number(entry?.[lowKey]);
              const close = Number(entry?.[closeKey]);

              if (
                xValue == null ||
                [open, high, low, close].some(
                  (v) => v == null || Number.isNaN(v)
                )
              ) {
                return null;
              }

              let cx = Number(xScale(xValue));

              if (!Number.isFinite(cx)) {
                // As a last resort, fall back to index positioning
                cx = isBand
                  ? (xScale as any)(idx) + bandWidth / 2
                  : idx * defaultStep;
              } else if (isBand) {
                // Center within the band
                cx = cx + bandWidth / 2;
              }

              const yOpen = Number(yScale(open));
              const yClose = Number(yScale(close));
              const yHigh = Number(yScale(high));
              const yLow = Number(yScale(low));

              if (
                [yOpen, yClose, yHigh, yLow].some(
                  (v) => !Number.isFinite(v)
                )
              ) {
                return null;
              }

              const bullish = close >= open;
              const color = bullish ? bullColor : bearColor;

              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
              const bodyX = cx - bodyWidth / 2;

              return (
                <g key={`candle-${idx}`}>
                  {/* Wick */}
                  <line
                    x1={cx}
                    x2={cx}
                    y1={yHigh}
                    y2={yLow}
                    stroke={color}
                    strokeWidth={1.3}
                    opacity={0.9}
                  />
                  {/* Body */}
                  <rect
                    x={bodyX}
                    y={bodyTop}
                    width={bodyWidth}
                    height={bodyHeight}
                    fill={color}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.95}
                    rx={1}
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
