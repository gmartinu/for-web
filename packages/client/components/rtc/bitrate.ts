import type {
  LocalTrackPublication,
  TrackPublishOptions,
} from "livekit-client";
import type { Channel } from "stoat.js";

/**
 * Bitrate range exposed to users (bits per second of Opus audio).
 *
 * Matches the backend constraint (8000..=510000) but is capped at a
 * Discord-like 96 kbps in the UI.
 */
export const MIN_AUDIO_BITRATE = 8000;
export const MAX_AUDIO_BITRATE = 96000;
export const AUDIO_BITRATE_STEP = 8000;

/**
 * Bitrate above which users on poor connections start to suffer
 */
export const AUDIO_BITRATE_WARN_THRESHOLD = 64000;

/**
 * Default bitrate presented in the UI when the channel has none configured
 */
export const DEFAULT_AUDIO_BITRATE = 64000;

/**
 * Clamp a bitrate to the accepted range
 */
export function clampAudioBitrate(value: number) {
  return Math.min(MAX_AUDIO_BITRATE, Math.max(MIN_AUDIO_BITRATE, value));
}

/**
 * Read the configured audio bitrate of a channel.
 *
 * stoat.js hydrates `voice.maxBitrate` from the API and keeps it up to date
 * through `ChannelUpdate`, so this is a synchronous read off the store.
 *
 * @param channel Channel
 * @returns Bitrate in bits per second, or undefined for the server default
 */
export function getChannelMaxBitrate(
  channel: Channel | undefined,
): number | undefined {
  return channel?.voice?.maxBitrate ?? undefined;
}

/**
 * Build publish options for an audio track
 * @param bitrate Bitrate in bits per second
 */
export function audioPublishOptions(
  bitrate?: number,
): TrackPublishOptions | undefined {
  return typeof bitrate === "number"
    ? { audioPreset: { maxBitrate: clampAudioBitrate(bitrate) } }
    : undefined;
}

/**
 * Apply a new bitrate to an already published microphone track.
 *
 * livekit-client 2.20 has no API to change publish options after the fact, so
 * we go through the underlying sender parameters; this takes effect without
 * renegotiating or dropping the track.
 *
 * @param publication Microphone publication
 * @param bitrate Bitrate in bits per second
 */
export async function applyLiveAudioBitrate(
  publication: LocalTrackPublication | undefined,
  bitrate?: number,
) {
  const sender = publication?.track?.sender;
  if (!sender || typeof bitrate !== "number") return;

  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;

    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = clampAudioBitrate(bitrate);
    }

    await sender.setParameters(parameters);
  } catch (err) {
    console.debug("Failed to apply audio bitrate live", err);
  }
}
