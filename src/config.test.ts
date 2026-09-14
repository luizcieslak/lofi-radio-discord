import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from './config.ts'

const validEnvironment: NodeJS.ProcessEnv = {
	DISCORD_TOKEN: 'secret',
	RADIO_STREAM_URL: 'http://lofi-radio.railway.internal:8080/stream?sid=discord_bot',
}

describe('loadConfig', () => {
	it('loads multi-guild configuration with local defaults', () => {
		const config = loadConfig(validEnvironment)

		assert.equal(config.port, 3000)
		assert.equal(config.startupJoinDelayMs, 0)
		assert.equal(config.ffmpegPath, 'ffmpeg')
		assert.equal(config.stateDatabasePath, '.data/lofi-radio.sqlite')
		assert.equal(config.legacyDefaultAssignment, null)
	})

	it('adds a Railway restore delay by default', () => {
		const config = loadConfig({ ...validEnvironment, RAILWAY_ENVIRONMENT_ID: 'environment-id' })

		assert.equal(config.startupJoinDelayMs, 5_000)
	})

	it('accepts a complete legacy assignment for migration', () => {
		const config = loadConfig({
			...validEnvironment,
			DISCORD_GUILD_ID: '223456789012345678',
			DEFAULT_VOICE_CHANNEL_ID: '323456789012345678',
		})

		assert.deepEqual(config.legacyDefaultAssignment, {
			guildId: '223456789012345678',
			channelId: '323456789012345678',
		})
	})

	it('rejects incomplete legacy assignments', () => {
		assert.throws(
			() => loadConfig({ ...validEnvironment, DISCORD_GUILD_ID: '223456789012345678' }),
			/legacy guild and channel variables/,
		)
	})

	it('rejects missing secrets and non-HTTP stream URLs', () => {
		assert.throws(() => loadConfig({ ...validEnvironment, DISCORD_TOKEN: '' }), /Invalid environment/)
		assert.throws(
			() => loadConfig({ ...validEnvironment, RADIO_STREAM_URL: 'file:///songs/radio.mp3' }),
			/must use http or https/,
		)
	})
})
