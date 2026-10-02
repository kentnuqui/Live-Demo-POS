import { useEffect, useState } from 'react'

/** True when the window is wide enough to show a list and its detail side by side. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const apply = () => setWide(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return wide
}
