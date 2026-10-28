import type { AttentionItem, AttentionState, Observation, Transition } from "@asmodeus/contracts";

/** Latest observation of an entity, as kept by the store (ADR-0008). */
export type StoredObservation = Observation & {
  collectorId: string;
  /** When the entity entered its current status. */
  statusSince: string;
};

export type CollectorState = {
  id: string;
  type: string;
  ok: boolean;
  error: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Start of the current failure streak, null while healthy. */
  failingSince: string | null;
};

export type NewAttentionItem = Omit<AttentionItem, "id">;
export type AttentionPatch = Partial<
  Omit<AttentionItem, "id" | "ruleId" | "entityKey" | "collectorId" | "origin" | "openedAt">
>;

/**
 * Persistence port (ADR-0007). Async so that a Postgres adapter can implement it.
 * Timestamps are ISO 8601 strings; adapters normalise them on write.
 */
export interface Store {
  listObservations(filter?: { collectorId?: string }): Promise<StoredObservation[]>;
  putObservation(observation: StoredObservation): Promise<void>;
  deleteObservations(entityKeys: string[]): Promise<void>;

  appendTransition(transition: Transition): Promise<void>;
  /** Newest first. */
  listTransitions(query: { since: string }): Promise<Transition[]>;
  /** Deletes transitions strictly older than `before`; returns how many. */
  purgeTransitions(before: string): Promise<number>;

  putCollectorState(state: CollectorState): Promise<void>;
  listCollectorStates(): Promise<CollectorState[]>;

  insertAttentionItem(item: NewAttentionItem): Promise<AttentionItem>;
  updateAttentionItem(id: string, patch: AttentionPatch): Promise<AttentionItem>;
  getAttentionItem(id: string): Promise<AttentionItem | null>;
  /** Most recently opened item for this rule and entity, whatever its state. */
  latestAttentionItem(ruleId: string, entityKey: string): Promise<AttentionItem | null>;
  listAttentionItems(query?: { states?: AttentionState[]; collectorId?: string }): Promise<AttentionItem[]>;

  close(): Promise<void>;
}
