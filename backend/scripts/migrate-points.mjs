import { copyFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
const DB_PATH = 'prisma/dev.db';
if (!existsSync(DB_PATH)) {
    console.log(`Базы ${DB_PATH} нет — миграция не нужна.`);
    process.exit(0);
}
const backup = `${DB_PATH}.before-points`;
if (!existsSync(backup)) {
    copyFileSync(DB_PATH, backup);
    console.log(`Копия базы: ${backup}`);
}
const db = new Database(DB_PATH);
const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
function collapse(table, target, sources) {
    const present = columns(table);
    if (!present.has(target)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${target} INTEGER NOT NULL DEFAULT 0`);
        console.log(`${table}.${target}: колонка добавлена`);
    }
    const available = sources.filter((name) => present.has(name));
    if (available.length === 0) {
        console.log(`${table}.${target}: исходных колонок нет, значения уже перенесены`);
        return;
    }
    const sum = available.map((name) => `COALESCE(${name}, 0)`).join(' + ');
    const changed = db.prepare(`UPDATE ${table} SET ${target} = ${sum}`).run().changes;
    console.log(`${table}.${target} = ${available.join(' + ')} — обновлено строк: ${changed}`);
}
function drop(table, column) {
    if (!columns(table).has(column))
        return;
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    console.log(`${table}.${column}: колонка удалена`);
}
db.transaction(() => {
    collapse('User', 'points', ['coins', 'xp']);
    collapse('Pool', 'pointsEarned', ['coinsEarned', 'xpEarned']);
    collapse('Attempt', 'points', ['coins', 'xp']);
    collapse('DailyStat', 'points', ['coins', 'xp']);
    collapse('AiSubmission', 'points', ['coins', 'xp']);
    for (const [table, column] of [
        ['User', 'coins'],
        ['User', 'xp'],
        ['User', 'totalDelta'],
        ['Pool', 'coinsEarned'],
        ['Pool', 'xpEarned'],
        ['Attempt', 'coins'],
        ['Attempt', 'xp'],
        ['DailyStat', 'coins'],
        ['DailyStat', 'xp'],
        ['AiSubmission', 'coins'],
        ['AiSubmission', 'xp'],
    ]) {
        drop(table, column);
    }
    db.exec('DROP TABLE IF EXISTS InventoryItem');
})();
const LEVEL_BASE = 50;
const LEVEL_EXPONENT = 2;
const MAX_LEVEL = 1000;
const levelFromPoints = (points) => {
    if (points < LEVEL_BASE)
        return 1;
    const guess = Math.floor((points / LEVEL_BASE) ** (1 / LEVEL_EXPONENT));
    const total = (level) => Math.round(LEVEL_BASE * Math.min(Math.max(level, 1), MAX_LEVEL) ** LEVEL_EXPONENT);
    let level = Math.min(Math.max(guess, 1), MAX_LEVEL);
    while (level < MAX_LEVEL && total(level + 1) <= points)
        level++;
    while (level > 1 && total(level) > points)
        level--;
    return level;
};
const users = db.prepare('SELECT id, name, points, level FROM User').all();
const setLevel = db.prepare('UPDATE User SET level = ? WHERE id = ?');
for (const user of users) {
    const level = levelFromPoints(user.points);
    setLevel.run(level, user.id);
    console.log(`${user.name}: ${user.points} очков → уровень ${user.level} → ${level}`);
}
const spent = db.prepare('SELECT COUNT(*) AS count FROM "Transaction" WHERE amount < 0').get().count;
if (spent > 0) {
    db.exec('UPDATE "Transaction" SET amount = 0 WHERE amount < 0');
    console.log(`История: ${spent} прошлых трат обнулены`);
}
db.close();
console.log('Готово. Дальше: npm run db:push && npm run db:generate');
