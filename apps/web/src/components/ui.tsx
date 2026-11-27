import { cva, type VariantProps } from 'class-variance-authority';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
} from 'react';
import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:pointer-events-none disabled:opacity-50 min-h-[44px] px-4 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-[#1D4ED8] text-white hover:bg-[#1E40AF]',
        secondary: 'bg-[#0B0F17] text-white hover:bg-[#1E2430]',
        outline: 'border border-[#D0D5DD] bg-white text-[#0B0F17] hover:bg-[#F4F5F7]',
        ghost: 'text-[#344054] hover:bg-[#F4F5F7] hover:text-[#0B0F17]',
        danger: 'border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FFE4E6]',
      },
      size: {
        sm: 'min-h-[38px] px-3 text-xs',
        md: 'min-h-[44px] px-4 text-sm',
        lg: 'min-h-[48px] px-6 text-sm font-semibold',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-[#E4E7EC] bg-white', className)} {...props} />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full min-h-[44px] rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm text-[#0B0F17] placeholder:text-[#98A2B3] focus:border-[#1D4ED8] focus:outline-2 focus:outline-offset-0 focus:outline-[#1D4ED8]/20 disabled:bg-[#F4F5F7] disabled:text-[#667085]',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'block text-xs font-semibold uppercase tracking-wider text-[#475467]',
        className,
      )}
      {...props}
    />
  );
}

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-[#E4E7EC] bg-[#F4F5F7] text-[#344054]',
        accent: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]',
        success: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]',
        warning: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]',
        danger: 'border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function AlertBox({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'success';
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles: Record<string, string> = {
    neutral: 'border-[#E4E7EC] bg-[#F8FAFC] text-[#344054]',
    accent: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]',
    warning: 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]',
    danger: 'border-[#FECDD3] bg-[#FFF1F2] text-[#9F1239]',
    success: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]',
  };
  return (
    <div
      role="status"
      className={cn('rounded-xl border px-4 py-3 text-sm', styles[tone], className)}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-xs leading-relaxed opacity-95">{children}</div>
    </div>
  );
}
