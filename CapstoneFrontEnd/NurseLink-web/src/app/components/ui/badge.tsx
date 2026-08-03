import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2.5 py-0.5 text-xs font-semibold w-fit whitespace-nowrap shrink-0 gap-1 transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-primary/20 bg-primary text-white",
        secondary:
          "border-secondary/20 bg-secondary text-white",
        destructive:
          "border-destructive/20 bg-destructive text-white",
        success:
          "border-success/20 bg-success text-white",
        warning:
          "border-warning/20 bg-warning text-foreground",
        info:
          "border-primary/20 bg-primary-light text-primary",
        outline:
          "border-border bg-card text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };