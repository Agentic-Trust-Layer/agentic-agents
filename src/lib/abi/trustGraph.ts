import type { Abi } from "viem";

export const trustGraphAbi = [
    // Write API
    {
      type: 'function',
      name: 'createTrustAtom',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'target', type: 'bytes32' },
        { name: 'content', type: 'string' },
        { name: 'valueText', type: 'string' },
        {
          name: 'extra',
          type: 'tuple[]',
          components: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'string' },
          ],
        },
      ],
      outputs: [
        {
          name: 'atom',
          type: 'tuple',
          components: [
            { name: 'source', type: 'address' },
            { name: 'target', type: 'bytes32' },
            { name: 'content', type: 'string' },
            { name: 'valueText', type: 'string' },
            { name: 'extraHash', type: 'bytes32' },
            { name: 'timestamp', type: 'uint256' },
          ],
        },
      ],
    },
    // Read API
    {
      type: 'function',
      name: 'getExtra',
      stateMutability: 'view',
      inputs: [
        { name: 'extraHash', type: 'bytes32' },
      ],
      outputs: [
        {
          name: '',
          type: 'tuple[]',
          components: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'string' },
          ],
        },
      ],
    },
    {
      type: 'function',
      name: 'listSourcesByTarget',
      stateMutability: 'view',
      inputs: [
        { name: 'target', type: 'bytes32' },
      ],
      outputs: [
        { name: '', type: 'address[]' },
      ],
    },
    {
      type: 'function',
      name: 'listTargetsBySource',
      stateMutability: 'view',
      inputs: [
        { name: 'source', type: 'address' },
      ],
      outputs: [
        { name: '', type: 'bytes32[]' },
      ],
    },
    // Events
    {
      type: 'event',
      name: 'TrustAtomCreated',
      anonymous: false,
      inputs: [
        { name: 'source', type: 'address', indexed: true },
        { name: 'target', type: 'bytes32', indexed: true },
        { name: 'content', type: 'string', indexed: false },
        { name: 'valueText', type: 'string', indexed: false },
        { name: 'extraHash', type: 'bytes32', indexed: true },
        { name: 'timestamp', type: 'uint256', indexed: false },
      ],
    },
  ] as const satisfies Abi;

