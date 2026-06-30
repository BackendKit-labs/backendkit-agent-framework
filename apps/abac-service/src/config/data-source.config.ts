import { DataSource, DataSourceOptions } from 'typeorm';

import { config } from 'dotenv';
import * as path from 'path';

config();

const isProduction = process.env.NODE_ENV === 'production';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'abac_db',
  entities: [
    isProduction
      ? path.join(__dirname, '..', '**', '*.entity.js')
      : path.join(__dirname, '..', '**', '*.entity.ts')
  ],
  migrations: [
    isProduction
      ? path.join(__dirname, '..', 'migrations', '*.js')
      : path.join(__dirname, '..', 'migrations', '*.ts')
  ],
  synchronize: false,
  logging: !isProduction,
  migrationsTableName: 'migrations',
  migrationsRun: false,
};

export default new DataSource(dataSourceOptions);