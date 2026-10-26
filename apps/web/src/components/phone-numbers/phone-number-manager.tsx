"use client";

import { PhoneOffIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { Button } from "@/components/ui/button";
import { fetchPhoneNumbers } from "@/lib/phone-numbers/client";
import type { PhoneNumberList } from "@/lib/phone-numbers/types";
import { AddNumber } from "./add-number";
import { NumberList } from "./number-list";

export function PhoneNumberManager({
  initialError,
  initialList,
  readOnly = false,
}: {
  initialError: string | null;
  initialList: PhoneNumberList | null;
  readOnly?: boolean;
}) {
  const [list, setList] = useState(initialList);
  const [error, setError] = useState(initialError);

  const refresh = useCallback(async () => {
    try {
      setList(await fetchPhoneNumbers());
      setError(null);
    } catch (caught) {
      setList(null);
      setError(caught instanceof Error ? caught.message : "Could not load phone numbers");
    }
  }, []);

  if (!list) {
    return (
      <EmptyPanel
        description={error ?? "Could not load phone numbers."}
        icon={PhoneOffIcon}
        title="Phone numbers unavailable"
      >
        <Button onClick={refresh} variant="outline">
          Try again
        </Button>
      </EmptyPanel>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {readOnly ? null : <AddNumber agents={list.agents} onChange={refresh} />}
      <NumberList
        agents={list.agents}
        numbers={list.numbers}
        onChange={refresh}
        readOnly={readOnly}
      />
    </div>
  );
}
