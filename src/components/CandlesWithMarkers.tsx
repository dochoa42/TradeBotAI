import React, { useCallback, useMemo, useState } from "react";
import TvCandles, {
  type TvCandleData,
  type TvMarkerData,
  type MarkerHoverEvent,
} from "./TvCandles";

export interface Candle {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeMarker {
  id: number | string;
  tradeId: number | string;
  time: number | string;
  price: number;
  side: "buy" | "sell" | "long" | "short";
  strategyName?: string | null;
  alphaScore?: number | null;
  pnl?: number | null;
  quantity?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  type?: "entry" | "exit";
}

export interface CandlesWithMarkersProps {
  candles: Candle[];
  markers?: TradeMarker[];
  height?: number;
  className?: string;
  selectedMarkerId?: number | string | null;
  onMarkerClick?: (marker: TradeMarker | null) => void;
}

const formatNumber = (value?: number | null, digits = 2): string => {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
};

const markerColor = (marker: TradeMarker): string => {
  const normalizedSide = marker.side === "sell" ? "short" : marker.side;
  return normalizedSide === "short" ? "#f87171" : "#4ade80";
};

const markerPosition = (marker: TradeMarker): "aboveBar" | "belowBar" => {
  if (marker.type === "exit") {
    return "aboveBar";
  }
  const normalizedSide = marker.side === "sell" ? "short" : marker.side;
  return normalizedSide === "short" ? "aboveBar" : "belowBar";
};

const CandlesWithMarkers: React.FC<CandlesWithMarkersProps> = ({
  candles,
  markers = [],
  height = 360,
  className,
  selectedMarkerId,
  onMarkerClick,
}) => {
  const [hoverState, setHoverState] = useState<{
    marker: TradeMarker;
    point: { x: number; y: number };
    containerSize?: { width: number; height: number };
  } | null>(null);

  const candleData = useMemo<TvCandleData[]>(
    () =>
      candles.map((c) => ({
        ts: typeof c.time === "number" ? c.time : Date.parse(String(c.time)),
        time: c.time,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      })),
    [candles]
  );

  const markerData = useMemo<TvMarkerData[]>(
    () =>
      markers.map((marker) => {
        const normalizedSide =
          marker.side === "sell"
            ? "short"
            : marker.side === "buy"
            ? "long"
            : (marker.side as "long" | "short");
        return {
          id: marker.id,
          ts: typeof marker.time === "number" ? marker.time : Date.parse(String(marker.time)),
          time: marker.time,
          price: marker.price,
          position: markerPosition(marker),
          side: normalizedSide,
          color: markerColor(marker),
          text:
            marker.type === "exit"
              ? "Exit"
              : marker.strategyName?.slice(0, 4)?.toUpperCase(),
          payload: marker,
        } as TvMarkerData;
      }),
    [markers]
  );

  const handleMarkerHover = useCallback(
    (event?: MarkerHoverEvent) => {
      if (!event || !event.marker?.payload || !event.point) {
        setHoverState(null);
        return;
      }
      setHoverState({
        marker: event.marker.payload as TradeMarker,
        point: event.point,
        containerSize: event.containerSize,
      });
    },
    []
  );

  const tooltip = useMemo(() => {
    if (!hoverState) return null;
    const width = 220;
    const heightClamp = 120;
    const containerWidth = hoverState.containerSize?.width ?? width;
    const left = Math.min(
      Math.max(hoverState.point.x + 12, 0),
      Math.max(containerWidth - width - 12, 0)
    );
    const top = Math.max(hoverState.point.y - heightClamp, 10);
    const trade = hoverState.marker;

    return (
      <div
        className="pointer-events-none absolute z-20 w-56 rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs text-slate-100 shadow-2xl"
        style={{ left, top }}
      >
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase text-slate-400">
          <span>{trade.strategyName ?? "Unlabeled"}</span>
          <span className="font-semibold text-slate-200">{trade.side}</span>
        </div>
        <div className="space-y-1 text-[13px]">
          <div className="flex justify-between">
            <span className="text-slate-400">Qty</span>
            <span>{formatNumber(trade.quantity, 4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Entry</span>
            <span>{formatNumber(trade.entryPrice ?? trade.price)}</span>
          </div>
          {trade.exitPrice != null && (
            <div className="flex justify-between">
              <span className="text-slate-400">Exit</span>
              <span>{formatNumber(trade.exitPrice)}</span>
            </div>
          )}
          {trade.pnl != null && (
            <div className="flex justify-between">
              <span className="text-slate-400">PnL</span>
              <span className={trade.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {formatNumber(trade.pnl)}
              </span>
            </div>
          )}
          {trade.alphaScore != null && (
            <div className="flex justify-between">
              <span className="text-slate-400">Alpha</span>
              <span>{formatNumber(trade.alphaScore)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }, [hoverState]);

  const wrapperClass = className ? `relative w-full ${className}` : "relative w-full";

  return (
    <div className={wrapperClass} style={{ height }}>
      <TvCandles
        data={candleData}
        markers={markerData}
        className="h-full"
        selectedMarkerId={selectedMarkerId ?? null}
        onMarkerClick={(marker) =>
          onMarkerClick?.((marker?.payload as TradeMarker | null) ?? null)
        }
        onMarkerHover={handleMarkerHover}
      />
      {tooltip}
    </div>
  );
};

export default CandlesWithMarkers;
