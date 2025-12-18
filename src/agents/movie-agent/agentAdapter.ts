import { createPublicClient, createWalletClient, custom, http, defineChain, encodeFunctionData, encodeAbiParameters, keccak256, isHex, hexToBytes, sliceHex, zeroAddress, toHex, getAddress, type Address, type Chain, type PublicClient, type Account } from "viem";
import { identityRegistryAbi } from "../../lib/abi/identityRegistry.js";
import { initReputationClient, getReputationClient as getReputationClientLegacy, initIdentityClient, getIdentityClient } from './clientProvider.js';
// @ts-expect-error - TypeScript module resolution issue, but exports exist at runtime
import { getAgenticTrustClient, loadSessionPackage } from '@agentic-trust/core/server';
import { reputationRegistryAbi } from "../../lib/abi/reputationRegistry.js";
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';

import { privateKeyToAccount } from 'viem/accounts';

import { sepolia } from "viem/chains";

import { ethers } from 'ethers';
import IpfsService from '../../services/ipfs.js';

function getEnsRegistryFromEnv(): `0x${string}` {
  return (process.env.ENS_REGISTRY ||
    process.env.NEXT_PUBLIC_ENS_REGISTRY ||
    '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}`;
}

async function getReputationClientInitialized(params: {
  publicClient: PublicClient;
  walletClient?: any;
  agentAccount?: Account;
  clientAccount?: Account;
  reputationRegistry: `0x${string}`;
  ensRegistry?: `0x${string}`;
}) {
  try {
    return getReputationClientLegacy();
  } catch {}
  await initReputationClient({
    publicClient: params.publicClient,
    walletClient: params.walletClient,
    agentAccount: params.agentAccount,
    clientAccount: params.clientAccount,
    reputationRegistry: params.reputationRegistry,
    ensRegistry: params.ensRegistry ?? getEnsRegistryFromEnv(),
  });
  return getReputationClientLegacy();
}




async function fetchIdentityRegistry(publicClient: PublicClient, reputationRegistry: `0x${string}`): Promise<`0x${string}`> {
  return await publicClient.readContract({
    address: reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'getIdentityRegistry',
    args: [],
  }) as `0x${string}`;
}



export async function createFeedbackAuth(params: {
  publicClient: PublicClient;
  reputationRegistry: `0x${string}`;
  agentId: bigint;
  clientAddress: `0x${string}`;
  signer: Account;
  walletClient?: any;
  indexLimitOverride?: bigint;
  expirySeconds?: number;
  chainIdOverride?: bigint;
}): Promise<`0x${string}`> {
  const {
    publicClient,
    reputationRegistry,
    agentId,
    clientAddress,
    signer,
    walletClient,
    indexLimitOverride,
    expirySeconds = 3600,
    chainIdOverride,
  } = params;

  const rep = await getReputationClientInitialized({
    publicClient,
    walletClient,
    agentAccount: signer,
    reputationRegistry,
  });
  const identityReg = (await rep.getIdentityRegistry?.()) || (await fetchIdentityRegistry(publicClient, reputationRegistry));

  // Ensure IdentityRegistry operator approvals are configured for sessionAA
  console.info("**********************************")
  try {
    const ownerOfAgent = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'ownerOf' as any,
      args: [agentId],
    }) as `0x${string}`;
    const isOperator = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'isApprovedForAll' as any,
      args: [ownerOfAgent, signer.address as `0x${string}`],
    }) as boolean;
    const tokenApproved = await publicClient.readContract({
      address: identityReg as `0x${string}`,
      abi: identityRegistryAbi as any,
      functionName: 'getApproved' as any,
      args: [agentId],
    }) as `0x${string}`;

    console.info('IdentityRegistry approvals:', { ownerOfAgent, isOperator, tokenApproved });
    if (!isOperator && tokenApproved.toLowerCase() !== (signer.address as string).toLowerCase()) {
      throw new Error(`IdentityRegistry approval missing: neither isApprovedForAll`);
    }
  } catch (e: any) {
    console.warn('[IdentityRegistry] approval check failed:', e?.message || e);
    throw e;
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const chainId = chainIdOverride ?? BigInt(publicClient.chain?.id ?? 0);

  const U64_MAX = 18446744073709551615n;
  const lastIndexFetched = indexLimitOverride !== undefined
    ? (indexLimitOverride - 1n)
    : await rep.getLastIndex(agentId, clientAddress);
  let indexLimit = lastIndexFetched + 1n;
  let expiry = nowSec + BigInt(expirySeconds);
  if (expiry > U64_MAX) {
    console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
    expiry = U64_MAX;
  }

  // Build FeedbackAuth struct via ReputationClient
  const authStruct = rep.createFeedbackAuth(
    agentId,
    clientAddress,
    indexLimit,
    expiry,
    chainId,
    signer.address as `0x${string}`,
  );

  // Sign keccak256(encoded tuple) with provided signer (sessionAA via ERC-1271)
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address', 'address'],
    [
      authStruct.agentId,
      authStruct.clientAddress,
      authStruct.indexLimit,
      authStruct.expiry,
      authStruct.chainId,
      authStruct.identityRegistry,
      authStruct.signerAddress,
    ]
  );
  const messageHash = ethers.keccak256(encoded) as `0x${string}`;
  const signature = await signer.signMessage({ message: { raw: ethers.getBytes(messageHash) } });
  return signature as `0x${string}`;

  /*
  return feedbackAuth as `0x${string}`;

  // Build the domain-separated inner hash exactly as the contract does
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },  // FEEDBACK_DOMAIN
        { type: 'uint64'  },  // chainId
        { type: 'address' },  // reputationRegistry (address(this))
        { type: 'address' },  // identityRegistry
        { type: 'uint256' },  // agentId
        { type: 'address' },  // clientAddress
        { type: 'uint64'  },  // indexLimit
        { type: 'uint64'  },  // expiry
        { type: 'address' },  // signer
      ],
      [
        FEEDBACK_DOMAIN,
        BigInt(chainId),
        reputationRegistry,
        identityRegistry,
        agentId,
        clientAddress,
        indexLimit,
        expiry,
        payload.signerAddress,
      ],
    ),
  );

  // Sign inner; the solidity code calls toEthSignedMessageHash(inner), which viem applies for signMessage.
  // Return ONLY the raw 65-byte signature to pass as feedbackAuth.
  const feedbackAuth = await signFeedbackAuthMessage({ account: signer, message: inner });
  return feedbackAuth as `0x${string}`;
  */
}

