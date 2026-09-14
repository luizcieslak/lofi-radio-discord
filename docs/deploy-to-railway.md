# Deploy the Discord radio bot to Railway

This guide deploys the bot beside `lofi-radio` in one Railway project and environment. The services
communicate over Railway private networking.

## Prerequisites

- `lofi-radio` is running and listens on port `8080`.
- The Discord bot is invited with View Channel, Connect, Speak, and Application Commands.
- You have the Discord bot token.

## 1. Create the service

Create a service from this repository. Railway detects the root `Dockerfile` automatically.

Configure:

- One replica
- App sleeping disabled
- Health-check path `/healthz`
- Restart policy `Always`
- Deployment overlap `0` seconds
- Deployment draining `20` seconds

Zero overlap avoids two deployments using the same Discord bot session. A deploy briefly interrupts
voice; persisted active sessions reconnect automatically after the replacement is ready.

## 2. Add persistent storage

Attach a Railway volume to the bot service and mount it at:

```text
/app/.data
```

The volume stores only the SQLite guild-to-channel assignments. Do not scale the service beyond one
replica while using this database.

## 3. Set variables

```text
DISCORD_TOKEN=<bot-token>
RADIO_STREAM_URL=http://${{lofi-radio.RAILWAY_PRIVATE_DOMAIN}}:8080/stream?sid=discord_bot
STATE_DATABASE_PATH=/app/.data/lofi-radio.sqlite
STARTUP_JOIN_DELAY_MS=5000
FFMPEG_PATH=ffmpeg
```

Service names in Railway references are case-sensitive. Replace `lofi-radio` if the source service
has another name. Seal `DISCORD_TOKEN` and never commit it.

For the first migration from the old single-server release, leave `DISCORD_GUILD_ID` and
`DEFAULT_VOICE_CHANNEL_ID` set. The bot imports that assignment into an empty database and removes
the old guild-scoped `/radio` command. Remove both variables after confirming `/lofi` works.

## 4. Deploy and verify

Push the desired commit to the branch connected to Railway. Confirm the deployment reaches
`SUCCESS`, then check for these runtime events:

1. The health server and SQLite store start.
2. The Discord gateway becomes ready.
3. Global slash commands register.
4. Saved guild voice sessions restore.
5. Discord voice connections become ready.
6. Shared radio audio starts playing.

Install the bot in two servers, run `/lofi play` in both, and confirm both receive audio. Stop one
with `/lofi stop` and verify the other continues. Redeploy once and verify the remaining active
session reconnects from SQLite.
