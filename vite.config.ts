import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/saccogame/', // troque pelo nome do seu repo
  plugins: [react()],
})
