import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Drop-in liveness/readiness endpoint for every non-gateway service — import
 * this into `AppModule` to get a real `GET /health` 200 for k8s probes
 * without duplicating the controller in all 12 services.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
