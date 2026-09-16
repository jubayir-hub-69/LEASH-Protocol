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
  killSwitch: boolean;
  frozen: boolean;
  lastVerdict: string;
  lastReason: string;
  lastAction: string;
  lastReceipts: string;
  lastSpend: string;
  approvedNextSpend: string;
  threatScore: string;
  threatThreshold: string;
  submissionCount: string;
  owner: string;
  constructorParams: string[];
  methodCount: number;
  methods: string[];
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

export type JuryWriteResult = {
  ok: boolean;
  functionName: string;
  txHash?: string;
  status?: string;
  result?: string;
  state?: AgentSnapshot;
  error?: string;
  detail?: string;
};
