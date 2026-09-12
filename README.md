# lofi-radio-discord

A resilient, single-guild Discord bot that relays the continuous MP3 broadcast from
[`lofi-radio`](https://github.com/luizcieslak/lofi-radio) into one Discord voice channel.

The service runs on Node.js 24 LTS. FFmpeg converts the source stream to 48 kHz stereo Opus, while
`@discordjs/voice` handles Discord voice transport and DAVE encryption.

## Run locally

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

The permission value requests View Channel, Connect, and Speak. Slash commands additionally require
the `applications.commands` OAuth scope.

Copy the server ID and default voice-channel ID with Discord Developer Mode enabled.

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

Check process health at `http://localhost:3000/healthz`. Readiness becomes successful at
`http://localhost:3000/readyz` after Discord voice and audio are both playing.

## Commands

All commands require Discord's Manage Server permission.

| Command | Behavior |
| --- | --- |
| `/radio join [channel]` | Joins the selected channel, or the caller's current voice channel. |
| `/radio leave` | Disconnects and pauses recovery until another join. |
| `/radio restart` | Rebuilds the FFmpeg source without changing channels. |
| `/radio status` | Reports voice, audio, uptime, and the most recent error. |

## Deploy to Railway

This guide assumes `lofi-radio` and this bot are services in the same Railway project and environment.

1. Create a service named `lofi-radio-discord` from this repository. Railway detects the root
   `Dockerfile` automatically.
2. Keep exactly one replica and disable Serverless/app sleeping.
3. Set `/healthz` as the deployment health-check path and set the restart policy to Always where your
   Railway plan permits it.
4. Set a deployment draining window of 20 seconds.
5. Add these service variables:

```text
DISCORD_TOKEN=<sealed secret>
DISCORD_CLIENT_ID=<application id>
DISCORD_GUILD_ID=<server id>
DEFAULT_VOICE_CHANNEL_ID=<voice channel id>
RADIO_STREAM_URL=http://${{lofi-radio.RAILWAY_PRIVATE_DOMAIN}}:${{lofi-radio.PORT}}/stream?sid=discord_bot
STARTUP_JOIN_DELAY_MS=5000
```

Railway injects `PORT`. The private-domain reference keeps the audio stream inside Railway's private
network and avoids public egress. If the source service is not named `lofi-radio`, update the reference
to match its exact service name.

No public domain, volume, database, or inbound TCP proxy is required. Railway can still run the
configured deployment health check against the service port.

### Railway CLI

The CLI installed on this workstation is available at `/home/luiz/.railway/bin/railway`.

After resolving the project, environment, and service IDs, deploy with explicit scope:

```bash
/home/luiz/.railway/bin/railway up \
  --project <project-id> \
  --environment production \
  --service lofi-radio-discord \
  --detach \
  --json \
  -m "Deploy Discord radio relay"
```

Poll the returned deployment ID until its status is `SUCCESS`; upload completion alone does not mean
the deployment is live.

## Configuration reference

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | — | Secret bot token. |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application ID. |
| `DISCORD_GUILD_ID` | Yes | — | The only server the bot accepts commands from. |
| `DEFAULT_VOICE_CHANNEL_ID` | Yes | — | Channel joined after startup. |
| `RADIO_STREAM_URL` | Yes | — | HTTP(S) lofi-radio `/stream` URL. |
| `PORT` | No | `3000` | Health server port; supplied by Railway. |
| `STARTUP_JOIN_DELAY_MS` | No | `5000` on Railway, otherwise `0` | Delays joining during deployment handoff. |
| `FFMPEG_PATH` | No | `ffmpeg` | FFmpeg executable path. |

## Operations

- `/healthz` returns `200` while the process is accepting work and `503` during shutdown.
- `/readyz` returns `200` only while Discord voice is ready and audio is playing.
- Source and voice failures retry with exponential backoff and jitter, capped at 30 seconds.
- SIGINT and SIGTERM stop retries, disconnect voice, terminate FFmpeg, and close the health server.
- Logs are newline-delimited JSON and never include the bot token. FFmpeg output redacts the configured
  source URL.

## Development checks

```bash
npm run check
docker build -t lofi-radio-discord .
```
