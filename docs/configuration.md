# Configuration and command reference

## Environment variables

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Non-empty string | Required | Discord bot token. Treat it as a secret. |
| `DISCORD_CLIENT_ID` | Discord snowflake | Required | Discord application ID. |
| `DISCORD_GUILD_ID` | Discord snowflake | Required | The only guild accepted by the bot. |
| `DEFAULT_VOICE_CHANNEL_ID` | Discord snowflake | Required | Voice channel joined at startup. |
| `RADIO_STREAM_URL` | HTTP or HTTPS URL | Required | Continuous lofi-radio `/stream` endpoint. |
| `PORT` | Integer, 1–65535 | `3000` | Health-server port. Railway supplies this value. |
| `STARTUP_JOIN_DELAY_MS` | Integer, 0–60000 | `5000` on Railway; otherwise `0` | Delay before the default voice join. |
| `FFMPEG_PATH` | Non-empty string | `ffmpeg` | FFmpeg executable path. |

## Slash commands

All commands require Discord's Manage Server permission.

| Command | Behavior |
| --- | --- |
| `/radio join [channel]` | Joins the selected channel, or the caller's current voice channel. |
| `/radio leave` | Disconnects and pauses recovery until another join. |
| `/radio restart` | Rebuilds the FFmpeg source without changing channels. |
| `/radio status` | Reports voice, audio, uptime, desired channel, and the latest error. |

## Health endpoints

**`GET /healthz`**

Returns `200` while the process is healthy and `503` during graceful shutdown. Use this endpoint for
the Railway deployment health check.

**`GET /readyz`**

Returns `200` only when Discord voice is ready and audio is playing. Otherwise it returns `503` with
the current voice, audio, retry, uptime, and last-error state.

## Runtime behavior

- Source and Discord voice failures retry with bounded exponential backoff and jitter.
- Only one recovery timer, voice connection, audio player, and FFmpeg child can be active.
- `/radio leave` suppresses reconnection for the current process.
- A process restart restores the configured default-channel auto-join.
- SIGINT and SIGTERM stop recovery and close Discord, FFmpeg, and HTTP resources.
- Logs are structured JSON. The stream URL is removed from FFmpeg diagnostic output.
