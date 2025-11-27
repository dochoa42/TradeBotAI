import React, { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type BarData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type MouseEventParams,
  type UTCTimestamp,
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
  id?: string | number;
  ts?: number;
  time?: number | string | Date;
  price?: number;
  side?: "long" | "short";
  position?: "aboveBar" | "belowBar";
  color?: string;
  shape?: "arrowUp" | "arrowDown" | "circle";
  text?: string;
  size?: number;
  payload?: unknown;
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
  selectedMarkerId?: string | number | null;
  onMarkerClick?: (marker?: TvMarkerData) => void;
  onMarkerHover?: (event?: MarkerHoverEvent) => void;
};

export type MarkerHoverEvent = {
  marker?: TvMarkerData;
  point?: { x: number; y: number };
  containerSize?: { width: number; height: number };
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

function prepareSeriesData(candles: TvCandleData[]): BarData[] {
  if (!Array.isArray(candles) || !candles.length) {
    return [];
  }

  const cleaned = candles
    .map((c) => {
      const time = tsToSeconds(c);
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);

      if (
        time == null ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }

      return {
        time: time as UTCTimestamp,
        open,
        high,
        low,
        close,
      } as BarData;
    })
    .filter((v): v is BarData => Boolean(v))
    .sort((a, b) => (a.time as number) - (b.time as number));

  if (!cleaned.length) {
    return [];
  }

  const deduped: BarData[] = [];
  cleaned.forEach((bar) => {
    const last = deduped[deduped.length - 1];
    if (last && last.time === bar.time) {
      deduped[deduped.length - 1] = bar;
    } else {
      deduped.push(bar);
    }
  });

  return deduped;
}

// --- component -------------------------------------------------------

const TvCandles: React.FC<TvCandlesProps> = ({
  data,
  markers = [],
  overlays = [],
  className,
  selectedMarkerId = null,
  onMarkerClick,
  onMarkerHover,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<CandleSeriesWithMarkers | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const markersMapRef = useRef<Map<string, TvMarkerData>>(new Map());

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

    const prepared = prepareSeriesData(data ?? []);

    try {
      seriesRef.current.setData(prepared);
      if (prepared.length && chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    } catch (error) {
      console.error("TvCandles setData error", error);
    }
  }, [data]);

  // 3) optional markers overlay
  useEffect(() => {
    if (!seriesRef.current || typeof seriesRef.current.setMarkers !== "function") {
      return;
    }

    const map = markersMapRef.current;
    map.clear();

    if (!markers.length) {
      seriesRef.current.setMarkers([]);
      return;
    }

    const highlightId =
      selectedMarkerId !== null && selectedMarkerId !== undefined
        ? String(selectedMarkerId)
        : null;

    const mappedMarkers: SeriesMarker<Time>[] = [];

    markers.forEach((m, idx) => {
      const t = tsToSeconds(m);
      if (t == null) return;

      const markerId = String(m.id ?? `${m.ts ?? m.time ?? idx}-${idx}`);
      const isSelected = highlightId === markerId;
      const defaultColor =
        m.color ?? (m.side === "short" || m.shape === "arrowDown" ? "#ef4444" : "#22c55e");
      const color = isSelected ? "#facc15" : defaultColor;
      const shape = isSelected
        ? "circle"
        : m.shape ?? (m.side === "short" ? "arrowDown" : "arrowUp");
      const size = isSelected ? (m.size ?? 1) + 1 : m.size;

      mappedMarkers.push({
        id: markerId,
        time: t as Time,
        price: typeof m.price === "number" ? m.price : undefined,
        position: m.position ?? "aboveBar",
        color,
        shape,
        text: m.text,
        size,
      });

      map.set(markerId, { ...m, id: markerId });
    });

    mappedMarkers.sort((a, b) => (a.time as number) - (b.time as number));

    seriesRef.current.setMarkers(mappedMarkers);
  }, [markers, selectedMarkerId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onMarkerClick) return;

    const handleClick = (param: MouseEventParams<Time>) => {
      if (param.hoveredObjectId == null) {
        return;
      }
      const marker = markersMapRef.current.get(String(param.hoveredObjectId));
      onMarkerClick(marker);
    };

    chart.subscribeClick(handleClick);
    return () => {
      chart.unsubscribeClick(handleClick);
    };
  }, [onMarkerClick]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onMarkerHover) return;

    const handleMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.hoveredObjectId == null) {
        onMarkerHover(undefined);
        return;
      }
      const marker = markersMapRef.current.get(String(param.hoveredObjectId));
      const container = containerRef.current;
      onMarkerHover({
        marker,
        point: { x: param.point.x, y: param.point.y },
        containerSize: container
          ? { width: container.clientWidth, height: container.clientHeight }
          : undefined,
      });
    };

    chart.subscribeCrosshairMove(handleMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleMove);
    };
  }, [onMarkerHover]);

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
