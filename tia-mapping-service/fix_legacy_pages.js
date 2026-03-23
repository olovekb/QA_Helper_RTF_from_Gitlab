import dotenv from 'dotenv';
dotenv.config();
import db from './db/pool.js';
import config from './config/index.js';

async function fix() {
  try {
    console.log(`Подключение к базе: ${config.dbHost}:${config.dbPort}/${config.dbName}`);
    const deleted = await db('page_component_dependencies')
      .where('page_name', 'like', '[%')
      .del();

    console.log(`Удалено ${deleted} устаревших записей (роуты-в-поле-имени).`);
  } catch (err) {
    console.error('Ошибка при очистке:', err);
  } finally {
    process.exit(0);
  }
}

fix();
