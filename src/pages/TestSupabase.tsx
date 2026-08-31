import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function TestSupabase() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [data, setData] = useState<unknown | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        setStatus('error')
        setErrorMessage(error.message)
        return
      }

      setStatus('success')
      setData({
        connected: true,
        hasSession: Boolean(data.session),
      })
    }

    testConnection()
  }, [])

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (status === 'error') {
    return <div>{errorMessage}</div>
  }

  return (
    <div>
      <div>Connected successfully</div>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}
