import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import {
  CorrelationInterceptor,
  PerformanceInterceptor,
  AllExceptionsFilter,
  LoggerService,
} from '@backendkit-labs/observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use structured logger from observability module
  const logger = app.get(LoggerService);
  app.useLogger(logger);

  // Correlation ID + performance tracking on every request
  app.useGlobalInterceptors(
    app.get(CorrelationInterceptor),
    app.get(PerformanceInterceptor),
  );

  // Structured exception handling
  app.useGlobalFilters(app.get(AllExceptionsFilter));

  // Enable CORS for frontend communication
  const origins = (process.env.CORS_ORIGIN || 'http://localhost:3001,http://localhost:3002').split(',');
  app.enableCors({
    origin: origins.length === 1 ? origins[0] : origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Set global prefix for all API routes
  app.setGlobalPrefix('api');

  // Enable global validation pipe with strict settings
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`director-api running on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();