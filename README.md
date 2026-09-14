# lofi-radio-discord

A resilient, multi-server Discord bot that relays the continuous MP3 broadcast from
[`lofi-radio`](https://github.com/luizcieslak/lofi-radio) into voice channels.

One shared FFmpeg pipeline converts the station to 48 kHz stereo Opus. Every active Discord server
gets an independent voice connection, and saved channel assignments are restored after restarts.

## Run locally

By the end of these steps, `/lofi play` will join your voice channel and play the live radio.

### Prerequisites

- Node.js 24.17 or newer
- FFmpeg with `libopus` support
- A Discord application with a bot user
- A running `lofi-radio` `/stream` endpoint

### 1. Configure the Discord application

Create an application and bot in the Discord Developer Portal. No privileged gateway intents are
required.

Invite it with the following URL, replacing `<client-id>`:

```text
https://discord.com/oauth2/authorize?client_id=<client-id>&permissions=3146752&scope=bot%20applications.commands
```

The permission value requests View Channel, Connect, and Speak.

### 2. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`. Never commit the bot token.

### 3. Start the bot

```bash
npm run dev
```

Invite the bot to a server, join a standard voice channel, and run `/lofi play`. Use `/lofi stop`
to disconnect it and `/lofi status` to inspect that server's state.

`http://localhost:3000/healthz` reports process health. `http://localhost:3000/readyz` becomes ready
after Discord, SQLite, and every saved active voice session are ready.

## More documentation

- [Deploy to Railway](docs/deploy-to-railway.md)
- [Configuration and commands](docs/configuration.md)

## Development checks

```bash
npm run check
docker build -t lofi-radio-discord .
```
