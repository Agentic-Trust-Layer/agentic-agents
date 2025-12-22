import type { PublicClient, WalletClient, Account } from 'viem';
import { ViemAccountProvider, type ChainConfig } from '@agentic-trust/8004-ext-sdk';
import { AIAgentReputationClient, AIAgentIdentityClient } from '@agentic-trust/8004-ext-sdk';


let reputationClient: AIAgentReputationClient | null = null;
let identityClient: AIAgentIdentityClient | null = null;


export async function initReputationClient(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAccount?: Account;
  clientAccount?: Account;
  reputationRegistry: `0x${string}`;
  ensRegistry: `0x${string}`;
}) {
  const { publicClient, walletClient, clientAccount, agentAccount, reputationRegistry, ensRegistry } = params;

  const chain = (publicClient as any)?.chain;
  const chainId = Number(chain?.id ?? process.env.ERC8004_CHAIN_ID ?? 11155111);
  const rpcUrl = String(
    process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA ||
      process.env.RPC_URL ||
      process.env.JSON_RPC_URL ||
      'https://rpc.sepolia.org',
  ).trim();
  const chainConfig: ChainConfig = {
    id: chainId,
    name: String(chain?.name || `chain-${chainId}`),
    rpcUrl,
    chain,
    bundlerUrl: (process.env.BUNDLER_URL || '').trim() || undefined,
    paymasterUrl: (process.env.PAYMASTER_URL || '').trim() || undefined,
  };

  const clientAdapter = new ViemAccountProvider({
    publicClient: publicClient as any,
    walletClient: (walletClient as any) ?? null,
    account: clientAccount as any,
    chainConfig,
  });
  const agentAdapter = new ViemAccountProvider({
    publicClient: publicClient as any,
    walletClient: (walletClient as any) ?? null,
    account: agentAccount as any,
    chainConfig,
  });
  reputationClient = await AIAgentReputationClient.create(
    agentAdapter as any,
    clientAdapter as any,
    reputationRegistry,
    ensRegistry,
  );
}

export function getReputationClient(): AIAgentReputationClient {
  if (!reputationClient) throw new Error('AIAgentReputation not initialized');
  return reputationClient;
}


export function initIdentityClient(params: {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAccount?: Account;
  identityRegistry: `0x${string}`;
  ensRegistry: `0x${string}`;
}) {
  const { publicClient, walletClient, agentAccount, identityRegistry, ensRegistry } = params;

  const chain = (publicClient as any)?.chain;
  const chainId = Number(chain?.id ?? process.env.ERC8004_CHAIN_ID ?? 11155111);
  const rpcUrl = String(
    process.env.AGENTIC_TRUST_RPC_URL_SEPOLIA ||
      process.env.RPC_URL ||
      process.env.JSON_RPC_URL ||
      'https://rpc.sepolia.org',
  ).trim();
  const chainConfig: ChainConfig = {
    id: chainId,
    name: String(chain?.name || `chain-${chainId}`),
    rpcUrl,
    chain,
    bundlerUrl: (process.env.BUNDLER_URL || '').trim() || undefined,
    paymasterUrl: (process.env.PAYMASTER_URL || '').trim() || undefined,
  };

  const agentAdapter = new ViemAccountProvider({
    publicClient: publicClient as any,
    walletClient: (walletClient as any) ?? null,
    account: agentAccount as any,
    chainConfig,
  });
  const orgAdapter = new ViemAccountProvider({
    publicClient: publicClient as any,
    walletClient: (walletClient as any) ?? null,
    account: undefined as any,
    chainConfig,
  });
  identityClient = new AIAgentIdentityClient(
    agentAdapter as any,
    orgAdapter as any,
    identityRegistry,
    ensRegistry,
  );
}

export function getIdentityClient(): AIAgentIdentityClient {
  if (!identityClient) throw new Error('AIAgentIdentity not initialized');
  return identityClient;
}

