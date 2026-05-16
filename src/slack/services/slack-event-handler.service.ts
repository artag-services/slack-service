import { Injectable, Logger } from '@nestjs/common'

import { SLACK_EVENT_TYPES } from '../constants/events'

/**
 * Routes Slack events received via RabbitMQ to type-specific log handlers.
 *
 * This service **only logs** events. Any business logic (auto-replies,
 * AI processing, audit persistence) should subscribe to the corresponding
 * RabbitMQ routing key in the relevant consumer service — the listener
 * here is not the place to send messages back.
 *
 * Previous version contained "Test: ..." auto-replies that would spam
 * every user/channel in production (including an infinite DM loop risk).
 * Those were removed.
 */
@Injectable()
export class SlackEventHandlerService {
  private readonly logger = new Logger(SlackEventHandlerService.name)

  async handleEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const event = (payload['event'] as Record<string, unknown>) ?? {}

      switch (eventType) {
        // Message Events
        case SLACK_EVENT_TYPES.MESSAGE_CHANNELS:
          this.logMessage('channel', event)
          break
        case SLACK_EVENT_TYPES.MESSAGE_GROUPS:
          this.logMessage('private-channel', event, { warnOnSensitive: true })
          break
        case SLACK_EVENT_TYPES.MESSAGE_IM:
          this.logMessage('dm', event)
          break
        case SLACK_EVENT_TYPES.MESSAGE_MPIM:
          this.logMessage('multi-dm', event)
          break
        case SLACK_EVENT_TYPES.APP_MENTION:
          this.logAppMention(event)
          break

        // Channel Events
        case SLACK_EVENT_TYPES.CHANNEL_CREATED:
          this.logChannelCreated(event)
          break
        case SLACK_EVENT_TYPES.CHANNEL_DELETED:
          this.logger.log(`🗑️ channel deleted | id=${event['channel']}`)
          break
        case SLACK_EVENT_TYPES.CHANNEL_RENAMED:
          this.logChannelRenamed(event)
          break
        case SLACK_EVENT_TYPES.MEMBER_JOINED_CHANNEL:
          this.logger.log(
            `👤 member joined | user=${event['user']} channel=${event['channel']} ` +
              `inviter=${event['inviter'] ?? '-'}`,
          )
          break

        // Reaction Events
        case SLACK_EVENT_TYPES.REACTION_ADDED:
          this.logReaction('added', event)
          break
        case SLACK_EVENT_TYPES.REACTION_REMOVED:
          this.logReaction('removed', event)
          break

        // User Events
        case SLACK_EVENT_TYPES.USER_CHANGE:
          this.logUserChange(event)
          break
        case SLACK_EVENT_TYPES.TEAM_JOIN:
          this.logTeamJoin(event)
          break

        // File Events
        case SLACK_EVENT_TYPES.FILE_CREATED:
          this.logFileCreated(event)
          break
        case SLACK_EVENT_TYPES.FILE_DELETED:
          this.logger.log(`🗑️ file deleted | id=${event['file_id']}`)
          break

        default:
          this.logger.warn(`Unknown Slack event type: ${eventType}`)
      }
    } catch (error) {
      this.logger.error(
        `Error handling Slack event [${eventType}]: ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  // ─────────────── log helpers ───────────────

  private logMessage(
    kind: string,
    event: Record<string, unknown>,
    opts: { warnOnSensitive?: boolean } = {},
  ): void {
    const channel = event['channel'] as string | undefined
    const user = event['user'] as string | undefined
    const text = event['text'] as string | undefined
    const ts = event['ts'] as string | undefined

    this.logger.log(`📨 [${kind}] channel=${channel} user=${user} ts=${ts}`)

    if (opts.warnOnSensitive && text && /(password|secret|api[_-]?key|token)/i.test(text)) {
      this.logger.warn(`⚠️ possible sensitive data in ${kind} ${channel}`)
    }
  }

  private logAppMention(event: Record<string, unknown>): void {
    const channel = event['channel'] as string | undefined
    const user = event['user'] as string | undefined
    const ts = event['ts'] as string | undefined
    const text = event['text'] as string | undefined
    this.logger.log(`🤖 app_mention | channel=${channel} user=${user} ts=${ts}`)
    if (Logger.isLevelEnabled('debug') && text) {
      this.logger.debug(`app_mention text: ${text.slice(0, 200)}`)
    }
  }

  private logChannelCreated(event: Record<string, unknown>): void {
    const channel = (event['channel'] as Record<string, unknown>) ?? {}
    this.logger.log(
      `✨ channel created | name=#${channel['name']} id=${channel['id']} creator=${channel['creator']}`,
    )
  }

  private logChannelRenamed(event: Record<string, unknown>): void {
    const channel = (event['channel'] as Record<string, unknown>) ?? {}
    this.logger.log(`📝 channel renamed | #${channel['old_name']} → #${channel['name']}`)
  }

  private logReaction(kind: 'added' | 'removed', event: Record<string, unknown>): void {
    const emoji = event['reaction'] as string | undefined
    const user = event['user'] as string | undefined
    const item = event['item'] as Record<string, unknown> | undefined
    const ts = item?.['ts'] as string | undefined
    const channel = item?.['channel'] as string | undefined
    this.logger.log(`❤️ reaction ${kind} | :${emoji}: user=${user} channel=${channel} ts=${ts}`)
  }

  private logUserChange(event: Record<string, unknown>): void {
    const user = event['user'] as Record<string, unknown> | undefined
    const userId = user?.['id']
    const profile = user?.['profile'] as Record<string, unknown> | undefined
    const name = profile?.['display_name'] ?? user?.['real_name']
    this.logger.log(`👤 user_change | id=${userId} name=${name}`)
  }

  private logTeamJoin(event: Record<string, unknown>): void {
    const user = event['user'] as Record<string, unknown> | undefined
    const userId = user?.['id']
    const realName = user?.['real_name']
    const profile = user?.['profile'] as Record<string, unknown> | undefined
    const email = profile?.['email']
    this.logger.log(`🎉 team_join | id=${userId} name=${realName} email=${email}`)
  }

  private logFileCreated(event: Record<string, unknown>): void {
    const file = event['file'] as Record<string, unknown> | undefined
    const name = file?.['name']
    const size = file?.['size']
    const mimetype = file?.['mimetype']
    const user = file?.['user']
    this.logger.log(`📎 file_created | name=${name} size=${size} type=${mimetype} user=${user}`)
    if (typeof name === 'string' && /\.(exe|bat|sh|cmd|ps1)$/i.test(name)) {
      this.logger.warn(`⚠️ executable file uploaded: ${name}`)
    }
  }
}
