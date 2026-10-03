export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({
    label: "Plano gratuito", duration_days: 0, price_cents: 0,
    max_file_mb: 10, max_file_bytes: 10 * 1024 * 1024, max_batch: 2,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: {
      restore_achievements: true, change_mode: false, hardcore: false,
      advanced_rules: true, change_difficulty: true, world_icon: true,
      rename: true, remove_behavior_packs: true, add_behavior_packs: 2,
      chunks_restore: { max_chunks: 8, daily_operations: 1 },
      player: { basic_inventory: true, armor: false, ender_chest: false, xp: false, max_enchantment: "vanilla", daily_operations: 2 },
      builder: { daily_operations: 3 },
      convert: { daily_operations: 3 }
    }
  }),
  world1: Object.freeze({
    label: "Créditos de mundo", catalog_label: "1 mundo", duration_days: 0, price_cents: 599, credit_count: 1,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  worlds2v1: Object.freeze({
    label: "2 mundos", duration_days: 0, price_cents: 1190, credit_count: 2,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  ouro: Object.freeze({
    label: "Créditos de mundo", catalog_label: "Ouro · 3 créditos", duration_days: 0, price_cents: 1499, credit_count: 3,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  diamante: Object.freeze({
    label: "Créditos de mundo", catalog_label: "Diamante · 5 créditos", duration_days: 0, price_cents: 2290, credit_count: 5,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  vip24h: Object.freeze({
    label: "Passe 24 horas (legado)", duration_days: 1, price_cents: 599,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true }
  }),
  vip7: Object.freeze({
    label: "Passe 7 dias", duration_days: 7, price_cents: 799,
    max_file_mb: 500, max_file_bytes: 500 * 1024 * 1024, max_batch: 5,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  }),
  vip30: Object.freeze({
    label: "Passe 30 dias", duration_days: 30, price_cents: 2490,
    max_file_mb: null, max_file_bytes: null, max_batch: 10,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  }),
  creator: Object.freeze({
    label: "Criador", duration_days: 30, price_cents: 3990,
    max_file_mb: null, max_file_bytes: null, max_batch: 20,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  })
});
// New SKU: existing receipts keep their original price and credit count.
const WORLD_PROJECT_WINDOW_MS = PLAN_LIMITS.world1.project_window_days * 86400000;
