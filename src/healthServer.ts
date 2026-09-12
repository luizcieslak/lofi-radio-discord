import { createServer, type Server } from 'node:http'
import type { RuntimeStatus } from './runtimeStatus.ts'

export class HealthServer {
	private readonly port: number
	private readonly server: Server

	constructor(port: number, status: RuntimeStatus) {
		this.port = port
		this.server = createServer((request, response) => {
			const snapshot = status.snapshot()
			response.setHeader('Content-Type', 'application/json; charset=utf-8')
			response.setHeader('Cache-Control', 'no-store')

			if (request.url === '/healthz') {
				response.writeHead(snapshot.status === 'healthy' ? 200 : 503)
				response.end(JSON.stringify(snapshot))
				return
			}

			if (request.url === '/readyz') {
				response.writeHead(snapshot.ready ? 200 : 503)
				response.end(JSON.stringify(snapshot))
				return
			}

			response.writeHead(404)
			response.end(JSON.stringify({ error: 'not_found' }))
		})
	}

	async start(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.server.once('error', reject)
			this.server.listen(this.port, '0.0.0.0', () => {
				this.server.off('error', reject)
				resolve()
			})
		})
	}

	async stop(): Promise<void> {
		if (!this.server.listening) return
		await new Promise<void>((resolve, reject) => {
			this.server.close(error => {
				if (error) reject(error)
				else resolve()
			})
		})
	}
}
