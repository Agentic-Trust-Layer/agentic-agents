import { createPublicClient, createWalletClient, http, zeroHash, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { reputationRegistryAbi } from "@/lib/abi/reputationRegistry";

export const runtime = "nodejs";

function mustEnv(key: string): string {
  const v = String(process.env[key] || "").trim();
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optEnv(key: string): string {
  return String(process.env[key] || "").trim();
}

function normalizeOrigin(input: string): string {
  return new URL(input).origin;
}

function getAgentOrigin(): string {
  const raw =
    String(process.env.MOVIE_AGENT_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_MOVIE_AGENT_URL || "").trim();
  if (!raw) throw new Error("Missing required env var: MOVIE_AGENT_URL (or NEXT_PUBLIC_MOVIE_AGENT_URL)");
  return new URL(raw).origin;
}

async function fetchAgentCard(agentOrigin: string): Promise<any> {
  const r1 = await fetch(`${agentOrigin}/.well-known/agent-card.json`).catch(() => null);
  if (r1 && r1.ok) return await r1.json().catch(() => ({}));
  const r2 = await fetch(`${agentOrigin}/.well-known/agent.json`).catch(() => null);
  if (r2 && r2.ok) return await r2.json().catch(() => ({}));
  throw new Error(`Failed to load agent card from ${agentOrigin}`);
}

function extractAgentIdFromCard(card: any): bigint | null {
  const exts: any[] = Array.isArray(card?.capabilities?.extensions) ? card.capabilities.extensions : [];
  const e8004 = exts.find((e) => String(e?.uri || "").includes("eip-8004"));
  const regs: any[] = Array.isArray(e8004?.params?.registrations) ? e8004.params.registrations : [];
  const id = regs?.[0]?.agentId;
  if (id === undefined || id === null || String(id).trim() === "") return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function clampRatingToScorePct(rating: number): number {
  const r = Math.max(1, Math.min(5, Math.floor(rating)));
  return Math.max(0, Math.min(100, r * 20));
}

export async function POST(request: Request) {
  try {
    const body: any = await request.json().catch(() => ({}));
    const rating = Number(body?.rating);
    const commentRaw = String(body?.comment || "").trim();
    const agentName = String(body?.agentName || "").trim();
    let feedbackAuthId = String(body?.feedbackAuthId || "").trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return Response.json({ error: "Rating must be between 1 and 5" }, { status: 400 });
    }
    if (!commentRaw) return Response.json({ error: "comment is required" }, { status: 400 });

    const pk = String(process.env.CLIENT_WALLET_EOA_PRIVATE_KEY || "").trim();
    if (!pk) return Response.json({ error: "Missing required env var: CLIENT_WALLET_EOA_PRIVATE_KEY" }, { status: 400 });
    if (!pk.startsWith("0x") || pk.length !== 66) {
      return Response.json({ error: "CLIENT_WALLET_EOA_PRIVATE_KEY invalid" }, { status: 400 });
    }
    const account = privateKeyToAccount(pk as `0x${string}`);

    const rpcUrl = (
      optEnv("AGENTIC_TRUST_RPC_URL_SEPOLIA") ||
      optEnv("RPC_URL") ||
      optEnv("JSON_RPC_URL") ||
      "https://rpc.sepolia.org"
    ).trim();

    const repRegRaw = String(process.env.AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA || "").trim();
    if (!repRegRaw) {
      return Response.json(
        { error: "Missing required env var: AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA" },
        { status: 400 },
      );
    }
    const repReg = repRegRaw as Address;
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain: sepolia, account, transport: http(rpcUrl) });

    // Guardrail: if the RPC URL is for the wrong chain (e.g. Optimism mainnet), the node will reject
    // the signed tx with errors like "invalid sender".
    const actualChainId = await publicClient.getChainId().catch(() => 0);
    if (actualChainId !== 11155111) {
      return Response.json(
        {
          error:
            `RPC chain mismatch: expected Sepolia (11155111) but RPC returned chainId=${actualChainId}. ` +
            `Set AGENTIC_TRUST_RPC_URL_SEPOLIA (or RPC_URL) to a Sepolia RPC. Current rpcUrl=${rpcUrl}`,
        },
        { status: 400 },
      );
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
    const agentId = extractAgentIdFromCard(card);
    if (!agentId || agentId <= BigInt(0)) return Response.json({ error: "Could not determine agentId" }, { status: 500 });

    // Auto-resolve feedbackAuth if client didn't provide it
    if (!feedbackAuthId || !feedbackAuthId.startsWith("0x")) {
      const resp = await fetch(`${agentOrigin}/api/feedback-auth/${account.address}`);
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return Response.json({ error: `agent feedback-auth failed: ${resp.status} ${t}` }, { status: 502 });
      }
      const data: any = await resp.json().catch(() => ({}));
      feedbackAuthId = String(data?.feedbackAuthId || data?.signature || "").trim();
    }
    if (!feedbackAuthId || !feedbackAuthId.startsWith("0x")) {
      return Response.json({ error: "feedbackAuthId is required" }, { status: 400 });
    }

    const score = clampRatingToScorePct(rating);
    const tag = zeroHash;
    const feedbackUri = commentRaw.slice(0, 280);
    const feedbackHash = zeroHash;

    // Some RPCs return "gas required exceeds allowance (0)" if the estimate call has an accidental 0 gas cap.
    // Provide a reasonable cap explicitly.
    const GAS_CAP = BigInt(2_000_000);

    const { request: txRequest } = await publicClient.simulateContract({
      account,
      address: repReg,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [agentId, score, tag, tag, feedbackUri, feedbackHash, feedbackAuthId],
      gas: GAS_CAP,
    });
    const txHash = await walletClient.writeContract({ ...(txRequest as any), gas: (txRequest as any)?.gas ?? GAS_CAP } as any);

    try {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch {}

    return Response.json({
      status: "ok",
      agentId: agentId.toString(),
      domain: agentName || cardName,
      rating,
      comment: commentRaw,
      proofOfPayment: txHash,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
}


