import { useState } from "react";
import type { ChartAnalysis } from "../analysis";

const WIDTH = 840;
const PAD_L = 74;
const PAD_R = 24;
const PRICE_TOP = 28;
const PRICE_H = 300;
const VOL_GAP = 26;
const VOL_H = 58;
const MACD_GAP = 36;
const MACD_H = 112;
const BOTTOM = 32;

function linePath(
  values: (number | null)[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

function ribbonPaths(
  emaFast: (number | null)[],
  emaSlow: (number | null)[],
  xAt: (index: number) => number,
  yPrice: (value: number) => number,
): { bullishPath: string; bearishPath: string } {
  let bullish = "";
  let bearish = "";

  for (let i = 1; i < emaFast.length; i += 1) {
    const f0 = emaFast[i - 1];
    const f1 = emaFast[i];
    const s0 = emaSlow[i - 1];
    const s1 = emaSlow[i];
    if (f0 == null || f1 == null || s0 == null || s1 == null) continue;

    const x0 = xAt(i - 1).toFixed(1);
    const x1 = xAt(i).toFixed(1);
    const yf0 = yPrice(f0).toFixed(1);
    const yf1 = yPrice(f1).toFixed(1);
    const ys0 = yPrice(s0).toFixed(1);
    const ys1 = yPrice(s1).toFixed(1);

    const quad = `M${x0},${yf0} L${x1},${yf1} L${x1},${ys1} L${x0},${ys0} Z `;
    if (f1 >= s1) {
      bullish += quad;
    } else {
      bearish += quad;
    }
  }

  return { bullishPath: bullish, bearishPath: bearish };
}

function axisPrice(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: value >= 200 ? 0 : 1,
  }).format(value);
}

function formatVolume(val: number): string {
  if (val >= 10_000_000) return `${(val / 10_000_000).toFixed(2)} Cr`;
  if (val >= 100_000) return `${(val / 100_000).toFixed(2)} L`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return val.toString();
}

export interface TradeLevels {
  entry?: number | null;
  maxChase?: number | null;
  stop?: number | null;
  tranche1?: number | null;
  target?: number | null;
}

export interface ChartOverlays {
  ema: boolean;
  levels: boolean;
  macd: boolean;
  tradeLevels?: boolean;
}

interface TradeLevelConfig {
  key: string;
  price: number;
  label: string;
  tone: "target" | "tranche1" | "entry" | "maxbuy" | "stop";
  side: "left" | "right";
  dash: string;
}

