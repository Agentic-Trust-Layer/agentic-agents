"use client";

import { useEffect, useRef, useState } from "react";
import { A2AClient } from "@a2a-js/sdk/client";
import type { AgentCard, Message, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { v4 as uuidv4 } from "uuid";

function normalizeAgentBaseUrl(input: string): string {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed
      .replace(/\/+$/, "")
      .replace(/\/\.well-known\/agent\.json\/?$/, "")
      .replace(/\/api\/a2a\/?$/, "")
      .replace(/\/api\/?$/, "");
  }
}

const MOVIE_AGENT_URL = normalizeAgentBaseUrl(
  process.env.NEXT_PUBLIC_MOVIE_AGENT_URL || "https://movie-agent.richardpedersen3.workers.dev",
);
const AGENT_DISPLAY_NAME = process.env.NEXT_PUBLIC_AGENT_NAME || "Agent";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "working" | "completed" | "failed";
};

function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export default function MovieClientApp() {
  const [agentCard, setAgentCard] = useState<AgentCard | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>();
  const [currentContextId, setCurrentContextId] = useState<string | undefined>();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const clientRef = useRef<A2AClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const init = async () => {
      try {
        const client = new A2AClient(MOVIE_AGENT_URL, ".well-known/agent.json");
        clientRef.current = client;
        const card = await client.getAgentCard();
        setAgentCard(card);
        setMessages([
          {
            id: uuidv4(),
            role: "agent",
            content: `Connected to ${card.name || AGENT_DISPLAY_NAME}. ${card.description || "Ready to help!"}`,
            timestamp: new Date(),
            status: "completed",
          },
        ]);
      } catch (e: any) {
        setError(`Failed to connect: ${e?.message || String(e)}`);
      }
    };
    init();
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !clientRef.current) return;

    const text = input.trim();
    setInput("");

    if (text.toLowerCase().includes("give feedback") || text.toLowerCase().includes("give review")) {
      setShowFeedback(true);
      return;
    }

    const userMsg: ChatMessage = { id: uuidv4(), role: "user", content: text, timestamp: new Date(), status: "completed" };
    const agentMsgId = uuidv4();
    setMessages((m) => [
      ...m,
      userMsg,
      { id: agentMsgId, role: "agent", content: "Working...", timestamp: new Date(), status: "working" },
    ]);

    setIsLoading(true);
    try {
      const message: Message = {
        kind: "message",
        messageId: uuidv4(),
        role: "user",
        contextId: currentContextId,
        parts: [{ kind: "text", text }],
      } as any;

      const stream = clientRef.current.sendMessageStream({
        message,
        configuration: {
          acceptedOutputModes: ["text/plain", "application/json"],
          blocking: false,
        },
      } as any);

      for await (const evt of stream as any) {
        const anyEvt: any = evt;
        if (anyEvt?.taskId) setCurrentTaskId(anyEvt.taskId);
        if (anyEvt?.contextId) setCurrentContextId(anyEvt.contextId);

        // Prefer task status updates (streaming)
        const status = anyEvt?.status?.state;
        const statusParts = anyEvt?.status?.message?.parts;
        const msgParts = anyEvt?.parts || anyEvt?.message?.parts;
        const parts = Array.isArray(statusParts) ? statusParts : Array.isArray(msgParts) ? msgParts : [];
        const content = parts.map((p: any) => p?.text || "").join("").trim();

        if (content) {
          setMessages((prev) =>
            prev.map((mm) =>
              mm.id === agentMsgId
                ? {
                    ...mm,
                    content,
                    status: status === "completed" ? "completed" : status === "failed" ? "failed" : "working",
                  }
                : mm,
            ),
          );
        }
      }
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((mm) => (mm.id === agentMsgId ? { ...mm, content: `Error: ${e?.message || e}`, status: "failed" } : mm)),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const submitFeedback = async () => {
    if (!agentCard) return;
    setSubmittingFeedback(true);
    try {
      // optional preflight
      await fetch("/api/health", { signal: createTimeoutSignal(5000) });
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating: feedbackRating,
          comment: feedbackComment,
          agentName: agentCard.name || "movies.8004-agent.eth",
          ...(currentTaskId ? { taskId: currentTaskId } : {}),
          ...(currentContextId ? { contextId: currentContextId } : {}),
        }),
        signal: createTimeoutSignal(30000),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${resp.status}`);
      }
      setShowFeedback(false);
      setFeedbackComment("");
      setMessages((m) => [
        ...m,
        {
          id: uuidv4(),
          role: "agent",
          content: "Feedback submitted.",
          timestamp: new Date(),
          status: "completed",
        },
      ]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-800 px-6 py-4">
        <div className="text-lg font-semibold">{agentCard?.name || AGENT_DISPLAY_NAME}</div>
        <div className="text-xs text-gray-300">{MOVIE_AGENT_URL}</div>
      </header>

      {error ? <div className="bg-red-900/40 px-6 py-3 text-sm">{error}</div> : null}

      <div className="flex-1 overflow-auto px-6 py-4 pb-28">
        {messages.map((m) => (
          <div key={m.id} className="mb-3">
            <div className="text-xs text-gray-400">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* NOTE: Next.js dev indicator sits bottom-left in dev; add extra left padding so it doesn't cover the input. */}
      <div className="sticky bottom-0 z-50 border-t border-gray-700 bg-gray-800 py-4 pr-4 pl-16">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask about movies… (type 'give feedback' to rate)"
          />
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50"
            onClick={sendMessage}
            disabled={isLoading || !clientRef.current}
          >
            Send
          </button>
        </div>
      </div>

      {showFeedback ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded bg-gray-800 p-4">
            <div className="mb-3 text-lg font-semibold">Give feedback</div>
            <div className="mb-3">
              <label className="mb-1 block text-sm text-gray-300">Rating (1-5)</label>
              <input
                type="number"
                min={1}
                max={5}
                value={feedbackRating}
                onChange={(e) => setFeedbackRating(Number(e.target.value))}
                className="w-full rounded bg-gray-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-sm text-gray-300">Comment</label>
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                className="h-24 w-full rounded bg-gray-900 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="rounded bg-gray-700 px-4 py-2 text-sm" onClick={() => setShowFeedback(false)}>
                Cancel
              </button>
              <button
                className="rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50"
                onClick={submitFeedback}
                disabled={submittingFeedback}
              >
                {submittingFeedback ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


