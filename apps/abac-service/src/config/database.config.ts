import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs('database', (): TypeOrmModuleOptions => {
    return {
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10) || 5432,
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'abac_db',
        autoLoadEntities: true,
        synchronize: true,
        logging: false,
        dropSchema: false,
        // En standalone (tsc) el glob resolvería archivos reales y conflictuaría
        // con synchronize: true. Se usa array vacío — las migraciones se corren
        // manualmente con `npm run migration:run` cuando sea necesario.
        migrations: [],
    } as TypeOrmModuleOptions;
});
