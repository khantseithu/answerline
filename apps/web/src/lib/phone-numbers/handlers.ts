import { phoneNumberSchema } from "@answerline/worker/phone-numbers";
import { z } from "zod";
import { assignPhoneNumber, createPhoneNumber } from "./schemas";
import {
  connectPhoneNumber,
  disconnectPhoneNumber,
  listPhoneNumberView,
  PhoneNumberBadRequestError,
  PhoneNumberConflictError,
  type PhoneNumberDeps,
  PhoneNumberNotFoundError,
  PhoneNumberUnavailableError,
  reassignPhoneNumber,
} from "./service";

const noStore = { "Cache-Control": "no-store" };

export function phoneNumberErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request", issues: error.issues },
      { status: 400 }
    );
  }
  if (error instanceof PhoneNumberBadRequestError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof PhoneNumberNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof PhoneNumberConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof PhoneNumberUnavailableError) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 502 });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new PhoneNumberBadRequestError("Request body must be JSON", { cause: error });
  }
}

function parseNumber(raw: string) {
  try {
    return phoneNumberSchema.parse(decodeURIComponent(raw));
  } catch (error) {
    if (error instanceof URIError) {
      throw new PhoneNumberBadRequestError("Invalid phone number", { cause: error });
    }
    throw error;
  }
}

export function createPhoneNumberHandlers(getDeps: () => Promise<PhoneNumberDeps>) {
  return {
    async assign(request: Request, rawNumber: string) {
      try {
        const number = parseNumber(rawNumber);
        const { agent } = assignPhoneNumber.parse(await readJson(request));
        const result = await reassignPhoneNumber(await getDeps(), number, agent);
        return Response.json(result, { headers: noStore });
      } catch (error) {
        return phoneNumberErrorResponse(error);
      }
    },
    async create(request: Request) {
      try {
        const input = createPhoneNumber.parse(await readJson(request));
        const result = await connectPhoneNumber(await getDeps(), input);
        return Response.json(result, { headers: noStore, status: 201 });
      } catch (error) {
        return phoneNumberErrorResponse(error);
      }
    },
    async list() {
      try {
        const result = await listPhoneNumberView(await getDeps());
        return Response.json(result, { headers: noStore });
      } catch (error) {
        return phoneNumberErrorResponse(error);
      }
    },
    async remove(_request: Request, rawNumber: string) {
      try {
        await disconnectPhoneNumber(await getDeps(), parseNumber(rawNumber));
        return new Response(null, { headers: noStore, status: 204 });
      } catch (error) {
        return phoneNumberErrorResponse(error);
      }
    },
  };
}
