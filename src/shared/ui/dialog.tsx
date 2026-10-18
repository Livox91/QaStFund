"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/class-names";

export function Dialog({
  children,
  className,
  description,
  footer,
  onOpenChange,
  open,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  description?: string;
  footer?: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={cn(
        "fixed top-1/2 left-1/2 m-0 max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)]",
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.currentTarget === event.target) onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p
              className="mt-1 text-sm leading-6 text-slate-500"
              id={descriptionId}
            >
              {description}
            </p>
          ) : null}
        </div>
        <Button
          aria-label="Close dialog"
          className="-mt-1 -mr-2 text-xl font-normal"
          onClick={() => onOpenChange(false)}
          size="icon"
          variant="ghost"
        >
          <span aria-hidden="true">×</span>
        </Button>
      </div>
      <div className="max-h-[65dvh] overflow-y-auto px-5 py-5 sm:px-6">
        {children}
      </div>
      {footer ? (
        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 [&>button]:w-full sm:[&>button]:w-auto">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
