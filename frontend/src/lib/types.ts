export const VERDICT_NAMES = [
  "Continue",
  "Warn",
  "ConstrainCap",
  "Revoke",
  "UnlockMilestone",
] as const;

export type VerdictName = (typeof VERDICT_NAMES)[number];
export type KillSwitchStatus = "ACTIVE" | "DISABLED";

export type AgentSnapshot = {
  ok: true;
  connected: true;
  rpc: string;
  chainId: number;
  blockNumber: number;
  contractAddress: string;
  addressSource: string;
  agentId: number;
  agentCount: number;
  wallet: string;
  principal: string;
  mandate: string;
  mandateHash: string;
  spendCapWei: string;
  spendCapUsd: string;
  expiresAt: number;
  deadline: number;
  erc7710DelegationHash: string;
  delegationManager: string;
  paused: boolean;
  registered: boolean;
  awaitingVerdict: boolean;
  nonce: string;
  warningCount: number;
  threatScore: number;
  threatThreshold: number;
  approvedNextSpendUsd: string;
  lastSubmissionId: string;
  approvedDestination: string;
  lastVerdict: VerdictName;
  killSwitchStatus: KillSwitchStatus;
  canProceed: boolean;
  canProceedReason: string;
  fetchedAt: string;
};

export type AgentError = {
  ok: false;
  connected: boolean;
  rpc: string;
  contractAddress?: string;
  error: string;
  detail?: string;
  fetchedAt: string;
};

export type AgentResponse = AgentSnapshot | AgentError;
