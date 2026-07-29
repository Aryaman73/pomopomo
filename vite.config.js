import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works at any GitHub Pages sub-path
// (aryamans.me/pomopomo/), at a site root, or behind another domain.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
