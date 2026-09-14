import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAudioPlayer } from '@discordjs/voice'
import { Client } from 'discord.js'
import type { BroadcastController } from './broadcast.ts'
import { InvalidVoiceTargetError } from './relay.ts'
import { RuntimeStatus } from './runtimeStatus.ts'
import { GuildSessionManager, type VoiceSession } from './sessionManager.ts'
import type { AssignmentStore, GuildAssignment } from './stateStore.ts'

class MemoryStore implements AssignmentStore {
	readonly assignments = new Map<string, GuildAssignment>()
	closed = false

	list(): GuildAssignment[] {
		return [...this.assignments.values()]
	}

	upsert(guildId: string, channelId: string): void {
		this.assignments.set(guildId, { guildId, channelId, updatedAt: new Date().toISOString() })
	}

	delete(guildId: string): void {
		this.assignments.delete(guildId)
	}

	count(): number {
		return this.assignments.size
	}

	close(): void {
		this.closed = true
	}
}

class FakeBroadcast implements BroadcastController {
	readonly player = createAudioPlayer()
	readonly activeGuilds = new Set<string>()
	starts = 0
	stops = 0
	shutdowns = 0

	async activate(guildId: string): Promise<void> {
		if (this.activeGuilds.size === 0) this.starts += 1
		this.activeGuilds.add(guildId)
	}

	async deactivate(guildId: string): Promise<void> {
		this.activeGuilds.delete(guildId)
		if (this.activeGuilds.size === 0) this.stops += 1
	}

	async stop(): Promise<void> {
		this.activeGuilds.clear()
		this.shutdowns += 1
	}
}

class FakeSession implements VoiceSession {
	channelId: string | null = null
	readonly joinError: Error | null
	joinCalls = 0
	stopped = false

	constructor(joinError: Error | null = null) {
		this.joinError = joinError
	}

	async join(channelId: string): Promise<void> {
		this.joinCalls += 1
		this.channelId = channelId
		if (this.joinError) throw this.joinError
	}

	async stop(): Promise<void> {
		this.channelId = null
		this.stopped = true
	}
}

class BlockingSession implements VoiceSession {
	channelId: string | null = null
	readonly started = Promise.withResolvers<void>()
	readonly release = Promise.withResolvers<void>()
	stopped = false

	async join(channelId: string): Promise<void> {
		this.channelId = channelId
		this.started.resolve()
		await this.release.promise
	}

	async stop(): Promise<void> {
		this.channelId = null
		this.stopped = true
	}
}

function createManager(
	store: MemoryStore,
	broadcast: FakeBroadcast,
	sessions: Map<string, FakeSession>,
	validator: (assignment: GuildAssignment) => Promise<boolean> = async () => true,
): GuildSessionManager {
	const client = new Client({ intents: [] })
	const status = new RuntimeStatus()
	return new GuildSessionManager(
		client,
		broadcast,
		store,
		status,
		guildId => {
			const session = sessions.get(guildId) ?? new FakeSession()
			sessions.set(guildId, session)
			return session
		},
		validator,
	)
}

