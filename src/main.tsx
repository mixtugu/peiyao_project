import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SettingPage from './setting.tsx'

function getRoute(): string {
  // Try hash first (for static hosting without SPA rewrites)
  // Accept forms like "#/setting" or "#setting" → normalize to "/setting"
  const rawHash = window.location.hash
  if (rawHash) {
    const h = rawHash.replace(/^#/, '')
    if (h.startsWith('/')) return h
    if (h.length > 0) return `/${h}`
  }

  // Fallback to pathname (local dev or servers with proper rewrites)
  const base = (import.meta as any).env?.BASE_URL ?? '/'
  // Ensure we strip the base when app is served under a sub-path
  let path = window.location.pathname
  if (base !== '/' && path.startsWith(base)) {
    path = path.slice(base.length - 1) // keep leading '/'
  }
  return path || '/'
}

function RootRouter() {
  const [route, setRoute] = useState<string>(getRoute())

  useEffect(() => {
    const onPop = () => setRoute(getRoute())
    const onHash = () => setRoute(getRoute())

    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onHash)

    const originalPush = history.pushState
    const originalReplace = history.replaceState

    history.pushState = function (...args) {
      // @ts-ignore
      originalPush.apply(this, args)
      window.dispatchEvent(new Event('popstate'))
    }
    history.replaceState = function (...args) {
      // @ts-ignore
      originalReplace.apply(this, args)
      window.dispatchEvent(new Event('popstate'))
    }

    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onHash)
      history.pushState = originalPush
      history.replaceState = originalReplace
    }
  }, [])

  // If either pathname is "/setting" (dev/SSR) or hash is "#/setting" (static), render settings
  if (route === '/setting') {
    return <SettingPage />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>,
)
