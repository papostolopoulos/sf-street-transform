import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // base must match the GitHub Pages repo path so asset URLs resolve correctly
  base: '/sf-street-transform/',
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      '8bde9cef-c0fd-44be-b2c0-158c5de8c557-00-1o3lvehsyx8sg.riker.replit.dev'
    ]
  }
});