export function CandleChart({
  analysis,
  overlays = { ema: true, levels: true, macd: true, tradeLevels: true },
  tradeLevels,
}: {
  analysis: ChartAnalysis;
  overlays?: ChartOverlays;
  tradeLevels?: TradeLevels;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { bars, ema20, ema50, macd, support, resistance } = analysis;
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);

  const levelValues = [
    overlays.levels ? support : null,
    overlays.levels ? resistance : null,
    overlays.tradeLevels !== false ? tradeLevels?.entry : null,
    overlays.tradeLevels !== false ? tradeLevels?.stop : null,
    overlays.tradeLevels !== false ? tradeLevels?.target : null,
    overlays.tradeLevels !== false ? tradeLevels?.tranche1 : null,
    overlays.tradeLevels !== false ? tradeLevels?.maxChase : null,
  ].filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  const rawMin = Math.min(...lows, ...(levelValues.length > 0 ? levelValues : [lows[0] ?? 0]));
  const rawMax = Math.max(...highs, ...(levelValues.length > 0 ? levelValues : [highs[0] ?? 1]));
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const slot = (WIDTH - PAD_L - PAD_R) / bars.length;
  const bodyWidth = Math.max(3.6, Math.min(slot * 0.72, slot - 1.2));

  const xAt = (index: number) => PAD_L + slot * index + slot / 2;
  const yPrice = (value: number) => PRICE_TOP + ((max - value) / (max - min)) * PRICE_H;

  const ribbon = overlays.ema ? ribbonPaths(ema20, ema50, xAt, yPrice) : null;

  const activeLevels: TradeLevelConfig[] = [];
  if (overlays.tradeLevels !== false && tradeLevels) {
    if (tradeLevels.target && tradeLevels.target > 0) {
      activeLevels.push({
        key: "target",
        price: tradeLevels.target,
        label: `🎯 Target +12% (${axisPrice(tradeLevels.target)})`,
        tone: "target",
        side: "right",
        dash: "5 3",
      });
    }
    if (tradeLevels.tranche1 && tradeLevels.tranche1 > 0) {
      activeLevels.push({
        key: "tranche1",
        price: tradeLevels.tranche1,
        label: `🟡 Tranche 1 +6% (${axisPrice(tradeLevels.tranche1)})`,
        tone: "tranche1",
        side: "right",
        dash: "4 3",
      });
    }
    if (tradeLevels.entry && tradeLevels.entry > 0) {
      activeLevels.push({
        key: "entry",
        price: tradeLevels.entry,
        label: `⚡ Entry (${axisPrice(tradeLevels.entry)})`,
        tone: "entry",
        side: "left",
        dash: "6 3",
      });
    }
    if (tradeLevels.maxChase && tradeLevels.maxChase > (tradeLevels.entry ?? 0)) {
      activeLevels.push({
        key: "maxbuy",
        price: tradeLevels.maxChase,
        label: `🛡️ Max Buy (${axisPrice(tradeLevels.maxChase)})`,
        tone: "maxbuy",
        side: "left",
        dash: "3 2",
      });
    }
    if (tradeLevels.stop && tradeLevels.stop > 0) {
      activeLevels.push({
        key: "stop",
        price: tradeLevels.stop,
        label: `🛑 Hard Stop (${axisPrice(tradeLevels.stop)})`,
        tone: "stop",
        side: "left",
        dash: "5 3",
      });
    }
  }

  const macdValues = [...macd.line, ...macd.signal, ...macd.histogram].filter(
    (value): value is number => value != null,
  );
  const macdPeak = Math.max(0.5, ...macdValues.map((value) => Math.abs(value)));
  const volumes = bars.map((bar) => bar.volume ?? 0);
  const hasVolume = volumes.some((value) => value > 0);
  const volumePeak = Math.max(1, ...volumes);
  const volumeTop = PRICE_TOP + PRICE_H + (hasVolume ? VOL_GAP : 0);
  const yVolume = (value: number) => volumeTop + VOL_H - (value / volumePeak) * (VOL_H - 6);
  const macdTop = volumeTop + (hasVolume ? VOL_H : 0) + (overlays.macd ? MACD_GAP : 0);
  const yMacd = (value: number) => macdTop + ((macdPeak - value) / (macdPeak * 2)) * MACD_H;
  const height =
    PRICE_TOP +
    PRICE_H +
    (hasVolume ? VOL_GAP + VOL_H : 0) +
    (overlays.macd ? MACD_GAP + MACD_H : 0) +
    BOTTOM;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * (1 - t));
  const dateMarks = [0, Math.floor(bars.length / 2), bars.length - 1];

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * WIDTH;
    if (svgX < PAD_L || svgX > WIDTH - PAD_R) {
      setHoverIndex(null);
      return;
    }
    const idx = Math.floor((svgX - PAD_L) / slot);
    if (idx >= 0 && idx < bars.length) {
      setHoverIndex(idx);
    } else {
      setHoverIndex(null);
    }
  };

  const onMouseLeave = () => setHoverIndex(null);

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={chartLabel(analysis)}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <rect
          x={PAD_L}
          y={PRICE_TOP}
          width={WIDTH - PAD_L - PAD_R}
          height={PRICE_H}
          className="chart-plot"
        />
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yPrice(tick)}
              y2={yPrice(tick)}
              className="chart-grid"
            />
            <text x={PAD_L - 10} y={yPrice(tick) + 4} textAnchor="end" className="chart-axis">
              {axisPrice(tick)}
            </text>
          </g>
        ))}
        {dateMarks.map((index) => (
          <line
            key={`grid-${bars[index].date}`}
            x1={xAt(index)}
            x2={xAt(index)}
            y1={PRICE_TOP}
            y2={PRICE_TOP + PRICE_H}
            className="chart-grid-v"
          />
        ))}

        {overlays.levels ? (
          <>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yPrice(support)}
              y2={yPrice(support)}
              className="chart-support"
            />
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yPrice(resistance)}
              y2={yPrice(resistance)}
              className="chart-resistance"
            />
          </>
        ) : null}

        {/* EMA Trend Ribbon Cloud */}
        {overlays.ema && ribbon ? (
          <g className="chart-ribbon-group">
            {ribbon.bullishPath ? <path d={ribbon.bullishPath} className="chart-ribbon-bullish" /> : null}
            {ribbon.bearishPath ? <path d={ribbon.bearishPath} className="chart-ribbon-bearish" /> : null}
          </g>
        ) : null}

        {/* Candlesticks */}
        {bars.map((bar, index) => {
          const up = bar.close >= bar.open;
          const x = xAt(index);
          const yHigh = yPrice(bar.high);
          const yLow = yPrice(bar.low);
          const yOpen = yPrice(bar.open);
          const yClose = yPrice(bar.close);
          const top = Math.min(yOpen, yClose);
          const candleHeight = Math.max(1.2, Math.abs(yClose - yOpen));
          return (
            <g key={bar.date} className={up ? "candle-up" : "candle-down"}>
              <line x1={x} x2={x} y1={yHigh} y2={yLow} />
              <rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={candleHeight} rx="0.6" />
            </g>
          );
        })}

        {/* EMA lines */}
        {overlays.ema ? (
          <>
            <path d={linePath(ema20, xAt, yPrice)} className="chart-ema20" />
            <path d={linePath(ema50, xAt, yPrice)} className="chart-ema50" />
          </>
        ) : null}

        {/* Support & Resistance tags */}
        {overlays.levels ? (
          <>
            <LevelTag
              x={PAD_L + 8}
              y={yPrice(support) + 16}
              anchor="start"
              text={`Support ${axisPrice(support)}`}
              tone="support"
            />
            <LevelTag
              x={WIDTH - PAD_R - 6}
              y={yPrice(resistance) - 8}
              anchor="end"
              text={`Resistance ${axisPrice(resistance)}`}
              tone="resistance"
            />
          </>
        ) : null}

        {/* Visual Swing Trade Levels */}
        {overlays.tradeLevels !== false && activeLevels.length > 0 ? (
          <g className="chart-trade-levels">
            {activeLevels.map((lvl) => (
              <g key={lvl.key}>
                <line
                  x1={PAD_L}
                  x2={WIDTH - PAD_R}
                  y1={yPrice(lvl.price)}
                  y2={yPrice(lvl.price)}
                  className={`chart-trade-line chart-line-${lvl.tone}`}
                  strokeDasharray={lvl.dash}
                />
                <TradeLevelTag
                  x={lvl.side === "left" ? PAD_L + 8 : WIDTH - PAD_R - 8}
                  y={yPrice(lvl.price)}
                  anchor={lvl.side === "left" ? "start" : "end"}
                  text={lvl.label}
                  tone={lvl.tone}
                />
              </g>
            ))}
          </g>
        ) : null}

        {/* Volume Subplot */}
        {hasVolume ? (
          <>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={PRICE_TOP + PRICE_H + 12}
              y2={PRICE_TOP + PRICE_H + 12}
              className="chart-pane-divider"
            />
            <text x={PAD_L} y={volumeTop - 6} className="chart-pane-label">
              Volume
            </text>
            <rect
              x={PAD_L}
              y={volumeTop}
              width={WIDTH - PAD_L - PAD_R}
              height={VOL_H}
              className="chart-subplot"
            />
            {bars.map((bar, index) => {
              const volume = bar.volume ?? 0;
              if (volume <= 0) return null;
              const x = xAt(index);
              const y = yVolume(volume);
              const barHeight = Math.max(1.5, volumeTop + VOL_H - y);
              return (
                <rect
                  key={`vol-${bar.date}`}
                  x={x - bodyWidth / 2}
                  y={y}
                  width={bodyWidth}
                  height={barHeight}
                  className={bar.close >= bar.open ? "volume-up" : "volume-down"}
                />
              );
            })}
          </>
        ) : null}

        {/* MACD Subplot */}
        {overlays.macd ? (
          <>
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={macdTop - 22}
              y2={macdTop - 22}
              className="chart-pane-divider"
            />
            <text x={PAD_L} y={macdTop - 8} className="chart-pane-label">
              MACD 12, 26, 9
            </text>
            <rect
              x={PAD_L}
              y={macdTop}
              width={WIDTH - PAD_L - PAD_R}
              height={MACD_H}
              className="chart-subplot"
            />
            <line
              x1={PAD_L}
              x2={WIDTH - PAD_R}
              y1={yMacd(0)}
              y2={yMacd(0)}
              className="chart-zero"
            />
            {macd.histogram.map((value, index) => {
              if (value == null) return null;
              const x = xAt(index);
              const y0 = yMacd(0);
              const y1 = yMacd(value);
              return (
                <rect
                  key={bars[index].date}
                  x={x - bodyWidth / 2}
                  y={Math.min(y0, y1)}
                  width={bodyWidth}
                  height={Math.max(1, Math.abs(y1 - y0))}
                  className={value >= 0 ? "hist-up" : "hist-down"}
                />
              );
            })}
            <path d={linePath(macd.line, xAt, yMacd)} className="chart-macd" />
            <path d={linePath(macd.signal, xAt, yMacd)} className="chart-signal" />
          </>
        ) : null}

        {/* Bottom Dates Axis */}
        {dateMarks.map((index) => (
          <text key={bars[index].date} x={xAt(index)} y={height - 6} textAnchor="middle" className="chart-axis">
            {bars[index].label}
          </text>
        ))}

        {/* Interactive Crosshair & Floating HUD */}
        {hoverIndex != null && bars[hoverIndex] ? (
          <g className="chart-crosshair-group">
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={PRICE_TOP}
              y2={PRICE_TOP + PRICE_H}
              className="chart-crosshair"
            />
            <g className="chart-hud-badge">
              <rect
                x={PAD_L + 6}
                y={PRICE_TOP + 6}
                width={WIDTH - PAD_L - PAD_R - 12}
                height={22}
                rx="6"
                className="chart-hud-bg"
              />
              <text x={PAD_L + 14} y={PRICE_TOP + 21} className="chart-hud-text">
                <tspan className="hud-date">{bars[hoverIndex].date}</tspan>
                <tspan dx="12">O: {axisPrice(bars[hoverIndex].open)}</tspan>
                <tspan dx="8">H: {axisPrice(bars[hoverIndex].high)}</tspan>
                <tspan dx="8">L: {axisPrice(bars[hoverIndex].low)}</tspan>
                <tspan dx="8">C: {axisPrice(bars[hoverIndex].close)}</tspan>
                <tspan
                  dx="8"
                  className={
                    bars[hoverIndex].close >= bars[hoverIndex].open ? "hud-chg-up" : "hud-chg-down"
                  }
                >
                  {bars[hoverIndex].close >= bars[hoverIndex].open ? "▲ +" : "▼ "}
                  {(
                    ((bars[hoverIndex].close - bars[hoverIndex].open) /
                      (bars[hoverIndex].open || 1)) *
                    100
                  ).toFixed(2)}
                  %
                </tspan>
                {bars[hoverIndex].volume ? (
                  <tspan dx="12" className="hud-vol">
                    Vol: {formatVolume(bars[hoverIndex].volume!)}
                  </tspan>
                ) : null}
              </text>
            </g>
          </g>
        ) : null}
      </svg>
      <ul className="chart-legend">
        {overlays.ema ? (
          <>
            <li>
              <span className="legend-line ema20" /> EMA 20
            </li>
            <li>
              <span className="legend-line ema50" /> EMA 50
            </li>
            <li>
              <span className="legend-line ribbon" /> Trend Ribbon
            </li>
          </>
        ) : null}
        {overlays.tradeLevels !== false && activeLevels.length > 0 ? (
          <>
            <li>
              <span className="legend-line target" /> Target (+12%)
            </li>
            <li>
              <span className="legend-line tranche1" /> Tranche 1 (+6%)
            </li>
            <li>
              <span className="legend-line entry" /> Entry
            </li>
            <li>
              <span className="legend-line stop" /> Stop Loss
            </li>
          </>
        ) : null}
        {overlays.levels ? (
          <>
            <li>
              <span className="legend-line support" /> Support
            </li>
            <li>
              <span className="legend-line resistance" /> Resistance
            </li>
          </>
        ) : null}
        {hasVolume ? (
          <li>
            <span className="legend-line volume" /> Volume
          </li>
        ) : null}
        {overlays.macd ? (
          <>
            <li>
              <span className="legend-line macd" /> MACD
            </li>
            <li>
              <span className="legend-line signal" /> Signal
            </li>
          </>
        ) : null}
      </ul>
    </div>
  );
}

