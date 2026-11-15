import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyTheme, getThemePreference } from '@/lib/theme'

// index.html already painted the right theme; this keeps "Automático" following the system live
applyTheme(getThemePreference())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
