import {
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	NoSubscriberBehavior,
	StreamType,
	type VoiceConnection,
	VoiceConnectionStatus,
} from '@discordjs/voice'
import { ChannelType, type Client } from 'discord.js'
import { errorMessage, logger } from './logger.ts'
import type { MediaSource, MediaSourceFactory } from './mediaSource.ts'
import { backoffDelay } from './retry.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'

export class RadioRelay {
	private readonly client: Client
	private readonly guildId: string
	private readonly mediaSourceFactory: MediaSourceFactory
	private readonly status: RuntimeStatus
	private readonly player = createAudioPlayer({
		behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
	})
	private desiredChannelId: string | null = null
	private connection: VoiceConnection | null = null
	private source: MediaSource | null = null
	private sourceRetryTimer: NodeJS.Timeout | null = null
	private voiceRetryTimer: NodeJS.Timeout | null = null
	private sourceAttempts = 0
	private voiceAttempts = 0
	private stopping = false
	private operation: Promise<void> = Promise.resolve()

	constructor(
		client: Client,
		guildId: string,
		mediaSourceFactory: MediaSourceFactory,
		status: RuntimeStatus,
	) {
		this.client = client
		this.guildId = guildId
		this.mediaSourceFactory = mediaSourceFactory
		this.status = status
		this.player.on('error', error => {
			if (this.stopping) return
			this.reportError('Discord audio player failed', error)
			this.scheduleSourceRestart('player error')
		})

		this.player.on('stateChange', (oldState, newState) => {
			if (
				!this.stopping &&
				this.desiredChannelId &&
				this.source &&
				oldState.status !== AudioPlayerStatus.Idle &&
				newState.status === AudioPlayerStatus.Idle
			) {
				this.scheduleSourceRestart('player became idle')
			}
		})
	}

	async join(channelId: string): Promise<void> {
		this.desiredChannelId = channelId
		this.status.setDesiredChannel(channelId)
		this.clearRetries()
		try {
			await this.enqueue(async () => this.connectNow())
		} catch (error) {
			this.scheduleVoiceReconnect('requested voice join failed')
			throw error
		}
	}

	async leave(): Promise<void> {
		this.desiredChannelId = null
		this.status.setDesiredChannel(null)
		this.clearRetries()
		await this.enqueue(async () => this.disconnectNow())
	}

	async restartSource(): Promise<void> {
		if (!this.desiredChannelId) throw new Error('The radio is not assigned to a voice channel')
		await this.enqueue(async () => {
			if (this.connection?.state.status !== VoiceConnectionStatus.Ready) {
				await this.connectNow()
				return
			}
			await this.startSourceNow()
		})
	}

	async stop(): Promise<void> {
		this.stopping = true
		this.desiredChannelId = null
		this.status.setDesiredChannel(null)
		this.clearRetries()
		await this.enqueue(async () => this.disconnectNow())
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const next = this.operation.then(task, task)
		this.operation = next.catch(error => {
			this.reportError('Relay operation failed', error)
		})
		return next
	}

	private async connectNow(): Promise<void> {
		const channelId = this.desiredChannelId
		if (!channelId || this.stopping) return

		await this.disconnectNow(false)
		this.status.setDesiredChannel(channelId)
		this.status.setVoice('connecting')

		const guild = await this.client.guilds.fetch(this.guildId)
		const channel = await guild.channels.fetch(channelId)
		if (!channel || channel.type !== ChannelType.GuildVoice) {
			throw new Error(`Channel ${channelId} is not a standard guild voice channel`)
		}

		const connection = joinVoiceChannel({
			channelId,
			guildId: this.guildId,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: true,
		})
		this.connection = connection
		connection.subscribe(this.player)
		this.watchConnection(connection)

		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
		} catch (error) {
			if (this.connection === connection) {
				this.connection = null
				connection.destroy()
			}
			throw new Error('Discord voice connection did not become ready', { cause: error })
		}

		if (this.connection !== connection || this.desiredChannelId !== channelId || this.stopping) return
		this.voiceAttempts = 0
		this.status.setVoice('ready')
		logger.info('Discord voice connection ready', { guildId: this.guildId, channelId })

