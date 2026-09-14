export interface ControlContext {
	hasManageGuild: boolean
	memberChannelId: string | null
	botChannelId: string | null
}

export function canMoveOrStop(context: ControlContext): boolean {
	return (
		context.hasManageGuild || (!!context.botChannelId && context.memberChannelId === context.botChannelId)
	)
}

export function canPlayInChannel(
	context: Pick<ControlContext, 'hasManageGuild' | 'memberChannelId'>,
	targetChannelId: string,
): boolean {
	return context.hasManageGuild || context.memberChannelId === targetChannelId
}
