import { Accessor, For, Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { styled } from "styled-system/jsx";

import { ConnectionStats } from "@revolt/rtc";

/** How much history the graph shows, in milliseconds */
const WINDOW = 5 * 60 * 1000;

/** Graph geometry, in SVG user units */
const GEOMETRY = {
  width: 280,
  height: 110,
  left: 34,
  right: 6,
  top: 8,
  bottom: 18,
};

const PLOT_WIDTH = GEOMETRY.width - GEOMETRY.left - GEOMETRY.right;
const PLOT_HEIGHT = GEOMETRY.height - GEOMETRY.top - GEOMETRY.bottom;

/** Above this round trip time a call starts to feel laggy */
const LAG_THRESHOLD = 250;

type Props = {
  /** Live statistics for the participant */
  stats: Accessor<ConnectionStats>;
  /** Whether these statistics describe ourselves */
  isLocal: boolean;
};

/**
 * Round trip time graph plus a breakdown of the current transport statistics,
 * shown when clicking a participant's connection quality badge.
 */
export function ConnectionStatsPopover(props: Props) {
  const { t } = useLingui();

  const unknown = "—";

  /**
   * Samples inside the graph window, projected into SVG coordinates
   */
  const graph = createMemo(() => {
    const now = Date.now();
    const samples = props
      .stats()
      .history.filter((sample) => now - sample.timestamp <= WINDOW);

    const peak = samples.reduce((max, sample) => Math.max(max, sample.rtt), 0);
    // Round the axis up to a sensible multiple so it does not jitter about
    const scale = Math.max(100, Math.ceil(peak / 50) * 50);

    const points = samples.map((sample) => {
      const x =
        GEOMETRY.left + (1 - (now - sample.timestamp) / WINDOW) * PLOT_WIDTH;
      const y =
        GEOMETRY.top + (1 - Math.min(sample.rtt, scale) / scale) * PLOT_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return { points, scale, count: samples.length };
  });

  /**
   * Horizontal grid lines, from the top of the axis down to zero
   */
  const yTicks = () =>
    [1, 0.5, 0].map((fraction) => ({
      label: Math.round(graph().scale * fraction).toString(),
      y: GEOMETRY.top + (1 - fraction) * PLOT_HEIGHT,
    }));

  /**
   * Time marks along the bottom, one per minute
   */
  const xTicks = () =>
    [5, 4, 3, 2, 1, 0].map((minutes) => ({
      label: minutes === 0 ? t`now` : `-${minutes}m`,
      x: GEOMETRY.left + (1 - (minutes * 60 * 1000) / WINDOW) * PLOT_WIDTH,
    }));

  /**
   * Mean round trip time over the graphed window
   */
  const average = () => {
    const samples = props.stats().history;
    if (!samples.length) return unknown;
    const total = samples.reduce((sum, sample) => sum + sample.rtt, 0);
    return Math.round(total / samples.length).toString();
  };

  const last = () => {
    const value = props.stats().rtt;
    return typeof value === "number" ? Math.round(value).toString() : unknown;
  };

  const loss = () => {
    const value = props.stats().loss;
    return typeof value === "number" ? value.toFixed(1) : unknown;
  };

  const jitter = () => {
    const value = props.stats().jitter;
    return typeof value === "number" ? Math.round(value).toString() : unknown;
  };

  return (
    <Base
      // keep the popover open when interacting with it
      onpointerdown={(event) => event.stopImmediatePropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Title>{t`Connection`}</Title>

      <Chart
        viewBox={`0 0 ${GEOMETRY.width} ${GEOMETRY.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t`Round trip time over the last five minutes`}
      >
        <For each={yTicks()}>
          {(tick) => (
            <>
              <line
                x1={GEOMETRY.left}
                x2={GEOMETRY.width - GEOMETRY.right}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--md-sys-color-outline-variant)"
                stroke-width="1"
              />
              <text
                x={GEOMETRY.left - 5}
                y={tick.y + 3}
                text-anchor="end"
                font-size="9"
                fill="var(--md-sys-color-on-surface-variant)"
              >
                {tick.label}
              </text>
            </>
          )}
        </For>

        <text
          x={2}
          y={GEOMETRY.top - 1}
          font-size="9"
          fill="var(--md-sys-color-on-surface-variant)"
        >
          ms
        </text>

        <For each={xTicks()}>
          {(tick) => (
            <text
              x={tick.x}
              y={GEOMETRY.height - 5}
              text-anchor="middle"
              font-size="9"
              fill="var(--md-sys-color-on-surface-variant)"
            >
              {tick.label}
            </text>
          )}
        </For>

        <Show
          when={graph().count > 1}
          fallback={
            <text
              x={GEOMETRY.left + PLOT_WIDTH / 2}
              y={GEOMETRY.top + PLOT_HEIGHT / 2}
              text-anchor="middle"
              font-size="9"
              fill="var(--md-sys-color-on-surface-variant)"
            >
              {t`Collecting data…`}
            </text>
          }
        >
          <polyline
            points={graph().points.join(" ")}
            fill="none"
            stroke="var(--md-sys-color-primary)"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </Show>
      </Chart>

      <Rows>
        <Row>{t`Average ping: ${average()} ms`}</Row>
        <Row>{t`Last ping: ${last()} ms`}</Row>
        <Row>
          {props.isLocal
            ? t`Sent packet loss rate: ${loss()}%`
            : t`Received packet loss rate: ${loss()}%`}
        </Row>
        <Row>{t`Jitter: ${jitter()} ms`}</Row>
      </Rows>

      <Hint>{t`You may notice audio delay above ${LAG_THRESHOLD} ms.`}</Hint>
    </Base>
  );
}

const Base = styled("div", {
  base: {
    width: "280px",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md) var(--gap-lg)",

    borderRadius: "var(--borderRadius-xs)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 0 3px var(--md-sys-color-shadow)",

    userSelect: "none",
  },
});

const Title = styled("div", {
  base: {
    fontWeight: 600,
    fontSize: "0.875rem",
  },
});

const Chart = styled("svg", {
  base: {
    width: "100%",
    height: "110px",
    overflow: "visible",
  },
});

const Rows = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});

const Row = styled("div", {
  base: {
    fontSize: "0.75rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Hint = styled("div", {
  base: {
    fontSize: "0.6875rem",
    color: "var(--md-sys-color-on-surface-variant)",
    opacity: 0.8,
  },
});
