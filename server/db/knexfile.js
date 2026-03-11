const connection = process.env.DATABASE_URL || {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'tia_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'allure_inspector_db'
};

export default {
  client: 'pg',
  connection,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations'
  }
};
