import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RuntimeStatus } from './runtimeStatus.ts'

describe('RuntimeStatus', () => {
	it('is ready only while voice and audio are ready', () => {
		const status = new RuntimeStatus()
		status.setDesiredChannel('323456789012345678')
		status.setVoice('ready')
		status.setAudio('playing')

		const snapshot = status.snapshot()
		assert.equal(snapshot.ready, true)
		assert.equal(snapshot.desiredChannelId, '323456789012345678')
	})

	it('becomes unhealthy for readiness during shutdown', () => {
		const status = new RuntimeStatus()
		status.setVoice('ready')
		status.setAudio('playing')
		status.markShuttingDown()

		const snapshot = status.snapshot()
		assert.equal(snapshot.status, 'shutting_down')
		assert.equal(snapshot.ready, false)
	})
})
