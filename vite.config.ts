import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path is intentionally NOT hardcoded here. The GitHub Actions deploy
// workflow passes --base=/${{ github.event.repository.name }}/ at build time;
// local dev and `vite preview` fall back to Vite's default '/'. Runtime code
// must read the base via import.meta.env.BASE_URL, never a literal.
export default defineConfig({
  plugins: [react()],
});
