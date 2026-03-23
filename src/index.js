require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const requiredEnv = ["DISCORD_TOKEN", "CREATE_CHANNEL_ID"];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const temporaryRooms = new Map();
const creationLocks = new Set();

const PANEL_MESSAGE = "Используй кнопки ниже, чтобы управлять своей комнатой.";
const PANEL_BUTTONS = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId("room-panel:settings")
    .setLabel("Настройки")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("room-panel:lock")
    .setLabel("Открыть / Закрыть")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("room-panel:claim")
    .setLabel("Забрать комнату")
    .setStyle(ButtonStyle.Success),
);
const PANEL_ACTIONS = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId("room-panel:visibility")
    .setLabel("Скрыть / Показать")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("room-panel:kick")
    .setLabel("Кикнуть")
    .setStyle(ButtonStyle.Danger),
);

function buildRoomName(member) {
  const template = process.env.ROOM_NAME_TEMPLATE || "Комната {displayName}";
  return template
    .replaceAll("{displayName}", member.displayName)
    .replaceAll("{username}", member.user.username);
}

function getRoomRecord(channelId) {
  return temporaryRooms.get(channelId) || null;
}

function getMemberRoom(member) {
  if (!member.voice.channelId) {
    return null;
  }

  const record = getRoomRecord(member.voice.channelId);
  if (!record) {
    return null;
  }

  return { channel: member.voice.channel, record };
}

function isRoomOwner(member, record) {
  return member.id === record.ownerId;
}

function canClaimRoom(member, voiceChannel, record) {
  if (!record || record.ownerId === member.id) {
    return false;
  }

  return !voiceChannel.members.has(record.ownerId);
}

function buildPanelEmbed(room, ownerId) {
  const isLocked = room.permissionsFor(room.guild.roles.everyone)?.has(PermissionsBitField.Flags.Connect) === false;
  const isHidden = room.permissionsFor(room.guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) === false;

  return {
    color: 0x5865f2,
    title: "Панель управления комнатой",
    description: PANEL_MESSAGE,
    fields: [
      {
        name: "Владелец",
        value: `<@${ownerId}>`,
        inline: true,
      },
      {
        name: "Название",
        value: room.name,
        inline: true,
      },
      {
        name: "Лимит",
        value: room.userLimit === 0 ? "Без лимита" : String(room.userLimit),
        inline: true,
      },
      {
        name: "Доступ",
        value: isLocked ? "Закрыт" : "Открыт",
        inline: true,
      },
      {
        name: "Видимость",
        value: isHidden ? "Скрыта" : "Видна",
        inline: true,
      },
    ],
  };
}

async function ensurePanelMessage(room, ownerId) {
  const record = temporaryRooms.get(room.id);

  if (!record) {
    return;
  }

  const payload = {
    embeds: [buildPanelEmbed(room, ownerId)],
    components: [PANEL_BUTTONS, PANEL_ACTIONS],
  };

  if (record.panelMessageId) {
    try {
      const existingMessage = await room.messages.fetch(record.panelMessageId);
      await existingMessage.edit(payload);
      return;
    } catch (error) {
      record.panelMessageId = null;
    }
  }

  const panelMessage = await room.send(payload);
  record.panelMessageId = panelMessage.id;
}

async function refreshRoomPanel(room) {
  const record = temporaryRooms.get(room.id);

  if (!record) {
    return;
  }

  await ensurePanelMessage(room, record.ownerId);
}

function buildKickModal(channel) {
  const members = [...channel.members.values()].filter((member) => !member.user.bot);
  const placeholder = members
    .slice(0, 5)
    .map((member) => member.displayName)
    .join(", ");

  const userInput = new TextInputBuilder()
    .setCustomId("targetUser")
    .setLabel("ID пользователя или @упоминание")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(placeholder || "Вставь ID или @упоминание");

  return new ModalBuilder()
    .setCustomId(`room-panel:kick:${channel.id}`)
    .setTitle("Кикнуть пользователя")
    .addComponents(new ActionRowBuilder().addComponents(userInput));
}

