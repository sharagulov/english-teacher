import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, ErrorNote, Kbd, Loading, PageHeader, Progress, SectionTitle, Stat, cx, } from '../components/ui';
import { DirectionSwitch } from '../components/DirectionSwitch';
import { RatingPointsLabel } from '../components/RatingPoints';
import { ApiError, api } from '../lib/api';
import { MODE_LABELS, formatNumber, plural } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import type { CefrLevel, ClassicDirection, SelectablePracticeMode } from '../lib/types';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
function levelsUpTo(target: CefrLevel): CefrLevel[] {
    const index = CEFR_LEVELS.indexOf(target);
    return CEFR_LEVELS.slice(0, Math.min(index + 2, CEFR_LEVELS.length));
}
function floorExcludedLevels(cefrLevel: CefrLevel): CefrLevel[] {
    const index = CEFR_LEVELS.indexOf(cefrLevel);
    return index <= 0 ? [] : CEFR_LEVELS.slice(0, index);
}
function normalizeExcludedLevels(stored: CefrLevel[], cefrLevel: CefrLevel, available: CefrLevel[]): CefrLevel[] {
    const floor = floorExcludedLevels(cefrLevel).filter((level) => available.includes(level));
    const merged = [...new Set([...floor, ...stored])].filter((level) => available.includes(level));
    const included = available.filter((level) => !merged.includes(level));
    if (included.length > 0)
        return merged;
    const keep = available[available.length - 1];
    if (!keep)
        return merged;
    return merged.filter((level) => level !== keep);
}
function excludedLevelsKey(userId: string): string {
    return `lexio.practice.excludedLevels.${userId}`;
}
function loadExcludedLevels(userId: string | undefined): CefrLevel[] {
    if (!userId)
        return [];
    try {
        const raw = localStorage.getItem(excludedLevelsKey(userId));
        if (!raw)
            return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        const levels = parsed.filter((item): item is CefrLevel => typeof item === 'string' && (CEFR_LEVELS as readonly string[]).includes(item));
        return levels.length >= CEFR_LEVELS.length ? levels.slice(0, -1) : levels;
    }
    catch {
        return [];
    }
}
function saveExcludedLevels(userId: string | undefined, levels: CefrLevel[]): void {
    if (!userId)
        return;
    localStorage.setItem(excludedLevelsKey(userId), JSON.stringify(levels));
}
function classicDirectionKey(userId: string): string {
    return `lexio.practice.classicDirection.${userId}`;
}
function loadClassicDirection(userId: string | undefined): ClassicDirection {
    if (!userId)
        return 'en_ru';
    try {
        return localStorage.getItem(classicDirectionKey(userId)) === 'ru_en' ? 'ru_en' : 'en_ru';
    }
    catch {
        return 'en_ru';
    }
}
function saveClassicDirection(userId: string | undefined, direction: ClassicDirection): void {
    if (!userId)
        return;
    localStorage.setItem(classicDirectionKey(userId), direction);
}
const MODE_NOTES: Record<SelectablePracticeMode, string> = {
    classic: 'Слово по-английски — вы пишете перевод. Основной режим для набора словаря.',
    choice: 'Четыре варианта перевода. Можно убрать два неверных за рейтинг — жалко, но иногда спасает.',
    listening: 'Слово звучит, вы записываете перевод. Тренирует восприятие на слух.',
    weak: 'Слова, на которых вы чаще всего ошибаетесь. Самый быстрый способ закрыть пробелы.',
    srs: 'Слова, подошедшие к сроку повторения. Именно это удерживает словарь в памяти.',
};
const MODE_SOURCE: Record<SelectablePracticeMode, 'new' | 'due' | 'weak' | 'any'> = {
    classic: 'new',
    choice: 'any',
    listening: 'any',
    weak: 'weak',
    srs: 'due',
};
const SIZES = [10, 15, 20, 30, 40];
export function Practice() {
    const navigate = useNavigate();
    const notify = useUi((state) => state.notify);
    const userId = useAuth((state) => state.user?.id);
    const cefrLevel = useAuth((state) => state.user?.cefrLevel ?? 'A2');
    const [mode, setMode] = useState<SelectablePracticeMode>('classic');
    const [classicDirection, setClassicDirection] = useState<ClassicDirection>(() => loadClassicDirection(userId));
    const [size, setSize] = useState(20);
    const [excludedLevels, setExcludedLevels] = useState<CefrLevel[]>(() => loadExcludedLevels(userId));
    const [topics, setTopics] = useState<string[]>([]);
    const [creating, setCreating] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [levelError, setLevelError] = useState<string | null>(null);
    const candidateLevels = useMemo(() => levelsUpTo(cefrLevel), [cefrLevel]);
    const includedLevels = useMemo(() => candidateLevels.filter((level) => !excludedLevels.includes(level)), [candidateLevels, excludedLevels]);
    const poolLevels = excludedLevels.length > 0 ? includedLevels : undefined;
    const poolTopics = topics.length > 0 ? topics : undefined;
    const overview = useAsync(() => api.practice.overview({ levels: poolLevels, topics: poolTopics }), [poolLevels?.join(','), poolTopics?.join(',')]);
    const data = overview.data;
    useEffect(() => {
        if (!data?.levels.length)
            return;
        setExcludedLevels((prev) => {
            const next = normalizeExcludedLevels(prev, cefrLevel, data.levels);
            if (next.length === prev.length && next.every((level) => prev.includes(level)))
                return prev;
            saveExcludedLevels(userId, next);
            return next;
        });
    }, [data?.levels, cefrLevel, userId]);
    const profileFloor = useMemo(() => floorExcludedLevels(cefrLevel), [cefrLevel]);
    const available = useMemo(() => {
        if (!data)
            return 0;
        const source = MODE_SOURCE[mode];
        const { newWords, due, weak, total } = data.availability;
        return { new: newWords, due, weak, any: total }[source];
    }, [data, mode]);
    if (overview.loading && !data)
        return <Loading label="Готовим тренажёр"/>;
    if (overview.error)
        return <ErrorNote message={overview.error} onRetry={overview.reload}/>;
    if (!data)
        return null;
    const activePool = data.activePool;
    const multiplier = data.availability.modeMultipliers[mode] ?? 1;
    const toggle = <T,>(list: T[], value: T): T[] => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    const toggleLevel = (level: CefrLevel) => {
        if (profileFloor.includes(level))
            return;
        const alreadyExcluded = excludedLevels.includes(level);
        if (!alreadyExcluded && includedLevels.length <= 1) {
            setLevelError('Оставьте хотя бы один уровень');
            return;
        }
        setLevelError(null);
        const next = toggle(excludedLevels, level);
        setExcludedLevels(next);
        saveExcludedLevels(userId, next);
    };
    const start = async () => {
        setCreating(true);
        setFailure(null);
        try {
            const state = await api.practice.createPool({
                mode,
                size,
                ...(poolLevels ? { levels: poolLevels } : {}),
                ...(poolTopics ? { topics: poolTopics } : {}),
                ...(mode === 'classic' && classicDirection === 'ru_en' ? { direction: 'ru_en' } : {}),
            });
            navigate(`/practice/session/${state.pool.id}`);
        }
        catch (cause) {
            setFailure(cause instanceof ApiError ? cause.message : 'Не удалось собрать пулл');
        }
        finally {
            setCreating(false);
        }
    };
    const resume = () => {
        if (activePool)
            navigate(`/practice/session/${activePool.pool.id}`);
    };
    const drop = async () => {
        if (!activePool)
            return;
        await api.practice.abandon(activePool.pool.id);
        notify({ title: 'Пулл отменён', tone: 'neutral' });
        overview.reload();
    };
    return (<div>
      <PageHeader title="Слова" description="Соберите пулл — слова из него возвращаются, пока не будут угаданы."/>

      {activePool ? (<Card className="border-accent/35 bg-accent-soft mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-56 flex-1">
              <p className="text-ink text-sm font-medium">
                Незакрытый пулл: {MODE_LABELS[activePool.pool.mode]} №{activePool.pool.ordinal}
              </p>
              <p className="text-soft mt-1 text-[13px]">
                Осталось {plural(activePool.progress.remaining, 'слово', 'слова', 'слов')} из{' '}
                {activePool.progress.total}
              </p>
              <Progress className="mt-3 max-w-xs" value={activePool.progress.solved / Math.max(1, activePool.progress.total)}/>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-center">
              <Button variant="ghost" size="sm" onClick={drop}>
                Отменить
              </Button>
              <Button variant="primary" onClick={resume}>
                Продолжить
              </Button>
            </div>
          </div>
        </Card>) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <SectionTitle title="Режим" description="Все режимы работают с вашим личным словарём и статистикой"/>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.modes.map((item) => {
            const selected = item.mode === mode;
            return (<button key={item.mode} type="button" disabled={!item.unlocked} onClick={() => setMode(item.mode)} className={cx('rounded-2xl border p-4 text-left transition-[border-color,background-color] duration-150', selected ? 'border-ink bg-raised' : 'border-line bg-raised hover:border-line-strong', !item.unlocked && 'cursor-not-allowed opacity-45 hover:border-line')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink text-sm font-medium">{item.label}</span>
                    {item.unlocked ? (data.availability.modeMultipliers[item.mode] > 1 ? (<Badge tone="accent">×{data.availability.modeMultipliers[item.mode]}</Badge>) : null) : (<Badge>с {item.unlockLevel} ур.</Badge>)}
                  </div>
                  <p className="text-soft mt-1.5 text-[13px] leading-relaxed">{MODE_NOTES[item.mode]}</p>
                </button>);
        })}
          </div>

          <div className="mt-7">
            <SectionTitle title="Размер пулла" description="Слово покидает пулл только после верного ответа"/>
            <div className="flex flex-wrap gap-2">
              {SIZES.map((value) => (<button key={value} type="button" onClick={() => setSize(value)} className={cx('h-10 w-14 rounded-xl border text-sm font-medium tabular-nums transition-colors duration-150', size === value
                ? 'border-ink bg-ink text-surface'
                : 'border-line bg-raised text-soft hover:border-line-strong')}>
                  {value}
                </button>))}
            </div>
          </div>

          <div className="mt-7">
            <SectionTitle title="Отбор слов" description="Без фильтров слова подбираются по вашему уровню и приоритету повторения"/>
            <p className="text-faint mb-1 text-[12px] font-medium tracking-wide uppercase">Уровни</p>
            <p className="text-soft mb-2 text-[12px] leading-relaxed">
              Ниже {cefrLevel} — по профилю. Зачёркнутый — исключён.
            </p>
            <div className="mb-5">
              <div className="flex flex-wrap gap-2">
                {data.levels.map((level) => {
            const excluded = excludedLevels.includes(level);
            const locked = profileFloor.includes(level);
            return (<Chip key={level} excluded={excluded} disabled={locked} title={locked ? `Уровень ниже ${cefrLevel} — измените CEFR в профиле` : undefined} ariaLabel={locked
                    ? `Уровень ${level} исключён по профилю`
                    : excluded
                        ? `Вернуть уровень ${level}`
                        : `Исключить уровень ${level}`} onClick={() => toggleLevel(level)}>
                      {level}
                    </Chip>);
        })}
              </div>
              {levelError ? (<p className="text-danger mt-2 text-[12px] leading-relaxed">{levelError}</p>) : null}
            </div>

            {data.topics.length > 0 ? (<>
                <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Темы</p>
                <div className="flex flex-wrap gap-2">
                  {data.topics.slice(0, 18).map((item) => (<Chip key={item.topic} active={topics.includes(item.topic)} onClick={() => setTopics(toggle(topics, item.topic))}>
                      {item.topic}
                      <span className="text-faint ml-1 tabular-nums">{item.count}</span>
                    </Chip>))}
                </div>
              </>) : null}
          </div>
        </section>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <SectionTitle title="Готово к работе"/>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Новых" value={formatNumber(data.availability.newWords)}/>
              <Stat label="К повтору" value={formatNumber(data.availability.due)} tone="accent"/>
              <Stat label="Слабых" value={formatNumber(data.availability.weak)} tone="danger"/>
            </div>

            <div className="border-line mt-5 border-t pt-5">
              {mode === 'classic' ? (<div className="mb-4">
                  <p className="text-faint mb-2 text-[12px] font-medium tracking-wide uppercase">Направление</p>
                  <DirectionSwitch value={classicDirection} onChange={(next) => {
                setClassicDirection(next);
                saveClassicDirection(userId, next);
            }}/>
                </div>) : null}
              <p className="text-soft text-[13px]">
                {MODE_LABELS[mode]}
                {mode === 'classic' ? (classicDirection === 'ru_en' ? ', с русского' : ', с английского') : ''}
                , {size} слов
                {multiplier > 1 ? `, очки ×${multiplier}` : ''}
                {excludedLevels.length > 0 ? `, без ${excludedLevels.join(', ')}` : ''}
              </p>
              {mode === 'choice' && data.choiceHint ? (<p className="text-faint mt-2 text-[12px] leading-relaxed">
                  Подсказка убирает два неверных варианта и стоит{' '}
                  <RatingPointsLabel amount={data.choiceHint.cost} valueClassName="text-[12px]"/>.
                  Если очков станет меньше порога уровня — уровень понизится.
                </p>) : null}
              {available < size ? (<p className="text-warning mt-2 text-[12px] leading-relaxed">
                  Подходящих слов: {available}. Пулл будет меньше запрошенного.
                </p>) : null}

              {failure ? <div className="mt-3"><ErrorNote message={failure}/></div> : null}

              <Button variant="primary" size="lg" block className="mt-4" loading={creating} disabled={available === 0} onClick={start}>
                {available === 0 ? 'Нет подходящих слов' : 'Начать'}
              </Button>
            </div>

            <div className="border-line text-faint mt-5 space-y-1.5 border-t pt-5 text-[12px]">
              <p className="text-soft font-medium">Горячие клавиши в тренажёре</p>
              <p>
                <Kbd>Enter</Kbd> — ответить · любая клавиша — закрыть разбор
              </p>
              <p>
                <Kbd>1</Kbd>–<Kbd>4</Kbd> — выбор варианта
              </p>
              <p>
                <Kbd>Esc</Kbd> — не знаю
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>);
}
function Chip({ active = false, excluded = false, disabled = false, onClick, children, ariaLabel, title, }: {
    active?: boolean;
    excluded?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
    ariaLabel?: string;
    title?: string;
}) {
    return (<button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={excluded || active} aria-label={ariaLabel} className={cx('rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors duration-150', disabled && 'cursor-not-allowed opacity-60', excluded
            ? 'border-line bg-sunken text-faint line-through decoration-faint hover:border-line-strong'
            : active
                ? 'border-ink bg-ink text-surface'
                : 'border-line bg-raised text-soft hover:border-line-strong', disabled && excluded && 'hover:border-line')}>
      {children}
    </button>);
}
