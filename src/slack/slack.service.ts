import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  WebClient,
  ChatPostMessageResponse,
  ChatScheduleMessageResponse,
  retryPolicies,
} from '@slack/web-api'
import { v4 as uuidv4 } from 'uuid'

import { PrismaService } from '../prisma/prisma.service'
import { SendSlackDto } from './dto/send-slack.dto'
import { SlackResponseDto } from './dto/slack-response.dto'

/**
 * Slack microservice — outbound messaging + helper API ops.
 *
 * Uses the official `@slack/web-api` `WebClient`, which already handles:
 *   - HTTP keep-alive (internal node-fetch agent)
 *   - Automatic backoff/retries on 429 and 5xx
 *
 * So unlike the Meta-based services, we don't need a custom HTTP client.
 * We just configure timeout + retries explicitly via env.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name)
  private readonly client: WebClient

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const token = this.config.getOrThrow<string>('SLACK_BOT_TOKEN')
    const timeoutMs = Number(this.config.get<string>('SLACK_API_TIMEOUT_MS') ?? 30_000)
    const maxRetries = Number(this.config.get<string>('SLACK_API_MAX_RETRIES') ?? 3)

    this.client = new WebClient(token, {
      timeout: timeoutMs,
      retryConfig: maxRetries === 0 ? retryPolicies.rapidRetryPolicy : { retries: maxRetries },
    })

    this.logger.log(`SlackService ready — timeout=${timeoutMs}ms retries=${maxRetries}`)
  }

  // ─────────────── fan-out send ───────────────

  async sendToRecipients(dto: SendSlackDto): Promise<SlackResponseDto> {
    const results = await Promise.allSettled(
      dto.recipients.map((recipient) =>
        this.sendToOne(dto.messageId, recipient, dto.message, dto.mediaUrl),
      ),
    )

    const errors = results
      .map((r, i) =>
        r.status === 'rejected'
          ? {
              recipient: dto.recipients[i],
              reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
            }
          : null,
      )
      .filter((e): e is { recipient: string; reason: string } => e !== null)

    const sentCount = results.filter((r) => r.status === 'fulfilled').length
    const failedCount = errors.length

    return {
      messageId: dto.messageId,
      status: this.resolveStatus(sentCount, failedCount),
      sentCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    }
  }

  // ─────────────── single send ───────────────

  private async sendToOne(
    messageId: string,
    recipient: string,
    message: string,
    mediaUrl?: string | null,
  ): Promise<void> {
    const record = await this.prisma.slackMessage.create({
      data: {
        id: uuidv4(),
        messageId,
        recipient,
        body: message,
        mediaUrl: mediaUrl ?? null,
        status: 'PENDING',
      },
    })

    try {
      const response: ChatPostMessageResponse = mediaUrl
        ? await this.client.chat.postMessage({
            channel: recipient,
            text: message,
            blocks: [
              { type: 'image', image_url: mediaUrl, alt_text: message },
              { type: 'section', text: { type: 'mrkdwn', text: message } },
            ],
          })
        : await this.client.chat.postMessage({ channel: recipient, text: message })

      await this.prisma.slackMessage.update({
        where: { id: record.id },
        data: {
          status: 'SENT',
          slackMsgTs: response.ts ?? null,
          channel: response.channel ?? null,
          sentAt: new Date(),
        },
      })

      this.logger.log(`Sent to ${recipient} | ts=${response.ts}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.prisma.slackMessage.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorReason: reason },
      })
      this.logger.error(`Failed to send to ${recipient}: ${reason}`)
      throw error instanceof Error ? error : new Error(reason)
    }
  }

  // ─────────────── helper ops ───────────────

  async scheduleMessage(
    channelId: string,
    text: string,
    postAt: number,
    blocks?: Array<Record<string, unknown>>,
  ): Promise<string> {
    try {
      const response = (await this.client.chat.scheduleMessage({
        channel: channelId,
        text,
        post_at: postAt,
        blocks: blocks as any,
      })) as ChatScheduleMessageResponse
      if (!response.ok) throw new Error(response.error || 'Unknown error')
      this.logger.log(
        `Scheduled in ${channelId} | scheduled_message_id=${response.scheduled_message_id}`,
      )
      return response.scheduled_message_id as string
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Failed to schedule message: ${reason}`)
    }
  }

  async addReaction(emoji: string, channelId: string, messageTs: string): Promise<void> {
    try {
      const response = await this.client.reactions.add({
        name: emoji,
        channel: channelId,
        timestamp: messageTs,
      })
      if (!response.ok) throw new Error(response.error || 'Unknown error')
      this.logger.log(`Added :${emoji}: in ${channelId} (ts=${messageTs})`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Failed to add reaction: ${reason}`)
    }
  }

  async removeReaction(emoji: string, channelId: string, messageTs: string): Promise<void> {
    try {
      const response = await this.client.reactions.remove({
        name: emoji,
        channel: channelId,
        timestamp: messageTs,
      })
      if (!response.ok) throw new Error(response.error || 'Unknown error')
      this.logger.log(`Removed :${emoji}: from ${channelId}`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Failed to remove reaction: ${reason}`)
    }
  }

  async postThreadReply(
    channelId: string,
    text: string,
    threadTs: string,
    replyBroadcast = false,
  ): Promise<ChatPostMessageResponse> {
    if (!threadTs) {
      throw new BadRequestException('postThreadReply requires a non-empty threadTs')
    }
    try {
      const response = await this.client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts: threadTs,
        reply_broadcast: replyBroadcast,
      })
      if (!response.ok) throw new Error(response.error || 'Unknown error')
      this.logger.log(`Thread reply in ${channelId} (thread_ts=${threadTs})`)
      return response
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new BadRequestException(`Failed to post thread reply: ${reason}`)
    }
  }

  // ─────────────── helpers ───────────────

  private resolveStatus(sent: number, failed: number): 'SENT' | 'FAILED' | 'PARTIAL' {
    if (failed === 0) return 'SENT'
    if (sent === 0) return 'FAILED'
    return 'PARTIAL'
  }
}
