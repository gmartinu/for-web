import type {
  LocalTrackPublication,
  TrackPublishOptions,
} from "livekit-client";
import type { Client } from "stoat.js";

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
 * `voice` object as sent by the API.
 *
 * NB. `max_bitrate` is not exposed by stoat.js: the channel hydration maps
 * `voice` to `{ maxUsers }` only, so the field is dropped from the store. We
 * therefore read it straight from the API here, in a single place, instead of
 * spreading casts around. Once stoat.js hydrates `max_bitrate`, this module
 * should read it from the channel object instead.
 */
export type VoiceInformationWithBitrate = {
  max_users?: number | null;
  max_bitrate?: number | null;
};

/**
 * Default bitrate presented in the UI when the channel has none configured
 */
export const DEFAULT_AUDIO_BITRATE = 64000;

/**
 * Last known bitrate per channel id
 */
const cache = new Map<string, number | undefined>();

/**
 * Clamp a bitrate to the accepted range
 */
export function clampAudioBitrate(value: number) {
  return Math.min(MAX_AUDIO_BITRATE, Math.max(MIN_AUDIO_BITRATE, value));
}

/**
 * Read the last known bitrate for a channel without hitting the network
 */
export function cachedChannelMaxBitrate(channelId: string) {
  return cache.get(channelId);
}

/**
 * Record a bitrate locally (e.g. right after saving channel settings)
 */
export function setCachedChannelMaxBitrate(
  channelId: string,
  value?: number | null,
) {
  cache.set(channelId, value ?? undefined);
}

/**
 * Fetch the configured audio bitrate of a channel
 * @param client Client
 * @param channelId Channel id
 * @returns Bitrate in bits per second, or undefined for the server default
 */
export async function getChannelVoiceInfo(
  client: Client,
  channelId: string,
): Promise<VoiceInformationWithBitrate | undefined> {
  const channel = await client.api.get(`/channels/${channelId as ""}`);

  const voice = (channel as { voice?: VoiceInformationWithBitrate | null })
    .voice;

  cache.set(channelId, voice?.max_bitrate ?? undefined);
  return voice ?? undefined;
}

/**
 * Fetch the configured audio bitrate of a channel
 * @param client Client
 * @param channelId Channel id
 * @returns Bitrate in bits per second, or undefined for the server default
 */
export async function getChannelMaxBitrate(
  client: Client,
  channelId: string,
): Promise<number | undefined> {
  try {
    const voice = await getChannelVoiceInfo(client, channelId);
    return voice?.max_bitrate ?? undefined;
  } catch {
    return cache.get(channelId);
  }
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
