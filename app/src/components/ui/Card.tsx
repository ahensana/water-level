import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-[var(--shadow-card)]",
        "dark:border-neutral-800 dark:bg-neutral-900",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className, ...rest }: CardProps) {
  return (
    <h2
      className={clsx(
        "text-sm font-semibold tracking-wide text-neutral-800 dark:text-neutral-100",
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}

export function CardBody({ children, className, ...rest }: CardProps) {
  return (
    <div className={clsx("p-4", className)} {...rest}>
      {children}
    </div>
  );
}
