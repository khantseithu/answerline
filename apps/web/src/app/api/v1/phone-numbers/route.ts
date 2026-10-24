import { connection } from "next/server";
import { getPhoneNumberDeps } from "@/lib/phone-numbers/context";
import { createPhoneNumberHandlers } from "@/lib/phone-numbers/handlers";

const handlers = createPhoneNumberHandlers(getPhoneNumberDeps);

export async function GET() {
  await connection();
  return handlers.list();
}

export function POST(request: Request) {
  return handlers.create(request);
}