export type AgentInfo = {
  agentId: bigint;
  agentDomain: string;
  agentAddress: Address;
};

export type AgentAdapterConfig = {
  registryAddress: Address;
  rpcUrl?: string;
};

export function createAgentAdapter(config: AgentAdapterConfig) {
  function getPublicClient() {
    if (config.rpcUrl) {
      return createPublicClient({ transport: http(config.rpcUrl) });
    }
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      return createPublicClient({ transport: custom((window as any).ethereum) });
    }
    throw new Error('Missing RPC URL. Provide config.rpcUrl or ensure window.ethereum is available.');
  }

  async function getAgentCount(): Promise<bigint> {
    const publicClient = getPublicClient();
    return await publicClient.readContract({
      address: config.registryAddress,
      abi: identityRegistryAbi,
      functionName: "getAgentCount",
      args: [],
    }) as bigint;
  }

  async function getAgent(agentId: bigint): Promise<AgentInfo> {
    const publicClient = getPublicClient();
    const res = await publicClient.readContract({
      address: config.registryAddress,
      abi: identityRegistryAbi,
      functionName: "getAgent",
      args: [agentId],
    }) as any;
    return {
      agentId: BigInt(res.agentId ?? agentId),
      agentDomain: res.agentDomain,
      agentAddress: res.agentAddress as Address,
    };
  }

  async function resolveByDomain(agentDomain: string): Promise<AgentInfo> {
    const publicClient = getPublicClient();
    const res = await publicClient.readContract({
      address: config.registryAddress,
      abi: identityRegistryAbi,
      functionName: "resolveByDomain",
      args: [agentDomain],
    }) as any;
    return {
      agentId: BigInt(res.agentId),
      agentDomain: res.agentDomain,
      agentAddress: res.agentAddress as Address,
    };
  }

  async function resolveByAddress(agentAddress: Address): Promise<AgentInfo> {
    const publicClient = getPublicClient();
    const res = await publicClient.readContract({
      address: config.registryAddress,
      abi: identityRegistryAbi,
      functionName: "resolveByAddress",
      args: [agentAddress],
    }) as any;
    return {
      agentId: BigInt(res.agentId),
      agentDomain: res.agentDomain,
      agentAddress: res.agentAddress as Address,
    };
  }

  function getWalletClient() {
    if (typeof window === "undefined") return null;
    const eth: any = (window as any).ethereum;
    if (!eth) return null;
    const chain = inferChainFromProvider(eth, config.rpcUrl);
    return createWalletClient({ chain, transport: custom(eth) });
  }

  function inferChainFromProvider(provider: any, fallbackRpcUrl?: string): Chain {
    // Best-effort sync read; if it fails, default to mainnet + provided rpc
    const rpcUrl = fallbackRpcUrl || 'https://rpc.ankr.com/eth';
    let chainIdHex: string | undefined;
    try { chainIdHex = provider?.chainId; } catch {}
    const readChainId = () => {
      if (chainIdHex && typeof chainIdHex === 'string') return chainIdHex;
      return undefined;
    };
    const hex = readChainId();
    const id = hex ? parseInt(hex, 16) : 1;
    return defineChain({
      id,
      name: `chain-${id}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    });
  }

  async function registerByDomainWithProvider(agentDomain: string, eip1193Provider: any): Promise<`0x${string}`> {
    const accounts = await eip1193Provider.request({ method: 'eth_accounts' }).catch(() => []);
    const from: Address = (accounts && accounts[0]) as Address;
    if (!from) throw new Error('No account from provider');
    const chain = inferChainFromProvider(eip1193Provider, config.rpcUrl);
    const walletClient = createWalletClient({ chain, transport: custom(eip1193Provider as any) });
    const hash = await walletClient.writeContract({
      address: config.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'registerByDomain',
      args: [agentDomain, from],
      account: from,
      chain,
    });
    return hash as `0x${string}`;
  }

  return {
    // getPublicClient intentionally not exported; consumers use helpers below
    getAgentCount,
    getAgent,
    resolveByDomain,
    resolveByAddress,
    getWalletClient,
    registerByDomainWithProvider,
  };
}


export async function getAgentByDomain(params: {
  publicClient: PublicClient,
  registry: `0x${string}`,
  domain: string,
}): Promise<`0x${string}` | null> {
  const { publicClient, registry } = params;
  const domain = params.domain.trim().toLowerCase();
  const zero = '0x0000000000000000000000000000000000000000';
  try {
    const info: any = await publicClient.readContract({ address: registry, abi: identityRegistryAbi as any, functionName: 'resolveByDomain' as any, args: [domain] });
    const addr = (info?.agentAddress ?? info?.[2]) as `0x${string}` | undefined;
    if (addr && addr !== zero) return addr;
  } catch {}
  const fns: Array<'agentOfDomain' | 'getAgent' | 'agents'> = ['agentOfDomain', 'getAgent', 'agents'];
  for (const fn of fns) {
    try {
      const addr = await publicClient.readContract({ address: registry, abi: identityRegistryAbi as any, functionName: fn as any, args: [domain] }) as `0x${string}`;
      if (addr && addr !== zero) return addr;
    } catch {}
  }
  return null;
}

export async function getAgentInfoByDomain(params: {
  publicClient: PublicClient,
  registry: `0x${string}`,
  domain: string,
}): Promise<{ agentId: bigint; agentAddress: `0x${string}` } | null> {
  const { publicClient, registry } = params;
  const domain = params.domain.trim().toLowerCase();
  try {
    const info: any = await publicClient.readContract({
      address: registry,
      abi: identityRegistryAbi as any,
      functionName: 'resolveByDomain' as any,
      args: [domain],
    });
    const agentId = BigInt(info?.agentId ?? info?.[0] ?? 0);
    const agentAddress = (info?.agentAddress ?? info?.[2]) as `0x${string}` | undefined;
    if (agentId > 0n && agentAddress) return { agentId, agentAddress };
  } catch {}
  return null;
}

export async function deploySmartAccountIfNeeded(params: {
  bundlerUrl: string,
  chain: Chain,
  account: { isDeployed: () => Promise<boolean> }
}): Promise<boolean> {
  const { bundlerUrl, chain, account } = params;
  const isDeployed = await account.isDeployed();
  if (isDeployed) return false;
  const bundlerClient = createBundlerClient({ transport: http(bundlerUrl), chain: chain as any, paymaster: true as any, paymasterContext: { mode: 'SPONSORED' } } as any);
  
  // Set generous gas limits for deployment
  const gasConfig = {
    callGasLimit: 2000000n, // 2M gas for deployment (higher than regular calls)
    verificationGasLimit: 2000000n, // 2M gas for verification
    preVerificationGas: 200000n, // 200K gas for pre-verification
    maxFeePerGas: 1000000000n, // 1 gwei max fee
    maxPriorityFeePerGas: 1000000000n, // 1 gwei priority fee
  };
  
  console.info('*************** deploySmartAccountIfNeeded with gas config:', gasConfig);
  const userOperationHash = await (bundlerClient as any).sendUserOperation({ 
    account, 
    calls: [{ to: zeroAddress }],
    ...gasConfig
  });
  await (bundlerClient as any).waitForUserOperationReceipt({ hash: userOperationHash });
  return true;
}

export async function sendSponsoredUserOperation(params: {
  bundlerUrl: string,
  chain: Chain,
  account: any,
  calls: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }[],
}): Promise<`0x${string}`> {
  const { bundlerUrl, chain, account, calls } = params;
  const paymasterClient = createPaymasterClient({ transport: http(bundlerUrl) } as any);
  const bundlerClient = createBundlerClient({
    transport: http(process.env.BUNDLER_URL || ''),
    paymaster: true,
    chain: sepolia,
    paymasterContext: {
      mode:             'SPONSORED',
    },
  });

  // Set generous gas limits for the user operation
  const gasConfig = {
    callGasLimit: 1000000n, // 1M gas for the call
    verificationGasLimit: 1000000n, // 1M gas for verification
    preVerificationGas: 100000n, // 100K gas for pre-verification
    maxFeePerGas: 1000000000n, // 1 gwei max fee
    maxPriorityFeePerGas: 1000000000n, // 1 gwei priority fee
  };
  
  const userOpHash = await (bundlerClient as any).sendUserOperation({ 
    account, 
    calls, 
    ...gasConfig
  });

  const userOperationReceipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });

  return userOpHash as `0x${string}`;
}


// -------------------- Reputation Registry (ERC-8004-like) via Delegation Toolkit --------------------




export async function giveFeedbackWithDelegation(params: {
  score?: number; // 0..100
  tag1?: `0x${string}`; // bytes32
  tag2?: `0x${string}`; // bytes32
  fileuri?: string;
  filehash?: `0x${string}`; // bytes32
  feedbackAuth?: `0x${string}`; // bytes
  agentAccount?: any; // Smart account configured for the session key
}): Promise<`0x${string}`> {

  const sp = loadSessionPackage();
  const agentId = sp.agentId;


  console.info("*************** sp.agentId", agentId);


  const clientPrivateKey = (process.env.AGENT_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
  if (!clientPrivateKey || !clientPrivateKey.startsWith('0x')) {
    throw new Error('AGENT_EOA_PRIVATE_KEY not set or invalid. Please set a 0x-prefixed 32-byte hex in .env');
  }
  const clientAccount = privateKeyToAccount(clientPrivateKey);
  const clientAddress = clientAccount.address as `0x${string}`;

  


  // construct feedbackAuth

  const zeroBytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
  const score = typeof params.score === 'number' ? Math.max(0, Math.min(100, Math.floor(params.score))) :  93;
  const tag1 = params.tag1 || zeroBytes32;
  const tag2 = params.tag2 || zeroBytes32;
  const feedbackUri = params.fileuri || '';
  const feedbackHash = params.filehash || zeroBytes32;

  // If feedbackAuth not provided, build and sign it (EIP-191 / ERC-1271 verification on-chain)
  let feedbackAuth = (params.feedbackAuth || '0x') as `0x${string}`;
  if (!params.feedbackAuth || params.feedbackAuth === '0x') {

    const walletClient = createWalletClient({ chain: sepolia, transport: http(sp.rpcUrl) }) as any;
    const publicClient = createPublicClient({ chain: sepolia, transport: http(sp.rpcUrl) });


    // signer: agent owner/operator derived from session key
    const ownerEOA = privateKeyToAccount(sp.sessionKey.privateKey);
    



    const rep = await getReputationClientInitialized({
      publicClient,
      walletClient,
      agentAccount: ownerEOA as any,
      reputationRegistry: sp.reputationRegistry as `0x${string}`,
    });






    /*
     * check NFT operator set properly
    try {
      const ownerOfAgent = await publicClient.readContract({
        address: identityReg as `0x${string}`,
        abi: identityRegistryAbi as any,
        functionName: 'ownerOf' as any,
        args: [agentId],
      }) as `0x${string}`;
      const isOperator = await publicClient.readContract({
        address: identityReg as `0x${string}`,
        abi: identityRegistryAbi as any,
        functionName: 'isApprovedForAll' as any,
        args: [ownerOfAgent, sp.sessionAA as `0x${string}`],
      }) as boolean;
      const tokenApproved = await publicClient.readContract({
        address: identityReg as `0x${string}`,
        abi: identityRegistryAbi as any,
        functionName: 'getApproved' as any,
        args: [agentId],
      }) as `0x${string}`;

      console.info('IdentityRegistry approvals:', { ownerOfAgent, isOperator, tokenApproved });
      if (!isOperator && tokenApproved.toLowerCase() !== (sp.sessionAA as string).toLowerCase()) {
        throw new Error(`IdentityRegistry approval missing: neither isApprovedForAll(owner=${ownerOfAgent}, operator=${sp.sessionAA}) nor getApproved(${agentId}) == ${sp.sessionAA}`);
      }
    } catch (e: any) {
      console.warn('[IdentityRegistry] approval check failed:', e?.message || e);
      throw e;
    }
      */


    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const chainId = BigInt(publicClient.chain?.id ?? 0);
    const U64_MAX = 18446744073709551615n;

    const lastIndexFetched = await rep.getLastIndex(BigInt(agentId), clientAddress);
    const lastIndex = lastIndexFetched > U64_MAX ? U64_MAX : lastIndexFetched;
    let indexLimit = (lastIndex + 10n);
    if (indexLimit > U64_MAX) {
      console.warn('[FeedbackAuth] Computed indexLimit exceeds uint64; clamping to max');
      indexLimit = U64_MAX;
    }
    let expiry = nowSec + BigInt(Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600));
    if (expiry > U64_MAX) {
      console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
      expiry = U64_MAX;
    }

    const identityReg = await rep.getIdentityRegistry();
    feedbackAuth = await rep.signFeedbackAuth({
      agentId,
      clientAddress: clientAccount.address as `0x${string}`,
      indexLimit: indexLimit,
      expiry: expiry,
      chainId: chainId,
      identityRegistry: identityReg,
      signerAddress: sp.sessionAA as `0x${string}`,
    }) as `0x${string}`;
    
  }

  console.info("*************** feedbackAuth", feedbackAuth);

  // not give feedback from client account
  const walletClient = createWalletClient({ chain: sepolia, transport: http(sp.rpcUrl) }) as any;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(sp.rpcUrl) });


  // Use official AgenticTrustClient singleton (initializes from env vars automatically)
  console.info("*************** giveFeedback with delegation yyy 1");
  const rep = await getReputationClientInitialized({
    publicClient,
    walletClient,
    clientAccount: clientAccount as any,
    reputationRegistry: sp.reputationRegistry as `0x${string}`,
  });
  const { txHash } = await rep.giveClientFeedback({
    agentId,
    score,
    tag1: tag1 as any,
    tag2: tag2 as any,
    feedbackUri,
    feedbackHash,
    feedbackAuth,
  } as any);
  console.info("*************** giveFeedback with delegation - done 1");

  const receiptClient = createPublicClient({ chain: sepolia, transport: http(sp.rpcUrl) });
  const receipt = await receiptClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

  return txHash as `0x${string}`;

 

}


export async function addFeedback(params: {
  agentId?: bigint;
  domain?: string;
  rating: number; // 1-5 scale
  comment: string;
  feedbackAuthId?: string;
  taskId?: string;
  contextId?: string;
  isReserve?: boolean;
  proofOfPayment?: string;
}): Promise<{
  status: string;
  agentId: string;
  domain: string;
  rating: number;
  comment: string;
  proofOfPayment?: string;
}>{
  const { rating, comment, feedbackAuthId, taskId, contextId, isReserve = false, proofOfPayment } = params;
  
  // Use environment variables or defaults
  const agentId = params.agentId;
  console.info("********************** agentId => agentId", agentId);
  const domain = params.domain || process.env.AGENT_DOMAIN || 'movieclient.localhost:3001';
  
  try {
    console.info('ERC-8004: addFeedback(agentId=%s, domain=%s, rating=%s)', agentId?.toString?.() || 'n/a', domain, rating);
    
    // Get chain ID from environment or default to Sepolia
    const chainId = process.env.ERC8004_CHAIN_ID || '11155111';
    
    const finalFeedbackAuthId = feedbackAuthId || '';
    let onChainTxHash: `0x${string}` | undefined = undefined;

  // Build feedback metadata and upload to IPFS to obtain feedbackUri
  let feedbackUri = '';
  try {
    const feedbackMeta = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#feedback-v1',
      agentId: agentId?.toString?.() || '',
      domain,
      ratingPct: Math.max(0, Math.min(100, rating * 20)),
      comment,
      timestamp: new Date().toISOString(),
    } as any;
    const uploaded = await IpfsService.uploadJson({ data: feedbackMeta, filename: `feedback_${Date.now()}.json` });
    feedbackUri = uploaded.url;
  } catch {}

    // If we have a feedbackAuth and agentId, attempt on-chain submission via Reputation SDK
    if (finalFeedbackAuthId && agentId && agentId > 0n) {
      try {
        const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
        const repReg = (process.env.REPUTATION_REGISTRY || process.env.ERC8004_REPUTATION_REGISTRY || '').trim() as `0x${string}`;
        if (!repReg) throw new Error('REPUTATION_REGISTRY env var is required to submit on-chain feedback');

        const clientPrivateKey = (process.env.AGENT_EOA_PRIVATE_KEY || '').trim() as `0x${string}`;
        if (!clientPrivateKey || !clientPrivateKey.startsWith('0x')) {
          throw new Error('AGENT_EOA_PRIVATE_KEY not set or invalid. Please set a 0x-prefixed 32-byte hex in .env');
        }

        const walletClient = createWalletClient({ chain: sepolia, transport: http(rpcUrl) }) as any;
        const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
        const clientAccount = privateKeyToAccount(clientPrivateKey);

        const rep = await getReputationClientInitialized({
          publicClient,
          walletClient,
          clientAccount: clientAccount as any,
          reputationRegistry: repReg,
        });
        const zeroBytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
        const ratingPctForChain = Math.max(0, Math.min(100, rating * 20));

        console.info(" feedbackUri", feedbackUri);

        const { txHash } = await rep.giveClientFeedback({
          agentId,
          score: ratingPctForChain,
          tag1: zeroBytes32 as any,
          tag2: zeroBytes32 as any,
          feedbackUri,
          feedbackHash: zeroBytes32 as any,
          feedbackAuth: finalFeedbackAuthId as `0x${string}`,
        } as any);
        onChainTxHash = txHash as `0x${string}`;
        console.info('ERC-8004: on-chain feedback submitted, txHash:', onChainTxHash);
      } catch (e: any) {
        console.warn('ERC-8004: on-chain feedback submission skipped/failed:', e?.message || e);
      }
    }
    
    // Determine agent skill ID
    const agentSkillId = isReserve ? 'reserve:v1' : 'finder:v1';
    
    // Convert rating from 1-5 scale to percentage (0-100)
    const ratingPct = Math.max(0, Math.min(100, rating * 20));
    
    
    
    return {
      status: 'ok',
      agentId: (agentId || 0n).toString(),
      domain,
      rating,
      comment,
      ...(onChainTxHash && { proofOfPayment: onChainTxHash as string })
    };
    
  } catch (error: any) {
    console.info('ERC-8004: addFeedback failed:', error?.message || error);
    return {
      status: 'error',
      agentId: (params.agentId || 0n).toString(),
      domain,
      rating,
      comment
    };
  }
}



/* this will always run on client application */
export async function acceptFeedbackWithDelegation(params: {
  clientAccount: any;
  agentName: string;
  feedbackAuth: `0x${string}`;
}): Promise<string> {
  const { clientAccount, agentName, feedbackAuth } = params;


  const rpcUrl = (process.env.RPC_URL || process.env.JSON_RPC_URL || 'https://rpc.sepolia.org');
  const wal = createWalletClient({ chain: sepolia, transport: http(rpcUrl) }) as any;
  const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const repRegRaw = (process.env.REPUTATION_REGISTRY || '').trim();
  if (!repRegRaw) {
    throw new Error('REPUTATION_REGISTRY env var is required to accept feedback');
  }
  let reputationRegistry: `0x${string}`;
  try {
    // Normalize to standard EIP-55 checksum (chain-agnostic) so viem validation passes
    reputationRegistry = getAddress(repRegRaw as `0x${string}`) as `0x${string}`;
  } catch (e: any) {
    throw new Error(`Invalid REPUTATION_REGISTRY address: ${repRegRaw}`);
  }

  // Resolve agentId from the IdentityRegistry using the provided agentName (domain)
  const rep = await getReputationClientInitialized({
    publicClient: pub,
    walletClient: wal,
    clientAccount: clientAccount as any,
    reputationRegistry,
  });
  const identityReg = (await rep.getIdentityRegistry?.()) || (await fetchIdentityRegistry(pub, reputationRegistry));
  const info = await getAgentInfoByDomain({ publicClient: pub, registry: identityReg as `0x${string}`, domain: agentName });
  const agentId = info?.agentId ?? 0n;
  if (!agentId || agentId === 0n) throw new Error(`Agent not found for domain: ${agentName}`);

  // Use provided feedbackAuth; do not derive here
  if (!feedbackAuth || feedbackAuth === '0x') {
    throw new Error('feedbackAuth is required');
  }

  // Use official AgenticTrustClient singleton (initializes from env vars automatically)
  console.info("*************** giveFeedback with delegation yyy 2");
  const { txHash } = await rep.giveClientFeedback({
    agentId,
    score: 100,
    tag1: '',
    tag2: '',
    feedbackUri: '',
    feedbackHash: '',
    feedbackAuth,
  } as any);
  console.info("*************** giveFeedback with delegation - done 2");

  return "success"
}


/* this will always run on server application */
export async function getFeedbackAuthId(params: {
  clientAddress: string;
}): Promise<string | null> {

  const { clientAddress } = params;


  const sp = loadSessionPackage();
  const agentId = sp.agentId;
  
  let feedbackAuth = ('0x') as `0x${string}`;


  const walletClient = createWalletClient({ chain: sepolia, transport: http(sp.rpcUrl) }) as any;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(sp.rpcUrl) });
  
  // signer: agent owner/operator derived from session key
  const ownerEOA = privateKeyToAccount(sp.sessionKey.privateKey);
  


  // Use AgenticTrustClient singleton (provider mode)
  const ensRegistry = (process.env.ENS_REGISTRY || process.env.NEXT_PUBLIC_ENS_REGISTRY || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as `0x${string}`;
  /*
  await initAgenticTrustClientProvider({
    publicClient: publicClient as any,
    walletClient: walletClient as any,
    agentAccount: signerSmartAccount as any,
    reputationRegistry: sp.reputationRegistry as `0x${string}`,
    ensRegistry,
  });
  */

  const rep = await getReputationClientInitialized({
    publicClient,
    walletClient,
    agentAccount: ownerEOA as any,
    reputationRegistry: sp.reputationRegistry as `0x${string}`,
  });

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const chainId = BigInt(publicClient.chain?.id ?? 0);
  const U64_MAX = 18446744073709551615n;

  const lastIndexFetched = await rep.getLastIndex(BigInt(agentId), clientAddress);
  const lastIndex = lastIndexFetched > U64_MAX ? U64_MAX : lastIndexFetched;
  let indexLimit = (lastIndex + 10n);
  if (indexLimit > U64_MAX) {
    console.warn('[FeedbackAuth] Computed indexLimit exceeds uint64; clamping to max');
    indexLimit = U64_MAX;
  }
  let expiry = nowSec + BigInt(Number(process.env.ERC8004_FEEDBACKAUTH_TTL_SEC || 3600));
  if (expiry > U64_MAX) {
    console.warn('[FeedbackAuth] Computed expiry exceeds uint64; clamping to max');
    expiry = U64_MAX;
  }

  const identityReg = await rep.getIdentityRegistry();
  feedbackAuth = await rep.signFeedbackAuth({
    agentId,
    clientAddress: clientAddress as `0x${string}`,
    indexLimit: indexLimit,
    expiry: expiry,
    chainId: chainId,
    identityRegistry: identityReg as `0x${string}`,
    signerAddress: sp.sessionAA as `0x${string}`,
  }) as `0x${string}`;
    
  return feedbackAuth
  
}


// Helper to serialize BigInt values for JSON.stringify
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }
  return obj;
}

// Skill implementation: agent.feedback.requestAuth
export async function requestFeedbackAuth(params: {
  agentId?: bigint;
  clientAddress: `0x${string}`;
  taskRef?: string; // optional external binding
  chainId?: number;
  indexLimit?: bigint;
  expirySeconds?: number;
}): Promise<{ signature: `0x${string}`; signerAddress: `0x${string}` }> {
  // Serialize BigInt values before logging
  const serializableParams = serializeBigInt(params);
  console.info(`********* [MovieAgent] requestAuthabcasss: ${JSON.stringify(serializableParams)}`);

  const client = await getAgenticTrustClient();

  console.info("........... load session package ");
  const sessionPackage = loadSessionPackage();
  console.info("........... sessionPackage ........ 1234: ", sessionPackage);
  const agentIdForRequest = sessionPackage.agentId.toString();

  console.info("........... agentIdForRequest ........ 1234: ", agentIdForRequest);
  const agent = agentIdForRequest ? await client.agents.getAgent(agentIdForRequest) : null;
  console.info("........... agent ........ 1234: ", agent);
  console.info("........... sp.agentId ........ 1234: ", sp.agentId);
  console.info("........... params.clientAddress ........ 1234: ", params.clientAddress);
          
  const feedbackAuthResponse = await agent.feedback.requestAuth({
    clientAddress: params.clientAddress,
    agentId: sp.agentId,
    skillId: 'agent.feedback.requestAuth',
    expirySeconds: params.expirySeconds
  });
  console.info("........... feedbackAuthResponse ........ 1234: ", feedbackAuthResponse);



  return { signature: feedbackAuthResponse.feedbackAuth, signerAddress: sp.sessionAA as `0x${string}` };
}
