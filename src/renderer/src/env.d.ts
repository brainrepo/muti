/// <reference types="vite/client" />
import type { MutiApi } from '../../shared/types.ts'

declare global {
  interface Window {
    muti: MutiApi
  }
}
