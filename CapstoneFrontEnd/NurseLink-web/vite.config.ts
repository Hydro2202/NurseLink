import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    // ANALYZE=1 npm run build writes dist/stats.html (treemap of what's in
    // the bundle, with gzip/brotli sizes). Off by default: it adds build
    // time and nobody needs it for an ordinary deploy.
    process.env.ANALYZE && visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    // No source maps in the shipped build. (This is already Vite's default;
    // stated explicitly so it can't be silently flipped on later.)
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React, ReactDOM and the router change far less often than app
          // code, so they get their own long-cached chunk — a deploy that
          // only touches app code doesn't invalidate this for returning
          // visitors.
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'vendor';
          }
        },
      },
    },
  },
})
