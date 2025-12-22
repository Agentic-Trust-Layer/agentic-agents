export const runtime = "nodejs";

function mustEnv(key: string): string {
  const v = String(process.env[key] || "").trim();
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function getAgentOrigin(): string {
  const raw =
    String(process.env.MOVIE_AGENT_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_MOVIE_AGENT_URL || "").trim();
  if (!raw) throw new Error("Missing required env var: MOVIE_AGENT_URL (or NEXT_PUBLIC_MOVIE_AGENT_URL)");
  return new URL(raw).origin;
}

function normalizeOrigin(input: string): string {
  return new URL(input).origin;
}

async function fetchAgentCard(agentOrigin: string): Promise<any> {
  const r1 = await fetch(`${agentOrigin}/.well-known/agent-card.json`).catch(() => null);
  if (r1 && r1.ok) return await r1.json().catch(() => ({}));
  const r2 = await fetch(`${agentOrigin}/.well-known/agent.json`).catch(() => null);
  if (r2 && r2.ok) return await r2.json().catch(() => ({}));
  throw new Error(`Failed to load agent card from ${agentOrigin}`);
}

function extractAgentIdFromCard(card: any): string {
  const exts: any[] = Array.isArray(card?.capabilities?.extensions) ? card.capabilities.extensions : [];
  const e8004 = exts.find((e) => String(e?.uri || "").includes("eip-8004"));
  const regs: any[] = Array.isArray(e8004?.params?.registrations) ? e8004.params.registrations : [];
  const id = regs?.[0]?.agentId;
  return id === undefined || id === null ? "" : String(id);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clientAddress = String(url.searchParams.get("clientAddress") || "").trim();
    const agentName = String(url.searchParams.get("agentName") || "").trim();

    if (!clientAddress || !clientAddress.startsWith("0x") || clientAddress.length !== 42) {
      return Response.json({ error: "clientAddress is required" }, { status: 400 });
    }

    const agentOrigin = getAgentOrigin();
    const card = await fetchAgentCard(agentOrigin);
    const cardName = String(card?.name || "").trim();
    if (agentName && cardName && agentName.toLowerCase() !== cardName.toLowerCase()) {
      return Response.json(
        { error: `Agent mismatch: requested "${agentName}" but MOVIE_AGENT_URL serves "${cardName}"` },
        { status: 400 },
      );
    }

    const resp = await fetch(`${agentOrigin}/api/feedback-auth/${clientAddress}`);
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return Response.json({ error: `agent feedback-auth failed: ${resp.status} ${t}` }, { status: 502 });
    }
    const data: any = await resp.json().catch(() => ({}));
    const feedbackAuthId = String(data?.feedbackAuthId || data?.signature || "").trim();
    if (!feedbackAuthId) return Response.json({ error: "No feedbackAuthId returned by agent" }, { status: 502 });

    return Response.json({
      feedbackAuthId,
      agentId: extractAgentIdFromCard(card),
      canonicalAgentName: cardName || agentName,
      agentUrl: agentOrigin,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
}


