import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import * as path from 'path';

const env = process.env.NODE_ENV || 'development';
config({ path: path.resolve(__dirname, `.env.${env}`) });

export const dataSourceOptions: DataSourceOptions = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'abac_db',
    entities: [path.join(__dirname, 'src', '**', '*.entity.{ts,js}')],
    migrations: [path.join(__dirname, 'src', 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: env !== 'production',
    migrationsTableName: 'migrations',
    migrationsRun: false,
};

export const dataSource = new DataSource(dataSourceOptions);
