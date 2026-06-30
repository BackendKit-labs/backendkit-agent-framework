// src/config/metrics.config.ts
import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
    imports: [
        // `as any`: @willsoto/nestjs-prometheus trae su propia copia de los tipos de
        // @nestjs/common, lo que hace incompatibles los DynamicModule entre sí al
        // compilar con nest build. El cast resuelve el choque sin afectar el runtime.
        PrometheusModule.register({
            defaultMetrics: {
                enabled: true,
            },
        }) as any,
    ],
})
export class MetricsModule { }