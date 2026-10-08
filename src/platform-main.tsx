import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PlatformApp } from './platform/PlatformApp'
import './platform/platform.css'

const root = document.getElementById('root')
if (!root) throw new Error('HomePlanner platform root was not found.')
createRoot(root).render(<StrictMode><PlatformApp /></StrictMode>)
