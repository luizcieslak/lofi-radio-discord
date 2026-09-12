import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { errorMessage, logger } from './logger.ts'

export interface MediaExit {
	code: number | null
	signal: NodeJS.Signals | null
	error: string | null
}

export interface MediaSource {
	output: Readable
	completed: Promise<MediaExit>
	stop(): Promise<void>
}

export type MediaSourceFactory = () => MediaSource

export function createFfmpegMediaSource(ffmpegPath: string, radioStreamUrl: string): MediaSource {
	const child = spawn(
		ffmpegPath,
		[
			'-hide_banner',
			'-loglevel',
			'warning',
			'-reconnect',
			'1',
			'-reconnect_streamed',
			'1',
			'-reconnect_delay_max',
			'5',
			'-i',
			radioStreamUrl,
			'-vn',
			'-ac',
			'2',
			'-ar',
			'48000',
			'-c:a',
			'libopus',
			'-application',
			'audio',
			'-frame_duration',
			'20',
			'-b:a',
			'128k',
			'-vbr',
			'on',
			'-f',
			'ogg',
			'pipe:1',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	)

	let spawnError: string | null = null
	let stopped = false

	const stderr = createInterface({ input: child.stderr })
	stderr.on('line', line => {
		const sanitized = line.replaceAll(radioStreamUrl, '[radio-stream]')
		logger.warn('FFmpeg output', { output: sanitized })
	})

	const completed = new Promise<MediaExit>(resolve => {
		child.once('error', error => {
			spawnError = errorMessage(error)
		})
		child.once('close', (code, signal) => {
			stderr.close()
			resolve({ code, signal, error: spawnError })
		})
	})

	return {
		output: child.stdout,
		completed,
		async stop(): Promise<void> {
			if (stopped || child.exitCode !== null || child.signalCode !== null) return
			stopped = true
			child.kill('SIGTERM')
			const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000)
			forceKill.unref()
			await completed
			clearTimeout(forceKill)
		},
	}
}
