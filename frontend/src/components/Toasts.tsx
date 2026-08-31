import { useUi } from '../store/ui';
import { cx } from './ui';
const TONES = {
    neutral: 'border-line bg-raised text-ink',
    success: 'border-transparent bg-success text-white',
    danger: 'border-transparent bg-danger text-white',
    reward: 'border-transparent bg-ink text-surface',
};
export function Toasts() {
    const { toasts, dismiss } = useUi();
    if (toasts.length === 0)
        return null;
    return (<div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (<button key={toast.id} type="button" onClick={() => dismiss(toast.id)} className={cx('animate-rise pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-left shadow-card', TONES[toast.tone])}>
          <p className="text-[13px] font-semibold">{toast.title}</p>
          {toast.description ? <p className="mt-0.5 text-[12px] opacity-80">{toast.description}</p> : null}
        </button>))}
    </div>);
}
