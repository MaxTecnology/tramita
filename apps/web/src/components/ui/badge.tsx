import { cn } from '@/lib/utils'
import { type HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-blue-100 text-blue-700',
        variant === 'secondary' && 'bg-gray-100 text-gray-600',
        variant === 'outline' && 'border border-gray-300 text-gray-600',
        className,
      )}
      {...props}
    />
  )
}
