import {
	ChannelType,
	type ChatInputCommandInteraction,
	Client,
	Events,
	GatewayIntentBits,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from 'discord.js'
import type { Config } from './config.ts'
import { errorMessage, logger } from './logger.ts'
import type { MediaSourceFactory } from './mediaSource.ts'
import { RadioRelay } from './relay.ts'
import { delay } from './retry.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'

const radioCommand = new SlashCommandBuilder()
	.setName('radio')
	.setDescription('Control the 24/7 lofi radio relay')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.addSubcommand(subcommand =>
		subcommand
			.setName('join')
			.setDescription('Join or move to a voice channel')
			.addChannelOption(option =>
				option
					.setName('channel')
					.setDescription('Voice channel; defaults to your current channel')
					.addChannelTypes(ChannelType.GuildVoice),
			),
	)
	.addSubcommand(subcommand => subcommand.setName('leave').setDescription('Leave voice and pause recovery'))
	.addSubcommand(subcommand => subcommand.setName('restart').setDescription('Restart the radio audio source'))
	.addSubcommand(subcommand => subcommand.setName('status').setDescription('Show relay health and state'))

export class RadioBot {
	private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] })
	private readonly config: Config
	private readonly status: RuntimeStatus
	private readonly relay: RadioRelay

	constructor(config: Config, status: RuntimeStatus, mediaSourceFactory: MediaSourceFactory) {
		this.config = config
		this.status = status
		this.relay = new RadioRelay(this.client, config.discordGuildId, mediaSourceFactory, status)

		this.client.on(Events.InteractionCreate, interaction => {
			if (!interaction.isChatInputCommand() || interaction.commandName !== 'radio') return
			void this.handleCommand(interaction).catch(error => this.handleCommandError(interaction, error))
		})
	}

	async start(): Promise<void> {
		this.client.once(Events.ClientReady, readyClient => {
			void this.onReady(readyClient).catch(error => {
				this.status.recordError(`Discord startup failed: ${errorMessage(error)}`)
				logger.error('Discord startup failed', { error: errorMessage(error) })
			})
		})

		await this.client.login(this.config.discordToken)
	}

	async stop(): Promise<void> {
		await this.relay.stop()
		this.client.destroy()
	}

	private async onReady(readyClient: Client<true>): Promise<void> {
		logger.info('Discord gateway ready', { botUserId: readyClient.user.id })
		try {
			const guild = await readyClient.guilds.fetch(this.config.discordGuildId)
			await guild.commands.set([radioCommand.toJSON()])
			logger.info('Guild slash commands registered', { guildId: guild.id })
		} catch (error) {
			this.status.recordError(`Slash command registration failed: ${errorMessage(error)}`)
			logger.error('Slash command registration failed', { error: errorMessage(error) })
		}

		if (this.config.startupJoinDelayMs > 0) {
			logger.info('Waiting before the default voice join', { waitMs: this.config.startupJoinDelayMs })
			await delay(this.config.startupJoinDelayMs)
		}

		try {
			await this.relay.join(this.config.defaultVoiceChannelId)
		} catch (error) {
			this.status.recordError(`Default voice join failed: ${errorMessage(error)}`)
			logger.error('Default voice join failed', { error: errorMessage(error) })
		}
	}

	private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
		if (interaction.guildId !== this.config.discordGuildId) {
			await interaction.reply({
				content: 'This bot is configured for another server.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.reply({
				content: 'Manage Server permission is required.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		const subcommand = interaction.options.getSubcommand()
		if (subcommand === 'status') {
			const snapshot = this.status.snapshot()
			await interaction.reply({
				content: [
					`Voice: **${snapshot.voice}**`,
					`Audio: **${snapshot.audio}**`,
					`Desired channel: ${snapshot.desiredChannelId ? `<#${snapshot.desiredChannelId}>` : 'none'}`,
					`Uptime: ${snapshot.uptimeSeconds}s`,
					`Last error: ${snapshot.lastError ?? 'none'}`,
				].join('\n'),
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })

		if (subcommand === 'leave') {
			await this.relay.leave()
			await interaction.editReply('Disconnected. Automatic recovery is paused until `/radio join`.')
			return
		}

		if (subcommand === 'restart') {
			await this.relay.restartSource()
			await interaction.editReply('The radio audio source was restarted.')
			return
		}

		if (subcommand === 'join') {
			const selected = interaction.options.getChannel('channel')
			let channelId: string | null = null
			if (selected?.type === ChannelType.GuildVoice) {
				channelId = selected.id
			} else if (interaction.member instanceof GuildMember) {
				const memberChannel = interaction.member.voice.channel
				if (memberChannel?.type === ChannelType.GuildVoice) channelId = memberChannel.id
			}

			if (!channelId) {
				await interaction.editReply('Choose a voice channel or join one before running this command.')
				return
			}

			await this.relay.join(channelId)
			await interaction.editReply(`Streaming in <#${channelId}>.`)
		}
	}

	private async handleCommandError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
		const message = errorMessage(error)
		logger.error('Slash command failed', { error: message, userId: interaction.user.id })
		const content = `The radio command failed: ${message}`

		try {
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply(content)
				return
			}
			await interaction.reply({ content, flags: MessageFlags.Ephemeral })
		} catch (replyError) {
			logger.error('Could not report slash command failure', { error: errorMessage(replyError) })
		}
	}
}
