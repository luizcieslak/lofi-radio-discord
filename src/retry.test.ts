import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { backoffDelay } from './retry.ts'

describe('backoffDelay', () => {
	it('increases exponentially and respects the maximum', () => {
		const options = { baseMs: 1_000, maximumMs: 5_000, jitterRatio: 0, random: () => 0.5 }

		assert.equal(backoffDelay(1, options), 1_000)
		assert.equal(backoffDelay(2, options), 2_000)
		assert.equal(backoffDelay(3, options), 4_000)
		assert.equal(backoffDelay(4, options), 5_000)
		assert.equal(backoffDelay(100, options), 5_000)
	})

	it('applies bounded jitter', () => {
		assert.equal(backoffDelay(1, { jitterRatio: 0.2, random: () => 0 }), 800)
		assert.equal(backoffDelay(1, { jitterRatio: 0.2, random: () => 1 }), 1_200)
	})
})
