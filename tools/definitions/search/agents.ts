import { agentIds } from "../../../agents";

export const isSpectre = (agent: string): boolean => agentIds.some((one) => one === agent);
