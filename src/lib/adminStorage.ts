import { supabase } from './supabase'

export const ADMIN_STORAGE_WARNING_PERCENT = 70

export type AdminStorageStatus = {
  capacityBytes: number
  databaseBytes: number
  editorProjectBytes: number
  editorProjectCount: number
  percentUsed: number
  warning: boolean
  warningPercent: number
}

function byteCount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export async function loadAdminStorageStatus(): Promise<AdminStorageStatus> {
  const { data, error } = await supabase.rpc('get_admin_storage_status')
  if (error) {
    const message = String(error.message ?? '')
    throw new Error(message.includes('ADMIN_REQUIRED')
      ? 'Ehhez adminisztrátori jogosultság szükséges.'
      : message || 'A tárhelyadatok most nem érhetők el.')
  }
  const row = data?.[0]
  if (!row) throw new Error('A tárhelyadatok most nem érhetők el.')
  const capacityBytes = byteCount(row.capacity_bytes)
  const databaseBytes = byteCount(row.database_bytes)
  const warningPercent = Math.min(100, Math.max(1, Number(row.warning_percent) || ADMIN_STORAGE_WARNING_PERCENT))
  const percentUsed = capacityBytes > 0 ? Math.min(100, databaseBytes / capacityBytes * 100) : 0
  return {
    capacityBytes,
    databaseBytes,
    editorProjectBytes: byteCount(row.editor_project_bytes),
    editorProjectCount: byteCount(row.editor_project_count),
    percentUsed,
    warning: percentUsed >= warningPercent,
    warningPercent,
  }
}