function TradeLevelTag({
  x,
  y,
  anchor,
  text,
  tone,
}: {
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
  tone: "target" | "tranche1" | "entry" | "maxbuy" | "stop";
}) {
  const width = text.length * 6.8 + 18;
  const height = 20;
  const boxX = anchor === "end" ? x - width : x;
  const boxY = y - height / 2;
  return (
    <g className={`chart-trade-pill chart-pill-${tone}`}>
      <rect x={boxX} y={boxY} width={width} height={height} rx="4" />
      <text x={boxX + width / 2} y={boxY + 14} textAnchor="middle" className={`chart-trade-text chart-text-${tone}`}>
        {text}
      </text>
    </g>
  );
}

function LevelTag({
  x,
  y,
  anchor,
  text,
  tone,
}: {
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
  tone: "support" | "resistance";
}) {
  const width = text.length * 7.1 + 20;
  const height = 22;
  const boxX = anchor === "end" ? x - width : x;
  const boxY = y - 14;
  return (
    <g className={`chart-pill chart-pill-${tone}`}>
      <rect x={boxX} y={boxY} width={width} height={height} rx={height / 2} />
      <text x={boxX + width / 2} y={boxY + 14} textAnchor="middle" className={`chart-level chart-level-${tone}`}>
        {text}
      </text>
    </g>
  );
}

function chartLabel(analysis: ChartAnalysis): string {
  return `${analysis.symbol} sample candlestick chart. Last close ${analysis.lastClose.toFixed(2)} rupees. EMA 20 ${analysis.ema20Last.toFixed(2)}. EMA 50 ${analysis.ema50Last.toFixed(2)}. Support ${analysis.support}. Resistance ${analysis.resistance}.`;
}
