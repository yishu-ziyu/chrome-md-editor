import { resolve } from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";

// 从 package.json 注入版本，避免 APP_VERSION 与 manifest 手动不同步（曾出现 1.4.15 发布但代码仍报 1.4.8）。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(__dirname, "src/editor.html"),
        index: resolve(__dirname, "src/index.html"),
        compare: resolve(__dirname, "src/compare.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
