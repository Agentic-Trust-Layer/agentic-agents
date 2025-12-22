/**
 * Runtime session package loader for both Node and Cloudflare Workers.
 *
 * IMPORTANT:
 * - Cloudflare Workers cannot rely on filesystem paths.
 * - We load the session package from the secret/env var: AGENTIC_TRUST_SESSION_PACKAGE_JSON
 * - Supports either raw JSON or base64-encoded JSON ("base64:<...>" or plain base64).
 */

function getRuntimeEnvValue(key) {
  const runtimeEnv = globalThis?.MOVIE_AGENT_ENV;
  const v = runtimeEnv?.[key] ?? (typeof process !== 'undefined' ? process?.env?.[key] : undefined);
  return typeof v === 'string' ? v : undefined;
}

function requireRuntimeEnvValue(key) {
  const v = (getRuntimeEnvValue(key) || '').trim();
  if (!v) throw new Error(`Missing required environment variable: ${key}`);
  return v;
}

function decodeBase64ToString(b64) {
  if (typeof globalThis?.atob === 'function') return globalThis.atob(b64);
  // Buffer is available in Node and in Workers with nodejs_compat.
  // eslint-disable-next-line no-undef
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function parseSessionPackageJson(raw) {
  const trimmed = (raw || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (e1) {
    const b64 = trimmed.startsWith('base64:') ? trimmed.slice('base64:'.length).trim() : trimmed;
    try {
      const decoded = decodeBase64ToString(b64);
      return JSON.parse(decoded);
    } catch (e2) {
      throw new Error(
        `Invalid AGENTIC_TRUST_SESSION_PACKAGE_JSON: ${e1?.message || e1}. ` +
          `Also tried base64 decoding but failed: ${e2?.message || e2}`,
      );
    }
  }
}

export function loadSessionPackage() {
  const raw = requireRuntimeEnvValue('AGENTIC_TRUST_SESSION_PACKAGE_JSON');
  return parseSessionPackageJson(raw);
}

export function validateSessionPackage(pkg) {
  if (!pkg?.chainId) throw new Error('sessionPackage.chainId is required');
  if (!pkg?.aa) throw new Error('sessionPackage.aa is required');
  if (!pkg?.entryPoint) throw new Error('sessionPackage.entryPoint is required');
  if (!pkg?.bundlerUrl) throw new Error('sessionPackage.bundlerUrl is required');
  if (!pkg?.sessionKey?.privateKey || !pkg?.sessionKey?.address) {
    throw new Error('sessionPackage.sessionKey.privateKey and address are required');
  }
  if (!pkg?.signedDelegation?.signature) {
    throw new Error('sessionPackage.signedDelegation.signature is required');
  }
}

// Simplified session management for Cloudflare Pages
/*
export function buildDelegationSetup() {
  // Simplified implementation for Cloudflare Pages
  return {
    agentId: 11,
    chainId: 11155111,
    rpcUrl: process.env.RPC_URL || 'https://rpc.sepolia.org',
    bundlerUrl: process.env.BUNDLER_URL || '',
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    aa: '0x' + '0'.repeat(40),
    sessionAA: '0x' + '0'.repeat(40),
    reputationRegistry: '0x' + '0'.repeat(40),
    selector: '0x' + '0'.repeat(8),
    sessionKey: {
      privateKey: '0x' + '0'.repeat(64),
      address: '0x' + '0'.repeat(40),
      validAfter: 0,
      validUntil: 0
    },
    signedDelegation: {
      message: {
        delegate: '0x' + '0'.repeat(40),
        delegator: '0x' + '0'.repeat(40),
        authority: '0x' + '0'.repeat(40),
        caveats: [],
        salt: '0x' + '0'.repeat(64),
        signature: '0x' + '0'.repeat(130)
      },
      signature: '0x' + '0'.repeat(130)
    }
  };
}
  */
