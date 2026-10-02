import { cn } from '@/lib/utils'

const DINER = ['D', 'I', 'N', 'E', 'R'] as const

/**
 * Town's Diner wordmark.
 * DINER is stretched to the same width as Town's so the name reads as one mark.
 */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <div className={cn('inline-grid w-max text-current', className)} aria-label="Town's Diner">
      <p className="font-serif text-[3.25rem] leading-[0.82] tracking-[-0.035em] sm:text-6xl">Town’s</p>
      <div className="mt-3 h-px bg-current opacity-40" aria-hidden />
      <p className="mt-2.5 flex justify-between text-[0.7rem] font-medium uppercase leading-none">
        {DINER.map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </p>
    </div>
  )
}
