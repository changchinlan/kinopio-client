export const localServerEnabled = import.meta.env.VITE_LOCAL_SERVER === 'true'
export const localApi = (path) => `/local-api${path}`

// Canvas mutations the local SQLite server owns. Account/preferences stay in IndexedDB.
export const localCanvasOperations = new Set([
  'createSpace', 'updateSpace', 'removeSpace', 'deleteSpace', 'deleteAllRemovedSpaces',
  'createCard', 'updateCard', 'deleteCard', 'restoreRemovedCard', 'deleteAllRemovedCards',
  'createConnection', 'updateConnection', 'removeConnection',
  'createBox', 'updateBox', 'removeBox',
  'createList', 'updateList', 'removeList',
  'createLine', 'updateLine', 'removeLine',
  'createDrawingStroke', 'removeDrawingStroke', 'clearDrawing',
  'updateTags', 'removeTag', 'removeTagsByName', 'updateTagColorByName'
])

// Account preferences and notifications remain browser-local. Everything else
// reaches the server and is either committed or visibly rejected as unsupported.
export const localUiOperations = new Set([
  'updateUser', 'updateFavoriteSpace', 'updateFavoriteUser', 'updateFavoriteColor',
  'updateUserCardsCreatedCount', 'updateUserCardsCreatedCountRaw', 'updateSpaceIsHidden',
  'updateUserVisitSpaces', 'createUserNotification', 'removeUserNotification',
  'updateNotificationsIsRead'
])
