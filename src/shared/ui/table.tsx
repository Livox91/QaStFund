import { cn } from "@/shared/utils/class-names";

export function TableContainer({
  children,
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-slate-200 bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Table({
  children,
  className,
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("w-full min-w-[640px] text-left", className)}>
      {children}
    </table>
  );
}

export function TableCaption({
  children,
  className,
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption className={cn("px-5 py-3 text-sm text-slate-500", className)}>
      {children}
    </caption>
  );
}

export function TableHeader({
  children,
  className,
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-slate-50/80", className)}>{children}</thead>;
}

export function TableBody({
  children,
  className,
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("divide-y divide-slate-100", className)}>
      {children}
    </tbody>
  );
}

export function TableRow({
  children,
  className,
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-slate-50/70", className)}>
      {children}
    </tr>
  );
}

export function TableHead({
  children,
  className,
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-slate-200 px-5 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className,
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-5 py-4 text-sm text-slate-700", className)}>
      {children}
    </td>
  );
}
