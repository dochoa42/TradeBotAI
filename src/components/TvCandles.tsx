import React, { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";

export type TvCandlePoint = {
  time: number | string | Date;
  ts?: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TvCandleData = TvCandlePoint;

export type TvMarkerData = {
  time: number | string | Date;
  position?: "aboveBar" | "belowBar" | "inBar";
  color?: string;
  shape?: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
};

type TvCandlesProps = {
  data: TvCandleData[];
  markers?: TvMarkerData[];
  className?: string;
};

// tiny fallback demo series so we always see something
const FALLBACK_SERIES: any[] = (() => {
  const base = Math.floor(Date.now() / 1000) - 60 * 5;
  const mk = (i: number, o: number, h: number, l: number, c: number) => ({
    time: base + i * 60,
    open: o,
    high: h,
    low: l,
    close: c,
  });
  return [
    mk(0, 100, 105, 95, 102),
    mk(1, 102, 108, 101, 107),
    mk(2, 107, 109, 103, 104),
    mk(3, 104, 106, 98, 99),
    mk(4, 99, 102, 96, 101),
  ];
})();

const normalizeTimestamp = (value?: number | string | Date): number | null => {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // if it looks like ms, convert to s
    return value > 2_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return Math.floor(parsed / 1000);
  }

  if (value instanceof Date) {
    const ts = value.getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.floor(ts / 1000);
  }

  return null;
};

const getPointTimestamp = (point: TvCandleData): number | null =>
  normalizeTimestamp(point.time) ?? normalizeTimestamp(point.ts);

const baseContainerClass = "w-full h-full rounded-2xl bg-slate-950";

const TvCandles: React.FC<TvCandlesProps> = ({
  data,
  markers = [],
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);
  const seriesRef = useRef<any | null>(null);

  // create chart only once, when container has a real size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let chart: any = null;
    let series: any = null;
    let created = false;

    const initChart = (width: number, height: number) => {
      if (created) return;
      if (width <= 0 || height <= 0) {
        // wait for a real size
        return;
      }

      try {
        console.log("[TvCandles] initChart with size", width, height);
        chart = createChart(container, { width, height });

        chart.applyOptions({
          layout: {
            background: { type: ColorType.Solid, color: "#020617" },
            textColor: "#e5e7eb",
          },
          grid: {
            vertLines: { color: "#020617" },
            horzLines: { color: "#020617" },
          },
          rightPriceScale: { borderColor: "#1f2937" },
          timeScale: {
            borderColor: "#1f2937",
            rightOffset: 5,
            barSpacing: 8,
          },
          crosshair: { mode: 0 },
        });

        series =
          typeof chart.addCandlestickSeries === "function"
            ? chart.addCandlestickSeries({
                upColor: "#22c55e",
                downColor: "#ef4444",
                wickUpColor: "#22c55e",
                wickDownColor: "#ef4444",
                borderUpColor: "#22c55e",
                borderDownColor: "#ef4444",
              })
            : chart.addSeries("Candlestick", {
                upColor: "#22c55e",
                downColor: "#ef4444",
                wickUpColor: "#22c55e",
                wickDownColor: "#ef4444",
                borderUpColor: "#22c55e",
                borderDownColor: "#ef4444",
              });

        chartRef.current = chart;
        seriesRef.current = series;
        created = true;
      } catch (err) {
        console.error("[TvCandles] chart creation failed in initChart", err);
      }
    };

    const rect = container.getBoundingClientRect();
    initChart(rect.width, rect.height);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (!created) {
          initChart(width, height);
        } else if (chartRef.current) {
          chartRef.current.applyOptions({ width, height });
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (chart) {
        chart.remove();
      }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // candles
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    try {
      let mapped: any[] = [];

      if (data && data.length) {
        mapped = data
          .map((d) => {
            const ts = getPointTimestamp(d);
            if (ts == null) return null;

            const open = Number(d.open);
            const high = Number(d.high);
            const low = Number(d.low);
            const close = Number(d.close);

            if (
              !Number.isFinite(open) ||
              !Number.isFinite(high) ||
              !Number.isFinite(low) ||
              !Number.isFinite(close)
            ) {
              return null;
            }

            return { time: ts, open, high, low, close };
          })
          .filter(Boolean) as any[];

        mapped.sort((a, b) => (a.time as number) - (b.time as number));
      }

      if (!mapped.length) {
        console.warn(
          "[TvCandles] No valid candle data mapped, using fallback demo series.",
        );
        mapped = FALLBACK_SERIES.slice();
      }

      console.log("[TvCandles] Using candle sample:", mapped.slice(0, 5));

      seriesRef.current.setData(mapped);
      chartRef.current.timeScale().fitContent();
    } catch (err) {
      console.error(
        "[TvCandles] candle effect failed",
        err,
        { rawDataSample: data?.slice?.(0, 5) },
      );
    }
  }, [data]);

  // markers
  useEffect(() => {
    if (!seriesRef.current) return;
    if (typeof seriesRef.current.setMarkers !== "function") return;

    try {
      if (!markers.length) {
        seriesRef.current.setMarkers([]);
        return;
      }

      const normalizedMarkers = markers
        .map((marker) => {
          const ts = normalizeTimestamp(marker.time);
          if (ts == null) return null;

          return {
            time: ts,
            position: marker.position ?? "aboveBar",
            color:
              marker.color ??
              (marker.shape === "arrowDown" ? "#ef4444" : "#22c55e"),
            shape: marker.shape ?? "circle",
            text: marker.text,
          };
        })
        .filter(Boolean) as any[];

      normalizedMarkers.sort(
        (a, b) => (a.time as number) - (b.time as number),
      );

      seriesRef.current.setMarkers(normalizedMarkers);
    } catch (err) {
      console.error(
        "[TvCandles] marker effect failed",
        err,
        { rawMarkersSample: markers?.slice?.(0, 5) },
      );
    }
  }, [markers]);

  const mergedClassName = className
    ? `${baseContainerClass} ${className}`
    : baseContainerClass;

  return (
    <div
      ref={containerRef}
      className={mergedClassName}
      style={{ minHeight: 280 }}
    />
  );
};

export default TvCandles;
