import React, { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

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
  price: number;
  side?: "long" | "short";
  position?: "aboveBar" | "belowBar";
  color?: string;
  shape?: "arrowUp" | "arrowDown" | "circle";
  text?: string;
};

type TvCandlesProps = {
  data: TvCandleData[];
  markers?: TvMarkerData[];
  className?: string;
};

// --- helpers ---------------------------------------------------------

function tsToSeconds(point: { ts?: number; time?: any }): number | null {
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
  className,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);
  const seriesRef = useRef<any | null>(null);

  // 1) create / destroy chart once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const chart: any = createChart(container, {
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

    const series: any = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
    });

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
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2) push REAL candles whenever data changes
  useEffect(() => {
    if (!seriesRef.current) return;

    const mapped: any[] = (data || [])
      .map((d) => {
        const t = tsToSeconds(d);
        if (t == null) return null;

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

        return { time: t, open, high, low, close };
      })
      .filter(Boolean) as any[];

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

    const mappedMarkers: any[] = markers
      .map((m) => {
        const t = tsToSeconds(m);
        if (t == null) return null;
        return {
          time: t,
          position: m.position ?? "aboveBar",
          color:
            m.color ??
            (m.side === "short" || m.shape === "arrowDown" ? "#ef4444" : "#22c55e"),
          shape: m.shape ?? (m.side === "short" ? "arrowDown" : "arrowUp"),
          text: m.text,
        };
      })
      .filter(Boolean) as any[];

    mappedMarkers.sort((a, b) => (a.time as number) - (b.time as number));

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
