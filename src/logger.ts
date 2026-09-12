export type LogDetails = Readonly<Record<string, unknown>>

function write(level: 'info' | 'warn' | 'error', message: string, details?: LogDetails): void {
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...(details ?? {}),
	}

	const line = JSON.stringify(entry)
	if (level === 'error') {
		console.error(line)
		return
	}
	if (level === 'warn') {
		console.warn(line)
		return
	}
	console.log(line)
}

export const logger = {
	info(message: string, details?: LogDetails): void {
		write('info', message, details)
	},
	warn(message: string, details?: LogDetails): void {
		write('warn', message, details)
	},
	error(message: string, details?: LogDetails): void {
		write('error', message, details)
	},
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
