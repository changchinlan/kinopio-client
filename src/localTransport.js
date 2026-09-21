import { localApi } from '@/localServer.js'

export const canApplyLocalSnapshot = ({ targetId, activeTargetId, reconciliation, startedGeneration, currentGeneration, queueIdle }) => {
  if (targetId !== activeTargetId) return false
  if (!queueIdle) return false
  return !reconciliation || startedGeneration === currentGeneration
}

export const postLocalOperations = async ({ operations, requestOptions, fetchImpl = fetch }) => {
  const options = await requestOptions({ body: operations, method: 'POST' })
  return fetchImpl(localApi('/operations'), options)
}
