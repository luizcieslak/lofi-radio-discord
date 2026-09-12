import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from './config.ts'

const validEnvironment: NodeJS.ProcessEnv = {
	DISCORD_TOKEN: 'secret',
	DISCORD_CLIENT_ID: '123456789012345678',
	DISCORD_GUILD_ID: '223456789012345678',
	DEFAULT_VOICE_CHANNEL_ID: '323456789012345678',
	RADIO_STREAM_URL: 'http://lofi-radio.railway.internal:5634/stream?sid=discord_bot',
}

describe('loadConfig', () => {
	it('loads valid configuration with local defaults', () => {
		const config = loadConfig(validEnvironment)

		assert.equal(config.port, 3000)
		assert.equal(config.startupJoinDelayMs, 0)
		assert.equal(config.ffmpegPath, 'ffmpeg')
	})

	it('adds a Railway handoff delay by default', () => {
		const config = loadConfig({ ...validEnvironment, RAILWAY_ENVIRONMENT_ID: 'environment-id' })

		assert.equal(config.startupJoinDelayMs, 5_000)
	})

	it('rejects missing secrets and invalid channel identifiers', () => {
		assert.throws(
			() =>
				loadConfig({
					...validEnvironment,
					DISCORD_TOKEN: '',
					DEFAULT_VOICE_CHANNEL_ID: 'not-a-snowflake',
				}),
			/Invalid environment configuration/,
		)
	})

	it('rejects non-HTTP stream URLs', () => {
		assert.throws(
			() => loadConfig({ ...validEnvironment, RADIO_STREAM_URL: 'file:///songs/radio.mp3' }),
			/must use http or https/,
		)
	})
})
