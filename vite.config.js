import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative asset paths — required for the built app to load correctly
  // inside the Capacitor Android WebView; harmless for normal web hosting.
  base: './',
  plugins: [react(), tailwindcss()],
})