import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SettingPage from './setting.tsx'

function RootRouter() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const handlePop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handlePop)

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
      window.removeEventListener('popstate', handlePop)
      history.pushState = originalPush
      history.replaceState = originalReplace
    }
  }, [])

  if (path === '/setting') {
    return <SettingPage />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRouter />
  </StrictMode>,
)
