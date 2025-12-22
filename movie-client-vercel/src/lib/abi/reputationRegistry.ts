import type { Abi } from "viem";

export const reputationRegistryAbi: Abi = [
  {
    type: "function",
    name: "getIdentityRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
  },
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "uint8", name: "score", type: "uint8" },
      { internalType: "bytes32", name: "tag1", type: "bytes32" },
      { internalType: "bytes32", name: "tag2", type: "bytes32" },
      { internalType: "string", name: "feedbackUri", type: "string" },
      { internalType: "bytes32", name: "feedbackHash", type: "bytes32" },
      { internalType: "bytes", name: "feedbackAuth", type: "bytes" },
    ],
    outputs: [],
  },
];


