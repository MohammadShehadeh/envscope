// Vite-style framework env (import.meta.env). Only the web app imports @sample/ui,
// so VITE_THEME should be attributed to apps/web and NOT to apps/api.
export const theme = import.meta.env.VITE_THEME ?? "light";
