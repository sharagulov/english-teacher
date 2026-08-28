import { useId, useMemo, useState } from 'react';
import { cx } from './ui';

/**
 * Графики нарисованы вручную на SVG: набор нужных визуализаций небольшой,
 * а отказ от библиотеки заметно уменьшает объём загружаемого кода.
 */

export interface SeriesPoint {
  label: string;
  value: number | null;
}

// ─────────────────────────────── График-площадь ───────────────────────────────

export function AreaChart({
  points,
  height = 140,
  tone = 'accent',
  formatValue = (value: number) => String(Math.round(value)),
  emptyLabel = 'Пока нет данных',
  showLabels = true,
}: {
  points: SeriesPoint[];
  height?: number;
  tone?: 'accent' | 'success' | 'hero';
  formatValue?: (value: number) => string;
  emptyLabel?: string;
  showLabels?: boolean;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(...values, 1);
  const hasData = points.some((p) => (p.value ?? 0) > 0);

  const width = 100;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const baselineY = height - 4;
  const plotHeight = height - 12;

  const coords = points.map((point, index) => ({
    x: index * step,
    y: baselineY - ((point.value ?? 0) / max) * plotHeight,
  }));

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${baselineY} L0,${baselineY} Z`;
  const color = tone === 'success' ? 'var(--success)' : tone === 'hero' ? 'var(--dash-hero-ink)' : 'var(--accent)';
  const isHero = tone === 'hero';

  if (!hasData) {
    return (
      <div
        className={cx('flex items-center justify-center text-[13px]', isHero ? 'text-white/35' : 'text-faint')}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const active = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={isHero ? '0.22' : '0.16'} />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={isHero ? '1.8' : '1.4'} vectorEffect="non-scaling-stroke" />

          {/* Прозрачные области для наведения — по одной на точку. */}
          {points.map((point, index) => (
            <rect
              key={point.label}
              x={index * step - step / 2}
              y={0}
              width={Math.max(step, 1)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>

        {/* HTML-слой: круг и линия не искажаются при preserveAspectRatio="none". */}
        {hover != null && coords[hover] ? (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div
              className={cx('absolute top-0 bottom-0 w-px', isHero ? 'bg-white/25' : 'bg-line-strong')}
              style={{ left: `${(coords[hover]!.x / width) * 100}%` }}
            />
            <div
              className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${(coords[hover]!.x / width) * 100}%`,
                top: `${(coords[hover]!.y / height) * 100}%`,
                background: color,
              }}
            />
          </div>
        ) : null}
      </div>

      {showLabels ? (
        <div className={cx('mt-1.5 flex justify-between text-[11px]', isHero ? 'text-white/40' : 'text-faint')}>
          <span>{points[0]?.label}</span>
          {active ? (
            <span className={cx('font-medium', isHero ? 'text-white/80' : 'text-ink')}>
              {active.label}: {formatValue(active.value ?? 0)}
            </span>
          ) : null}
          <span>{points[points.length - 1]?.label}</span>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Столбцы ───────────────────────────────

export function BarChart({
  items,
  formatValue = (value: number) => String(Math.round(value)),
  emptyLabel = 'Нет данных',
  tone = 'ink',
}: {
  items: { label: string; value: number; caption?: string }[];
  formatValue?: (value: number) => string;
  emptyLabel?: string;
  tone?: 'ink' | 'accent' | 'success';
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const colors = { ink: 'bg-ink', accent: 'bg-accent', success: 'bg-success' };

  if (items.length === 0) {
    return <p className="text-faint py-6 text-center text-[13px]">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink truncate">{item.label}</span>
            <span className="text-soft shrink-0 tabular-nums">
              {formatValue(item.value)}
              {item.caption ? <span className="text-faint ml-1.5">{item.caption}</span> : null}
            </span>
          </div>
          <div className="bg-sunken h-1.5 overflow-hidden rounded-full">
            <div
              className={cx('h-full rounded-full transition-[width] duration-500', colors[tone])}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────── Полоса распределения по статусам ───────────────────────

export function StackedBar({
  segments,
  height = 10,
}: {
  segments: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <div className="bg-sunken rounded-full" style={{ height }} />;
  }

  return (
    <div>
      <div className="flex overflow-hidden rounded-full" style={{ height }}>
        {segments
          .filter((s) => s.value > 0)
          .map((segment) => (
            <div
              key={segment.label}
              title={`${segment.label}: ${segment.value}`}
              style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
            />
          ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments
          .filter((s) => s.value > 0)
          .map((segment) => (
            <span key={segment.label} className="text-soft flex items-center gap-1.5 text-[12px]">
              <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} />
              {segment.label}
              <span className="text-ink font-medium tabular-nums">{segment.value}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

// ─────────────────────────── Активность по часам ───────────────────────────

export function HourHeatmap({ hours }: { hours: { hour: number; attempts: number; correct: number }[] }) {
  const max = Math.max(...hours.map((h) => h.attempts), 1);

  return (
    <div>
      <div className="grid grid-cols-12 gap-1">
        {hours.map((entry) => {
          const intensity = entry.attempts / max;
          const accuracy = entry.attempts > 0 ? entry.correct / entry.attempts : 0;
          return (
            <div
              key={entry.hour}
              title={`${String(entry.hour).padStart(2, '0')}:00 — ${entry.attempts} ответов${
                entry.attempts > 0 ? `, точность ${Math.round(accuracy * 100)}%` : ''
              }`}
              className="aspect-square rounded-[4px] transition-colors"
              style={{
                background:
                  entry.attempts === 0
                    ? 'var(--surface-sunken)'
                    : `color-mix(in oklab, var(--accent) ${Math.round(18 + intensity * 82)}%, var(--surface-sunken))`,
              }}
            />
          );
        })}
      </div>
      <div className="text-faint mt-1.5 flex justify-between text-[11px]">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Календарь занятий ───────────────────────────

export function ActivityCalendar({
  days,
}: {
  days: { day: string; value: number; label: string }[];
}) {
  const max = useMemo(() => Math.max(...days.map((d) => d.value), 1), [days]);

  return (
    <div className="flex flex-wrap gap-1">
      {days.map((entry) => (
        <div
          key={entry.day}
          title={entry.label}
          className="h-3.5 w-3.5 rounded-[3px]"
          style={{
            background:
              entry.value === 0
                ? 'var(--surface-sunken)'
                : `color-mix(in oklab, var(--success) ${Math.round(25 + (entry.value / max) * 75)}%, var(--surface-sunken))`,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────── Кольцевой индикатор ───────────────────────────

export function Ring({
  value,
  size = 72,
  thickness = 6,
  children,
  tone = 'accent',
}: {
  value: number;
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
  tone?: 'accent' | 'success' | 'danger';
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  const color = { accent: 'var(--accent)', success: 'var(--success)', danger: 'var(--danger)' }[tone];

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
