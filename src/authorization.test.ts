import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canMoveOrStop, canPlayInChannel } from './authorization.ts'

describe('voice command authorization', () => {
	it('lets a voice member start in their own channel only', () => {
		const context = { hasManageGuild: false, memberChannelId: 'voice-1' }
		assert.equal(canPlayInChannel(context, 'voice-1'), true)
		assert.equal(canPlayInChannel(context, 'voice-2'), false)
	})

	it('lets current-channel members or managers move and stop', () => {
		assert.equal(
			canMoveOrStop({ hasManageGuild: false, memberChannelId: 'voice-1', botChannelId: 'voice-1' }),
			true,
		)
		assert.equal(
			canMoveOrStop({ hasManageGuild: false, memberChannelId: 'voice-2', botChannelId: 'voice-1' }),
			false,
		)
		assert.equal(
			canMoveOrStop({ hasManageGuild: true, memberChannelId: null, botChannelId: 'voice-1' }),
			true,
		)
	})
})
