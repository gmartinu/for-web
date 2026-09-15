import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { useEnsureParticipant } from "solid-livekit-components";

import { ConnectionQuality } from "livekit-client";

import { useConnectionStats } from "@revolt/rtc";

import { Symbol } from "../../utils/Symbol";

import { ConnectionStatsPopover } from "./ConnectionStatsPopover";

/**
 * Icon used for each connection quality bucket.
 */
const SYMBOLS: Record<ConnectionQuality, string> = {
  [ConnectionQuality.Excellent]: "signal_cellular_alt",
  [ConnectionQuality.Good]: "signal_cellular_alt_2_bar",
  [ConnectionQuality.Poor]: "signal_cellular_alt_1_bar",
  [ConnectionQuality.Lost]: "signal_cellular_off",
  [ConnectionQuality.Unknown]: "signal_cellular_nodata",
};

/**
 * Colour used for each connection quality bucket; excellent and good are left
 * unstyled so that a healthy connection does not draw attention.
 */
const COLOURS: Partial<Record<ConnectionQuality, string>> = {
  [ConnectionQuality.Poor]: "var(--md-sys-color-tertiary)",
  [ConnectionQuality.Lost]: "var(--md-sys-color-error)",
};

/**
 * Small connection quality indicator for a participant, with a tooltip
 * breaking down round trip time, packet loss and jitter, and a popover
 * graphing the round trip time over time when clicked.
 */
export function ConnectionQualityBadge() {
  const { t } = useLingui();
  const participant = useEnsureParticipant();
  const stats = useConnectionStats(participant);

  const unknown = "—";

  const rtt = () => {
    const value = stats().rtt;
    return typeof value === "number" ? Math.round(value).toString() : unknown;
  };

  const loss = () => {
    const value = stats().loss;
    return typeof value === "number" ? value.toFixed(1) : unknown;
  };

  const jitter = () => {
    const value = stats().jitter;
    return typeof value === "number" ? Math.round(value).toString() : unknown;
  };

  const tooltip = () =>
    t`RTT ${rtt()} ms · loss ${loss()}% · jitter ${jitter()} ms`;

  return (
    <Show when={stats().quality !== ConnectionQuality.Unknown}>
      {/* the directive has to live on a real element: `Symbol` renders a
          Panda styled component, which would only spread it as an attribute */}
      <span
        style={{ display: "flex", cursor: "pointer" }}
        use:floating={{
          tooltip: {
            placement: "top",
            content: tooltip(),
          },
          contextMenu: () => (
            <ConnectionStatsPopover
              stats={stats}
              isLocal={participant.isLocal}
            />
          ),
          contextMenuHandler: "click",
        }}
      >
        <Symbol size={16} color={COLOURS[stats().quality]}>
          {SYMBOLS[stats().quality]}
        </Symbol>
      </span>
    </Show>
  );
}
