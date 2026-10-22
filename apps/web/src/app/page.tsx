import { CallApp } from "@/components/call/call-app";
import { DEFAULT_AGENT_SLUG } from "@/lib/call-token";

export default function Home() {
  return <CallApp agentName="Bright Smile Dental" agentSlug={DEFAULT_AGENT_SLUG} />;
}
