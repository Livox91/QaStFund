import { Card, CardContent } from "@/shared/ui/card";

export function EmployeeDashboardMetricCard({
  helper,
  label,
  value,
}: {
  helper: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <span
          aria-hidden="true"
          className="absolute top-0 right-0 h-full w-1 bg-teal-500"
        />
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">{helper}</p>
      </CardContent>
    </Card>
  );
}
