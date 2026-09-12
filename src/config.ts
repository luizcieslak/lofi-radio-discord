import { z } from 'zod'

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake')

function streamUrlSchema(): z.ZodType<string> {
	return z
		.string()
		.url()
		.refine(value => {
			const protocol = new URL(value).protocol
			return protocol === 'http:' || protocol === 'https:'
		}, 'must use http or https')
}

function schema(defaultJoinDelayMs: number) {
	return z.object({
		DISCORD_TOKEN: z.string().min(1),
		DISCORD_CLIENT_ID: snowflake,
		DISCORD_GUILD_ID: snowflake,
		DEFAULT_VOICE_CHANNEL_ID: snowflake,
		RADIO_STREAM_URL: streamUrlSchema(),
		PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
		STARTUP_JOIN_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(defaultJoinDelayMs),
		FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
	})
}

export interface Config {
	discordToken: string
	discordClientId: string
	discordGuildId: string
	defaultVoiceChannelId: string
	radioStreamUrl: string
	port: number
	startupJoinDelayMs: number
	ffmpegPath: string
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
	const defaultJoinDelayMs = environment.RAILWAY_ENVIRONMENT_ID ? 5_000 : 0
	const parsed = schema(defaultJoinDelayMs).safeParse(environment)

	if (!parsed.success) {
		const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
		throw new Error(`Invalid environment configuration: ${problems}`)
	}

	return {
		discordToken: parsed.data.DISCORD_TOKEN,
		discordClientId: parsed.data.DISCORD_CLIENT_ID,
		discordGuildId: parsed.data.DISCORD_GUILD_ID,
		defaultVoiceChannelId: parsed.data.DEFAULT_VOICE_CHANNEL_ID,
		radioStreamUrl: parsed.data.RADIO_STREAM_URL,
		port: parsed.data.PORT,
		startupJoinDelayMs: parsed.data.STARTUP_JOIN_DELAY_MS,
		ffmpegPath: parsed.data.FFMPEG_PATH,
	}
}
