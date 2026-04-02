import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy /serve-video to the FastAPI server so Remotion's fetch()
      // doesn't hit CORS issues (same-origin request)
      '/serve-video': 'http://localhost:8000',
    },
  },
})
