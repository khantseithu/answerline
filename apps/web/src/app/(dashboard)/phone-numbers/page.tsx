import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PhoneNumberManager } from "@/components/phone-numbers/phone-number-manager";
import { PageContainer, PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getPhoneNumberDeps } from "@/lib/phone-numbers/context";
import { listPhoneNumberView, PhoneNumberUnavailableError } from "@/lib/phone-numbers/service";

export const instant = false;
export const metadata: Metadata = { title: "Phone numbers" };

async function PhoneNumbersContent() {
  await connection();
  try {
    const list = await listPhoneNumberView(await getPhoneNumberDeps());
    return <PhoneNumberManager initialError={null} initialList={list} />;
  } catch (error) {
    if (error instanceof PhoneNumberUnavailableError) {
      return <PhoneNumberManager initialError={error.message} initialList={null} />;
    }
    throw error;
  }
}

function PhoneNumbersFallback() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

export default function PhoneNumbersPage() {
  return (
    <PageContainer>
      <PageHeader
        description="The numbers callers dial, and which agent answers each one."
        title="Phone numbers"
      />
      <Suspense fallback={<PhoneNumbersFallback />}>
        <PhoneNumbersContent />
      </Suspense>
    </PageContainer>
  );
}
