import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChartPanel, {
  type IndicatorToggle,
  type ChartPanelStatus,
} from "./ChartPanel";
import TvCandles, { type TvOverlayLine } from "./TvCandles";
import type { Interval, MultiChartState } from "../types/trading";

type MultiChartTile = MultiChartState & { overlays?: TvOverlayLine[] };

type MultiChartGridProps = {
  tiles: MultiChartTile[];
  symbols: readonly string[];
  timeframeOptions: readonly Interval[];
  indicators: IndicatorToggle[];
  onTileChange: (id: string, patch: Partial<MultiChartState>) => void;
};

const MultiChartGrid: React.FC<MultiChartGridProps> = ({
  tiles,
  symbols,
  timeframeOptions,
  indicators,
  onTileChange,
}) => {
  const columnCount = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;

  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  const dragRef = useRef<{
    id: string | null;
    offsetX: number;
    offsetY: number;
  }>({
    id: null,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const current = dragRef.current;
      if (!current.id) return;
      const { id, offsetX, offsetY } = current;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      setPositions((prev) => ({
        ...prev,
        [id]: { x, y },
      }));
    }

    function handleUp() {
      dragRef.current.id = null;
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile, index) => {
        const lastPoint = tile.candles.length
          ? tile.candles[tile.candles.length - 1]
          : null;
        const prevPoint =
          tile.candles.length > 1
            ? tile.candles[tile.candles.length - 2]
            : null;
        const lastPrice =
          typeof lastPoint?.close === "number" ? lastPoint.close : null;
        const prevPrice =
          typeof prevPoint?.close === "number" ? prevPoint.close : null;
        const changePct =
          lastPrice != null && prevPrice && prevPrice !== 0
            ? ((lastPrice - prevPrice) / prevPrice) * 100
            : null;

        const chartStatus: ChartPanelStatus = {
          lastPrice,
          changePct,
          bars: tile.candles.length,
          interval: tile.interval,
          isLoading: tile.loading,
          error: tile.error,
        };

        const panel = (
          <ChartPanel
            className="h-full"
            symbol={tile.symbol}
            symbols={symbols}
            onSymbolChange={(value) => onTileChange(tile.id, { symbol: value })}
            interval={tile.interval}
            timeframeOptions={timeframeOptions}
            onIntervalChange={(value) =>
              onTileChange(tile.id, { interval: value as Interval })
            }
            indicators={indicators}
            status={chartStatus}
          >
            <div className="relative h-full">
              <button
                type="button"
                onClick={() =>
                  onTileChange(tile.id, { detached: !tile.detached })
                }
                className="absolute top-3 right-3 z-10 px-3 py-1 text-xs rounded-full border border-slate-700 bg-slate-900/80 hover:border-slate-500"
              >
                {tile.detached ? "Dock" : "Detach"}
              </button>
              <TvCandles
                data={tile.candles}
                overlays={tile.overlays ?? []}
                className="h-full"
              />
            </div>
          </ChartPanel>
        );

        if (tile.detached) {
          const defaultX = 120 + index * 40;
          const defaultY = 80 + index * 40;
          const pos = positions[tile.id] ?? { x: defaultX, y: defaultY };

          const overlay =
            typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="fixed z-40 bg-slate-950/95 rounded-2xl shadow-2xl border border-slate-700 flex flex-col"
                    style={{
                      top: pos.y,
                      left: pos.x,
                      resize: "both",
                      overflow: "auto",
                      minWidth: 400,
                      minHeight: 260,
                      cursor: "move",
                    }}
                    onMouseDown={(e) => {
                      dragRef.current = {
                        id: tile.id,
                        offsetX: e.clientX - pos.x,
                        offsetY: e.clientY - pos.y,
                      };
                    }}
                  >
                    {panel}
                  </div>,
                  document.body
                )
              : null;

          return (
            <React.Fragment key={tile.id}>
              <div
                className="pointer-events-none opacity-0 h-[420px]"
                aria-hidden
              />
              {overlay}
            </React.Fragment>
          );
        }

        return (
          <div key={tile.id} className="h-[420px]">
            {panel}
          </div>
        );
      })}
    </div>
  );
};

export default MultiChartGrid;
