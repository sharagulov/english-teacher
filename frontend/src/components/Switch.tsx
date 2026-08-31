import type { ReactNode } from 'react';
import { cx } from './ui';
export function Switch({ checked, onChange, 'aria-label': ariaLabel, disabled, className, }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    'aria-label': string;
    disabled?: boolean;
    className?: string;
}) {
    return (<button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} onClick={() => onChange(!checked)} className={cx('relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45', checked ? 'border-ink bg-ink' : 'border-line bg-sunken', className)}>
      <span className={cx('absolute top-1/2 left-1 size-4 -translate-y-1/2 rounded-full transition-transform duration-150', checked ? 'translate-x-5 bg-surface' : 'translate-x-0 bg-ink')}/>
    </button>);
}
export function LabeledSwitch({ leftLabel, rightLabel, checked, onChange, 'aria-label': ariaLabel, disabled, className, }: {
    leftLabel: ReactNode;
    rightLabel: ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    'aria-label': string;
    disabled?: boolean;
    className?: string;
}) {
    return (<div className={cx('flex items-center justify-between gap-3', className)}>
      <span className={cx('text-[13px] font-medium tabular-nums', checked ? 'text-faint' : 'text-ink')}>
        {leftLabel}
      </span>
      <Switch checked={checked} onChange={onChange} aria-label={ariaLabel} disabled={disabled}/>
      <span className={cx('text-[13px] font-medium tabular-nums', checked ? 'text-ink' : 'text-faint')}>
        {rightLabel}
      </span>
    </div>);
}
export function SwitchField({ label, description, checked, onChange, disabled, }: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}) {
    return (<div className="hover:bg-sunken/60 -mx-2 flex items-start justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors">
      <span className="min-w-0 flex-1">
        <span className="text-ink block text-[13px] font-medium">{label}</span>
        {description ? (<span className="text-faint mt-0.5 block text-[12px] leading-relaxed">{description}</span>) : null}
      </span>
      <Switch checked={checked} onChange={onChange} aria-label={label} disabled={disabled} className="mt-0.5"/>
    </div>);
}
