import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RuntimeStatus } from './runtimeStatus.ts'

describe('RuntimeStatus', () => {
	it('is ready when infrastructure is ready and no guilds are active', () => {
		const status = new RuntimeStatus()
		status.setStorage('ready')
		status.setGateway('ready')

		const snapshot = status.snapshot()
		assert.equal(snapshot.ready, true)
		assert.equal(snapshot.activeGuilds, 0)
	})

	it('aggregates healthy and degraded guild sessions', () => {
		const status = new RuntimeStatus()
		status.setStorage('ready')
		status.setGateway('ready')
		status.setBroadcast('playing')
		status.setGuild('guild-1', 'channel-1', 'ready')
		status.setGuild('guild-2', 'channel-2', 'retrying')

		const degraded = status.snapshot()
		assert.equal(degraded.ready, false)
		assert.equal(degraded.activeGuilds, 2)
		assert.equal(degraded.connectedGuilds, 1)
		assert.equal(degraded.retryingGuilds, 1)

		status.setGuild('guild-2', 'channel-2', 'ready')
		assert.equal(status.snapshot().ready, true)
	})

	it('reports guild-local errors and becomes unready during shutdown', () => {
		const status = new RuntimeStatus()
		status.setStorage('ready')
		status.setGateway('ready')
		status.setBroadcast('playing')
		status.setGuild('guild-1', 'channel-1', 'ready')
		status.recordGuildError('guild-1', 'voice failed')

		assert.equal(status.guildSnapshot('guild-1')?.lastError, 'voice failed')
		status.markShuttingDown()
		assert.equal(status.snapshot().ready, false)
		assert.equal(status.snapshot().status, 'shutting_down')
	})
})
