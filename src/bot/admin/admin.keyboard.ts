import { InlineKeyboard } from 'grammy';

export const ADMIN_CALLBACKS = {
  stats: 'admin:stats',
  today: 'admin:today',
  users: 'admin:users',
  recent: 'admin:recent',
  export: 'admin:export',
  broadcastConfirm: 'admin:broadcast:confirm',
  broadcastCancel: 'admin:broadcast:cancel',
} as const;

/** Tasdiqlash tugmalari matnni ID orqali aniq belgilaydi. */
export const BROADCAST_CONFIRM_PATTERN = /^admin:broadcast:confirm:(.+)$/;
export const BROADCAST_CANCEL_PATTERN = /^admin:broadcast:cancel:(.+)$/;

/** Admin panel menyusi. */
export function buildAdminKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Statistika', ADMIN_CALLBACKS.stats)
    .text('📅 Bugun', ADMIN_CALLBACKS.today)
    .row()
    .text('👥 Foydalanuvchilar', ADMIN_CALLBACKS.users)
    .text("📋 So'nggi ovozlar", ADMIN_CALLBACKS.recent)
    .row()
    .text('📤 CSV eksport', ADMIN_CALLBACKS.export);
}

/** Statistika ostidagi yangilash tugmasi. */
export function buildRefreshKeyboard(callback: string): InlineKeyboard {
  return new InlineKeyboard().text('🔄 Yangilash', callback);
}

/**
 * Broadcast'ni tasdiqlash.
 * `id` tugmani AYNAN shu matnga bog'laydi — eski tugma yangi matnni yubormasin.
 */
export function buildBroadcastConfirmKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📢 Yuborish', `${ADMIN_CALLBACKS.broadcastConfirm}:${id}`)
    .row()
    .text('❌ Bekor qilish', `${ADMIN_CALLBACKS.broadcastCancel}:${id}`);
}
