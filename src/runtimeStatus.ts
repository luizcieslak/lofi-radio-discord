export type VoiceStatus = 'disconnected' | 'connecting' | 'ready' | 'retrying'
export type AudioStatus = 'idle' | 'starting' | 'playing' | 'retrying'

export interface StatusSnapshot {
	status: 'healthy' | 'shutting_down'
	ready: boolean
	uptimeSeconds: number
	voice: VoiceStatus
	audio: AudioStatus
	desiredChannelId: string | null
	lastError: string | null
	lastErrorAt: string | null
}

export class RuntimeStatus {
	private readonly startedAt = Date.now()
	private voice: VoiceStatus = 'disconnected'
	private audio: AudioStatus = 'idle'
	private desiredChannelId: string | null = null
	private lastError: string | null = null
	private lastErrorAt: string | null = null
	private shuttingDown = false

	setVoice(voice: VoiceStatus): void {
		this.voice = voice
	}

	setAudio(audio: AudioStatus): void {
		this.audio = audio
	}

	setDesiredChannel(channelId: string | null): void {
		this.desiredChannelId = channelId
	}

	recordError(message: string): void {
		this.lastError = message
		this.lastErrorAt = new Date().toISOString()
	}

	markShuttingDown(): void {
		this.shuttingDown = true
	}

	snapshot(now = Date.now()): StatusSnapshot {
		return {
			status: this.shuttingDown ? 'shutting_down' : 'healthy',
			ready: !this.shuttingDown && this.voice === 'ready' && this.audio === 'playing',
			uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1_000)),
			voice: this.voice,
			audio: this.audio,
			desiredChannelId: this.desiredChannelId,
			lastError: this.lastError,
			lastErrorAt: this.lastErrorAt,
		}
	}
}