describe('GuildSessionManager', () => {
	it('shares one broadcast lifecycle across independent guild sessions', async () => {
		const store = new MemoryStore()
		const broadcast = new FakeBroadcast()
		const sessions = new Map<string, FakeSession>()
		const manager = createManager(store, broadcast, sessions)

		await manager.play('guild-1', 'voice-1')
		await manager.play('guild-2', 'voice-2')
		assert.equal(broadcast.starts, 1)
		assert.equal(broadcast.activeGuilds.size, 2)
		assert.equal(store.count(), 2)

		await manager.stop('guild-1')
		assert.equal(broadcast.stops, 0)
		assert.equal(sessions.get('guild-1')?.stopped, true)
		assert.equal(sessions.get('guild-2')?.stopped, false)

		await manager.stop('guild-2')
		assert.equal(broadcast.stops, 1)
		assert.equal(store.count(), 0)
	})

	it('keeps one guild failure isolated and persisted for recovery', async () => {
		const store = new MemoryStore()
		const broadcast = new FakeBroadcast()
		const sessions = new Map<string, FakeSession>([['guild-1', new FakeSession(new Error('failed'))]])
		const manager = createManager(store, broadcast, sessions)

		await assert.rejects(() => manager.play('guild-1', 'voice-1'), /failed/)
		await manager.play('guild-2', 'voice-2')
		assert.equal(store.count(), 2)
		assert.equal(sessions.get('guild-2')?.channelId, 'voice-2')
	})

	it('serializes simultaneous play and stop operations within a guild', async () => {
		const store = new MemoryStore()
		const broadcast = new FakeBroadcast()
		const session = new BlockingSession()
		const client = new Client({ intents: [] })
		const manager = new GuildSessionManager(
			client,
			broadcast,
			store,
			new RuntimeStatus(),
			() => session,
			async () => true,
		)

		const play = manager.play('guild-1', 'voice-1')
		await session.started.promise
		const stop = manager.stop('guild-1')
		session.release.resolve()
		await Promise.all([play, stop])

		assert.equal(store.count(), 0)
		assert.equal(session.stopped, true)
		assert.equal(broadcast.activeGuilds.size, 0)
	})

	it('restores valid assignments and removes invalid targets', async () => {
		const store = new MemoryStore()
		store.upsert('valid-guild', 'voice-1')
		store.upsert('invalid-guild', 'voice-2')
		const broadcast = new FakeBroadcast()
		const sessions = new Map<string, FakeSession>()
		const manager = createManager(
			store,
			broadcast,
			sessions,
			async assignment => assignment.guildId === 'valid-guild',
		)

		await manager.restore()
		assert.equal(store.count(), 1)
		assert.equal(store.list()[0]?.guildId, 'valid-guild')
		assert.equal(sessions.get('valid-guild')?.channelId, 'voice-1')
		assert.equal(sessions.has('invalid-guild'), false)
	})

	it('keeps transient restore validation failures active for voice recovery', async () => {
		const store = new MemoryStore()
		store.upsert('recoverable-guild', 'voice-1')
		const status = new RuntimeStatus()
		const broadcast = new FakeBroadcast()
		const sessions = new Map<string, FakeSession>()
		const manager = new GuildSessionManager(
			new Client({ intents: [] }),
			broadcast,
			store,
			status,
			guildId => {
				const session = new FakeSession()
				sessions.set(guildId, session)
				return session
			},
			async () => {
				throw new Error('Discord API unavailable')
			},
		)

		await manager.restore()

		assert.equal(store.count(), 1)
		assert.equal(sessions.get('recoverable-guild')?.joinCalls, 1)
		assert.equal(broadcast.starts, 1)
		assert.equal(status.snapshot().activeGuilds, 1)
	})

	it('cleans up a target deleted between validation and voice join', async () => {
		const store = new MemoryStore()
		const status = new RuntimeStatus()
		const broadcast = new FakeBroadcast()
		const manager = new GuildSessionManager(
			new Client({ intents: [] }),
			broadcast,
			store,
			status,
			() => new FakeSession(new InvalidVoiceTargetError('deleted')),
			async () => true,
		)

		await assert.rejects(manager.play('deleted-target', 'voice-1'), InvalidVoiceTargetError)

		assert.equal(store.count(), 0)
		assert.equal(broadcast.stops, 1)
		assert.equal(status.guildSnapshot('deleted-target'), null)
	})

	it('shuts down sessions and broadcast without deleting persisted assignments', async () => {
		const store = new MemoryStore()
		const broadcast = new FakeBroadcast()
		const sessions = new Map<string, FakeSession>()
		const manager = createManager(store, broadcast, sessions)
		await manager.play('guild-1', 'voice-1')

		await manager.shutdown()
		assert.equal(store.count(), 1)
		assert.equal(sessions.get('guild-1')?.stopped, true)
		assert.equal(broadcast.shutdowns, 1)
	})
})
