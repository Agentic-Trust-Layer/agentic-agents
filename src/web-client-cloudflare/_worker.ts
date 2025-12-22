import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, zeroHash, type Address } from 'viem';
import { reputationRegistryAbi } from '../lib/abi/reputationRegistry.js';

type Env = Record<string, string | undefined>;

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  // CORS (dev + Pages)
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function mustEnv(env: Env, key: string): string {
  const v = String(env[key] || '').trim();
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optEnv(env: Env, key: string): string {
  return String(env[key] || '').trim();
}

function normalizeOrigin(input: string): string {
  const u = new URL(input);
  return u.origin;
}

async function fetchAgentCard(agentOrigin: string): Promise<any> {
  // Prefer v1.0 card
  const r1 = await fetch(`${agentOrigin}/.well-known/agent-card.json`).catch(() => null);
  if (r1 && r1.ok) return await r1.json().catch(() => ({}));
  const r2 = await fetch(`${agentOrigin}/.well-known/agent.json`).catch(() => null);
  if (r2 && r2.ok) return await r2.json().catch(() => ({}));
  throw new Error(`Failed to load agent card from ${agentOrigin}`);
}

function extractAgentIdFromCard(card: any): bigint | null {
  const exts: any[] = Array.isArray(card?.capabilities?.extensions) ? card.capabilities.extensions : [];
  const e8004 = exts.find((e) => String(e?.uri || '').includes('eip-8004'));
  const regs: any[] = Array.isArray(e8004?.params?.registrations) ? e8004.params.registrations : [];
  const id = regs?.[0]?.agentId;
  if (id === undefined || id === null || String(id).trim() === '') return null;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === 'OPTIONS') return json({ ok: true });

      // Bridge env -> process.env (some libs in this repo assume process.env exists)
      if (typeof process !== 'undefined' && (process as any).env) {
        for (const [k, v] of Object.entries(env)) {
          if (typeof v === 'string' && v.length > 0 && !(process as any).env[k]) {
            (process as any).env[k] = v;
          }
        }
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'GET' && path === '/api/health') {
        return json({ status: 'ok', service: 'movie-client-backend' });
      }

      if (request.method === 'GET' && path === '/api/config/client-address') {
        const pk = optEnv(env, 'CLIENT_WALLET_EOA_PRIVATE_KEY');
        if (!pk || !pk.startsWith('0x') || pk.length !== 66) return json({ clientAddress: '' });
        const account = privateKeyToAccount(pk as `0x${string}`);
        return json({ clientAddress: account.address });
      }

      if (request.method === 'GET' && path === '/api/feedback-auth') {
        const agentName = String(url.searchParams.get('agentName') || '').trim();
        const clientAddress = String(url.searchParams.get('clientAddress') || '').trim();
        if (!clientAddress || !clientAddress.startsWith('0x') || clientAddress.length !== 42) {
          return json({ error: 'clientAddress is required' }, { status: 400 });
        }

        const agentOrigin = normalizeOrigin(mustEnv(env, 'MOVIE_AGENT_URL'));
        const card = await fetchAgentCard(agentOrigin);
        const cardName = String(card?.name || '').trim();
        if (agentName && cardName && agentName.toLowerCase() !== cardName.toLowerCase()) {
          return json(
            { error: `Agent mismatch: requested "${agentName}" but MOVIE_AGENT_URL serves "${cardName}"` },
            { status: 400 },
          );
        }

        const agentId = extractAgentIdFromCard(card);
        const resp = await fetch(`${agentOrigin}/api/feedback-auth/${clientAddress}`);
        if (!resp.ok) {
          const t = await resp.text().catch(() => '');
          return json({ error: `agent feedback-auth failed: ${resp.status} ${t}` }, { status: 502 });
        }
        const data: any = await resp.json().catch(() => ({}));
        const feedbackAuthId = String(data?.feedbackAuthId || data?.signature || '').trim();
        if (!feedbackAuthId) return json({ error: 'No feedbackAuthId returned by agent' }, { status: 502 });
        return json({
          feedbackAuthId,
          agentId: agentId ? agentId.toString() : '',
          canonicalAgentName: cardName || agentName,
          agentUrl: agentOrigin,
        });
      }

      if (request.method === 'POST' && path === '/api/feedback') {
        const body: any = await request.json().catch(() => ({}));
        const rating = Number(body?.rating);
        const commentRaw = String(body?.comment || '').trim();
        const agentName = String(body?.agentName || '').trim();
        let feedbackAuthId = String(body?.feedbackAuthId || '').trim();

        if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
          return json({ error: 'Rating must be between 1 and 5' }, { status: 400 });
        }
        if (!commentRaw) return json({ error: 'comment is required' }, { status: 400 });

        const pk = mustEnv(env, 'CLIENT_WALLET_EOA_PRIVATE_KEY') as `0x${string}`;
        if (!pk.startsWith('0x') || pk.length !== 66) {
          return json({ error: 'CLIENT_WALLET_EOA_PRIVATE_KEY invalid' }, { status: 500 });
        }
        const account = privateKeyToAccount(pk);

        const rpcUrl = (
          optEnv(env, 'AGENTIC_TRUST_RPC_URL_SEPOLIA') ||
          optEnv(env, 'RPC_URL') ||
          optEnv(env, 'JSON_RPC_URL') ||
          'https://rpc.sepolia.org'
        ).trim();
        const repReg = mustEnv(env, 'AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA') as Address;

        const publicClient = createPublicClient({ transport: http(rpcUrl) });
        const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

        const agentOrigin = normalizeOrigin(mustEnv(env, 'MOVIE_AGENT_URL'));
        const card = await fetchAgentCard(agentOrigin);
        const agentId = extractAgentIdFromCard(card);
        if (!agentId || agentId <= 0n) return json({ error: 'Could not determine agentId' }, { status: 500 });

        // If the frontend didn't provide a feedbackAuthId, obtain one now.
        if (!feedbackAuthId || !feedbackAuthId.startsWith('0x')) {
          try {
            const clientAddress = account.address;
            const cardName = String(card?.name || '').trim();
            if (agentName && cardName && agentName.toLowerCase() !== cardName.toLowerCase()) {
              return json(
                { error: `Agent mismatch: requested "${agentName}" but MOVIE_AGENT_URL serves "${cardName}"` },
                { status: 400 },
              );
            }
            const resp = await fetch(`${agentOrigin}/api/feedback-auth/${clientAddress}`);
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              return json({ error: `agent feedback-auth failed: ${resp.status} ${t}` }, { status: 502 });
            }
            const data: any = await resp.json().catch(() => ({}));
            feedbackAuthId = String(data?.feedbackAuthId || data?.signature || '').trim();
          } catch (e: any) {
            return json({ error: e?.message || 'Failed to resolve feedbackAuthId' }, { status: 502 });
          }
        }
        if (!feedbackAuthId || !feedbackAuthId.startsWith('0x')) {
          return json({ error: 'feedbackAuthId is required' }, { status: 400 });
        }

        const score = clampRatingToScorePct(rating);
        const tag = zeroHash; // bytes32(0)
        // Store comment directly to keep this Worker minimal (no IPFS/Pinata secrets needed).
        const feedbackUri = commentRaw.slice(0, 280);
        const feedbackHash = zeroHash;

        const txHash = await walletClient.writeContract({
          address: repReg,
          abi: reputationRegistryAbi as any,
          functionName: 'giveFeedback',
          args: [agentId, score, tag, tag, feedbackUri, feedbackHash, feedbackAuthId],
          chain: undefined as any,
        });

        // Wait for inclusion (best-effort)
        try {
          await publicClient.waitForTransactionReceipt({ hash: txHash });
        } catch {}

        return json({
          status: 'ok',
          agentId: agentId.toString(),
          domain: agentName || String(card?.name || ''),
          rating,
          comment: commentRaw,
          proofOfPayment: txHash,
        });
      }

      return json({ error: 'Not Found' }, { status: 404 });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, { status: 500 });
    }
  },
};


