import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["Safari >= 12", "iOS >= 12"],
      modernPolyfills: false,
      renderLegacyChunks: true
    })
  ],
  build: {
    cssTarget: "safari12",
    modulePreload: false,
    sourcemap: true
  },
  test: {
    environment: "node"
  }
});
