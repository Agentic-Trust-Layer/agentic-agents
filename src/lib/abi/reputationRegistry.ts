import type { Abi } from "viem";

export const reputationRegistryAbi = [
    // Constructor
    {
      type: 'constructor',
      stateMutability: 'nonpayable',
      inputs: [
        { internalType: 'address', name: '_identityRegistry', type: 'address' },
      ],
    },
    // Errors
    {
      type: 'error',
      name: 'ECDSAInvalidSignature',
      inputs: [],
    },
    {
      type: 'error',
      name: 'ECDSAInvalidSignatureLength',
      inputs: [
        { internalType: 'uint256', name: 'length', type: 'uint256' },
      ],
    },
    {
      type: 'error',
      name: 'ECDSAInvalidSignatureS',
      inputs: [
        { internalType: 'bytes32', name: 's', type: 'bytes32' },
      ],
    },
    // Events
    {
      type: 'event',
      name: 'FeedbackRevoked',
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
        { indexed: true, internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
      ],
    },
    {
      type: 'event',
      name: 'NewFeedback',
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
        { indexed: false, internalType: 'uint8', name: 'score', type: 'uint8' },
        { indexed: true, internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
        { indexed: false, internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
        { indexed: false, internalType: 'string', name: 'feedbackUri', type: 'string' },
        { indexed: false, internalType: 'bytes32', name: 'feedbackHash', type: 'bytes32' },
      ],
    },
    {
      type: 'event',
      name: 'ResponseAppended',
      anonymous: false,
      inputs: [
        { indexed: true, internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { indexed: true, internalType: 'address', name: 'clientAddress', type: 'address' },
        { indexed: false, internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
        { indexed: true, internalType: 'address', name: 'responder', type: 'address' },
        { indexed: false, internalType: 'string', name: 'responseUri', type: 'string' },
        { indexed: false, internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
      ],
    },
    // Write API
    {
      type: 'function',
      name: 'appendResponse',
      stateMutability: 'nonpayable',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address', name: 'clientAddress', type: 'address' },
        { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
        { internalType: 'string', name: 'responseUri', type: 'string' },
        { internalType: 'bytes32', name: 'responseHash', type: 'bytes32' },
      ],
      outputs: [],
    },
    {
      type: 'function',
      name: 'giveFeedback',
      stateMutability: 'nonpayable',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'uint8', name: 'score', type: 'uint8' },
        { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
        { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
        { internalType: 'string', name: 'feedbackUri', type: 'string' },
        { internalType: 'bytes32', name: 'feedbackHash', type: 'bytes32' },
        { internalType: 'bytes', name: 'feedbackAuth', type: 'bytes' },
      ],
      outputs: [],
    },
    {
      type: 'function',
      name: 'revokeFeedback',
      stateMutability: 'nonpayable',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
      ],
      outputs: [],
    },
    // Read API
    {
      type: 'function',
      name: 'getClients',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
      ],
      outputs: [
        { internalType: 'address[]', name: '', type: 'address[]' },
      ],
    },
    {
      type: 'function',
      name: 'getIdentityRegistry',
      stateMutability: 'view',
      inputs: [],
      outputs: [
        { internalType: 'address', name: '', type: 'address' },
      ],
    },
    {
      type: 'function',
      name: 'getLastIndex',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address', name: 'clientAddress', type: 'address' },
      ],
      outputs: [
        { internalType: 'uint64', name: '', type: 'uint64' },
      ],
    },
    {
      type: 'function',
      name: 'getResponseCount',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address', name: 'clientAddress', type: 'address' },
        { internalType: 'uint64', name: 'feedbackIndex', type: 'uint64' },
        { internalType: 'address[]', name: 'responders', type: 'address[]' },
      ],
      outputs: [
        { internalType: 'uint64', name: 'count', type: 'uint64' },
      ],
    },
    {
      type: 'function',
      name: 'getSummary',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' },
        { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
        { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
      ],
      outputs: [
        { internalType: 'uint64', name: 'count', type: 'uint64' },
        { internalType: 'uint8', name: 'averageScore', type: 'uint8' },
      ],
    },
    {
      type: 'function',
      name: 'readAllFeedback',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address[]', name: 'clientAddresses', type: 'address[]' },
        { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
        { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
        { internalType: 'bool', name: 'includeRevoked', type: 'bool' },
      ],
      outputs: [
        { internalType: 'address[]', name: 'clients', type: 'address[]' },
        { internalType: 'uint8[]', name: 'scores', type: 'uint8[]' },
        { internalType: 'bytes32[]', name: 'tag1s', type: 'bytes32[]' },
        { internalType: 'bytes32[]', name: 'tag2s', type: 'bytes32[]' },
        { internalType: 'bool[]', name: 'revokedStatuses', type: 'bool[]' },
      ],
    },
    {
      type: 'function',
      name: 'readFeedback',
      stateMutability: 'view',
      inputs: [
        { internalType: 'uint256', name: 'agentId', type: 'uint256' },
        { internalType: 'address', name: 'clientAddress', type: 'address' },
        { internalType: 'uint64', name: 'index', type: 'uint64' },
      ],
      outputs: [
        { internalType: 'uint8', name: 'score', type: 'uint8' },
        { internalType: 'bytes32', name: 'tag1', type: 'bytes32' },
        { internalType: 'bytes32', name: 'tag2', type: 'bytes32' },
        { internalType: 'bool', name: 'isRevoked', type: 'bool' },
      ],
    },
  ] as const satisfies Abi;