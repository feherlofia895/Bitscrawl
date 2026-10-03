import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

function currentRevision() {
  if (process.env.CF_PAGES_COMMIT_SHA) {
    return process.env.CF_PAGES_COMMIT_SHA.slice(0, 12)
  }

  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'local'
  }
}

const buildStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const buildId = process.env.BITSCRAWL_BUILD_ID ?? `${currentRevision()}-${buildStamp}`

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BITSCRAWL_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: 'bitscrawl-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: `${JSON.stringify({ buildId })}\n`,
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    open: true,
    port: 5173,
    strictPort: true,
  },
})
