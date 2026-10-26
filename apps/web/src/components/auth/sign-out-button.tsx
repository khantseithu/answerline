"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export function SignOutButton({ destination = "/login" }: { destination?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = useCallback(async () => {
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setFailed(true);
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [destination, router]);

  return (
    <>
      {failed ? (
        <span className="text-destructive text-xs" role="alert">
          Sign-out failed. Try again.
        </span>
      ) : null}
      <Button
        aria-label="Sign out"
        disabled={pending}
        onClick={signOut}
        size="icon-lg"
        variant="ghost"
      >
        <LogOutIcon />
      </Button>
    </>
  );
}
