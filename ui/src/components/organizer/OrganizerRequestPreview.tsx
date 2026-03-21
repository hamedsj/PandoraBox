import { useEffect } from 'react'
import { useProxyStore } from '@/store/proxy'
import { RequestInspector } from '@/components/inspector/RequestInspector'

interface Props {
  requestId: number
}

export function OrganizerRequestPreview({ requestId }: Props) {
  const setSelectedRequestId = useProxyStore((s) => s.setSelectedRequestId)

  useEffect(() => {
    setSelectedRequestId(requestId)
    return () => setSelectedRequestId(null)
  }, [requestId, setSelectedRequestId])

  return <RequestInspector />
}
