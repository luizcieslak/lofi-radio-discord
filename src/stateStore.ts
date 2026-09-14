import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface GuildAssignment {
	guildId: string
	channelId: string
	updatedAt: string
}

export interface AssignmentStore {
	list(): GuildAssignment[]
	upsert(guildId: string, channelId: string): void
	delete(guildId: string): void
	count(): number
	close(): void
}

export function importLegacyAssignment(
	store: AssignmentStore,
	assignment: Pick<GuildAssignment, 'guildId' | 'channelId'> | null,
): boolean {
	if (!assignment || store.count() !== 0) return false
	store.upsert(assignment.guildId, assignment.channelId)
	return true
}

function assignmentFromRow(row: Record<string, unknown>): GuildAssignment {
	const guildId = row.guild_id
	const channelId = row.channel_id
	const updatedAt = row.updated_at
	if (typeof guildId !== 'string' || typeof channelId !== 'string' || typeof updatedAt !== 'string') {
		throw new Error('The guild assignment database contains an invalid row')
	}
	return { guildId, channelId, updatedAt }
}

export class SqliteAssignmentStore implements AssignmentStore {
	private readonly database: DatabaseSync

	constructor(path: string) {
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
		this.database = new DatabaseSync(path)
		this.database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA busy_timeout = 5000;
			CREATE TABLE IF NOT EXISTS guild_assignments (
				guild_id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL,
				updated_at TEXT NOT NULL
			) STRICT;
		`)
	}

	list(): GuildAssignment[] {
		return this.database
			.prepare('SELECT guild_id, channel_id, updated_at FROM guild_assignments ORDER BY guild_id')
			.all()
			.map(assignmentFromRow)
	}

	upsert(guildId: string, channelId: string): void {
		this.database
			.prepare(`
				INSERT INTO guild_assignments (guild_id, channel_id, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(guild_id) DO UPDATE SET
					channel_id = excluded.channel_id,
					updated_at = excluded.updated_at
			`)
			.run(guildId, channelId, new Date().toISOString())
	}

	delete(guildId: string): void {
		this.database.prepare('DELETE FROM guild_assignments WHERE guild_id = ?').run(guildId)
	}

	count(): number {
		const row = this.database.prepare('SELECT COUNT(*) AS count FROM guild_assignments').get()
		const count = row?.count
		if (typeof count !== 'number') throw new Error('Could not count saved guild assignments')
		return count
	}

	close(): void {
		this.database.close()
	}
}
