# room-bot

Discord bot for temporary voice rooms.

## Features

- When a user joins the configured voice channel, the bot creates a temporary voice room.
- The bot moves the user into the new room automatically.
- The bot posts a Russian control panel inside the room chat with buttons for management.
- The room owner can open modal windows, change the room name, set the user limit, hide or show the room, lock or unlock access, and remove users.
- Empty temporary rooms are deleted automatically.
- A member can claim a room if the owner has left it.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Fill in the values in `.env`.
5. Start the bot with `npm start`.

## PM2

1. Install PM2 globally: `npm install -g pm2`
2. Copy the project to `/opt/room-bot`
3. Edit `cwd` in [ecosystem.config.cjs](C:\Users\Artem\Documents\room-bot\ecosystem.config.cjs#L1) if your path is different.
4. Make sure `.env` exists in the project root. PM2 will load it automatically.
5. Start the bot: `pm2 start ecosystem.config.cjs`
6. Save autostart: `pm2 save`
7. Enable PM2 on boot: `pm2 startup`

## systemd

1. Copy the project to `/opt/room-bot`
2. Create a Linux user if needed: `sudo useradd -r -s /usr/sbin/nologin room-bot`
3. Give ownership to that user: `sudo chown -R room-bot:room-bot /opt/room-bot`
4. Copy [deploy/room-bot.service](C:\Users\Artem\Documents\room-bot\deploy\room-bot.service#L1) to `/etc/systemd/system/room-bot.service`
5. Make sure `.env` exists in `/opt/room-bot/.env`.
6. If `node` is installed in another path, fix `ExecStart` in the service file.
7. Reload services: `sudo systemctl daemon-reload`
8. Enable and start the bot:
   `sudo systemctl enable room-bot`
   `sudo systemctl start room-bot`
9. Check status: `sudo systemctl status room-bot`

## Required Bot Permissions

- `View Channels`
- `Manage Channels`
- `Connect`
- `Move Members`
- `Read Messages/View Channels`
- `Send Messages`
- `Read Message History`

Also enable the `Server Members Intent` in the Discord Developer Portal.

## Environment Variables

- `DISCORD_TOKEN`: bot token.
- `CREATE_CHANNEL_ID`: the voice channel that triggers room creation.
- `TEMP_CATEGORY_ID`: optional category where temporary rooms should be created.
- `ROOM_NAME_TEMPLATE`: optional room name template. Supported placeholders: `{displayName}`, `{username}`.

## Control Panel

- `Настройки`: открывает окно, где владелец меняет название комнаты и лимит участников.
- `Открыть / Закрыть`: переключает доступ в комнату для новых участников.
- `Скрыть / Показать`: переключает видимость комнаты для всех.
- `Кикнуть`: открывает окно, где владелец вводит ID или упоминание пользователя для удаления из комнаты.
- `Забрать комнату`: передает владение, если прошлый владелец уже вышел.

## Notes

- Temporary room ownership is stored in memory.
- If the bot restarts, already existing temporary channels will no longer be tracked automatically.
