export type GatewayStatus = 'starting' | 'ready' | 'disconnected'
export type StorageStatus = 'starting' | 'ready' | 'failed'
export type BroadcastStatus = 'idle' | 'starting' | 'playing' | 'retrying'
export type VoiceStatus = 'disconnected' | 'connecting' | 'ready' | 'retrying'

export interface GuildStatusSnapshot {
	guildId: string
	desiredChannelId: string
	voice: VoiceStatus
	lastError: string | null
	lastErrorAt: string | null
}

export interface StatusSnapshot {
	status: 'healthy' | 'shutting_down'
	ready: boolean
	uptimeSeconds: number
	gateway: GatewayStatus
	storage: StorageStatus
	broadcast: BroadcastStatus
	activeGuilds: number
	connectedGuilds: number
	retryingGuilds: number
	lastError: string | null
	lastErrorAt: string | null
}

interface GuildStatus {
	desiredChannelId: string
	voice: VoiceStatus
	lastError: string | null
	lastErrorAt: string | null
}

export class RuntimeStatus {
	private readonly startedAt = Date.now()
	private readonly guilds = new Map<string, GuildStatus>()
	private gateway: GatewayStatus = 'starting'
	private storage: StorageStatus = 'starting'
	private broadcast: BroadcastStatus = 'idle'
	private lastError: string | null = null
	private lastErrorAt: string | null = null
	private shuttingDown = false

	setGateway(gateway: GatewayStatus): void {
		this.gateway = gateway
	}

	setStorage(storage: StorageStatus): void {
		this.storage = storage
	}

	setBroadcast(broadcast: BroadcastStatus): void {
		this.broadcast = broadcast
	}

	setGuild(guildId: string, desiredChannelId: string, voice: VoiceStatus): void {
		const current = this.guilds.get(guildId)
		this.guilds.set(guildId, {
			desiredChannelId,
			voice,
			lastError: current?.lastError ?? null,
			lastErrorAt: current?.lastErrorAt ?? null,
		})
	}

	removeGuild(guildId: string): void {
		this.guilds.delete(guildId)
	}

	recordGuildError(guildId: string, message: string): void {
		const current = this.guilds.get(guildId)
		if (!current) return
		this.guilds.set(guildId, {
			...current,
			lastError: message,
			lastErrorAt: new Date().toISOString(),
		})
	}

	recordError(message: string): void {
		this.lastError = message
		this.lastErrorAt = new Date().toISOString()
	}

	markShuttingDown(): void {
		this.shuttingDown = true
	}

	guildSnapshot(guildId: string): GuildStatusSnapshot | null {
		const guild = this.guilds.get(guildId)
		if (!guild) return null
		return { guildId, ...guild }
	}

	snapshot(now = Date.now()): StatusSnapshot {
		const guilds = [...this.guilds.values()]
		const activeGuilds = guilds.length
		const connectedGuilds = guilds.filter(guild => guild.voice === 'ready').length
		const retryingGuilds = guilds.filter(guild => guild.voice === 'retrying').length
		const sessionsReady = activeGuilds === 0 || connectedGuilds === activeGuilds
		const broadcastReady = activeGuilds === 0 || this.broadcast === 'playing'

		return {
			status: this.shuttingDown ? 'shutting_down' : 'healthy',
			ready:
				!this.shuttingDown &&
				this.gateway === 'ready' &&
				this.storage === 'ready' &&
				sessionsReady &&
				broadcastReady,
			uptimeSeconds: Math.max(0, Math.floor((now - this.startedAt) / 1_000)),
			gateway: this.gateway,
			storage: this.storage,
			broadcast: this.broadcast,
			activeGuilds,
			connectedGuilds,
			retryingGuilds,
			lastError: this.lastError,
			lastErrorAt: this.lastErrorAt,
		}
	}
}
