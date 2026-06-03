import { cn } from '@/lib/utils'
import * as LabelPrimitive from '@radix-ui/react-label'

export function Label({ className, ...props }: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium text-gray-700 leading-none peer-disabled:opacity-70', className)}
      {...props}
    />
  )
}
