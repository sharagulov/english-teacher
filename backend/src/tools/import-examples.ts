/**
 * Наполнение словаря примерами употребления из корпуса Tatoeba.
 *
 *   npm run db:examples
 *
 * Сервер делает то же самое фоном при запуске, но отдельный запуск удобен
 * сразу после `db:import`: он показывает ход работы и завершается, когда
 * примеры действительно лежат в базе.
 */
import { prisma } from '../db.js';
import { SOURCES } from '../lib/sources.js';
import { importCorpusExamples } from '../services/examples.js';

const log = (message: string) => console.log(message);

async function main() {
  const startedAt = Date.now();

  log('\n╭─ Примеры употребления из открытого корпуса');
  log(`│  источник: ${SOURCES.examples.license}`);
  log('│');

  const result = await importCorpusExamples(log);

  log('│');
  const total = await prisma.wordExample.count();
  const covered = await prisma.word.count({ where: { examples: { some: {} } } });
  log(`  обработано слов: ${result.words.toLocaleString('ru')}, добавлено примеров: ${result.examples.toLocaleString('ru')}`);
  log(`  всего в базе: ${total.toLocaleString('ru')} примеров у ${covered.toLocaleString('ru')} слов`);
  log(`╰─ Готово за ${((Date.now() - startedAt) / 1000).toFixed(1)} с\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('\n✖ Примеры не загружены:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
