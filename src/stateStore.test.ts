import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { importLegacyAssignment, SqliteAssignmentStore } from './stateStore.ts'

describe('SqliteAssignmentStore', () => {
	it('persists assignments across reopen and supports update and delete', () => {
		const directory = mkdtempSync(join(tmpdir(), 'lofi-radio-store-'))
		const path = join(directory, 'state.sqlite')
		try {
			const first = new SqliteAssignmentStore(path)
			first.upsert('guild-1', 'channel-1')
			first.upsert('guild-1', 'channel-2')
			first.upsert('guild-2', 'channel-3')
			assert.equal(first.count(), 2)
			first.close()

			const second = new SqliteAssignmentStore(path)
			assert.deepEqual(
				second.list().map(assignment => [assignment.guildId, assignment.channelId]),
				[
					['guild-1', 'channel-2'],
					['guild-2', 'channel-3'],
				],
			)
			second.delete('guild-1')
			assert.equal(second.count(), 1)
			second.close()
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	it('imports a legacy assignment only into an empty store', () => {
		const store = new SqliteAssignmentStore(':memory:')
		assert.equal(importLegacyAssignment(store, { guildId: 'legacy', channelId: 'voice' }), true)
		assert.equal(importLegacyAssignment(store, { guildId: 'other', channelId: 'other-voice' }), false)
		assert.equal(store.list()[0]?.guildId, 'legacy')
		store.close()
	})
})
