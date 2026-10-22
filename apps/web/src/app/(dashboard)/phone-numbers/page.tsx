import { Grid3x3Icon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyPanel } from "@/components/shell/empty-panel";
import { PageContainer, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Phone numbers" };

export default function PhoneNumbersPage() {
  return (
    <PageContainer>
      <PageHeader
        description="The numbers callers dial, and which agent answers each one."
        title="Phone numbers"
      />
      <EmptyPanel
        description="Connect a number from Twilio, Telnyx, or any SIP trunk and choose which agent picks up. Until then, your receptionist answers browser calls."
        icon={Grid3x3Icon}
        issue={70}
        title="Answer real phone calls"
      />
    </PageContainer>
  );
}
