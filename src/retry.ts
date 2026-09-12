export interface BackoffOptions {
	baseMs?: number
	maximumMs?: number
	jitterRatio?: number
	random?: () => number
}

export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
	const baseMs = options.baseMs ?? 1_000
	const maximumMs = options.maximumMs ?? 30_000
	const jitterRatio = options.jitterRatio ?? 0.2
	const random = options.random ?? Math.random
	const exponent = Math.max(0, Math.min(attempt - 1, 20))
	const bounded = Math.min(maximumMs, baseMs * 2 ** exponent)
	const jitter = bounded * jitterRatio * (random() * 2 - 1)
	return Math.max(0, Math.round(bounded + jitter))
}

export async function delay(milliseconds: number): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, milliseconds))
}
