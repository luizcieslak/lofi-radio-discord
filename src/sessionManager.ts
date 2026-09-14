import { ChannelType, type Client } from 'discord.js'
import type { BroadcastController } from './broadcast.ts'
import { errorMessage, logger } from './logger.ts'
import { GuildVoiceSession, InvalidVoiceTargetError } from './relay.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'
import type { AssignmentStore, GuildAssignment } from './stateStore.ts'

export interface VoiceSession {
	readonly channelId: string | null
	join(channelId: string): Promise<void>
	stop(): Promise<void>
}

export type VoiceSessionFactory = (guildId: string) => VoiceSession
export type RestoreTargetValidator = (assignment: GuildAssignment) => Promise<boolean>

export class GuildSessionManager {
	private readonly client: Client
	private readonly broadcast: BroadcastController
	private readonly store: AssignmentStore
	private readonly status: RuntimeStatus
	private readonly sessionFactory: VoiceSessionFactory
	private readonly restoreTargetValidator: RestoreTargetValidator
	private readonly sessions = new Map<string, VoiceSession>()
	private readonly guildOperations = new Map<string, Promise<void>>()
	private stopping = false

	constructor(
		client: Client,
		broadcast: BroadcastController,
		store: AssignmentStore,
		status: RuntimeStatus,
		sessionFactory?: VoiceSessionFactory,
		restoreTargetValidator?: RestoreTargetValidator,
	) {
		this.client = client
		this.broadcast = broadcast
		this.store = store
		this.status = status
		this.sessionFactory =
			sessionFactory ??
			(guildId => new GuildVoiceSession(this.client, guildId, this.broadcast.player, this.status))
		this.restoreTargetValidator =
			restoreTargetValidator ?? (async assignment => this.isRestorableTarget(assignment))
	}

	channelId(guildId: string): string | null {
		return this.sessions.get(guildId)?.channelId ?? null
	}

	async play(guildId: string, channelId: string): Promise<void> {
		if (this.stopping) throw new Error('The radio is shutting down')
		await this.enqueueGuild(guildId, async () => {
			try {
				await this.playNow(guildId, channelId)
			} catch (error) {
				if (error instanceof InvalidVoiceTargetError) await this.stopNow(guildId)
				throw error
			}
		})
	}

	async stop(guildId: string): Promise<void> {
		await this.enqueueGuild(guildId, async () => this.stopNow(guildId))
	}

	async restore(): Promise<void> {
		const assignments = this.store.list()
		if (assignments.length === 0) {
			logger.info('No saved guild voice sessions to restore')
			return
		}

		logger.info('Restoring saved guild voice sessions', { count: assignments.length })
		let nextIndex = 0
		const worker = async (): Promise<void> => {
			while (!this.stopping) {
				const assignment = assignments[nextIndex]
				nextIndex += 1
				if (!assignment) return
				await this.restoreOne(assignment)
			}
		}
		const workerCount = Math.min(3, assignments.length)
		await Promise.all(Array.from({ length: workerCount }, async () => worker()))
	}

	async removeGuild(guildId: string): Promise<void> {
		try {
			await this.stop(guildId)
			logger.info('Removed unavailable guild session', { guildId })
		} catch (error) {
			this.status.recordError(`Could not remove guild ${guildId}: ${errorMessage(error)}`)
			logger.error('Could not remove unavailable guild session', {
				guildId,
				error: errorMessage(error),
			})
		}
	}

	async shutdown(): Promise<void> {
		this.stopping = true
		await Promise.allSettled(this.guildOperations.values())
		const sessions = [...this.sessions.values()]
		await Promise.allSettled(sessions.map(async session => session.stop()))
		this.sessions.clear()
		await this.broadcast.stop()
	}

	private async playNow(guildId: string, channelId: string): Promise<void> {
		this.store.upsert(guildId, channelId)
		this.status.setGuild(guildId, channelId, 'connecting')
		const session = this.getOrCreateSession(guildId)
		const [broadcastResult, voiceResult] = await Promise.allSettled([
			this.broadcast.activate(guildId),
			session.join(channelId),
		])
		if (voiceResult.status === 'rejected') throw voiceResult.reason
		if (broadcastResult.status === 'rejected') throw broadcastResult.reason
	}

	private async stopNow(guildId: string): Promise<void> {
		this.store.delete(guildId)
		const session = this.sessions.get(guildId)
		if (session) await session.stop()
		this.sessions.delete(guildId)
		this.status.removeGuild(guildId)
		await this.broadcast.deactivate(guildId)
	}

	private enqueueGuild(guildId: string, task: () => Promise<void>): Promise<void> {
		const current = this.guildOperations.get(guildId) ?? Promise.resolve()
		const next = current.then(task, task)
		this.guildOperations.set(guildId, next)
		const cleanup = (): void => {
			if (this.guildOperations.get(guildId) === next) this.guildOperations.delete(guildId)
		}
		void next.then(cleanup, cleanup)
		return next
	}

	private getOrCreateSession(guildId: string): VoiceSession {
		const existing = this.sessions.get(guildId)
		if (existing) return existing
		const session = this.sessionFactory(guildId)
		this.sessions.set(guildId, session)
		return session
	}

	private async restoreOne(assignment: GuildAssignment): Promise<void> {
		this.status.setGuild(assignment.guildId, assignment.channelId, 'connecting')
		try {
			let targetExists = true
			try {
				targetExists = await this.restoreTargetValidator(assignment)
			} catch (error) {
				this.status.recordGuildError(
					assignment.guildId,
					`Saved target validation failed: ${errorMessage(error)}`,
				)
				logger.warn('Could not validate saved voice target; treating it as recoverable', {
					guildId: assignment.guildId,
					channelId: assignment.channelId,
					error: errorMessage(error),
				})
			}

			if (!targetExists) {
				this.store.delete(assignment.guildId)
				this.status.removeGuild(assignment.guildId)
				logger.warn('Discarded saved session for an unavailable guild or voice channel', {
					guildId: assignment.guildId,
					channelId: assignment.channelId,
				})
				return
			}
			await this.play(assignment.guildId, assignment.channelId)
		} catch (error) {
			if (error instanceof InvalidVoiceTargetError) {
				return
			}
			this.status.recordGuildError(assignment.guildId, `Saved session restore failed: ${errorMessage(error)}`)
			logger.error('Saved guild voice session restore failed; recovery remains active', {
				guildId: assignment.guildId,
				channelId: assignment.channelId,
				error: errorMessage(error),
			})
		}
	}

	private async isRestorableTarget(assignment: GuildAssignment): Promise<boolean> {
		const guild = this.client.guilds.cache.get(assignment.guildId)
		if (!guild) return false
		const channel = await guild.channels.fetch(assignment.channelId)
		return channel?.type === ChannelType.GuildVoice
	}
}
