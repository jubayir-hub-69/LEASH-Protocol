export type KillSwitchStatus = "ACTIVE" | "DISABLED";

export type AgentSnapshot = {
  ok: true;
  connected: true;
  rpc: string;
  chainId: number;
  blockNumber: number | null;
  contractAddress: string;
  addressSource: string;
  mandate: string;
  spendCap: string;
  spendCapUsd: string;
  deadline: number;
  deadlineOpen: boolean;
  expired: boolean;
  canProceed: boolean;
  canProceedReason: string;
  killSwitchStatus: KillSwitchStatus;
  constructorParams: string[];
  methodCount: number;
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
