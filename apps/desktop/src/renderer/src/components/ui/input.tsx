import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-xl border bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
        className
      )}
      {...props}
    />
  )
}
