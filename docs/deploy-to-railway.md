# Deploy the Discord radio bot to Railway

This guide deploys the bot beside `lofi-radio` in the same Railway project and environment. The bot
uses Railway private networking for the audio stream and does not need a public domain.

## Prerequisites

- The `lofi-radio` service is already deployed.
- The Discord bot has been invited with View Channel, Connect, Speak, and Application Commands.
- You have the Discord bot token, application ID, server ID, and default voice-channel ID.

## 1. Create the service

Create one service named `lofi-radio-discord` from this repository. Railway detects the root
`Dockerfile` automatically.

Configure the service with:

- One replica
- Serverless/app sleeping disabled
- Health-check path `/healthz`
- Restart policy `Always`, where your Railway plan permits it
- Deployment overlap `0` seconds
- Deployment draining `20` seconds

Do not attach a volume or database.

## 2. Set variables

Add the following Railway service variables:

```text
DISCORD_TOKEN=<bot-token>
DISCORD_CLIENT_ID=<application-id>
DISCORD_GUILD_ID=<server-id>
DEFAULT_VOICE_CHANNEL_ID=<voice-channel-id>
RADIO_STREAM_URL=http://${{lofi-radio.RAILWAY_PRIVATE_DOMAIN}}:${{lofi-radio.PORT}}/stream?sid=discord_bot
STARTUP_JOIN_DELAY_MS=5000
FFMPEG_PATH=ffmpeg
```

Service names in Railway references are case-sensitive. Replace `lofi-radio` if the source service
uses another name. Store `DISCORD_TOKEN` as a sealed value and never commit it.

## 3. Deploy with the Railway CLI

The CLI on the development machine is available at `/home/luiz/.railway/bin/railway`.

```bash
/home/luiz/.railway/bin/railway up \
  --project ae90f2be-c63f-4981-ac51-0bdc05ea283f \
  --environment b6623c56-eaaf-4812-b40e-35513a44c091 \
  --service c76f942e-ffd1-433a-8b1a-07650e256fa6 \
  --detach \
  --json \
  -m "Deploy Discord radio relay"
```

Capture the deployment ID, then inspect that exact deployment until Railway reports `SUCCESS`.
An accepted upload is not proof that the build or deployment succeeded.

## 4. Verify the result

In Railway logs, confirm these events appear:

1. The health server starts.
2. The Discord gateway becomes ready.
3. Guild slash commands register.
4. The Discord voice connection becomes ready.
5. Radio audio starts playing.

Finally, join the configured Discord voice channel and confirm audible playback. Run `/radio status`
to verify that both voice and audio report `ready` or `playing`.
