# lofi-radio-discord

A resilient, single-guild Discord bot that relays the continuous MP3 broadcast from
[`lofi-radio`](https://github.com/luizcieslak/lofi-radio) into one Discord voice channel.

The service runs on Node.js 24 LTS. FFmpeg converts the source stream to 48 kHz stereo Opus, while
`@discordjs/voice` handles Discord voice transport and DAVE encryption.

## Run locally

By the end of these steps, the bot will join your configured voice channel and play the live radio.

### Prerequisites

- Node.js 24.17 or newer
- FFmpeg with `libopus` support
- A Discord application with a bot user
- A running lofi-radio `/stream` endpoint

### 1. Configure the Discord application

In the Discord Developer Portal, create an application and bot. You do not need any privileged
gateway intents.

Invite the bot using the following URL, replacing `<client-id>`:

```text
https://discord.com/oauth2/authorize?client_id=<client-id>&permissions=3146752&scope=bot%20applications.commands
```

The permission value requests View Channel, Connect, and Speak. Copy the server ID and default
voice-channel ID with Discord Developer Mode enabled.

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

Open `http://localhost:3000/healthz`. It returns a healthy response as soon as the process is live.
`http://localhost:3000/readyz` becomes successful after Discord voice and audio are both playing.

## More documentation

- [Deploy to Railway](docs/deploy-to-railway.md)
- [Configuration and commands](docs/configuration.md)

## Development checks

```bash
npm run check
docker build -t lofi-radio-discord .
```
