import { Badge, type BadgeTone } from "@/shared/ui/badge";

const toneByStatus: Record<string, BadgeTone> = {
  active: "success",
  approved: "success",
  complete: "success",
  completed: "success",
  connected: "success",
  ok: "success",
  paid: "success",
  repaid: "success",
  pending: "warning",
  processing: "info",
  scheduled: "info",
  failed: "danger",
  defaulted: "danger",
  overdue: "danger",
  cancelled: "neutral",
  canceled: "neutral",
  inactive: "neutral",
};

export function formatStatusLabel(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\b\w/g, (character) => character.toUpperCase());
}

export function getStatusTone(status: string): BadgeTone {
  return toneByStatus[status.trim().toLowerCase()] ?? "neutral";
}

export function StatusDisplay({
  label,
  status,
  tone,
}: {
  label?: string;
  status: string;
  tone?: BadgeTone;
}) {
  return (
    <Badge tone={tone ?? getStatusTone(status)}>
      {label ?? formatStatusLabel(status)}
    </Badge>
  );
}
