import {
	type AudioPlayer,
	entersState,
	joinVoiceChannel,
	type PlayerSubscription,
	type VoiceConnection,
	VoiceConnectionStatus,
} from '@discordjs/voice'
import { ChannelType, type Client, PermissionFlagsBits } from 'discord.js'
import { errorMessage, logger } from './logger.ts'
import { backoffDelay } from './retry.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'

export class InvalidVoiceTargetError extends Error {}

export class GuildVoiceSession {
	private readonly client: Client
	private readonly guildId: string
	private readonly player: AudioPlayer
	private readonly status: RuntimeStatus
	private desiredChannelId: string | null = null
	private connection: VoiceConnection | null = null
	private subscription: PlayerSubscription | null = null
	private retryTimer: NodeJS.Timeout | null = null
	private attempts = 0
	private stopping = false
	private operation: Promise<void> = Promise.resolve()

	constructor(client: Client, guildId: string, player: AudioPlayer, status: RuntimeStatus) {
		this.client = client
		this.guildId = guildId
		this.player = player
		this.status = status
	}

	get channelId(): string | null {
		return this.desiredChannelId
	}

	async join(channelId: string): Promise<void> {
		this.stopping = false
		this.desiredChannelId = channelId
		this.clearRetry()
		this.status.setGuild(this.guildId, channelId, 'connecting')
		try {
			await this.enqueue(async () => this.connectNow())
		} catch (error) {
			if (!(error instanceof InvalidVoiceTargetError)) {
				this.scheduleReconnect('requested voice join failed')
			}
			throw error
		}
	}

	async stop(): Promise<void> {
		this.stopping = true
		this.desiredChannelId = null
		this.clearRetry()
		await this.enqueue(async () => this.disconnectNow())
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const next = this.operation.then(task, task)
		this.operation = next.catch(error => {
			this.reportError('Voice session operation failed', error)
		})
		return next
	}

	private async connectNow(): Promise<void> {
		const channelId = this.desiredChannelId
		if (!channelId || this.stopping) return

		await this.disconnectNow()
		this.status.setGuild(this.guildId, channelId, 'connecting')
		const guild = await this.client.guilds.fetch(this.guildId)
		const channel = await guild.channels.fetch(channelId)
		if (!channel || channel.type !== ChannelType.GuildVoice) {
			throw new InvalidVoiceTargetError(`Channel ${channelId} is not a standard guild voice channel`)
		}

		const botMember = guild.members.me
		const permissions = botMember ? channel.permissionsFor(botMember) : null
		if (
			!permissions?.has([
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.Connect,
				PermissionFlagsBits.Speak,
			])
		) {
			throw new Error('The bot needs View Channel, Connect, and Speak permissions in that channel')
		}

		const connection = joinVoiceChannel({
			channelId,
			guildId: this.guildId,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: true,
		})
		this.connection = connection
		this.subscription = connection.subscribe(this.player) ?? null
		this.watchConnection(connection)

		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
		} catch (error) {
			if (this.connection === connection) {
				this.connection = null
				this.subscription?.unsubscribe()
				this.subscription = null
				connection.destroy()
			}
			throw new Error('Discord voice connection did not become ready', { cause: error })
		}

		if (this.connection !== connection || this.desiredChannelId !== channelId || this.stopping) return
		this.attempts = 0
		this.status.setGuild(this.guildId, channelId, 'ready')
		logger.info('Discord voice connection ready', { guildId: this.guildId, channelId })
	}

	private watchConnection(connection: VoiceConnection): void {
		connection.on('stateChange', (_oldState, newState) => {
			if (this.connection !== connection || this.stopping) return

			if (newState.status === VoiceConnectionStatus.Ready) {
				this.attempts = 0
				const channelId = this.desiredChannelId
				if (channelId) this.status.setGuild(this.guildId, channelId, 'ready')
				return
			}

			if (newState.status === VoiceConnectionStatus.Disconnected) {
				void this.handleDisconnected(connection)
				return
			}

			if (newState.status === VoiceConnectionStatus.Destroyed) {
				this.scheduleReconnect('connection destroyed')
			}
		})
	}

	private async handleDisconnected(connection: VoiceConnection): Promise<void> {
		try {
			await Promise.race([
				entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
				entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
			])
			logger.info('Discord voice connection is recovering', { guildId: this.guildId })
		} catch (error) {
			this.reportError('Discord voice connection disconnected', error)
			this.scheduleReconnect('connection disconnected')
		}
	}

	private async disconnectNow(): Promise<void> {
		this.subscription?.unsubscribe()
		this.subscription = null
		const connection = this.connection
		this.connection = null
		if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy()
	}

	private scheduleReconnect(reason: string): void {
		const channelId = this.desiredChannelId
		if (this.stopping || !channelId || this.retryTimer) return
		this.attempts += 1
		const waitMs = backoffDelay(this.attempts)
		this.status.setGuild(this.guildId, channelId, 'retrying')
		logger.warn('Scheduling Discord voice reconnect', {
			guildId: this.guildId,
			reason,
			attempt: this.attempts,
			waitMs,
		})
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			void this.enqueue(async () => {
				try {
					await this.connectNow()
				} catch (error) {
					this.reportError('Discord voice reconnect failed', error)
					this.scheduleReconnect('voice retry failed')
				}
			})
		}, waitMs)
		this.retryTimer.unref()
	}

	private clearRetry(): void {
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		this.attempts = 0
	}

	private reportError(message: string, error?: unknown): void {
		const fullMessage = error === undefined ? message : `${message}: ${errorMessage(error)}`
		this.status.recordGuildError(this.guildId, fullMessage)
		logger.error(message, {
			guildId: this.guildId,
			...(error === undefined ? {} : { error: errorMessage(error) }),
		})
	}
}
