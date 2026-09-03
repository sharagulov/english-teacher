import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ');
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-surface hover:opacity-85 disabled:opacity-40',
    secondary: 'bg-raised text-ink border border-line hover:border-line-strong disabled:opacity-45',
    ghost: 'text-soft hover:text-ink hover:bg-sunken disabled:opacity-40',
    danger: 'bg-danger text-white hover:opacity-88 disabled:opacity-40',
    success: 'bg-success text-white hover:opacity-88 disabled:opacity-40',
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
    md: 'h-10 px-4 text-sm rounded-xl gap-2',
    lg: 'h-12 px-6 text-[15px] rounded-xl gap-2',
};
const BUTTON_BASE = 'inline-flex items-center justify-center font-medium transition-[opacity,background-color,border-color,transform] duration-150 select-none active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100';
function buttonClasses(variant: ButtonVariant, size: ButtonSize, block: boolean, className?: string): string {
    return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], block && 'w-full', className);
}
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    block?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', loading = false, block = false, className, children, disabled, ...rest }: ButtonProps) {
    return (<button type="button" disabled={disabled ?? loading} className={buttonClasses(variant, size, block, className)} {...rest}>
      {loading ? <Spinner size={size === 'sm' ? 12 : 14}/> : null}
      {children}
    </button>);
}
export function LinkButton({ to, variant = 'secondary', size = 'md', block = false, className, children, }: {
    to: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (<Link to={to} className={buttonClasses(variant, size, block, className)}>
      {children}
    </Link>);
}
const FIELD_BASE = 'w-full bg-raised border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition-colors duration-150 focus:border-accent focus:outline-none disabled:opacity-50';
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    hint?: string;
    error?: string | null;
}
export function Input({ label, hint, error, className, id, ...rest }: InputProps) {
    const fieldId = id ?? rest.name;
    return (<label className="block" htmlFor={fieldId}>
      {label ? <span className="mb-1.5 block text-[13px] font-medium text-soft">{label}</span> : null}
      <input id={fieldId} className={cx(FIELD_BASE, error && 'border-danger', className)} {...rest}/>
      {error ? <span className="mt-1.5 block text-[12px] text-danger">{error}</span> : null}
      {!error && hint ? <span className="mt-1.5 block text-[12px] text-faint">{hint}</span> : null}
    </label>);
}
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    hint?: string;
}
export function Textarea({ label, hint, className, id, ...rest }: TextareaProps) {
    const fieldId = id ?? rest.name;
    return (<label className="block" htmlFor={fieldId}>
      {label ? <span className="mb-1.5 block text-[13px] font-medium text-soft">{label}</span> : null}
      <textarea id={fieldId} className={cx(FIELD_BASE, 'resize-y leading-relaxed', className)} {...rest}/>
      {hint ? <span className="mt-1.5 block text-[12px] text-faint">{hint}</span> : null}
    </label>);
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
}
export function Select({ label, className, id, children, ...rest }: SelectProps) {
    const fieldId = id ?? rest.name;
    return (<label className="block" htmlFor={fieldId}>
      {label ? <span className="mb-1.5 block text-[13px] font-medium text-soft">{label}</span> : null}
      <select id={fieldId} className={cx(FIELD_BASE, 'cursor-pointer pr-8', className)} {...rest}>
        {children}
      </select>
    </label>);
}
export function SegmentedControl<T extends string>({ value, onChange, options, className, 'aria-label': ariaLabel, }: {
    value: T;
    onChange: (value: T) => void;
    options: readonly {
        value: T;
        label: ReactNode;
    }[];
    className?: string;
    'aria-label'?: string;
}) {
    return (<div role="group" aria-label={ariaLabel} className={cx('flex rounded-xl border border-line bg-sunken p-1', className)}>
      {options.map((option) => {
            const selected = value === option.value;
            return (<button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange(option.value)} className={cx('min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150', selected ? 'bg-ink text-surface shadow-sm' : 'text-soft hover:text-ink')}>
            {option.label}
          </button>);
        })}
    </div>);
}
export function Card({ className, children, padded = true, }: {
    className?: string;
    children: ReactNode;
    padded?: boolean;
}) {
    return (<div className={cx('bg-raised border border-line rounded-2xl', padded && 'p-5', className)}>{children}</div>);
}
export function SectionTitle({ title, description, action, }: {
    title: string;
    description?: string;
    action?: ReactNode;
}) {
    return (<div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-soft">{description}</p> : null}
      </div>
      {action}
    </div>);
}
export function PageHeader({ title, description, action, }: {
    title: string;
    description?: string;
    action?: ReactNode;
}) {
    return (<header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-soft">{description}</p> : null}
      </div>
      {action}
    </header>);
}
type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';
const BADGE_TONES: Record<BadgeTone, string> = {
    neutral: 'bg-sunken text-soft border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    success: 'bg-success-soft text-success border-transparent',
    danger: 'bg-danger-soft text-danger border-transparent',
    warning: 'bg-warning-soft text-warning border-transparent',
};
export function Badge({ children, tone = 'neutral', className, }: {
    children: ReactNode;
    tone?: BadgeTone;
    className?: string;
}) {
    return (<span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE_TONES[tone], className)}>
      {children}
    </span>);
}
export function Spinner({ size = 14 }: {
    size?: number;
}) {
    return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>);
}
export function Progress({ value, tone = 'accent', className, }: {
    value: number;
    tone?: 'accent' | 'success' | 'ink';
    className?: string;
}) {
    const percent = Math.max(0, Math.min(1, value)) * 100;
    const colors = { accent: 'bg-accent', success: 'bg-success', ink: 'bg-ink' };
    return (<div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', colors[tone])} style={{ width: `${percent}%` }}/>
    </div>);
}
export function Stat({ label, value, hint, tone, }: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    tone?: 'success' | 'danger' | 'accent';
}) {
    const colors = { success: 'text-success', danger: 'text-danger', accent: 'text-accent' };
    return (<div>
      <div className="text-[12px] font-medium tracking-wide text-faint uppercase">{label}</div>
      <div className={cx('mt-1 text-[22px] leading-tight font-semibold tracking-tight', tone ? colors[tone] : 'text-ink')}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-soft">{hint}</div> : null}
    </div>);
}
export function EmptyState({ title, description, action, }: {
    title: string;
    description?: string;
    action?: ReactNode;
}) {
    return (<div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-soft">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>);
}
export function ErrorNote({ message, onRetry }: {
    message: string;
    onRetry?: () => void;
}) {
    return (<div className="bg-danger-soft flex items-center justify-between gap-4 rounded-xl px-4 py-3">
      <span className="text-danger text-[13px]">{message}</span>
      {onRetry ? (<Button size="sm" variant="ghost" onClick={onRetry}>
          Повторить
        </Button>) : null}
    </div>);
}
export function Loading({ label = 'Загрузка' }: {
    label?: string;
}) {
    return (<div className="text-faint flex items-center justify-center gap-2 py-16 text-sm">
      <Spinner />
      {label}
    </div>);
}
export function Kbd({ children }: {
    children: ReactNode;
}) {
    return (<kbd className="border-line bg-sunken text-faint inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-sans text-[11px] font-medium">
      {children}
    </kbd>);
}
export function Modal({ open, onClose, title, children, wide = false, }: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    wide?: boolean;
}) {
    useEffect(() => {
        if (!open)
            return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape')
                onClose();
        };
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [open, onClose]);
    if (!open)
        return null;
    return (<div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} role="presentation"/>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('bg-raised border-line animate-rise relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border p-6 shadow-card sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        {title ? (<div className="mb-4 flex items-start justify-between gap-4">
            <h3 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h3>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="text-faint hover:text-ink -mt-1 -mr-1 h-8 w-8 rounded-lg transition-colors">
              ✕
            </button>
          </div>) : null}
        {children}
      </div>
    </div>);
}
