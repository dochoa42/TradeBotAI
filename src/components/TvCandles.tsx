import React, { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

export type TvCandlePoint = {
  ts?: number;                    // unix ms from backend
  time?: number | string | Date;  // optional display time
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TvCandleData = TvCandlePoint;

export type TvMarkerData = {
  ts?: number;
  time?: number | string | Date;
  price?: number;
  side?: "long" | "short";
  position?: "aboveBar" | "belowBar";
  color?: string;
  shape?: "arrowUp" | "arrowDown" | "circle";
  text?: string;
};

export type TvOverlayLine = {
  id: string;
  color: string;
  data: {
    ts?: number;
    time?: number | string | Date;
    value: number;
  }[];
};

type TvCandlesProps = {
  data: TvCandleData[];
  markers?: TvMarkerData[];
  overlays?: TvOverlayLine[];
  className?: string;
};

type CandleSeriesWithMarkers = ISeriesApi<"Candlestick"> & {
  setMarkers(markers: SeriesMarker<Time>[]): void;
};

// --- helpers ---------------------------------------------------------

function tsToSeconds(point: {
  ts?: number;
  time?: number | string | Date;
}): number | null {
  // Prefer backend ts (unix ms) if present
  if (typeof point.ts === "number" && Number.isFinite(point.ts)) {
    return Math.floor(point.ts / 1000);
  }
  // Fallbacks if something ever calls this without ts
  if (typeof point.time === "number" && Number.isFinite(point.time)) {
    return Math.floor(point.time / 1000);
  }
  if (typeof point.time === "string") {
    const parsed = Date.parse(point.time);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  if (point.time instanceof Date) {
    const ms = point.time.getTime();
    if (Number.isFinite(ms)) {
      return Math.floor(ms / 1000);
    }
  }
  return null;
}

const baseContainerClass = "w-full h-full min-h-[320px]";

// --- component -------------------------------------------------------

const TvCandles: React.FC<TvCandlesProps> = ({
  data,
  markers = [],
  overlays = [],
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<CandleSeriesWithMarkers | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

  // 1) create / destroy chart once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const chart = createChart(container, {
      width: clientWidth || 600,
      height: clientHeight || 360,
      layout: {
        background: { color: "transparent" },
        textColor: "#cbd5f5",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.12)" },
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: {
        borderColor: "#1f2937",
        rightOffset: 10,
        barSpacing: 8,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
    }) as CandleSeriesWithMarkers;

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (width && height) {
        chart.applyOptions({ width, height });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      overlaySeriesRef.current.forEach((line) => {
        chart.removeSeries(line);
      });
      overlaySeriesRef.current.clear();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2) push REAL candles whenever data changes
  useEffect(() => {
    if (!seriesRef.current) return;

    const mapped: CandlestickData<Time>[] = [];

    (data || []).forEach((d) => {
      const t = tsToSeconds(d);
      if (t == null) return;

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
        return;
      }

      mapped.push({
        time: t as Time,
        open,
        high,
        low,
        close,
      });
    });

    // lightweight-charts requires ascending time
    mapped.sort((a, b) => (a.time as number) - (b.time as number));

    seriesRef.current.setData(mapped);

    if (mapped.length && chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data]);

  // 3) optional markers overlay
  useEffect(() => {
    if (!seriesRef.current || typeof seriesRef.current.setMarkers !== "function") {
      return;
    }

    if (!markers.length) {
      seriesRef.current.setMarkers([]);
      return;
    }

    const mappedMarkers: SeriesMarker<Time>[] = [];

    markers.forEach((m) => {
      const t = tsToSeconds(m);
      if (t == null) return;
      mappedMarkers.push({
        time: t as Time,
        position: m.position ?? "aboveBar",
        color:
          m.color ??
          (m.side === "short" || m.shape === "arrowDown" ? "#ef4444" : "#22c55e"),
        shape: m.shape ?? (m.side === "short" ? "arrowDown" : "arrowUp"),
        text: m.text,
      });
    });

    mappedMarkers.sort((a, b) => (a.time as number) - (b.time as number));

    seriesRef.current.setMarkers(mappedMarkers);
  }, [markers]);

  // 4) overlay line series (SMA, Bollinger, etc.)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const nextOverlays = overlays ?? [];
    const seriesMap = overlaySeriesRef.current;
    const nextIds = new Set(nextOverlays.map((o) => o.id));

    const staleIds: string[] = [];
    seriesMap.forEach((_series, id) => {
      if (!nextIds.has(id)) {
        staleIds.push(id);
      }
    });

    staleIds.forEach((id) => {
      const line = seriesMap.get(id);
      if (line) {
        chart.removeSeries(line);
        seriesMap.delete(id);
      }
    });

    if (!nextOverlays.length) {
      return;
    }

    nextOverlays.forEach((overlay) => {
      if (!overlay || !overlay.id) return;

      let line = seriesMap.get(overlay.id);
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 2,
        });
        seriesMap.set(overlay.id, line);
      } else {
        line.applyOptions({ color: overlay.color });
      }

      const mappedData: LineData<Time>[] = [];
      (overlay.data || []).forEach((point) => {
        const t = tsToSeconds(point);
        const value = Number(point.value);
        if (t == null || !Number.isFinite(value)) return;
        mappedData.push({ time: t as Time, value });
      });

      mappedData.sort((a, b) => (a.time as number) - (b.time as number));
      line.setData(mappedData);
    });
  }, [overlays]);

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
