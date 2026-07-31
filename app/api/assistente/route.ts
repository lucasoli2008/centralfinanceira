import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAppContext } from "@/lib/auth/session";
import { askAssistant } from "@/lib/ai/assistant";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * Assistente de IA em linguagem natural sobre os dados financeiros da
 * organização. Sem estado no servidor: o cliente reenvia o histórico
 * completo a cada pergunta. Ver docs/AI_ASSISTANT.md.
 */
export async function POST(request: NextRequest) {
  const context = await requireAppContext();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Mensagens inválidas." }, { status: 400 });
  }

  try {
    const result = await askAssistant(parsed.data.messages, context);
    return Response.json(result);
  } catch (error) {
    logServerError("ai.route", error);
    const message = error instanceof Error ? error.message : "Não foi possível responder agora.";
    return Response.json({ error: message }, { status: 502 });
  }
}
