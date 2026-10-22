import { CallApp } from "@/components/call/call-app";
import { CallWelcome } from "@/components/call/call-welcome";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";

export default function Home() {
  return (
    <CallApp agentName="Bright Smile Dental" agentSlug={DEFAULT_AGENT_SLUG}>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-10">
        <CallWelcome />
      </main>
    </CallApp>
  );
}
