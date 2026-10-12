import type { Action, ActionType } from '../model/types';

/** Presentation groups only; stored action types and encodings stay distinct. */
export const ACTION_FAMILIES = {
  keyTap: ['keyTap', 'keyHold'],
  consumer: ['consumer', 'consumerHold'],
  consumerModified: ['consumerModified', 'consumerModifiedHold'],
  setLayer: ['setLayer', 'oneShotSetLayer', 'momentaryLayer'],
  relativeLayer: ['relativeLayer', 'oneShotRelativeLayer', 'momentaryRelativeLayer'],
} as const;

export type KeyAction = Extract<Action, { type: typeof ACTION_FAMILIES.keyTap[number] }>;
export function isKeyAction(action: Action): action is KeyAction {
  return actionFamilyType(action.type) === 'keyTap';
}

export function actionFamilyType(type: ActionType): ActionType {
  for (const [family, types] of Object.entries(ACTION_FAMILIES)) {
    if ((types as readonly ActionType[]).includes(type)) return family as ActionType;
  }
  return type;
}

export type MediaAction = Extract<Action, { type: typeof ACTION_FAMILIES.consumer[number] | typeof ACTION_FAMILIES.consumerModified[number] }>;
export function isMediaAction(action: Action): action is MediaAction {
  return actionFamilyType(action.type) === 'consumer' || actionFamilyType(action.type) === 'consumerModified';
}

export type LayerAction = Extract<Action, { type: typeof ACTION_FAMILIES.setLayer[number] | typeof ACTION_FAMILIES.relativeLayer[number] }>;
export function isLayerAction(action: Action): action is LayerAction {
  return actionFamilyType(action.type) === 'setLayer' || actionFamilyType(action.type) === 'relativeLayer';
}
