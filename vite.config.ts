import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        manager: "manager.html",
        popup: "popup.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
