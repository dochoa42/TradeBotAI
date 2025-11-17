import React, { useMemo } from "react";
import TvCandles, { TvCandleData, TvMarkerData } from "./TvCandles";

type TradeMarker = {
  time: any; // same type as data[i].time
  ts?: number;
  price: number; // y-position (usually close price)
  side: "long" | "short";
};

type SimulationViewerProps = {
  data: any[];
  step: number;
  onClose: () => void;
  markers?: TradeMarker[];
};

export const SimulationViewer: React.FC<SimulationViewerProps> = ({
  data,
  step,
  onClose,
  markers = [],
}) => {
  const hasData = data && data.length > 0;
  const playbackOhlc = useMemo<TvCandleData[]>(() => {
    if (!hasData) return [];
    return data.map((entry: any, idx: number) => ({
      time:
        typeof entry?.ts === "number"
          ? entry.ts
          : typeof entry?.time === "number"
          ? entry.time
          : idx,
      open: Number(entry?.open) || 0,
      high: Number(entry?.high) || 0,
      low: Number(entry?.low) || 0,
      close: Number(entry?.close) || 0,
    }));
  }, [data, hasData]);

  const playbackMarkers = useMemo<TvMarkerData[]>(() => {
    if (!markers.length || !hasData) return [];
    const timeLookup = new Map<any, number>();
    data.forEach((entry: any) => {
      if (entry?.time != null && typeof entry?.ts === "number") {
        timeLookup.set(entry.time, entry.ts);
      }
    });
    return markers
      .map((m) => {
        const ts =
          typeof m.ts === "number"
            ? m.ts
            : typeof m.time === "number"
            ? m.time
            : timeLookup.get(m.time);
        if (ts == null) return null;
        const isLong = m.side === "long";
        return {
          time: ts,
          position: isLong ? "belowBar" : "aboveBar",
          color: isLong ? "#f97316" : "#fb7185",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: isLong ? "L" : "S",
        };
      })
      .filter(Boolean) as TvMarkerData[];
  }, [markers, data, hasData]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-slate-900 rounded-2xl shadow-2xl w-[90vw] h-[80vh] flex flex-col border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Candle Playback Viewer
            </h2>
            <p className="text-xs text-slate-400">
              Playback is driven by the Simulation Desk controls. Use the brush
              below to zoom the window.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm"
          >
            ✕ Close
          </button>
        </div>

        {/* Chart body */}
        <div className="flex-1 p-4">
          {!hasData ? (
            <p className="text-sm text-slate-400">
              No candle data loaded yet. Run a backtest / load candles in the
              main console first.
            </p>
          ) : (
            <div className="w-full h-full">
              <TvCandles data={playbackOhlc} markers={playbackMarkers} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
