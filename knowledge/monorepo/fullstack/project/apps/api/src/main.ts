import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Development-only CORS. Explicitly configure known frontend origins in production.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
