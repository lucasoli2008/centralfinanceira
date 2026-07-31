"use client";

import * as React from "react";
import { FileText, Loader2, Send, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reportUrl?: string | null;
}

const SUGESTOES = [
  "Qual o ticket médio de aluguel deste ano?",
  "Quanto entrou de comissão este mês?",
  "Gera o relatório mensal atual",
];

/**
 * Painel de chat com o assistente financeiro. Sem persistência: fechar o
 * diálogo esquece a conversa (a API também não guarda nada — ver
 * app/api/assistente/route.ts).
 */
export function AssistantPanel() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    const history: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/assistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(typeof data?.error === "string" ? data.error : "Não foi possível responder agora.");
        return;
      }

      setMessages([
        ...history,
        { role: "assistant", content: data.text as string, reportUrl: (data.reportUrl as string | null) ?? null },
      ]);
    } catch {
      setError("Não foi possível falar com o assistente agora.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Assistente de IA">
          <Sparkles />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[85vh] max-w-2xl flex-col p-0">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            Assistente financeiro
          </DialogTitle>
          <DialogDescription>
            Pergunte sobre comissões, corretores e meses, ou peça um relatório em PDF.
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="label-caption">Experimente perguntar:</p>
              {SUGESTOES.map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  onClick={() => void send(sugestao)}
                  className="w-fit rounded-control border border-border bg-surface-sunken px-3 py-1.5 text-left text-[13px] text-muted transition-colors hover:border-accent-border hover:text-foreground"
                >
                  {sugestao}
                </button>
              ))}
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div
              key={index}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-card px-3.5 py-2.5 text-[13px] leading-relaxed",
                  message.role === "user"
                    ? "bg-accent text-accent-foreground"
                    : "surface-card text-foreground",
                )}
              >
                {message.content}
                {message.reportUrl ? (
                  <a
                    href={message.reportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex w-fit items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2.5 py-1 text-[12.5px] font-medium text-foreground hover:bg-surface-muted"
                  >
                    <FileText className="size-3.5" />
                    Abrir PDF
                  </a>
                ) : null}
              </div>
            </div>
          ))}

          {loading ? (
            <div className="flex items-center gap-2 text-[12.5px] text-subtle">
              <Loader2 className="size-3.5 animate-spin" />
              Consultando os dados…
            </div>
          ) : null}

          {error ? <p className="text-[12.5px] font-medium text-danger">{error}</p> : null}
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-border px-5 py-4">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Pergunte algo sobre as comissões…"
            className="min-h-10 flex-1 resize-none"
            rows={1}
          />
          <Button type="submit" size="icon" disabled={loading || input.trim() === ""} aria-label="Enviar">
            <Send />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
