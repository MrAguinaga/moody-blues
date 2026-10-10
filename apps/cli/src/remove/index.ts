export { createRemoveClients, type CreateRemoveClientsOptions } from './remove.context';
export { buildRemovePlan } from './remove.plan';
export { findTitleByExternalId, findTitles, normalizeText } from './remove.search';
export { readLibrary, runRemove, type RunRemoveOptions } from './remove.service';
export type {
  KeptTorrent,
  RemoveClients,
  RemoveKind,
  RemoveLibrary,
  RemovePlan,
  RemoveResult,
  RemoveStepId,
  RemoveStepResult,
  RemoveStepStatus,
  RemoveTarget,
  RemoveTorrent,
} from './remove.types';
