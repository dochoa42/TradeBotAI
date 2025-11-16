import React from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import CandlestickSeries from "./CandlestickSeries";

type TradeMarker = {
  time: any;            // same type as data[i].time
  price: number;        // y-position (usually close price)
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
  const clampedStep = hasData
    ? Math.max(0, Math.min(step, data.length - 1))
    : 0;
  const activeX = hasData ? data[clampedStep].time : undefined;

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
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12, fill: "#aaa" }}
                  minTickGap={24}
                  xAxisId="playback-x"
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#aaa" }}
                  domain={["auto", "auto"]}
                  yAxisId="playback-y"
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "1px solid #333",
                  }}
                />

                {/* Bollinger band cloud (if present) */}
                <Area
                  type="monotone"
                  dataKey="bbU"
                  strokeOpacity={0}
                  fillOpacity={0.05}
                  xAxisId="playback-x"
                  yAxisId="playback-y"
                />
                <Area
                  type="monotone"
                  dataKey="bbL"
                  strokeOpacity={0}
                  fillOpacity={0.05}
                  xAxisId="playback-x"
                  yAxisId="playback-y"
                />

                <CandlestickSeries
                  data={data}
                  xAxisId="playback-x"
                  yAxisId="playback-y"
                  xKey="time"
                  openKey="open"
                  highKey="high"
                  lowKey="low"
                  closeKey="close"
                />
                <Line
                  type="monotone"
                  dataKey="sma"
                  dot={false}
                  strokeWidth={1}
                  xAxisId="playback-x"
                  yAxisId="playback-y"
                />

                {/* Playback marker */}
                {activeX && (
                  <ReferenceLine
                    x={activeX}
                    stroke="#38bdf8"
                    strokeWidth={2}
                    xAxisId="playback-x"
                    yAxisId="playback-y"
                  />
                )}

                {/* Trade markers */}
                {markers.map((m, idx) => (
                    <ReferenceDot
                        key={idx}
                        x={m.time}
                        y={m.price}
                        r={6}
                        strokeWidth={2}
                        stroke={m.side === "long" ? "#f97316" : "#fb7185"} // bright orange / pink
                        fill={m.side === "long" ? "#f97316" : "#fb7185"}
                        xAxisId="playback-x"
                        yAxisId="playback-y"
                    />
                ))}
                {/* Zoom brush */}
                <Brush
                  dataKey="time"
                  height={24}
                  travellerWidth={12}
                  xAxisId="playback-x"
                />

              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};
