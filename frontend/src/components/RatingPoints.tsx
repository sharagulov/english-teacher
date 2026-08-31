import { formatNumber, pointsWord } from '../lib/format';
import { cx } from './ui';
export function RatingPointsIcon({ size = 14, className, }: {
    size?: number;
    className?: string;
}) {
    return (<svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={cx('shrink-0', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4.25 10.75V8.75M6.75 10.75V6.25M9.25 10.75V4.75M11.75 10.75V7.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
    </svg>);
}
export function RatingPoints({ amount, sign, iconSize = 14, className, valueClassName, iconClassName = 'text-accent', }: {
    amount: number;
    sign?: '+' | '−' | '';
    iconSize?: number;
    className?: string;
    valueClassName?: string;
    iconClassName?: string;
}) {
    const numeric = Math.abs(Math.round(amount));
    const prefix = sign ?? (amount < 0 ? '−' : '');
    return (<span className={cx('inline-flex items-center gap-1', className)} title="Очки рейтинга">
      <RatingPointsIcon size={iconSize} className={iconClassName}/>
      <span className={cx('tabular-nums', valueClassName)}>
        {prefix}
        {formatNumber(numeric)}
      </span>
    </span>);
}
export function RatingPointsLabel({ amount, sign = '', className, valueClassName, }: {
    amount: number;
    sign?: '+' | '−' | '';
    className?: string;
    valueClassName?: string;
}) {
    return (<span className={cx('inline-flex items-center gap-1', className)}>
      <RatingPoints amount={amount} sign={sign} valueClassName={valueClassName}/>
      <span className={valueClassName}>{pointsWord(amount)}</span>
    </span>);
}
