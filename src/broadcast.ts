import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	NoSubscriberBehavior,
	StreamType,
} from '@discordjs/voice'
import { errorMessage, logger } from './logger.ts'
import type { MediaSource, MediaSourceFactory } from './mediaSource.ts'
import { backoffDelay } from './retry.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'

export interface BroadcastController {
	readonly player: AudioPlayer
	activate(guildId: string): Promise<void>
	deactivate(guildId: string): Promise<void>
	stop(): Promise<void>
}

export class RadioBroadcast implements BroadcastController {
	readonly player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
	private readonly consumers = new Set<string>()
	private readonly mediaSourceFactory: MediaSourceFactory
	private readonly status: RuntimeStatus
	private source: MediaSource | null = null
	private retryTimer: NodeJS.Timeout | null = null
	private attempts = 0
	private stopping = false
	private operation: Promise<void> = Promise.resolve()

	constructor(mediaSourceFactory: MediaSourceFactory, status: RuntimeStatus) {
		this.mediaSourceFactory = mediaSourceFactory
		this.status = status
		this.player.on('error', error => {
			if (this.stopping) return
			this.reportError('Discord broadcast player failed', error)
			this.scheduleRestart('player error')
		})
		this.player.on('stateChange', (oldState, newState) => {
			if (
				!this.stopping &&
				this.consumers.size > 0 &&
				this.source &&
				oldState.status !== AudioPlayerStatus.Idle &&
				newState.status === AudioPlayerStatus.Idle
			) {
				this.scheduleRestart('player became idle')
			}
		})
	}

	async activate(guildId: string): Promise<void> {
		if (this.stopping) throw new Error('The radio broadcast is shutting down')
		this.consumers.add(guildId)
		if (this.source && this.player.state.status === AudioPlayerStatus.Playing) return
		try {
			await this.enqueue(async () => this.startSourceNow())
		} catch (error) {
			this.scheduleRestart('initial source failure')
			throw error
		}
	}

	async deactivate(guildId: string): Promise<void> {
		this.consumers.delete(guildId)
		if (this.consumers.size > 0) return
		this.clearRetry()
		await this.enqueue(async () => this.stopSource())
	}

	async stop(): Promise<void> {
		this.stopping = true
		this.consumers.clear()
		this.clearRetry()
		await this.enqueue(async () => this.stopSource())
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const next = this.operation.then(task, task)
		this.operation = next.catch(error => {
			this.reportError('Broadcast operation failed', error)
		})
		return next
	}

	private async startSourceNow(): Promise<void> {
		if (this.stopping || this.consumers.size === 0) return
		if (this.source && this.player.state.status === AudioPlayerStatus.Playing) return

		await this.stopSource()
		this.status.setBroadcast('starting')
		const source = this.mediaSourceFactory()
		this.source = source
		this.player.play(createAudioResource(source.output, { inputType: StreamType.OggOpus }))

		void source.completed.then(result => {
			if (this.source !== source || this.stopping) return
			const reason = result.error ?? `exit code ${result.code ?? 'none'}, signal ${result.signal ?? 'none'}`
			this.reportError(`FFmpeg stopped unexpectedly: ${reason}`)
			this.scheduleRestart('FFmpeg exited')
		})

		try {
			await entersState(this.player, AudioPlayerStatus.Playing, 15_000)
		} catch (error) {
			if (this.source === source) await this.stopSource()
			throw new Error('Discord broadcast player did not start', { cause: error })
		}

		if (this.source !== source || this.stopping) return
		this.attempts = 0
		this.status.setBroadcast('playing')
		logger.info('Shared radio audio is playing', { activeGuilds: this.consumers.size })
	}

	private async stopSource(): Promise<void> {
		const source = this.source
		this.source = null
		this.player.stop(true)
		this.status.setBroadcast('idle')
		if (source) await source.stop()
	}

	private scheduleRestart(reason: string): void {
		if (this.stopping || this.consumers.size === 0 || this.retryTimer) return
		this.attempts += 1
		const waitMs = backoffDelay(this.attempts)
		this.status.setBroadcast('retrying')
		logger.warn('Scheduling shared radio source restart', {
			reason,
			attempt: this.attempts,
			waitMs,
		})
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			void this.enqueue(async () => {
				try {
					await this.startSourceNow()
				} catch (error) {
					this.reportError('Shared radio source restart failed', error)
					this.scheduleRestart('source retry failed')
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
		this.status.recordError(fullMessage)
		logger.error(message, error === undefined ? undefined : { error: errorMessage(error) })
	}
}
