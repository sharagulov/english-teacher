import { Check, ChevronDown } from 'lucide-react';
import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';

interface ParsedOption {
    value: string;
    label: ReactNode;
    disabled?: boolean;
}

function parseOptions(children: ReactNode): ParsedOption[] {
    const options: ParsedOption[] = [];
    Children.forEach(children, (child) => {
        if (!isValidElement(child))
            return;
        const element = child as ReactElement<{
            value?: string;
            disabled?: boolean;
            children?: ReactNode;
        }>;
        if (typeof element.type === 'string' && element.type !== 'option')
            return;
        if (element.props.value === undefined && element.props.children === undefined)
            return;
        options.push({
            value: element.props.value ?? '',
            label: element.props.children,
            disabled: element.props.disabled,
        });
    });
    return options;
}

function syntheticChange(value: string, name?: string): ChangeEvent<HTMLSelectElement> {
    return {
        target: { value, name } as HTMLSelectElement,
        currentTarget: { value, name } as HTMLSelectElement,
    } as ChangeEvent<HTMLSelectElement>;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
    label?: string;
    onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}

export function Select({ label, className, id, children, value, disabled, name, onChange }: SelectProps) {
    const autoId = useId();
    const fieldId = id ?? name ?? autoId;
    const listboxId = `${fieldId}-listbox`;
    const rootRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const options = useMemo(() => parseOptions(children), [children]);
    const stringValue = value == null ? '' : String(value);
    const selected = options.find((option) => option.value === stringValue) ?? options[0];
    const enabledOptions = options.filter((option) => !option.disabled);

    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node))
                setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open]);

    useEffect(() => {
        if (!open)
            return;
        const selectedIndex = enabledOptions.findIndex((option) => option.value === stringValue);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        listRef.current?.focus();
    }, [open, enabledOptions, stringValue]);

    const pick = (next: string) => {
        onChange?.(syntheticChange(next, name));
        setOpen(false);
    };

    const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled)
            return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
        }
    };

    const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            return;
        }
        if (enabledOptions.length === 0)
            return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % enabledOptions.length);
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + enabledOptions.length) % enabledOptions.length);
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const option = enabledOptions[activeIndex];
            if (option)
                pick(option.value);
        }
    };

    return (<div ref={rootRef} className={cx('relative', className)}>
      {name ? <input type="hidden" name={name} value={stringValue}/> : null}
      {label ? <span id={`${fieldId}-label`} className="mb-1.5 block text-[13px] font-medium text-soft">{label}</span> : null}
      <button id={fieldId} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-labelledby={label ? `${fieldId}-label` : undefined} onClick={() => !disabled && setOpen((state) => !state)} onKeyDown={onTriggerKeyDown} className={cx(FIELD_TRIGGER, disabled && 'cursor-not-allowed opacity-50')}>
        <span className={cx('min-w-0 truncate', selected ? 'text-ink' : 'text-faint')}>
          {selected?.label ?? 'Выберите…'}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={cx('text-faint shrink-0 transition-transform duration-150', open && 'rotate-180')}/>
      </button>
      {open ? (<div ref={listRef} id={listboxId} role="listbox" aria-labelledby={label ? `${fieldId}-label` : undefined} tabIndex={0} onKeyDown={onListKeyDown} className="border-line bg-raised absolute top-full right-0 left-0 z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl border p-1 shadow-[var(--shadow)]">
          {options.map((option) => {
            const selectedOption = option.value === stringValue;
            const enabledIndex = enabledOptions.findIndex((item) => item.value === option.value);
            const active = enabledIndex === activeIndex;
            return (<button key={`${option.value}-${String(option.label)}`} type="button" role="option" aria-selected={selectedOption} disabled={option.disabled} onMouseEnter={() => {
                    if (!option.disabled && enabledIndex >= 0)
                        setActiveIndex(enabledIndex);
                }} onClick={() => {
                    if (!option.disabled)
                        pick(option.value);
                }} className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150', option.disabled && 'cursor-not-allowed opacity-45', !option.disabled && active && 'bg-sunken', !option.disabled && !active && 'hover:bg-sunken', selectedOption ? 'text-ink font-medium' : 'text-soft')}>
              <span className="flex-1 truncate">{option.label}</span>
              {selectedOption ? <Check size={14} strokeWidth={2} aria-hidden="true" className="text-ink shrink-0"/> : null}
            </button>);
        })}
        </div>) : null}
    </div>);
}

const FIELD_TRIGGER = 'flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-raised px-3.5 py-2.5 text-left text-sm text-ink transition-colors duration-150 hover:border-line-strong focus-visible:border-accent focus-visible:outline-none disabled:opacity-50';
