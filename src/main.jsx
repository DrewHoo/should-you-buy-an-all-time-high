import React from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Built pages arrive prerendered (scripts/prerender.mjs) with the ticker
// list the markup was rendered from; hydrate onto that markup rather than
// throwing it away. The dev server serves an empty #root, so render fresh.
const root = document.getElementById('root')
const seed = document.getElementById('initial-index')
const app = <App initialIndex={seed ? JSON.parse(seed.textContent) : null} />

if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)
