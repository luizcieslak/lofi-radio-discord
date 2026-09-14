# Configuration and command reference

## Environment variables

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Non-empty string | Required | Discord bot token. Treat it as a secret. |
| `RADIO_STREAM_URL` | HTTP or HTTPS URL | Required | Continuous `lofi-radio` `/stream` endpoint. |
| `PORT` | Integer, 1–65535 | `3000` | Health-server port. Railway supplies this value. |
| `STARTUP_JOIN_DELAY_MS` | Integer, 0–60000 | `5000` on Railway; otherwise `0` | Delay before saved sessions are restored. |
| `FFMPEG_PATH` | Non-empty string | `ffmpeg` | FFmpeg executable path. |
| `STATE_DATABASE_PATH` | Non-empty string | `.data/lofi-radio.sqlite` | SQLite assignment database. Mount persistent storage over its parent directory in production. |

`DISCORD_GUILD_ID` and `DEFAULT_VOICE_CHANNEL_ID` are optional migration-only variables. When both
are present and the database is empty, that assignment is imported once. Remove both after the
first successful multi-server deployment.

## Slash commands

| Command | Behavior |
| --- | --- |
| `/lofi play [channel]` | Starts playback in the selected channel, or the caller's current channel. |
| `/lofi stop` | Stops playback in the current server. |
| `/lofi status` | Reports the current server's channel, voice, audio, and latest error state. |

Members can start the radio in their own voice channel. Once active, only members in the bot's
current channel or members with Manage Server can move or stop it. A server manager may select any
standard voice channel. The bot must have View Channel, Connect, and Speak in the target channel.

## Health endpoints

**`GET /healthz`** returns `200` while the process is running and `503` during graceful shutdown.
Use this endpoint for deployment health checks.

**`GET /readyz`** returns `200` when Discord and SQLite are ready and all saved active sessions have
ready voice connections backed by a playing broadcast. With no active guilds, an idle broadcast is
ready. A degraded guild returns `503` without causing Railway to restart the process.

## Runtime behavior

- All guilds share one live FFmpeg and Discord audio-player pipeline.
- Each guild has an isolated voice connection and bounded retry loop.
- Saved active assignments restore with at most three simultaneous voice handshakes.
- `/lofi stop` removes that guild's saved assignment; empty channels keep playing until stopped.
- Removing the bot from a guild removes its saved assignment.
- The service must run as one replica. Multiple replicas would compete for the same Discord bot
  sessions and SQLite volume.
- SIGINT and SIGTERM stop retries and close Discord, FFmpeg, SQLite, and HTTP resources.
- Logs are structured JSON. The stream URL is removed from FFmpeg diagnostic output.
