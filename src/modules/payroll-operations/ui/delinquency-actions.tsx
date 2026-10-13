"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function DelinquencyActions(
  props: Readonly<{ id: string; hasFailedNotification: boolean }>,
) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(
    action: "REVIEW" | "CONTACT" | "REQUEST_ARRANGEMENT" | "RETRY_NOTIFICATION",
  ) {
    setBusy(true);
    const response = await fetch(`/api/employer/delinquency/${props.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(note.trim() ? { note } : {}) }),
    });
    setBusy(false);
    if (response.ok) router.refresh();
  }
  return (
    <div className="min-w-64 space-y-2">
      <Input
        aria-label="Case note"
        onChange={(event) => setNote(event.target.value)}
        placeholder="Review/contact note"
        value={note}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act("REVIEW")} size="sm">
          Mark reviewed
        </Button>
        <Button
          disabled={busy}
          onClick={() => void act("CONTACT")}
          size="sm"
          variant="outline"
        >
          Record contact
        </Button>
        <Button
          disabled={busy || !note.trim()}
          onClick={() => void act("REQUEST_ARRANGEMENT")}
          size="sm"
          variant="outline"
        >
          Request arrangement review
        </Button>
        {props.hasFailedNotification ? (
          <Button
            disabled={busy}
            onClick={() => void act("RETRY_NOTIFICATION")}
            size="sm"
            variant="outline"
          >
            Retry email
          </Button>
        ) : null}
      </div>
    </div>
  );
}
