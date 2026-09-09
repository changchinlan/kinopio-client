const cardFields = ['name', 'x', 'y', 'backgroundColor', 'width', 'height']

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const hasOnlyFields = (value, fields) => Object.keys(value).every(key => fields.includes(key))
const isNumber = value => typeof value === 'number' && Number.isFinite(value)

export const resolveIdPrefix = (items, prefix) => {
  const exact = items.find(item => item.id === prefix)
  if (exact) return { item: exact }
  const matches = items.filter(item => item.id.startsWith(prefix))
  if (matches.length === 1) return { item: matches[0] }
  if (!matches.length) return { error: `No current-space item matches ID prefix: ${prefix}` }
  return { error: `Ambiguous ID prefix ${prefix}: ${matches.map(item => item.id).join(', ')}` }
}

const validateCardFields = (params, required = []) => {
  if (!isObject(params) || !hasOnlyFields(params, cardFields.concat(['id']))) {
    return 'invalid card fields'
  }
  if (required.some(field => params[field] === undefined)) {
    return `missing ${required.join(', ')}`
  }
  if (params.name !== undefined && typeof params.name !== 'string') return 'name must be a string'
  if (params.backgroundColor !== undefined && typeof params.backgroundColor !== 'string') return 'backgroundColor must be a string'
  for (const field of ['x', 'y', 'width', 'height']) {
    if (params[field] !== undefined && !isNumber(params[field])) return `${field} must be a number`
  }
}

export const validateCommand = command => {
  if (!isObject(command) || typeof command.id !== 'string' || !command.id || command.id.length > 128) {
    return 'id must be a non-empty string up to 128 characters'
  }
  if (typeof command.action !== 'string') return 'action must be a string'

  const { params } = command
  if (command.action === 'snapshot') {
    return isObject(params) && Object.keys(params).length === 0 ? undefined : 'snapshot takes no parameters'
  }
  if (command.action === 'card.create') return validateCardFields(params)
  if (command.action === 'card.update') {
    const error = validateCardFields(params, ['id'])
    if (error) return error
    if (typeof params.id !== 'string' || !params.id) return 'id must be a non-empty string'
    return Object.keys(params).length > 1 ? undefined : 'no card fields to update'
  }
  if (command.action === 'card.move') {
    if (!isObject(params) || !hasOnlyFields(params, ['id', 'x', 'y'])) return 'invalid move fields'
    if (typeof params.id !== 'string' || !params.id) return 'id must be a non-empty string'
    if (!isNumber(params.x) || !isNumber(params.y)) return 'x and y must be numbers'
    return undefined
  }
  if (command.action === 'connection.create') {
    if (!isObject(params) || !hasOnlyFields(params, ['startItemId', 'endItemId', 'name'])) return 'invalid connection fields'
    if (typeof params.startItemId !== 'string' || typeof params.endItemId !== 'string') return 'connection item IDs must be strings'
    if (!params.startItemId || !params.endItemId) return 'connection item IDs must be non-empty'
    if (params.name !== undefined && typeof params.name !== 'string') return 'name must be a string'
    return undefined
  }
  return `unsupported action: ${command.action}`
}
