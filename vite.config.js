import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/should-you-buy-an-all-time-high/',
  plugins: [react()],
})
