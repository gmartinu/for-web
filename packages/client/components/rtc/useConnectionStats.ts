import { createSignal, onCleanup, onMount } from "solid-js";

import {
  ConnectionQuality,
  LocalTrack,
  Participant,
  ParticipantEvent,
  RemoteTrack,
} from "livekit-client";

/**
 * Connection statistics for a single participant.
 */
export type RttSample = {
  /** When the sample was taken (epoch milliseconds) */
  timestamp: number;
  /** Round trip time in milliseconds */
  rtt: number;
};

export type ConnectionStats = {
  /** Quality bucket reported by the SFU */
  quality: ConnectionQuality;
  /** Round trip time in milliseconds, if known */
  rtt?: number;
  /** Packet loss over the last sampling window, as a percentage (0-100) */
  loss?: number;
  /** Jitter in milliseconds, if known */
  jitter?: number;
  /** Recent round trip times, oldest first */
  history: readonly RttSample[];
};

/** How often we poll `getRTCStatsReport` */
const POLL_INTERVAL = 2000;

/**
 * How many RTT samples we keep around; at one sample every two seconds this
 * covers the last five minutes, which is what the connection popover graphs.
 */
const HISTORY_LIMIT = 150;

/**
 * Cumulative counters from the previous poll, used to turn the monotonically
 * increasing packet counters into a rate over the sampling window.
 */
type Cumulative = {
  lost: number;
  total: number;
};

/**
 * Pick the track we should read statistics from.
 *
 * Both local (published) and remote (subscribed) tracks expose
 * `getRTCStatsReport()`; we prefer the microphone track since it is the one
 * track every participant in a call is expected to have.
 */
function findStatsTrack(
  participant: Participant,
): LocalTrack | RemoteTrack | undefined {
  const publications = [
    ...participant.audioTrackPublications.values(),
    ...participant.videoTrackPublications.values(),
  ];

  for (const publication of publications) {
    const track = publication.track;
    if (
      track &&
      typeof (track as never as LocalTrack).getRTCStatsReport === "function"
    ) {
      return track as LocalTrack | RemoteTrack;
    }
  }

  return undefined;
}

/**
 * Read RTT / jitter / packet loss out of an `RTCStatsReport`.
 *
 * For remote participants the interesting entry is `inbound-rtp` (what we
 * actually received). For the local participant we published the track, so the
 * receiver's view of it comes back as `remote-inbound-rtp`. RTT is only
 * reported on the remote side, so we fall back to the selected ICE candidate
 * pair when it isn't available.
 */
function readReport(
  report: RTCStatsReport,
  previous: Cumulative | undefined,
): {
  stats: Omit<ConnectionStats, "quality" | "history">;
  cumulative?: Cumulative;
} {
  let rtt: number | undefined;
  let jitter: number | undefined;
  let lost: number | undefined;
  let total: number | undefined;

  report.forEach((entry: Record<string, unknown>) => {
    const type = entry["type"];

    if (type === "inbound-rtp") {
      const received = entry["packetsReceived"];
      const packetsLost = entry["packetsLost"];

      if (typeof packetsLost === "number") lost = packetsLost;
      if (typeof received === "number")
        total = received + (typeof packetsLost === "number" ? packetsLost : 0);
      if (typeof entry["jitter"] === "number")
        jitter = (entry["jitter"] as number) * 1000;
    } else if (type === "remote-inbound-rtp") {
      // The far end telling us how our outbound stream arrived
      const packetsLost = entry["packetsLost"];
      if (typeof packetsLost === "number") lost = packetsLost;
      if (typeof entry["jitter"] === "number")
        jitter = (entry["jitter"] as number) * 1000;
      if (typeof entry["roundTripTime"] === "number")
        rtt = (entry["roundTripTime"] as number) * 1000;
    } else if (type === "outbound-rtp") {
      const sent = entry["packetsSent"];
      if (typeof sent === "number") total = sent;
    } else if (type === "candidate-pair" && entry["nominated"]) {
      if (
        rtt === undefined &&
        typeof entry["currentRoundTripTime"] === "number"
      )
        rtt = (entry["currentRoundTripTime"] as number) * 1000;
    }
  });

  if (lost === undefined || total === undefined) {
    return { stats: { rtt, jitter } };
  }

  const cumulative: Cumulative = { lost, total };

  // Counters are cumulative for the lifetime of the track; diff them against
  // the previous sample so the figure reflects the last couple of seconds.
  let loss: number | undefined;
  if (previous) {
    const deltaLost = lost - previous.lost;
    const deltaTotal = total - previous.total;
    if (deltaTotal > 0 && deltaLost >= 0) {
      loss = (deltaLost / deltaTotal) * 100;
    } else if (deltaTotal === 0) {
      loss = 0;
    }
  }

  return { stats: { rtt, jitter, loss }, cumulative };
}

/**
 * Track live connection quality and transport statistics for a participant.
 *
 * Quality comes from the SFU via `ParticipantEvent.ConnectionQualityChanged`;
 * RTT, jitter and packet loss are polled off the participant's tracks every
 * couple of seconds. Everything degrades gracefully to `undefined` when there
 * is no track to read from (e.g. a participant who has not published or whose
 * tracks we have not subscribed to).
 */
export function useConnectionStats(participant: Participant) {
  const [stats, setStats] = createSignal<ConnectionStats>({
    quality: participant.connectionQuality,
    history: [],
  });

  onMount(() => {
    const onQualityChanged = (quality: ConnectionQuality) =>
      setStats((previous) => ({ ...previous, quality }));

    participant.on(ParticipantEvent.ConnectionQualityChanged, onQualityChanged);

    let previous: Cumulative | undefined;
    let cancelled = false;

    // Ring buffer of round trip times; kept outside of the signal so that a
    // poll which produces no RTT does not throw away the existing history.
    const history: RttSample[] = [];

    /**
     * Record a round trip time sample, dropping the oldest once full
     */
    function record(rtt: number | undefined) {
      if (typeof rtt !== "number" || !Number.isFinite(rtt)) return;
      history.push({ timestamp: Date.now(), rtt });
      if (history.length > HISTORY_LIMIT) history.shift();
    }

    const poll = async () => {
      const track = findStatsTrack(participant);
      if (!track) {
        previous = undefined;
        setStats((current) => ({
          quality: current.quality,
          history: current.history,
        }));
        return;
      }

      let report: RTCStatsReport | undefined;
      try {
        report = await track.getRTCStatsReport();
      } catch {
        // Track may have been unpublished mid-flight; nothing useful to show
        report = undefined;
      }

      if (cancelled) return;

      if (!report) {
        previous = undefined;
        setStats((current) => ({
          quality: current.quality,
          history: current.history,
        }));
        return;
      }

      const { stats: sample, cumulative } = readReport(report, previous);
      previous = cumulative;

      record(sample.rtt);

      setStats((current) => ({
        quality: current.quality,
        ...sample,
        history: [...history],
      }));
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL);

    onCleanup(() => {
      cancelled = true;
      clearInterval(interval);
      participant.off(
        ParticipantEvent.ConnectionQualityChanged,
        onQualityChanged,
      );
    });
  });

  return stats;
}
