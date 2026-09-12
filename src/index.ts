import closeWithGrace from 'close-with-grace'
import { RadioBot } from './bot.ts'
import { loadConfig } from './config.ts'
import { HealthServer } from './healthServer.ts'
import { errorMessage, logger } from './logger.ts'
import { createFfmpegMediaSource } from './mediaSource.ts'
import { RuntimeStatus } from './runtimeStatus.ts'

async function main(): Promise<void> {
	const config = loadConfig()
	const status = new RuntimeStatus()
	const healthServer = new HealthServer(config.port, status)
	const bot = new RadioBot(config, status, () =>
		createFfmpegMediaSource(config.ffmpegPath, config.radioStreamUrl),
	)

	await healthServer.start()
	logger.info('Health server listening', { host: '0.0.0.0', port: config.port })

	closeWithGrace({ delay: 15_000 }, async ({ signal, err }) => {
		status.markShuttingDown()
		if (err) logger.error('Fatal process error triggered shutdown', { error: errorMessage(err) })
		logger.info('Shutting down', { signal })
		await bot.stop()
		await healthServer.stop()
	})

	try {
		await bot.start()
	} catch (error) {
		status.markShuttingDown()
		await bot.stop()
		await healthServer.stop()
		throw error
	}
}

void main().catch(error => {
	logger.error('Application failed to start', { error: errorMessage(error) })
	process.exit(1)
})
