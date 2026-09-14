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
import { canMoveOrStop, canPlayInChannel } from './authorization.ts'
import { RadioBroadcast } from './broadcast.ts'
import type { Config } from './config.ts'
import { errorMessage, logger } from './logger.ts'
import type { MediaSourceFactory } from './mediaSource.ts'
import { delay } from './retry.ts'
import type { RuntimeStatus } from './runtimeStatus.ts'
import { GuildSessionManager } from './sessionManager.ts'
import { type AssignmentStore, importLegacyAssignment } from './stateStore.ts'

const lofiCommand = new SlashCommandBuilder()
	.setName('lofi')
	.setDescription('Play the shared lofi radio in a voice channel')
	.addSubcommand(subcommand =>
		subcommand
			.setName('play')
			.setDescription('Start or move the lofi radio')
			.addChannelOption(option =>
				option
					.setName('channel')
					.setDescription('Voice channel; defaults to your current channel')
					.addChannelTypes(ChannelType.GuildVoice),
			),
	)
	.addSubcommand(subcommand =>
		subcommand.setName('stop').setDescription('Stop the lofi radio in this server'),
	)
	.addSubcommand(subcommand => subcommand.setName('status').setDescription('Show lofi radio status'))

export class RadioBot {
	private readonly client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
	})
	private readonly config: Config
	private readonly status: RuntimeStatus
	private readonly store: AssignmentStore
	private readonly sessions: GuildSessionManager
	private stopped = false

	constructor(
		config: Config,
		status: RuntimeStatus,
		mediaSourceFactory: MediaSourceFactory,
		store: AssignmentStore,
	) {
		this.config = config
		this.status = status
		this.store = store
		const broadcast = new RadioBroadcast(mediaSourceFactory, status)
		this.sessions = new GuildSessionManager(this.client, broadcast, store, status)

		this.client.on(Events.InteractionCreate, interaction => {
			if (!interaction.isChatInputCommand() || interaction.commandName !== 'lofi') return
			void this.handleCommand(interaction).catch(error => this.handleCommandError(interaction, error))
		})
		this.client.on(Events.GuildDelete, guild => {
			void this.sessions.removeGuild(guild.id)
		})
		this.client.on(Events.ShardDisconnect, () => this.status.setGateway('disconnected'))
		this.client.on(Events.ShardReady, () => this.status.setGateway('ready'))
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
		if (this.stopped) return
		this.stopped = true
		await this.sessions.shutdown()
		this.client.destroy()
		this.store.close()
	}

	private async onReady(readyClient: Client<true>): Promise<void> {
		this.status.setGateway('ready')
		logger.info('Discord gateway ready', {
			botUserId: readyClient.user.id,
			guilds: readyClient.guilds.cache.size,
		})
		try {
			await readyClient.application.commands.set([lofiCommand.toJSON()])
			logger.info('Global slash commands registered')
		} catch (error) {
			this.status.recordError(`Global slash command registration failed: ${errorMessage(error)}`)
			logger.error('Global slash command registration failed', { error: errorMessage(error) })
		}

		await this.importLegacyAssignment(readyClient)
		if (this.config.startupJoinDelayMs > 0) {
			logger.info('Waiting before restoring voice sessions', { waitMs: this.config.startupJoinDelayMs })
			await delay(this.config.startupJoinDelayMs)
		}
		await this.sessions.restore()
	}

	private async importLegacyAssignment(readyClient: Client<true>): Promise<void> {
		const legacy = this.config.legacyDefaultAssignment
		if (!legacy) return

		if (importLegacyAssignment(this.store, legacy)) {
			logger.info('Imported legacy default voice assignment', {
				guildId: legacy.guildId,
				channelId: legacy.channelId,
			})
		}

		try {
			const guild = await readyClient.guilds.fetch(legacy.guildId)
			await guild.commands.set([])
			logger.info('Removed legacy guild slash commands', { guildId: legacy.guildId })
		} catch (error) {
			logger.warn('Could not remove legacy guild slash commands', {
				guildId: legacy.guildId,
				error: errorMessage(error),
			})
		}
	}

	private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
		const guild = interaction.guild
		if (!guild || !interaction.guildId) {
			await interaction.reply({ content: 'Use this command in a server.', flags: MessageFlags.Ephemeral })
			return
		}

		const member = interaction.member instanceof GuildMember ? interaction.member : null
		const memberChannelId = member?.voice.channelId ?? null
		const hasManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
		const botChannelId = this.sessions.channelId(guild.id)
		const subcommand = interaction.options.getSubcommand()

		if (subcommand === 'status') {
			const guildStatus = this.status.guildSnapshot(guild.id)
			const serviceStatus = this.status.snapshot()
			await interaction.reply({
				content: guildStatus
					? [
							`Voice: **${guildStatus.voice}**`,
							`Audio: **${serviceStatus.broadcast}**`,
							`Channel: <#${guildStatus.desiredChannelId}>`,
							`Last error: ${guildStatus.lastError ?? serviceStatus.lastError ?? 'none'}`,
						].join('\n')
					: 'The lofi radio is stopped in this server.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		if (subcommand === 'stop') {
			if (!botChannelId) {
				await interaction.reply({
					content: 'The lofi radio is already stopped in this server.',
					flags: MessageFlags.Ephemeral,
				})
				return
			}
			if (!canMoveOrStop({ hasManageGuild, memberChannelId, botChannelId })) {
				await interaction.reply({
					content: 'Join the bot’s voice channel or use an account with Manage Server permission.',
					flags: MessageFlags.Ephemeral,
				})
				return
			}
			await interaction.deferReply({ flags: MessageFlags.Ephemeral })
			await this.sessions.stop(guild.id)
			await interaction.editReply('Stopped the lofi radio in this server.')
			return
		}

		const selected = interaction.options.getChannel('channel')
		const targetChannelId = selected?.type === ChannelType.GuildVoice ? selected.id : memberChannelId
		if (!targetChannelId) {
			await interaction.reply({
				content: 'Join a voice channel or choose one before using `/lofi play`.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}
		if (!botChannelId && !canPlayInChannel({ hasManageGuild, memberChannelId }, targetChannelId)) {
			await interaction.reply({
				content: 'You can only start the radio in your own voice channel.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}
		if (botChannelId && !canMoveOrStop({ hasManageGuild, memberChannelId, botChannelId })) {
			await interaction.reply({
				content: 'Only members in the bot’s current channel or server managers can control it.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		const targetChannel = await guild.channels.fetch(targetChannelId)
		if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
			await interaction.reply({
				content: 'Choose a standard server voice channel.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}
		const botMember = guild.members.me
		const botPermissions = botMember ? targetChannel.permissionsFor(botMember) : null
		if (
			!botPermissions?.has([
				PermissionFlagsBits.ViewChannel,
				PermissionFlagsBits.Connect,
				PermissionFlagsBits.Speak,
			])
		) {
			await interaction.reply({
				content: 'I need View Channel, Connect, and Speak permissions in that voice channel.',
				flags: MessageFlags.Ephemeral,
			})
			return
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		await this.sessions.play(guild.id, targetChannelId)
		await interaction.editReply(`Streaming lofi in <#${targetChannelId}>.`)
	}

	private async handleCommandError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
		const message = errorMessage(error)
		logger.error('Slash command failed', {
			error: message,
			guildId: interaction.guildId,
			userId: interaction.user.id,
		})
		const content = `The lofi command failed: ${message}. Automatic recovery will keep trying when possible.`

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