		try {
			await this.startSourceNow()
		} catch (error) {
			this.reportError('Unable to start the radio source', error)
			this.scheduleSourceRestart('initial source failure')
		}
	}

	private watchConnection(connection: VoiceConnection): void {
		connection.on('stateChange', (_oldState, newState) => {
			if (this.connection !== connection || this.stopping) return

			if (newState.status === VoiceConnectionStatus.Ready) {
				this.voiceAttempts = 0
				this.status.setVoice('ready')
				return
			}

			if (newState.status === VoiceConnectionStatus.Disconnected) {
				void this.handleDisconnected(connection)
				return
			}

			if (newState.status === VoiceConnectionStatus.Destroyed) {
				this.scheduleVoiceReconnect('connection destroyed')
			}
		})
	}

	private async handleDisconnected(connection: VoiceConnection): Promise<void> {
		try {
			await Promise.race([
				entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
				entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
			])
			logger.info('Discord voice connection is recovering')
		} catch (error) {
			this.reportError('Discord voice connection disconnected', error)
			this.scheduleVoiceReconnect('connection disconnected')
		}
	}

	private async startSourceNow(): Promise<void> {
		if (this.stopping || this.connection?.state.status !== VoiceConnectionStatus.Ready) {
			throw new Error('Cannot start audio without a ready voice connection')
		}

		await this.stopSource()
		this.status.setAudio('starting')
		const source = this.mediaSourceFactory()
		this.source = source
		const resource = createAudioResource(source.output, { inputType: StreamType.OggOpus })
		this.player.play(resource)

		void source.completed.then(result => {
			if (this.source !== source || this.stopping) return
			const reason = result.error ?? `exit code ${result.code ?? 'none'}, signal ${result.signal ?? 'none'}`
			this.reportError(`FFmpeg stopped unexpectedly: ${reason}`)
			this.scheduleSourceRestart('FFmpeg exited')
		})

		try {
			await entersState(this.player, AudioPlayerStatus.Playing, 15_000)
		} catch (error) {
			if (this.source === source) await this.stopSource()
			throw new Error('Discord audio player did not start', { cause: error })
		}

		if (this.source !== source || this.stopping) return
		this.sourceAttempts = 0
		this.status.setAudio('playing')
		logger.info('Radio audio is playing')
	}

	private async stopSource(): Promise<void> {
		const source = this.source
		this.source = null
		this.player.stop(true)
		this.status.setAudio('idle')
		if (source) await source.stop()
	}

	private async disconnectNow(clearDesired = true): Promise<void> {
		await this.stopSource()
		const connection = this.connection
		this.connection = null
		if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy()
		this.status.setVoice('disconnected')
		if (clearDesired) {
			this.status.setDesiredChannel(this.desiredChannelId)
		}
	}

	private scheduleSourceRestart(reason: string): void {
		if (this.stopping || !this.desiredChannelId || this.sourceRetryTimer) return
		this.sourceAttempts += 1
		const waitMs = backoffDelay(this.sourceAttempts)
		this.status.setAudio('retrying')
		logger.warn('Scheduling radio source restart', { reason, attempt: this.sourceAttempts, waitMs })

		this.sourceRetryTimer = setTimeout(() => {
			this.sourceRetryTimer = null
			void this.enqueue(async () => {
				try {
					if (this.connection?.state.status === VoiceConnectionStatus.Ready) {
						await this.startSourceNow()
						return
					}
					this.scheduleVoiceReconnect('voice unavailable during source restart')
				} catch (error) {
					this.reportError('Radio source restart failed', error)
					this.scheduleSourceRestart('source retry failed')
				}
			})
		}, waitMs)
		this.sourceRetryTimer.unref()
	}

	private scheduleVoiceReconnect(reason: string): void {
		if (this.stopping || !this.desiredChannelId || this.voiceRetryTimer) return
		this.voiceAttempts += 1
		const waitMs = backoffDelay(this.voiceAttempts)
		this.status.setVoice('retrying')
		logger.warn('Scheduling Discord voice reconnect', { reason, attempt: this.voiceAttempts, waitMs })

		this.voiceRetryTimer = setTimeout(() => {
			this.voiceRetryTimer = null
			void this.enqueue(async () => {
				try {
					await this.connectNow()
				} catch (error) {
					this.reportError('Discord voice reconnect failed', error)
					this.scheduleVoiceReconnect('voice retry failed')
				}
			})
		}, waitMs)
		this.voiceRetryTimer.unref()
	}

	private clearRetries(): void {
		if (this.sourceRetryTimer) clearTimeout(this.sourceRetryTimer)
		if (this.voiceRetryTimer) clearTimeout(this.voiceRetryTimer)
		this.sourceRetryTimer = null
		this.voiceRetryTimer = null
		this.sourceAttempts = 0
		this.voiceAttempts = 0
	}

	private reportError(message: string, error?: unknown): void {
		const fullMessage = error === undefined ? message : `${message}: ${errorMessage(error)}`
		this.status.recordError(fullMessage)
		logger.error(message, error === undefined ? undefined : { error: errorMessage(error) })
	}
}
