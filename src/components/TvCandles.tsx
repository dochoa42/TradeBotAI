import React, { useEffect, useRef } from "react";
import {
  candlestickSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";

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
  position?: "aboveBar" | "belowBar";
  color?: string;
  shape?: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
};

type TvCandlesProps = {
  data: TvCandleData[];
  markers?: TvMarkerData[];
  className?: string;
};

const normalizeTimestamp = (value?: number | string | Date): number | null => {
  if (value == null) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
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

const TvCandles: React.FC<TvCandlesProps> = ({ data, markers = [], className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: "solid", color: "#020617" },
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
    }) as ReturnType<typeof createChart>;

    const candleSeries = chart.addSeries(candlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    markersPluginRef.current = createSeriesMarkers(candleSeries, []);

    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      chart.applyOptions({ width: clientWidth, height: clientHeight });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (!chartRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chartRef.current.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      markersPluginRef.current?.detach();
      markersPluginRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    console.log("[TvCandles] raw data length:", data?.length);

    if (!seriesRef.current || !data || data.length === 0) return;

    const mapped: CandlestickData[] = data
      .filter(
        (d) =>
          Number.isFinite(Number(d.open)) &&
          Number.isFinite(Number(d.high)) &&
          Number.isFinite(Number(d.low)) &&
          Number.isFinite(Number(d.close)) &&
          getPointTimestamp(d) !== null
      )
      .map((d) => {
        const ts = getPointTimestamp(d);
        if (ts == null) return null;

        return {
          time: ts as CandlestickData["time"],
          open: Number(d.open),
          high: Number(d.high),
          low: Number(d.low),
          close: Number(d.close),
        };
      })
      .filter((point): point is CandlestickData => Boolean(point));

    console.log("[TvCandles] mapped candles sample:", mapped[0]);

    if (mapped.length === 0) return;

    seriesRef.current.setData(mapped);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    if (!markersPluginRef.current) return;

    if (!markers.length) {
      markersPluginRef.current.setMarkers([]);
      return;
    }

    const normalizedMarkers = markers
      .map<SeriesMarker<UTCTimestamp> | null>((marker) => {
        const ts = normalizeTimestamp(marker.time);
        if (ts == null) return null;

        return {
          time: ts as UTCTimestamp,
          position: marker.position ?? "aboveBar",
          color: marker.color ?? "#22c55e",
          shape: marker.shape ?? "circle",
          text: marker.text,
        };
      })
      .filter((marker): marker is SeriesMarker<UTCTimestamp> => Boolean(marker));

    markersPluginRef.current.setMarkers(normalizedMarkers);
  }, [markers]);

  const mergedClassName = className ? `${baseContainerClass} ${className}` : baseContainerClass;

  return (
    <div
      ref={containerRef}
      className={mergedClassName}
      style={{ minHeight: 280 }}
    />
  );
};

export default TvCandles;
