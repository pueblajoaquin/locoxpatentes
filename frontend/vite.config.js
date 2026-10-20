import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// the proxy avoids CORS in development: the backend runs on port 3000
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000'
    }
  }
})
