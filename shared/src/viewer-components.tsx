import { createElement, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties,
  type HTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import './viewer-components.css'

type LayoutProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section'
  gap?: number
  align?: CSSProperties['alignItems']
  justify?: CSSProperties['justifyContent']
}

export function Stack({ as = 'div', gap = 1, className = '', style, children, ...rest }: LayoutProps) {
  return createElement(as, { ...rest, className: `ktz-stack ${className}`, style: { ...style, gap: `${gap}rem` } }, children)
}

export function Cluster({ as = 'div', gap = 0.5, align, justify, className = '', style, children, ...rest }: LayoutProps) {
  return createElement(as, { ...rest, className: `ktz-cluster ${className}`,
    style: { ...style, gap: `${gap}rem`, alignItems: align, justifyContent: justify } }, children)
}

export function Center({ children }: { children: ReactNode }) {
  return <div className="ktz-center">{children}</div>
}

export function Base({ padding = 1, className = '', style, children, ...rest }: HTMLAttributes<HTMLDivElement> & { padding?: number }) {
  return <div {...rest} className={`ktz-base ${className}`} style={{ ...style, padding: `${padding}rem` }}>{children}</div>
}

export function Section({ children }: { children: ReactNode }) {
  return <section className="ktz-section">{children}</section>
}

type TextProps = HTMLAttributes<HTMLSpanElement> & {
  size?: 'S' | 'L' | 'XL'
  weight?: 'bold'
  color?: 'TEXT_GREY' | 'TEXT_LINK' | 'TEXT_BLACK' | 'DANGER'
}
export function Text({ size, weight, color, className = '', children, ...rest }: TextProps) {
  return <span {...rest} className={`ktz-text ${className}`} data-size={size} data-weight={weight} data-color={color}>{children}</span>
}

export function Heading({ type, children }: { type: 'blockTitle' | 'subBlockTitle'; children: ReactNode }) {
  return type === 'blockTitle'
    ? <h1 className="ktz-heading" data-size="lg">{children}</h1>
    : <h2 className="ktz-heading" data-size="md">{children}</h2>
}

export function StatusLabel({ type, bold, children }: { type: 'green' | 'grey' | 'warning' | 'blue' | 'error'; bold?: boolean; children: ReactNode }) {
  return <span className="ktz-status" data-type={type} data-bold={bold || undefined}>{children}</span>
}

export function DefinitionList({ children }: { children: ReactNode }) {
  return <dl className="ktz-definition-list">{children}</dl>
}

export function DefinitionListItem({ term, children }: { term: string; children: ReactNode }) {
  return <div className="ktz-definition-item"><dt>{term}</dt><dd>{children}</dd></div>
}

export function InformationPanel({ type, heading, children }: { type?: 'error' | 'warning'; heading: string; toggleable?: false; children: ReactNode }) {
  return <section className="ktz-information" data-type={type || 'default'} role={type === 'error' ? 'alert' : undefined}>
    <h2>{heading}</h2>{children}
  </section>
}

export function Loader({ text }: { text: string }) {
  return <p className="ktz-loader" role="status" aria-live="polite">{text}</p>
}

type ActionVariant = 'primary' | 'secondary' | 'text'
const buttonType = (variant: ActionVariant = 'secondary') => variant === 'primary' ? 'solid-fill' : variant === 'secondary' ? 'outline' : 'text'

export function Button({ variant, size, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ActionVariant; size?: 'S' }) {
  return <button {...rest} type={rest.type || 'button'} className={`dads-button ${className}`} data-type={buttonType(variant)} data-size={size ? 'sm' : 'md'}>{children}</button>
}

export function AnchorButton({ variant, size, className = '', children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ActionVariant; size?: 'S' }) {
  return <a {...rest} className={`dads-button ${className}`} data-type={buttonType(variant)} data-size={size ? 'sm' : 'md'}>{children}</a>
}

export function TextLink({ className = '', children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...rest} className={`ktz-text-link ${className}`}>{children}</a>
}

export function Select({ options, onChangeValue, className = '', ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  options: { value: string; label: string }[]; onChangeValue: (value: string) => void
}) {
  return <span className="dads-select"><span className="dads-select__control">
    <select {...rest} className={`dads-select__select ${className}`} data-size="md" onChange={event => onChangeValue(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <svg className="dads-select__chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
  </span></span>
}

export function LineClamp({ maxLines, children }: { maxLines: number; children: ReactNode }) {
  return <div className="ktz-line-clamp" style={{ WebkitLineClamp: maxLines }}>{children}</div>
}

/** 公式タブCSSとキーボード操作を結び、表示中のパネルへフォーカス移動できる。 */
export function SegmentedControl<T extends string>({ options, value, onClickOption, ...rest }: {
  options: { value: T; content: ReactNode }[]; value: T; onClickOption: (value: T) => void; 'aria-label': string
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % options.length
      : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    onClickOption(options[next].value)
    event.currentTarget.parentElement?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <div className="dads-tab"><ul className="dads-tab__list" role="tablist" {...rest}>
    {options.map((option, index) => <li key={option.value}><button type="button" className="dads-tab__tab" role="tab"
      id={`ktz-board-tab-${option.value}`} aria-controls="ktz-board-panel" aria-selected={option.value === value}
      tabIndex={option.value === value ? 0 : -1} onClick={() => onClickOption(option.value)} onKeyDown={event => onKeyDown(event, index)}>
      <span>{option.content}</span></button></li>)}
  </ul></div>
}
