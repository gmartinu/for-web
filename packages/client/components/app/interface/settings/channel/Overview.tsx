import { createFormControl, createFormGroup } from "solid-forms";
import { Match, Show, Switch } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import type { API } from "stoat.js";

import { useClient } from "@revolt/client";
import { useDurationFormat } from "@revolt/i18n/durations";
import { useInstance } from "@revolt/instance";
import { useModals } from "@revolt/modal";
import {
  AUDIO_BITRATE_STEP,
  AUDIO_BITRATE_WARN_THRESHOLD,
  DEFAULT_AUDIO_BITRATE,
  MAX_AUDIO_BITRATE,
  MIN_AUDIO_BITRATE,
  getChannelMaxBitrate,
  useVoice,
} from "@revolt/rtc";
import {
  Button,
  CircularProgress,
  Column,
  Form2,
  MenuItem,
  Row,
  Slider,
  Text,
} from "@revolt/ui";

import { ChannelSettingsProps } from "../ChannelSettings";

/**
 * Channel overview
 */
export default function ChannelOverview(props: ChannelSettingsProps) {
  const { t } = useLingui();
  const client = useClient();
  const { openModal } = useModals();
  const instance = useInstance();
  const duration = useDurationFormat();
  const voice = useVoice();

  // eslint-disable-next-line solid/reactivity
  const isVoiceChannel = props.channel.isVoice;

  /**
   * Bitrate currently stored on the channel; stoat.js hydrates it and keeps it
   * up to date through `ChannelUpdate`, so no fetch is needed.
   */
  const channelBitrate = () => getChannelMaxBitrate(props.channel);

  /* eslint-disable solid/reactivity */
  // we want to take the initial value only
  const editGroup = createFormGroup({
    name: createFormControl(props.channel.name),
    description: createFormControl(props.channel.description || ""),
    icon: createFormControl<string | File[] | null>(
      props.channel.animatedIconURL,
    ),
    slowmode: createFormControl<string>(
      props.channel.slowmode.toString() ?? "0",
    ),
    bitrate: createFormControl<number>(
      getChannelMaxBitrate(props.channel) ?? DEFAULT_AUDIO_BITRATE,
    ),
  });
  /* eslint-enable solid/reactivity */

  function onReset() {
    editGroup.controls.name.setValue(props.channel.name);
    editGroup.controls.description.setValue(props.channel.description || "");
    editGroup.controls.icon.setValue(props.channel.animatedIconURL ?? null);
    editGroup.controls.slowmode.setValue(
      props.channel.slowmode.toString() ?? "0",
    );
    editGroup.controls.bitrate.setValue(
      channelBitrate() ?? DEFAULT_AUDIO_BITRATE,
    );
    editGroup.controls.bitrate.markDirty(false);
  }

  async function onSubmit() {
    const changes: API.DataEditChannel = {
      remove: [],
    };

    if (editGroup.controls.name.isDirty) {
      changes.name = editGroup.controls.name.value.trim();
    }

    if (editGroup.controls.description.isDirty) {
      const description = editGroup.controls.description.value.trim();

      if (description) {
        changes.description = description;
      } else {
        changes.remove!.push("Description");
      }
    }

    if (editGroup.controls.icon.isDirty) {
      if (!editGroup.controls.icon.value) {
        changes.remove!.push("Icon");
      } else if (Array.isArray(editGroup.controls.icon.value)) {
        const body = new FormData();
        body.append("file", editGroup.controls.icon.value[0]);

        const [key, value] = client().authenticationHeader;
        const data: { id: string } = await fetch(`${instance.mediaUrl}/icons`, {
          method: "POST",
          body,
          headers: {
            [key]: value,
          },
        }).then((res) => res.json());

        changes.icon = data.id;
      }
    }

    if (editGroup.controls.slowmode.isDirty) {
      changes.slowmode = Number(editGroup.controls.slowmode.value);
    }

    const bitrate = editGroup.controls.bitrate.value;
    const bitrateChanged = isVoiceChannel && editGroup.controls.bitrate.isDirty;

    if (bitrateChanged) {
      // `voice` is typed without `max_bitrate` in stoat-api; keep the other
      // voice fields intact when patching
      changes.voice = {
        max_users: props.channel.voice?.maxUsers,
        max_bitrate: bitrate,
      } as NonNullable<API.DataEditChannel["voice"]>;
    }

    await props.channel.edit(changes);

    if (bitrateChanged) {
      editGroup.controls.bitrate.markDirty(false);
      await voice.updateChannelMaxBitrate(props.channel.id, bitrate);
    }
  }

  const submit = Form2.useSubmitHandler(editGroup, onSubmit, onReset);

  return (
    <Column gap="xl">
      <form onSubmit={submit}>
        <Column>
          <Text class="label">
            <Trans>Channel Info</Trans>
          </Text>
          <Form2.FileInput
            control={editGroup.controls.icon}
            accept="image/*"
            maxSize={instance.limits().file_upload_size_limits["icons"]}
          />
          <Form2.TextField
            minlength={1}
            maxlength={32}
            counter
            name="name"
            control={editGroup.controls.name}
            label={t`Channel Name`}
          />
          <Form2.TextField
            autosize
            min-rows={2}
            maxlength={1024}
            counter
            name="description"
            control={editGroup.controls.description}
            label={t`Channel Description`}
            placeholder={t`This channel is about...`}
          />
          <Show when={props.channel.type === "TextChannel"}>
            <Form2.Select
              label={t`Channel Slowmode`}
              control={editGroup.controls.slowmode}
            >
              <MenuItem value="0">
                <Trans>Slowmode off</Trans>
              </MenuItem>
              <MenuItem value="5">{duration({ seconds: 5 })}</MenuItem>
              <MenuItem value="10">{duration({ seconds: 10 })}</MenuItem>
              <MenuItem value="30">{duration({ seconds: 30 })}</MenuItem>
              <MenuItem value="60">{duration({ minutes: 1 })}</MenuItem>
              <MenuItem value="300">{duration({ minutes: 5 })}</MenuItem>
              <MenuItem value="600">{duration({ minutes: 10 })}</MenuItem>
              <MenuItem value="1800">{duration({ minutes: 30 })}</MenuItem>
              <MenuItem value="3600">{duration({ hours: 1 })}</MenuItem>
              <MenuItem value="7200">{duration({ hours: 2 })}</MenuItem>
              <MenuItem value="21600">{duration({ hours: 6 })}</MenuItem>
            </Form2.Select>
          </Show>
          <Show when={isVoiceChannel}>
            <Text class="label">
              <Trans>Bitrate</Trans>
            </Text>
            <Slider
              min={MIN_AUDIO_BITRATE}
              max={MAX_AUDIO_BITRATE}
              step={AUDIO_BITRATE_STEP}
              tickmarks
              value={editGroup.controls.bitrate.value}
              labelFormatter={(value) => `${Math.round(value / 1000)} kbps`}
              onInput={(event) => {
                editGroup.controls.bitrate.setValue(
                  Number(event.currentTarget.value),
                );
                editGroup.controls.bitrate.markDirty(
                  Number(event.currentTarget.value) !==
                    (channelBitrate() ?? DEFAULT_AUDIO_BITRATE),
                );
              }}
            />
            <div
              style={{ display: "flex", "justify-content": "space-between" }}
            >
              <Text class="label">8</Text>
              <Text class="label">64</Text>
              <Text class="label">96</Text>
            </div>
            <Text>
              {t`${Math.round(editGroup.controls.bitrate.value / 1000)} kbps`}
            </Text>
            <Show
              when={
                editGroup.controls.bitrate.value > AUDIO_BITRATE_WARN_THRESHOLD
              }
            >
              <Text>
                <Trans>
                  Going above 64 kbps may negatively affect people with poor
                  connections.
                </Trans>
              </Text>
            </Show>
          </Show>
          <Row>
            <Form2.Reset group={editGroup} onReset={onReset} />
            <Form2.Submit group={editGroup} requireDirty>
              <Trans>Save</Trans>
            </Form2.Submit>
            <Show when={editGroup.isPending}>
              <CircularProgress />
            </Show>
          </Row>
        </Column>
      </form>
      <Column>
        <Text class="label">
          <Trans>Mark as Mature</Trans>
        </Text>
        <Text>
          <Trans>
            Users will be asked to confirm their age before opening this
            channel.
          </Trans>
        </Text>
        <div>
          <Button
            onPress={() =>
              openModal({
                type: "channel_toggle_mature",
                channel: props.channel,
              })
            }
          >
            <Switch fallback={<Trans>Mark as Mature</Trans>}>
              <Match when={props.channel.mature}>
                <Trans>Unmark as Mature</Trans>
              </Match>
            </Switch>
          </Button>
        </div>
      </Column>
    </Column>
  );
}
