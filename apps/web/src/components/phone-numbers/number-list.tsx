"use client";

import { Grid3x3Icon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EmptyPanel } from "@/components/shell/empty-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignPhoneNumber, removePhoneNumber } from "@/lib/phone-numbers/client";
import type { AgentOption, PhoneNumberView } from "@/lib/phone-numbers/types";
import { AgentSelect } from "./agent-select";

const TELEPHONY_DOCS = "https://github.com/khantseithu/answerline/blob/main/docs/telephony.md";

function NumberRow({
  agents,
  onChange,
  phone,
}: {
  agents: AgentOption[];
  onChange: () => Promise<void>;
  phone: PhoneNumberView;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>, success: string) => {
      setBusy(true);
      try {
        await action();
        toast.success(success);
        await onChange();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );
  const handleAssign = useCallback(
    (agent: string) => {
      if (agent !== phone.agent) {
        run(() => assignPhoneNumber(phone.number, agent), "Agent updated");
      }
    },
    [phone.agent, phone.number, run]
  );
  const handleRemove = useCallback(
    () => run(() => removePhoneNumber(phone.number), "Phone number removed"),
    [phone.number, run]
  );
  const openConfirm = useCallback(() => setConfirmOpen(true), []);

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">{phone.number}</TableCell>
      <TableCell>
        <AgentSelect
          agents={agents}
          disabled={busy}
          label={`Agent answering ${phone.number}`}
          onChange={handleAssign}
          size="sm"
          value={phone.agent}
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Button
            aria-label={`Remove ${phone.number}`}
            disabled={busy}
            onClick={openConfirm}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
        <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this number?</AlertDialogTitle>
              <AlertDialogDescription>
                {`Calls to ${phone.number} will stop reaching your receptionist. Your SIP provider keeps the number; only the connection to Answerline is removed.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep number</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemove} variant="destructive">
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function NumberList({
  agents,
  numbers,
  onChange,
}: {
  agents: AgentOption[];
  numbers: PhoneNumberView[];
  onChange: () => Promise<void>;
}) {
  if (!numbers.length) {
    return (
      <EmptyPanel
        description={
          <>
            Point a Twilio, Telnyx, or generic SIP trunk at this server, then connect the number
            above. Until then, your receptionist answers browser calls.{" "}
            <a
              className="rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
              href={TELEPHONY_DOCS}
              rel="noreferrer"
              target="_blank"
            >
              Read the telephony guide
            </a>
            .
          </>
        }
        icon={Grid3x3Icon}
        title="No phone numbers yet"
      />
    );
  }

  return (
    <section aria-labelledby="numbers-heading" className="flex flex-col gap-3">
      <h2 className="font-semibold text-base" id="numbers-heading">
        Numbers
      </h2>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Answered by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {numbers.map((phone) => (
              <NumberRow agents={agents} key={phone.number} onChange={onChange} phone={phone} />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
