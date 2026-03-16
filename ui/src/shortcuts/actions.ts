export type ShortcutActionId =
  | 'app.gotoIntercept'
  | 'app.gotoHistory'
  | 'app.gotoScope'
  | 'app.gotoSitemap'
  | 'app.gotoReplay'
  | 'app.gotoSettings'
  | 'common.openFilters'
  | 'common.closeCurrent'
  | 'common.sendSelectedToReplay'
  | 'common.escape'
  | 'intercept.toggleEnabled'
  | 'intercept.forwardSelected'
  | 'intercept.dropSelected'
  | 'intercept.toggleEditMode'
  | 'intercept.applyAndForward'
  | 'intercept.selectPrev'
  | 'intercept.selectNext'
  | 'replay.send'

export interface ShortcutDefinition {
  id: ShortcutActionId
  label: string
  description: string
  group: 'Navigation' | 'Common' | 'Intercept' | 'Replay'
}

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: 'app.gotoIntercept',
    label: 'Go to Intercept',
    description: 'Open the Intercept page.',
    group: 'Navigation',
  },
  {
    id: 'app.gotoHistory',
    label: 'Go to History',
    description: 'Open the History page.',
    group: 'Navigation',
  },
  {
    id: 'app.gotoScope',
    label: 'Go to Scope',
    description: 'Open the Scope page.',
    group: 'Navigation',
  },
  {
    id: 'app.gotoSitemap',
    label: 'Go to SiteMap',
    description: 'Open the SiteMap page.',
    group: 'Navigation',
  },
  {
    id: 'app.gotoReplay',
    label: 'Go to Replay',
    description: 'Open the Replay page.',
    group: 'Navigation',
  },
  {
    id: 'app.gotoSettings',
    label: 'Go to Settings',
    description: 'Open the Settings page.',
    group: 'Navigation',
  },
  {
    id: 'common.openFilters',
    label: 'Open Filters',
    description: 'Open the filter modal in History or SiteMap.',
    group: 'Common',
  },
  {
    id: 'common.closeCurrent',
    label: 'Close Current',
    description: 'Close the currently open request, editor, or modal.',
    group: 'Common',
  },
  {
    id: 'common.sendSelectedToReplay',
    label: 'Send Selected To Replay',
    description: 'Send the selected request to Replay and open the page.',
    group: 'Common',
  },
  {
    id: 'common.escape',
    label: 'Cancel Current Context',
    description: 'Close the active modal or clear the current selection.',
    group: 'Common',
  },
  {
    id: 'intercept.toggleEnabled',
    label: 'Toggle Intercept',
    description: 'Enable or disable interception.',
    group: 'Intercept',
  },
  {
    id: 'intercept.forwardSelected',
    label: 'Forward Selected Intercept Request',
    description: 'Forward the selected held request.',
    group: 'Intercept',
  },
  {
    id: 'intercept.dropSelected',
    label: 'Drop Selected Intercept Request',
    description: 'Drop the selected held request.',
    group: 'Intercept',
  },
  {
    id: 'intercept.toggleEditMode',
    label: 'Toggle Intercept Edit Mode',
    description: 'Switch the selected held request into edit mode.',
    group: 'Intercept',
  },
  {
    id: 'intercept.applyAndForward',
    label: 'Apply Intercept Changes And Forward',
    description: 'Send the modified held request upstream.',
    group: 'Intercept',
  },
  {
    id: 'intercept.selectPrev',
    label: 'Select Previous Held Request',
    description: 'Move to the previous held request in the queue.',
    group: 'Intercept',
  },
  {
    id: 'intercept.selectNext',
    label: 'Select Next Held Request',
    description: 'Move to the next held request in the queue.',
    group: 'Intercept',
  },
  {
    id: 'replay.send',
    label: 'Send Replay',
    description: 'Send the selected replay request.',
    group: 'Replay',
  },
]

export const defaultShortcutBindings: Record<ShortcutActionId, string> = {
  'app.gotoIntercept': 'Alt+1',
  'app.gotoHistory': 'Alt+2',
  'app.gotoScope': 'Alt+3',
  'app.gotoSitemap': 'Alt+4',
  'app.gotoReplay': 'Alt+5',
  'app.gotoSettings': 'Alt+6',
  'common.openFilters': 'Mod+F',
  'common.closeCurrent': 'Mod+W',
  'common.sendSelectedToReplay': 'Mod+R',
  'common.escape': 'Escape',
  'intercept.toggleEnabled': 'Mod+Shift+I',
  'intercept.forwardSelected': 'Mod+Shift+F',
  'intercept.dropSelected': 'Mod+Shift+D',
  'intercept.toggleEditMode': 'Mod+Shift+M',
  'intercept.applyAndForward': 'Mod+Enter',
  'intercept.selectPrev': 'Alt+ArrowUp',
  'intercept.selectNext': 'Alt+ArrowDown',
  'replay.send': 'Mod+Enter',
}
