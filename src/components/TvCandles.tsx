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

/**
 * Normalize anything (number / string / Date) into a Unix timestamp in seconds.
 * Returns null if the value can't be parsed.
 */
const normalizeTimestamp = (
  value?: number | string | Date,
): number | null => {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // if it's milliseconds, convert to seconds
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
  normalizeTimestamp(point.ts ?? point.time);

const baseContainerClass = "w-full h-full rounded-2xl bg-slate-950";

const TvCandles: React.FC<TvCandlesProps> = ({
  data,
  markers = [],
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Typed as any on purpose to avoid fighting older lightweight-charts typings
  const chartRef = useRef<any | null>(null);
  const seriesRef = useRef<any | null>(null);

  // create chart + series once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart: any = createChart(containerRef.current, {
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
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 5,
        barSpacing: 8,
      },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    // Support both APIs:
    //  - chart.addCandlestickSeries(...)
    //  - chart.addSeries("Candlestick", ...)
    let candleSeries: any;

    if (typeof chart.addCandlestickSeries === "function") {
      candleSeries = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderVisible: false,
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
      });
    } else if (typeof chart.addSeries === "function") {
      // Fallback for builds that only expose addSeries
      candleSeries = chart.addSeries("Candlestick", {
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderVisible: false,
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
      });
    } else {
      console.error(
        "[TvCandles] Chart instance has neither addCandlestickSeries nor addSeries.",
        chart,
      );
      return;
    }

    chartRef.current = chart;
    seriesRef.current = candleSeries;

    // auto-resize
    const resizeObserver = new ResizeObserver((entries) => {
      if (!chartRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chartRef.current.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);

    // initial size
    const { clientWidth, clientHeight } = containerRef.current;
    chart.applyOptions({ width: clientWidth, height: clientHeight });

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
      }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // update candlestick data
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (!data || data.length === 0) {
      seriesRef.current.setData([]);
      return;
    }

    const mapped = data
      .filter(
        (d) =>
          Number.isFinite(Number(d.open)) &&
          Number.isFinite(Number(d.high)) &&
          Number.isFinite(Number(d.low)) &&
          Number.isFinite(Number(d.close)) &&
          getPointTimestamp(d) !== null,
      )
      .map((d) => {
        const ts = getPointTimestamp(d);
        if (ts == null) return null;

        return {
          time: ts,
          open: Number(d.open),
          high: Number(d.high),
          low: Number(d.low),
          close: Number(d.close),
        };
      })
      .filter((d) => d !== null) as any[];

    seriesRef.current.setData(mapped);
    chartRef.current.timeScale().fitContent();
  }, [data]);

  // update markers
  useEffect(() => {
    if (!seriesRef.current) return;

    if (!markers.length) {
      seriesRef.current.setMarkers([]);
      return;
    }

    const mappedMarkers = markers
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
      .filter((m) => m !== null) as any[];

    seriesRef.current.setMarkers(mappedMarkers);
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
