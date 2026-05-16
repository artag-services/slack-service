import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';
import { SlackModule } from './slack/slack.module';

// Per CLAUDE.md / architecture rule: webhooks land at the gateway and are
// bridged to this service via RabbitMQ. There is no direct webhook controller
// on this service.

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RabbitMQModule,
    SlackModule,
  ],
})
export class AppModule {}
