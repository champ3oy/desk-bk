import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { ElevenLabsService } from '../src/integrations/elevenlabs/elevenlabs.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('MigrationScript');

  const orgService = app.get(OrganizationsService);
  const elevenLabsService = app.get(ElevenLabsService);

  logger.log(
    'Starting migration: Assign ElevenLabs Agents to existing organizations...',
  );

  const orgs = await orgService.findAll();
  logger.log(`Found ${orgs.length} organizations.`);

  for (const org of orgs) {
    if (org.elevenLabsAgentId) {
      logger.log(
        `Org "${org.name}" already has agent: ${org.elevenLabsAgentId}. Skipping.`,
      );
      continue;
    }

    try {
      logger.log(`Creating agent for org: "${org.name}"...`);
      const agentId = await elevenLabsService.createAgent(org.name);

      if (agentId) {
        await orgService.update((org as any)._id.toString(), {
          elevenLabsAgentId: agentId,
        });
        logger.log(`Success! Assigned agent ${agentId} to org "${org.name}".`);
      }
    } catch (error: any) {
      logger.error(
        `Failed to create agent for org "${org.name}": ${error.message}`,
      );
    }
  }

  logger.log('Migration complete.');
  await app.close();
}

bootstrap();