function normalizeUserId(rawValue) {
  return rawValue.replace(/[<@!>\s]/g, "");
}

async function createTemporaryRoom(member) {
  const guild = member.guild;
  const triggerChannel = guild.channels.cache.get(process.env.CREATE_CHANNEL_ID);

  if (!triggerChannel || triggerChannel.type !== ChannelType.GuildVoice) {
      throw new Error("CREATE_CHANNEL_ID должен указывать на существующий голосовой канал.");
  }

  const parentId = process.env.TEMP_CATEGORY_ID || triggerChannel.parentId || null;
  const room = await guild.channels.create({
    name: buildRoomName(member),
    type: ChannelType.GuildVoice,
    parent: parentId,
    userLimit: 0,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.MoveMembers,
        ],
      },
    ],
  });

  temporaryRooms.set(room.id, {
    ownerId: member.id,
    createdAt: Date.now(),
    panelMessageId: null,
  });

  await ensurePanelMessage(room, member.id);

  return room;
}

async function deleteRoomIfEmpty(channel) {
  if (!channel || !temporaryRooms.has(channel.id)) {
    return;
  }

  if (channel.members.size > 0) {
    return;
  }

  temporaryRooms.delete(channel.id);
  await channel.delete("Temporary voice room is empty");
}

async function handleTriggerJoin(newState) {
  const member = newState.member;

  if (!member || creationLocks.has(member.id)) {
    return;
  }

  creationLocks.add(member.id);

  try {
    const room = await createTemporaryRoom(member);
    try {
      await member.voice.setChannel(room);
    } catch (error) {
      temporaryRooms.delete(room.id);
      await room.delete("Не удалось перенести создателя во временную комнату");
      throw error;
    }
  } finally {
    creationLocks.delete(member.id);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (
      newState.channelId &&
      newState.channelId !== oldState.channelId &&
      newState.channelId === process.env.CREATE_CHANNEL_ID
    ) {
      await handleTriggerJoin(newState);
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await deleteRoomIfEmpty(oldState.channel);
    }
  } catch (error) {
    console.error("VoiceStateUpdate error:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild()) {
    return;
  }

  try {
    if (interaction.isButton()) {
      const member = interaction.member;
      const roomInfo = getMemberRoom(member);

      if (!roomInfo) {
        await interaction.reply({
      content: "Ты должен находиться во временной комнате, чтобы пользоваться панелью.",
          ephemeral: true,
        });
        return;
      }

      const { channel, record } = roomInfo;

      if (interaction.customId === "room-panel:claim") {
        if (!canClaimRoom(member, channel, record)) {
          await interaction.reply({
            content: "Забрать комнату можно только после того, как текущий владелец выйдет.",
            ephemeral: true,
          });
          return;
        }

        const previousOwnerId = record.ownerId;
        record.ownerId = member.id;
        await channel.permissionOverwrites.edit(previousOwnerId, {
          ManageChannels: false,
          MoveMembers: false,
        });
        await channel.permissionOverwrites.edit(member.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          ManageChannels: true,
          MoveMembers: true,
        });
        await refreshRoomPanel(channel);
        await interaction.reply({
          content: `Теперь ты владелец комнаты ${channel.name}.`,
          ephemeral: true,
        });
        return;
      }

      if (!isRoomOwner(member, record)) {
        await interaction.reply({
          content: "Этой кнопкой может пользоваться только владелец комнаты.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "room-panel:settings") {
        const modal = new ModalBuilder()
          .setCustomId(`room-panel:settings:${channel.id}`)
          .setTitle("Настройки комнаты");

        const nameInput = new TextInputBuilder()
          .setCustomId("roomName")
          .setLabel("Название комнаты")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(channel.name);

        const limitInput = new TextInputBuilder()
          .setCustomId("roomLimit")
          .setLabel("Лимит участников (0-99)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(channel.userLimit));

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(limitInput),
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "room-panel:lock") {
        const everyoneRole = interaction.guild.roles.everyone;
        const isLocked =
          channel.permissionsFor(everyoneRole)?.has(PermissionsBitField.Flags.Connect) === false;

        await channel.permissionOverwrites.edit(everyoneRole, {
          Connect: isLocked,
        });
        await refreshRoomPanel(channel);
        await interaction.reply({
          content: isLocked ? "Комната открыта." : "Комната закрыта.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "room-panel:visibility") {
        const everyoneRole = interaction.guild.roles.everyone;
        const isHidden =
          channel.permissionsFor(everyoneRole)?.has(PermissionsBitField.Flags.ViewChannel) === false;

        await channel.permissionOverwrites.edit(everyoneRole, {
          ViewChannel: isHidden,
        });
        await refreshRoomPanel(channel);
        await interaction.reply({
          content: isHidden ? "Комната снова видна." : "Комната теперь скрыта.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "room-panel:kick") {
        await interaction.showModal(buildKickModal(channel));
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("room-panel:settings:")) {
      const member = interaction.member;
      const roomInfo = getMemberRoom(member);

      if (!roomInfo) {
        await interaction.reply({
          content: "Ты должен находиться во временной комнате, чтобы менять ее настройки.",
          ephemeral: true,
        });
        return;
      }

      const { channel, record } = roomInfo;

      if (!isRoomOwner(member, record)) {
        await interaction.reply({
          content: "Менять комнату может только ее владелец.",
          ephemeral: true,
        });
        return;
      }

      const roomName = interaction.fields.getTextInputValue("roomName").trim();
      const limitRaw = interaction.fields.getTextInputValue("roomLimit").trim();
      const limit = Number(limitRaw);

      if (!roomName) {
        await interaction.reply({
          content: "Название комнаты не может быть пустым.",
          ephemeral: true,
        });
        return;
      }

      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await interaction.reply({
          content: "Лимит участников должен быть целым числом от 0 до 99.",
          ephemeral: true,
        });
        return;
      }

      await channel.setName(roomName);
      await channel.setUserLimit(limit);
      await refreshRoomPanel(channel);
      await interaction.reply({
        content: "Настройки комнаты обновлены.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("room-panel:kick:")) {
      const member = interaction.member;
      const roomInfo = getMemberRoom(member);

      if (!roomInfo) {
        await interaction.reply({
          content: "Ты должен находиться во временной комнате, чтобы кикнуть участника.",
          ephemeral: true,
        });
        return;
      }

      const { channel, record } = roomInfo;

      if (!isRoomOwner(member, record)) {
        await interaction.reply({
          content: "Кикать участников может только владелец комнаты.",
          ephemeral: true,
        });
        return;
      }

      const targetUserId = normalizeUserId(interaction.fields.getTextInputValue("targetUser"));
      const targetMember = channel.members.get(targetUserId);

      if (!targetMember) {
        await interaction.reply({
          content: "Пользователь не найден в комнате. Укажи ID или @упоминание участника, который находится внутри.",
          ephemeral: true,
        });
        return;
      }

      if (targetMember.id === member.id) {
        await interaction.reply({
          content: "Нельзя кикнуть самого себя из своей комнаты.",
          ephemeral: true,
        });
        return;
      }

      await targetMember.voice.disconnect("Kicked by temporary room owner");
      await interaction.reply({
        content: `${targetMember.displayName} был удален из комнаты.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("InteractionCreate error:", error);

    const replyPayload = {
      content: "Произошла ошибка при обработке команды комнаты.",
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyPayload);
      return;
    }

    await interaction.reply(replyPayload);
  }
});

client.login(process.env.DISCORD_TOKEN);
